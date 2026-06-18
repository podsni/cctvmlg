/**
 * Deploy to Cloudflare Pages.
 *
 * Reads the CF API token from ~/.config/.wrangler/config/default.toml —
 * shell env-var assignment tends to redact long tokens mid-write, so we
 * grab the value from the on-disk config file at runtime. This matches
 * how hadestv deploys.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_PATH = join(
  homedir(),
  ".config",
  ".wrangler",
  "config",
  "default.toml",
);

function loadToken() {
  if (!existsSync(TOKEN_PATH)) {
    console.error(`No CF token at ${TOKEN_PATH}`);
    process.exit(1);
  }
  const text = readFileSync(TOKEN_PATH, "utf-8");
  const m = text.match(/^api_token\s*=\s*"([^"]+)"/m);
  if (!m) {
    console.error(`No api_token in ${TOKEN_PATH}`);
    process.exit(1);
  }
  return m[1];
}

const token = loadToken();
console.log(`Token loaded (${token.length} chars), starting wrangler`);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/deploy.mjs <wrangler args>");
  process.exit(1);
}

// Pass token via env to avoid shell-level redaction of long tokens.
const result = spawnSync("npx", ["wrangler", ...args], {
  stdio: "inherit",
  env: { ...process.env, CLOUDFLARE_API_TOKEN: token },
});

process.exit(result.status ?? 1);
