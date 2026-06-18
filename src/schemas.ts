import { z } from "zod";

/**
 * Schemas for CCTV Kota Malang data — sourced from
 * https://cctv.malangkota.go.id/sebaran-cctv (scraped via CloakBrowser).
 *
 * The upstream API returns 253 cameras across 5 kecamatan (sub-districts):
 * BLIMBING (53), KLOJEN (115), KEDUNGKANDANG (33), SUKUN (19),
 * LOWOKWARU (33). Stream URLs follow the pattern
 *   https://cctv.malangkota.go.id/cctv-stream/streams/{stream_id}.m3u8
 * with HLS segments named {stream_id}_0p{seq}.ts.
 */

/** A single CCTV camera entry from the upstream API. */
export const CameraSchema = z.object({
  id: z.string(),
  name: z.string(),
  stream_id: z.string(),
  address: z.string(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  kecamatan_id: z.string(),
  status: z.string(),
  nama_kecamatan: z.string(),
});
export type Camera = z.infer<typeof CameraSchema>;

export const KECAMATAN = [
  { id: "1", name: "Blimbing", lat: -7.954, lng: 112.645 },
  { id: "2", name: "Klojen", lat: -7.971, lng: 112.628 },
  { id: "3", name: "Kedungkandang", lat: -7.99, lng: 112.658 },
  { id: "4", name: "Sukun", lat: -8.01, lng: 112.61 },
  { id: "5", name: "Lowokwaru", lat: -7.94, lng: 112.61 },
] as const;

export type KecamatanId = (typeof KECAMATAN)[number]["id"];

export function kecamatanName(id: string): string {
  return KECAMATAN.find((k) => k.id === id)?.name ?? id;
}

/** Upstream API response shape. */
export const CamerasResponseSchema = z.object({
  msg_main: z.object({
    status: z.boolean(),
    msg: z.string(),
  }),
  msg_detail: z.object({
    m_kecamatan_id: z.string(),
    list_data: z.array(CameraSchema),
  }),
});
export type CamerasResponse = z.infer<typeof CamerasResponseSchema>;

/** Health probe response. */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  total: z.number(),
  fetchedAt: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Stream proxy helpers. */

export function buildStreamUrl(streamId: string): string {
  return `https://cctv.malangkota.go.id/cctv-stream/streams/${streamId}.m3u8`;
}

export function buildSegmentUrl(streamId: string, sequence: string): string {
  return `https://cctv.malangkota.go.id/cctv-stream/streams/${streamId}_0p${sequence}.ts`;
}
