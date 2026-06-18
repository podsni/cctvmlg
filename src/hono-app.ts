/**
 * Hono app for cctvMlg.
 *
 * Routes:
 *   GET  /                   SSR HTML
 *   GET  /api/health         Liveness probe
 *   GET  /api/cameras        All 253 cameras (Zod-validated)
 *   GET  /api/stream/:id     HLS manifest proxy (rewrites segment URLs)
 *   GET  /api/segment/:id/:seq  HLS segment proxy
 *
 * The upstream CCTV server requires `Referer: https://cctv.malangkota.go.id/`
 * and a session cookie — both are set here so the browser sees only our
 * domain. CORS issues disappear because manifest + segments both come
 * from the same origin (this Worker).
 */
import { Hono } from "hono";
import { getCameras } from "./api";
import { renderApp } from "./ssr";
import { bakedCookieHeader } from "./_data_cookies";

export interface AppEnv {
  /** Static asset binding (Pages [assets]) — unused for now but kept for parity. */
  STATIC?: { fetch: (request: Request) => Promise<Response> };
}

export const app = new Hono<{ Bindings: AppEnv }>();

const UPSTREAM_BASE = "https://cctv.malangkota.go.id";
const UPSTREAM_REFERER = `${UPSTREAM_BASE}/sebaran-cctv`;
const UPSTREAM_ORIGIN = UPSTREAM_BASE;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Common headers we send to the upstream CCTV server. Mimics a real
 *  Chrome browser closely enough that the upstream's WAF lets us through
 *  when combined with valid session cookies. */
function upstreamHeaders(cookies: string): Record<string, string> {
  return {
    Referer: UPSTREAM_REFERER,
    Origin: UPSTREAM_ORIGIN,
    Accept: "*/*",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Cookie: cookies,
    "User-Agent": UA,
  };
}

/** Returns the baked-in session cookie header captured by `bun run scrape`.
 *  Returns empty string if not yet scraped — stream endpoints will fail
 *  with 503 until the deploy is refreshed. */
const bakedCookies: string = bakedCookieHeader ?? "";

/** CORS for /api/* (allow any origin). We proxy segments so this is safe. */
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/** Edge fetch options — adds cache hints. */
function edgeInit(headers: Record<string, string>): RequestInit {
  return {
    headers,
    cf: { cacheTtl: 60, cacheEverything: true },
  } as unknown as RequestInit;
}

/**
 * The CCTV upstream requires session cookies that are only set after the
 * browser visits the landing page. We mirror that visit once per edge
 * region and stash the cookies in the CF Cache API, then reuse them for
 * subsequent stream + segment fetches. Without this, every request 403s.
 */
