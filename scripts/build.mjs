import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/packages/core", { recursive: true });
await cp("apps/studio", "dist/apps/studio", { recursive: true });
await cp("packages/core/src", "dist/packages/core/src", { recursive: true });
await cp("apps/studio/index.html", "dist/index.html");
console.log("Built static studio into dist/");
