import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CameraSchema, type Camera } from "./schemas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function camerasJsonPath(): string {
  return resolve(__dirname, "..", "data", "cameras.json");
}

let cache: Camera[] | null = null;

export async function loadCameras(): Promise<Camera[]> {
  if (cache) return cache;
  const path = camerasJsonPath();
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as {
    scrapedAt: string;
    totalCameras: number;
    cameras: Camera[];
  };
  cache = parsed.cameras.map((c) => CameraSchema.parse(c));
  return cache;
}

export function getCachedCameras(): Camera[] | null {
  return cache;
}
