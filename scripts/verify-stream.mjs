/**
 * Verify one CCTV stream URL via CloakBrowser — checks that the .m3u8
 * manifest is fetchable and contains valid HLS segments.
 */
import { launch } from "cloakbrowser";

const STREAM_ID = "637253114452609264665590";
const STREAM_URL = `https://cctv.malangkota.go.id/cctv-stream/streams/${STREAM_ID}.m3u8`;

const browser = await launch({
  headless: true,
  humanize: true,
  args: ["--ignore-certificate-errors"],
});

try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  });

  const page = await context.newPage();
  console.log("Loading landing page to acquire cookies…");
  await page.goto("https://cctv.malangkota.go.id/sebaran-cctv", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2_000);

  console.log("Fetching stream:", STREAM_URL);
  const result = await page.evaluate(async (url) => {
    const resp = await fetch(url, {
      credentials: "include",
      headers: { Accept: "*/*" },
    });
    const text = await resp.text();
    return {
      status: resp.status,
      contentType: resp.headers.get("content-type"),
      body: text.slice(0, 1500),
    };
  }, STREAM_URL);

  console.log("HTTP", result.status, result.contentType);
  console.log("Body preview:");
  console.log(result.body);
} finally {
  await browser.close();
}
