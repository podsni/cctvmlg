# cctvMlg — Product Brief

## One-line description

Live CCTV viewer for Kota Malang — map + multi-play video for 253 traffic & public cameras.

## Source

https://cctv.malangkota.go.id/sebaran-cctv (public domain, link back to source).

## Data shape

- 253 cameras across 5 kecamatan (BLIMBING 53, KLOJEN 115, KEDUNGKANDANG 33, SUKUN 19, LOWOKWARU 33)
- Each camera: id, name, stream_id, address, lat/lng, kecamatan_id
- Stream URL: `cctv-stream/streams/{stream_id}.m3u8` — requires Referer to upstream; proxied via Worker

## Core user journeys

1. Open map → see all 253 markers on a Leaflet map of Kota Malang
2. Click a marker → opens popup with "▶ Putar" link → adds to multi-play grid
3. Search by street name / address → filters list + map
4. Filter by 5 kecamatan via chip tabs
5. Browse list view (paginated 24/page) → click to add to multi-play
6. Multi-play: up to 6 streams simultaneously, each with mute/close controls

## Stack

- **Frontend**: React 19 + Hono SSR + hls.js + Leaflet (CDN)
- **Backend**: Cloudflare Pages Functions (Worker) — proxy streams with proper Referer
- **Tooling**: Bun + tsgo + oxlint + oxfmt
- **Data**: Static JSON scraped via CloakBrowser (one-shot + on deploy)

## Design register

Editorial / newspaper feel — warm cream paper, Fraunces display + Inter Tight sans, hairline rules, aged gold accent. Per `hadestv` lineage. Mobile-first responsive.

## Non-goals

- No recordings (live only)
- No auth
- No native app