async function getSessionCookieHeader(): Promise<string> {
  const cache = caches as unknown as {
    default: {
      match: (req: Request | string) => Promise<Response | undefined>;
      put: (req: Request, resp: Response) => Promise<void>;
    };
  };
  const cacheKey = new Request(
    "https://internal.cctvmlg.local/session-cookies",
  );
  const cached = await cache.default.match(cacheKey);
  if (cached) {
    return await cached.text();
  }

  // Fetch the landing page to acquire session cookies. The landing page
  // itself is cached at edge so this is one upstream round-trip per
  // region per cache TTL.
  const landingResp = await fetch(UPSTREAM_BASE + "/sebaran-cctv", {
    headers: {
      Referer: UPSTREAM_REFERER,
      Origin: UPSTREAM_ORIGIN,
      Accept: "text/html",
      "User-Agent": UA,
    },
    cf: { cacheTtl: 1800, cacheEverything: true },
  } as unknown as RequestInit);

  if (!landingResp.ok) {
    throw new Error(`Landing fetch failed: ${landingResp.status}`);
  }

  // Extract cookie pairs from the response Set-Cookie headers. We send
  // Extract cookie pairs from the Set-Cookie response. Some Workers
  // runtimes don't expose Headers.getSetCookie(), so fall back to the
  // raw combined header (it's a single comma-delimited string there).
  const headersAny = landingResp.headers as unknown as {
    getSetCookie?: () => string[];
  };
  const rawSetCookie = landingResp.headers.get("set-cookie") ?? "";
  const combined = headersAny.getSetCookie?.() ?? [];
  const cookies =
    combined.length > 0 ? combined : rawSetCookie.split(/,(?=[^;]+=)/);
  const cookiePairs = cookies
    .map((sc) => sc.split(";")[0]?.trim() ?? "")
    .filter((c) => c.length > 0);

  const cookieHeader = cookiePairs.join("; ");
  const response = new Response(cookieHeader, {
    headers: { "cache-control": "max-age=1800" },
  });
  await cache.default.put(cacheKey, response);
  return cookieHeader;
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.get("/api/health", (c) =>
  c.json({
    ok: true as const,
    total: 0,
    fetchedAt: new Date().toISOString(),
  }),
);

app.get("/api/debug/upstream-test", async (c) => {
  const streamId = c.req.param("id") ?? "637253114452609264665590";
  if (!/^\d{15,30}$/.test(streamId)) {
    return c.json({ ok: false, error: "bad stream id" }, 400);
  }
  const headers = upstreamHeaders(bakedCookies);
  try {
    const resp = await fetch(
      `${UPSTREAM_BASE}/cctv-stream/streams/${streamId}.m3u8`,
      {
        headers,
        cf: { cacheTtl: 0, cacheEverything: false },
      } as unknown as RequestInit,
    );
    const text = await resp.text();
    return c.json({
      ok: resp.ok,
      status: resp.status,
      cookiesBaked: bakedCookies ? `${bakedCookies.length} chars` : "EMPTY",
      headersSent: headers,
      upstreamResponsePreview: text.slice(0, 300),
      upstreamResponseHeaders: {
        contentType: resp.headers.get("content-type"),
        server: resp.headers.get("server"),
        cfRay: resp.headers.get("cf-ray"),
      },
    });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

app.get("/api/cameras", (c) => {
  try {
    const cameras = getCameras();
    return c.json(
      {
        ok: true as const,
        total: cameras.length,
        fetchedAt: new Date().toISOString(),
        cameras,
      },
      200,
      {
        "cache-control":
          "public, max-age=300, s-maxage=600, stale-while-revalidate=86400",
        ...corsHeaders(),
      },
    );
  } catch (err) {
    return c.json(
      {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      },
      500,
      corsHeaders(),
    );
  }
});

/**
 * HLS manifest proxy. Fetches the upstream playlist, rewrites segment
 * URLs so they also flow through this Worker, returns the rewritten
 * manifest with cache headers.
 */
app.get("/api/stream/:id", async (c) => {
  const streamId = c.req.param("id");
  if (!/^\d{15,30}$/.test(streamId)) {
    return c.json(
      { ok: false, error: "Invalid stream id" },
      400,
      corsHeaders(),
    );
  }

  const upstreamUrl = `${UPSTREAM_BASE}/cctv-stream/streams/${streamId}.m3u8`;
  if (!bakedCookies) {
    return c.json(
      {
        ok: false,
        error:
          "Worker has no baked cookies — run `bun run scrape && bun run build && bun run deploy` first.",
      },
      503,
      corsHeaders(),
    );
  }
  try {
    const resp = await fetch(
      upstreamUrl,
      edgeInit(upstreamHeaders(bakedCookies)),
    );

    if (!resp.ok) {
      return c.json(
        { ok: false, error: `Upstream ${resp.status}`, upstreamUrl },
        resp.status as 502,
        corsHeaders(),
      );
    }

    const text = await resp.text();
    // Rewrite segment URLs (e.g. "637..._0p822209.ts" → "/api/segment/637.../822209.ts").
    const rewritten = text.replace(
      /^([0-9]+)_0p([0-9]+)\.ts$/gm,
      `/api/segment/$1/$2.ts`,
    );

    return new Response(rewritten, {
      status: 200,
      headers: {
        "content-type":
          resp.headers.get("content-type") ?? "application/vnd.apple.mpegurl",
        "cache-control":
          "public, max-age=10, s-maxage=30, stale-while-revalidate=60",
        "x-cctvmlg-stream": streamId,
        ...corsHeaders(),
      },
    });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      502,
      corsHeaders(),
    );
  }
});

/**
 * HLS segment proxy. :id is the stream id, :seq is the segment sequence
 * number. Fetches the upstream .ts file with proper Referer.
 */
app.get("/api/segment/:id/:seq", async (c) => {
  const streamId = c.req.param("id");
  const seq = c.req.param("seq");
  if (!/^\d{15,30}$/.test(streamId) || !/^\d+$/.test(seq)) {
    return c.text("Bad request", 400);
  }

  const upstreamUrl = `${UPSTREAM_BASE}/cctv-stream/streams/${streamId}_0p${seq}.ts`;
  if (!bakedCookies) {
    return c.text("Worker has no baked cookies — refresh the deploy.", 503);
  }
  try {
    const resp = await fetch(
      upstreamUrl,
      edgeInit(upstreamHeaders(bakedCookies)),
    );

    if (!resp.ok) {
      return c.text(`Upstream ${resp.status}`, resp.status as 502);
    }

    const body = await resp.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": resp.headers.get("content-type") ?? "video/mp2t",
        "content-length": String(body.byteLength),
        "cache-control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
        "x-cctvmlg-segment": `${streamId}/${seq}`,
      },
    });
  } catch (err) {
    return c.text(err instanceof Error ? err.message : "Proxy error", 502);
  }
});

// ---------------------------------------------------------------------------
// SSR home — Pages serves this for /, everything else goes to /api/* above.
// ---------------------------------------------------------------------------

app.get("/", (c) => {
  let cameras: ReturnType<typeof getCameras> = [];
  let upstreamError: string | null = null;
  try {
    cameras = getCameras();
  } catch (err) {
    upstreamError = err instanceof Error ? err.message : String(err);
  }

  const html = renderApp({
    initialCameras: cameras,
    upstreamError,
    requestUrl: c.req.url,
  });
  return c.html(html, 200, {
    "cache-control":
      "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    "x-cctvmlg-render": "ssr",
  });
});

app.notFound((c) => c.notFound());
