/**
 * Scrape CCTV Malang data via CloakBrowser.
 *
 * Runs the same Playwright API as a vanilla Chromium install, but with
 * CloakBrowser's source-level fingerprint patches — sufficient to pass
 * the government CCTV site's anti-bot checks without needing residential
 * proxies.
 */
import { launch } from "cloakbrowser";
import { writeFile } from "node:fs/promises";

const TARGET = "https://cctv.malangkota.go.id/sebaran-cctv";
const API = "https://cctv.malangkota.go.id/api/v2/get-cameras";
const OUT = "/root/cctvMlg/data/cameras.json";

const browser = await launch({
  headless: true,
  humanize: true,
  args: [
    "--ignore-certificate-errors",
    "--disable-web-security",
  ],
});

try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  console.log("Loading page:", TARGET);
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(3_000);

  // Try fetching the API from the page context (cookies + origin set).
  // The API expects POST with multipart FormData containing m_kecamatan_id.
  // Dropdown options are kecamatan ids: BLIMBING=1, KLOJEN=2, KEDUNGKANDANG=3,
  // SUKUN=4, LOWOKWARU=5. Iterate all of them to gather every camera.
  const KECAMATAN_IDS = [1, 2, 3, 4, 5];
  const aggregated = { all: [], byKecamatan: {} };
  const domHints = [];

  for (const id of KECAMATAN_IDS) {
    console.log(`POST get-cameras m_kecamatan_id=${id}`);
    const result = await page.evaluate(
      async ([url, kecId]) => {
        const form = new FormData();
        form.append("m_kecamatan_id", String(kecId));
        const resp = await fetch(url, {
          method: "POST",
          body: form,
          credentials: "include",
        });
        const text = await resp.text();
        return {
          status: resp.status,
          contentType: resp.headers.get("content-type"),
          body: text,
        };
      },
      [API, id],
    );

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch (e) {
      console.error(`  HTTP ${result.status} non-JSON:`, result.body.slice(0, 200));
      continue;
    }

    const detail = parsed?.msg_detail;
    // API shape: msg_detail = { m_kecamatan_id, list_data: [...] }
    const list = Array.isArray(detail?.list_data) ? detail.list_data : null;
    if (!list) {
      console.log(`  Empty/invalid for id=${id}:`, JSON.stringify(parsed?.msg_main));
      console.log(`  detail type:`, typeof detail, detail === null ? "null" : Object.keys(detail ?? {}));
      continue;
    }
    console.log(`  ${list.length} cameras in kecamatan ${id}`);
    aggregated.byKecamatan[String(id)] = list;
    aggregated.all.push(...list);
  }

  // Also collect DOM stream links as fallback.
  const domStreamLinks = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll("a, video, iframe, source"),
    )
      .map((el) => el.src || el.href || "")
      .filter(
        (s) =>
          s.includes("cctv") ||
          s.includes(".m3u8") ||
          s.includes(".mp4") ||
          s.includes("stream"),
      );
    return Array.from(new Set(links));
  });
  domHints.push(...domStreamLinks);

  // Inspect first camera object so we can see the exact schema.
  const firstCam = aggregated.all[0];
  if (firstCam) {
    console.log("Sample camera keys:", Object.keys(firstCam).join(","));
    console.log("Sample camera:", JSON.stringify(firstCam, null, 2).slice(0, 800));
  }

  await page.screenshot({ path: "/root/cctvMlg/data/page.png", fullPage: false });
  console.log("Saved screenshot to data/page.png");

  const out = {
    scrapedAt: new Date().toISOString(),
    totalCameras: aggregated.all.length,
    byKecamatan: aggregated.byKecamatan,
    cameras: aggregated.all,
    domStreamLinks: domHints,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log("Wrote", OUT, "— total cameras:", aggregated.all.length);
} finally {
  await browser.close();
}
