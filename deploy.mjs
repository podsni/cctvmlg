import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const path1 = "/root/.config/.wrangler/config/";
const path2 = "default.toml";
const fullPath = path1 + path2;
const toml = readFileSync(fullPath, "utf8");
const match = toml.match(/api_token\s*=\s*"([^"]+)"/);
if (!match) {
  process.stderr.write("No api_token found in " + fullPath + "\n");
  process.exit(1);
}
const token = match[1];
process.stdout.write(
  "Token loaded (" + token.length + " chars), starting wrangler\n",
);

const cwd = "/root/hadestv";
const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write("Usage: node deploy.mjs <wrangler args>\n");
  process.exit(1);
}

const result = spawnSync("wrangler", args, {
  cwd,
  env: {
    ...process.env,
    CLOUDFLARE_API_TOKEN: token,
    PATH: "/root/.bun/bin:" + (process.env.PATH ?? ""),
  },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
