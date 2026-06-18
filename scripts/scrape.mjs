/**
 * Scrape CCTV Malang data via CloakBrowser.
 *
 /**
  * Scrape CCTV Malang data + session cookies via CloakBrowser.
  *
  * Runs the same Playwright API as a vanilla Chromium install, but with
  * CloakBrowser's source-level fingerprint patches — sufficient to pass
  * the government CCTV site's anti-bot checks without needing residential
  * proxies.
  *
  * Outputs:
  *   - data/cameras.json  — 253 camera records
  *   - data/cookies.json — session cookies from the landing page,
  *     used by the Cloudflare Worker for the stream proxy (CCTV upstream
  *     blocks CF data-center IPs from receiving cookies directly).
  */
 import { launch } from "cloakbrowser";
 import { writeFile } from "node:fs/promises";

 const TARGET = "https://cctv.malangkota.go.id/sebaran-cctv";
 const API = "https://cctv.malangkota.go.id/api/v2/get-cameras";
 const OUT_CAMERAS = "/root/cctvMlg/data/cameras.json";
 const OUT_COOKIES = "/root/cctvMlg/data/cookies.json";

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
     viewport: { width: 1280, height: 800 },
   });

   const page = await context.newPage();

   console.log("Loading page:", TARGET);
   await page.goto(TARGET, { waitUntil: "networkidle", timeout: 60_000 });
   await page.waitForTimeout(3_000);

   // ---- 1. Pull cookies set by the landing page so the Worker can reuse
   // them when proxying streams. CF Workers' data-center IPs get 403'd
   // when fetching the landing page directly, so we have to capture
   //session cookies via a real-browser visit.
   const cookies = await context.cookies(TARGET);
   console.log(`Acquired ${cookies.length} cookies from landing page`);
   const cookiePairs = cookies.map(
     (c) => `${c.name}=${c.value}`,
   );
   const cookieHeader = cookiePairs.join("; ");
   const cookieExpiry = cookies.reduce(
     (min, c) => (c.expires && c.expires < min ? c.expires : min),
     Number.POSITIVE_INFINITY,
   );

   // ---- 2. Pull all 253 cameras via the upstream API, iterating
   // kecamatan 1–5.
   const KECAMATAN_IDS = [1, 2, 3, 4, 5];
   const aggregated = { all: [], byKecamatan: {} };

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
     } catch {
       console.error(`  HTTP ${result.status} non-JSON`);
       continue;
     }

     const list = parsed?.msg_detail?.list_data;
     if (!Array.isArray(list)) {
       console.log(`  Empty/invalid for id=${id}`);
       continue;
     }
     console.log(`  ${list.length} cameras in kecamatan ${id}`);
     aggregated.byKecamatan[String(id)] = list;
     aggregated.all.push(...list);
   }

   await page.screenshot({
     path: "/root/cctvMlg/data/page.png",
     fullPage: false,
   });

   const camerasOut = {
     scrapedAt: new Date().toISOString(),
     totalCameras: aggregated.all.length,
     byKecamatan: aggregated.byKecamatan,
     cameras: aggregated.all,
   };
   await writeFile(OUT_CAMERAS, JSON.stringify(camerasOut, null, 2));
   console.log(`Wrote ${OUT_CAMERAS} — ${aggregated.all.length} cameras`);

   const cookiesOut = {
     scrapedAt: new Date().toISOString(),
     expiresAt: Number.isFinite(cookieExpiry)
       ? new Date(cookieExpiry * 1000).toISOString()
       : null,
     cookieHeader,
     cookies,
   };
   await writeFile(OUT_COOKIES, JSON.stringify(cookiesOut, null, 2));
   console.log(
     `Wrote ${OUT_COOKIES} — ${cookies.length} cookies, expires ${cookiesOut.expiresAt ?? "n/a"}`,
   );
 } finally {
   await browser.close();
 }

