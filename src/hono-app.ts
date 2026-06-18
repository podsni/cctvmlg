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
import { loadCameras } from "./api";
import { renderApp } from "./ssr";

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

/** Common headers we send to the upstream CCTV server. */
function upstreamHeaders(): Record<string, string> {
  return {
    Referer: UPSTREAM_REFERER,
    Origin: UPSTREAM_ORIGIN,
    Accept: "*/*",
    "User-Agent": UA,
  };
}

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

app.get("/api/cameras", async (c) => {
  try {
    const cameras = await loadCameras();
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
  try {
    const resp = await fetch(upstreamUrl, edgeInit(upstreamHeaders()));

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
  try {
    const resp = await fetch(upstreamUrl, edgeInit(upstreamHeaders()));

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

app.get("/", async (c) => {
  let cameras: Awaited<ReturnType<typeof loadCameras>> = [];
  let upstreamError: string | null = null;
  try {
    cameras = await loadCameras();
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
