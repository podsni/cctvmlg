# cctvMlg — Product Requirements Document

> Live CCTV viewer untuk Kota Malang — peta interaktif + multi-play video player untuk 253 kamera lalu lintas & publik.

## 1. Goal

Bikin web app yang nampilin **253 CCTV kamera Pemerintah Kota Malang** secara real-time. User bisa:

- Lihat semua kamera di peta interaktif (Leaflet)
- Buka beberapa stream sekaligus (multi-play)
- Filter per kecamatan
- Cari kamera berdasarkan nama jalan / alamat

Data source: `https://cctv.malangkota.go.id/sebaran-cctv` (Pemerintah Kota Malang, domain publik, free to redistribute for non-commercial purposes — link back ke source).

## 2. Non-goals

- Tidak menyimpan rekaman CCTV (cuma live stream)
- Tidak ada user authentication
- Tidak ada payment / monetisasi
- Tidak embed di app native — pure web

## 3. User stories

| #   | As a …       | I want to …                        | So that …                                |
| --- | ------------ | ---------------------------------- | ---------------------------------------- |
| 1   | warga Malang | lihat peta CCTV kota               | tau kondisi lalu lintas real-time        |
| 2   | warga        | buka beberapa kamera sekaligus     | bandingin titik macet di beberapa lokasi |
| 3   | warga        | filter berdasarkan kecamatan       | fokus ke area rumah/kantor               |
| 4   | warga        | cari kamera berdasarkan nama jalan | cepet nemuin lokasi yang dikenal         |
| 5   | mobile user  | buka app di HP                     | mantau dari mana aja                     |
| 6   | user         | share URL dengan #camera-{id}      | kirim link spesifik ke temen             |

## 4. Functional requirements

### 4.1 Data

- Scrape dari `https://cctv.malangkota.go.id/api/v2/get-cameras` (POST `m_kecamatan_id`)
- 5 kecamatan: BLIMBING (53), KLOJEN (115), KEDUNGKANDANG (33), SUKUN (19), LOWOKWARU (33) = **253 cameras total**
- Setiap kamera punya: `id` (UUID), `name`, `stream_id` (24-digit), `address`, `latitude`, `longitude`, `kecamatan_id`, `nama_kecamatan`, `status`
- Stream URL pattern: `https://cctv.malangkota.go.id/cctv-stream/streams/{stream_id}.m3u8`
- Segment pattern: `{stream_id}_0p{seq}.ts`

### 4.2 Stream proxy

Upstream CCTV server requires:

- `Referer: https://cctv.malangkota.go.id/sebaran-cctv`
- Cookies set by visiting the landing page

Workaround: Cloudflare Worker proxy that sets Referer + cookies when fetching from upstream. Browser hits `https://cctvmlg.../api/stream/{stream_id}.m3u8`, Worker fetches upstream, rewrites segment URLs to also go through Worker, returns rewritten manifest.

### 4.3 Map view (Leaflet)

- Center: Kota Malang (-7.97, 112.63), zoom 12
- 253 markers — color-coded by status
- Marker click → opens camera panel + adds to multi-play
- Marker cluster for zoomed-out views (>20 visible)
- "Locate me" button — geolocation + center map

### 4.4 Grid view

- Cards in responsive grid (1/2/3/4 columns)
- Click card → multi-play
- Hover → highlight on map
- Search bar at top — filter by name/address
- Filter chips — All / 5 kecamatan

### 4.5 Multi-play

- Up to 6 streams simultaneously
- Responsive grid: 1=col, 2=cols, 3-4=cols
- Per-stream controls:
  - Close (×)
  - Mute / unmute toggle
  - Open source in new tab (fallback)
  - Show camera info (name + kecamatan)
- Header: "Sedang Tayang · N stream" + "Tutup semua"
- Keyboard: `Esc` close all, `C` close most recent

### 4.6 Performance

- Initial HTML ≤ 80KB (mobile-friendly first paint)
- Lazy-load Leaflet & camera data on demand
- Stream segments cached at edge (5min TTL)
- Manifest cached (30s TTL)

### 4.7 Search

- 200ms debounce
- Searches name + address + kecamatan
- Shows result count with `aria-live="polite"`

### 4.8 Mobile

- 44px touch targets
- Single-column stream grid
- Map full-width with collapsible sidebar
- Bottom sheet for camera list on mobile

## 5. Non-functional requirements

### 5.1 Tech stack

- **Runtime**: Bun (build + dev) → Cloudflare Workers (prod)
- **SSR**: Hono 4 + React 19 + renderToString
- **Validation**: Zod 4
- **Player**: hls.js (CDN: jsdelivr)
- **Map**: Leaflet 1.9 (CDN: unpkg)
- **Styling**: vanilla CSS with editorial design system
- **Type check**: tsgo
- **Lint**: oxlint
- **Format**: oxfmt

### 5.2 Design system

