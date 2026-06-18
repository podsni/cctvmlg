# cctvMlg

> Live CCTV viewer untuk Kota Malang — peta interaktif, multi-play video untuk 253 kamera lalu lintas & publik.

**Live**: https://cctvmlg-beta.pages.dev/

## Stack

- **Runtime**: Bun + tsgo + oxlint + oxfmt
- **Backend**: Cloudflare Pages Functions (Hono 4 + Zod 4)
- **Frontend**: React 19 + hls.js + Leaflet (CDN)
- **Source**: https://cctv.malangkota.go.id/sebaran-cctv
- **Data**: 253 cameras scraped via [cloakbrowser.dev](https://cloakbrowser.dev) (CloakBrowser = Chromium with source-level fingerprint patches)

## Development

```bash
bun install
bun run scrape         # scrape 253 cameras + session cookies
bun run build          # build static assets + worker bundle
bun run dev            # wrangler pages dev (local emulation)
bun run deploy         # build + deploy to CF Pages
```

## Architecture

```
Browser ──► Cloudflare Pages
            │
            ├──► Static assets (/style.css, /client.js)
            │
            └──► Pages Functions (Hono Worker)
                 │
                 ├── GET /            (SSR HTML)
                 ├── GET /api/health
                 ├── GET /api/cameras (Zod-validated)
                 ├── GET /api/stream/:id    (HLS manifest proxy)
                 └── GET /api/segment/:id/:seq  (HLS segment proxy)
                       │
                       ▼
                 Cookies (baked from scrape.mjs)
                       │
                       ▼
                 cctv.malangkota.go.id
```

## Stream proxy + cookies

The upstream CCTV server requires session cookies set after visiting
`/sebaran-cctv`. CF Workers' data-center IPs get blocked when fetching
the landing page directly (WAF), so we capture cookies via a real-browser
visit during the scrape job and bake them into the Worker:

```bash
bun run scrape  # writes data/cameras.json + data/cookies.json
bun run build   # embeds data/*.json into src/_data_*.ts
bun run deploy  # deploys the new cookies
```

**Cookie TTL is ~1 hour.** Refresh by re-running the pipeline.

If the proxy still fails (WAF rejects even with valid cookies), the UI
offers an "Open source" button to launch the upstream URL in a new tab
where it works from the user's browser with full cookies.

## Project structure

```
cctvMlg/
├── data/                   # scraped cameras + cookies (regenerated)
├── scripts/
│   ├── scrape.mjs          # CloakBrowser scraper
│   ├── verify-stream.mjs   # smoke test one stream
│   └── deploy.mjs          # CF deploy with token-bypass
├── src/
│   ├── app.tsx             # React app (SSR-safe)
│   ├── client.tsx          # hydrate
│   ├── hono-app.ts         # Worker routes + proxy
│   ├── schemas.ts          # Zod
│   ├── ssr.tsx             # renderToString
│   ├── style.css           # mobile-first editorial CSS
│   ├── _data_cameras.ts    # GENERATED — camera JSON inlined
│   ├── _data_cookies.ts    # GENERATED — cookies inlined
│   └── index.ts            # build script
├── functions/
│   ├── index.ts            # SSR entry
│   └── api/[[path]].ts     # API catch-all
├── PRD.md                  # product requirements doc
├── PRODUCT.md              # impeccable skill product brief
└── package.json
```

## Quality gates

```bash
bun run check   # typecheck + lint + format
bun test        # unit tests (parser + scrape)
```

## PRD

See [PRD.md](./PRD.md) and [PRODUCT.md](./PRODUCT.md).

## License

MIT. CCTV data sourced from Pemerintah Kota Malang public domain.
