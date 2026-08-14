import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["apps", "packages", "scripts"];
const files = [];

async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if ([".js", ".mjs"].includes(extname(entry.name))) files.push(full);
  }
}

for (const root of roots) await walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax check passed (${files.length} files)`);