Editorial / newspaper feel — warm cream paper, Fraunces display + Inter Tight sans, hairline rules, aged gold accent. Reuses the same tokens as `hadestv`.

### 5.3 Accessibility

- WCAG AA contrast (≥4.5:1)
- 44px touch targets on coarse pointers
- Focus visible everywhere
- `aria-live` for search results
- Keyboard shortcuts documented

### 5.4 Reliability

- Stream errors degrade gracefully — show "Stream unavailable" with "Open in new tab" fallback
- Camera list cached at edge (1h)
- Scrape job runs on deploy + on-demand refresh

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Pages (hadestv-beta project)                    │
│                                                              │
│  ┌────────────────┐    ┌─────────────────────────────┐    │
│  │  Static assets │    │  Pages Functions (Hono)     │    │
│  │  - /style.css  │    │  - GET /         (SSR HTML) │    │
│  │  - /client.js  │    │  - GET /api/cameras         │    │
│  └────────────────┘    │  - GET /api/stream/:id      │    │
│                         │  - GET /api/segment/:id/:s  │    │
│                         └─────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                ▲                ▲               │
                │ HTTPS          │ HTML/JSON     │ HLS proxy
                │                │               ▼
            ┌───┴───┐       ┌────┴─────┐   ┌─────────────────┐
            │ User  │       │ Camera   │   │ cctv.malangkota │
            │browser│       │ data     │   │  .go.id upstream│
            └───────┘       │ (static) │   └─────────────────┘
                             └─────────┘
                                  ▲
                                  │
                          ┌───────┴──────┐
                          │ CloakBrowser │
                          │ (scrape job) │
                          └──────────────┘
```

## 7. Data flow

### 7.1 Scrape (one-shot + on deploy)

1. `scripts/scrape.mjs` uses CloakBrowser (puppeteer-compatible Chromium with anti-bot patches)
2. Visit landing page → acquire cookies
3. POST `/api/v2/get-cameras` with each `m_kecamatan_id` (1-5)
4. Aggregate cameras → `data/cameras.json`
5. Commit + push to repo

### 7.2 SSR (every request)

1. Worker reads `data/cameras.json` from KV/Assets (cached for 1h)
2. Renders React tree with first 24 cameras
3. Returns HTML with embedded `window.__CCTVMLG__` for client hydration

### 7.3 Stream playback (per stream)

1. User clicks camera → `<video>` element created
2. hls.js loads `https://cctvmlg...pages.dev/api/stream/{stream_id}`
3. Worker fetches upstream manifest, rewrites segment URLs
4. hls.js loads segments through Worker
5. Worker fetches each segment with proper Referer + User-Agent

## 8. Folder structure

```
cctvMlg/
├── data/
│   ├── cameras.json          # scraped camera list
│   └── page.png              # scrape screenshot for QA
├── scripts/
│   ├── scrape.mjs            # CloakBrowser scrape
│   └── verify-stream.mjs     # verify one stream plays
├── src/
│   ├── api.ts                # camera data loader
│   ├── app.tsx               # React app (SSR-safe)
│   ├── client.tsx            # hydrateRoot
│   ├── components/
│   │   ├── CameraMap.tsx     # Leaflet wrapper
│   │   ├── CameraCard.tsx    # grid card
│   │   └── StreamPlayer.tsx  # video + hls.js
│   ├── hono-app.ts           # Hono routes + proxy
│   ├── schemas.ts            # Zod schemas
│   ├── ssr.tsx               # renderToString
│   └── style.css             # editorial CSS
├── functions/
│   ├── index.ts              # SSR entry
│   └── api/[[path]].ts       # API + stream proxy
├── public/                   # static assets (built to dist/)
├── wrangler.toml
├── package.json
└── PRD.md                    # this file
```

## 9. Milestones

- [x] M1: Scrape pipeline (CloakBrowser) → `data/cameras.json`
- [ ] M2: Hono Worker with stream proxy
- [ ] M3: Frontend — map + grid + multi-play
- [ ] M4: Deploy + verify live
- [ ] M5: README + CHANGELOG

## 10. Open questions

- **CCTV upstream ToS**: CCTV publik kota, link back to source. Long-running scrape OK?
- **CF Workers CPU limit**: proxying segments uses CPU. Free plan = 10ms CPU/req. Watch for overage.
- **CORS**: We proxy everything, so no browser CORS issues. Confirmed.
- **Bandwidth**: 253 cameras × live HLS = potentially GB/day. CF Workers paid plan covers.

## 11. Success criteria

- [ ] All 253 cameras accessible from the deployed app
- [ ] At least 80% streams play in-browser without "Open in new tab" fallback
- [ ] Initial page load < 2s on 4G
- [ ] Lighthouse mobile score ≥ 85
- [ ] Zero redirect / 403 errors for in-app playback
- [ ] Map renders in < 1s with all 253 markers

---

**Stack lineage**: Reuses the hadestv pattern (Bun + Hono + Zod + CF Pages) + adds Leaflet map + CCTV-specific stream proxy.
