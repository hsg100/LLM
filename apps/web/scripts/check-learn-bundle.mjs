// CI gate (design §7): after `next build`,
//  1. no checkpoint answer material may appear in any client chunk — checked
//     via the grading catalogue's canary string and the `correct_index`
//     field name;
//  2. the /learn routes' client JavaScript stays within a recorded budget so
//     a regression that drags the full catalogue (or worse, the grading
//     file) into client chunks is caught even if the strings mutate.
//
// Run from apps/web after a production build: node scripts/check-learn-bundle.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STATIC_DIR = ".next/static";
const MANIFEST = ".next/app-build-manifest.json";
const CANARY = "__FIELDMAP_GRADING_CANARY__";
const FORBIDDEN = [CANARY, "correct_index"];
// Raw (uncompressed) client-JS budget for any /learn route. The current
// build sits around 300 kB raw (~106 kB first-load); 450 kB leaves headroom
// for legitimate growth while a bundled catalogue/grading leak (which would
// add the full lesson corpus) blows straight through it.
const RAW_BUDGET_BYTES = 450 * 1024;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let failures = 0;
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

// 1a. The grading canary must not appear in ANY client asset — the grading
//     catalogue is api-image-only.
for (const file of walk(STATIC_DIR)) {
  if (!/\.(js|json|txt)$/.test(file)) continue;
  if (readFileSync(file, "utf8").includes(CANARY)) {
    console.error(`LEAK: grading canary found in client asset ${file}`);
    failures++;
  }
}

// 1b. `correct_index` must not appear in any chunk referenced by a /learn
//     route. (The legacy research quiz/review pages legitimately receive
//     correct_index from the landscapes API — existing pre-Phase-2
//     behaviour, scoped out here.)
const learnFiles = new Set();
for (const [route, files] of Object.entries(manifest.pages)) {
  if (!route.startsWith("/learn")) continue;
  for (const f of files) if (f.endsWith(".js")) learnFiles.add(f);
}
for (const f of learnFiles) {
  for (const needle of FORBIDDEN) {
    if (readFileSync(join(".next", f), "utf8").includes(needle)) {
      console.error(`LEAK: ${needle} found in /learn chunk ${f}`);
      failures++;
    }
  }
}

// 2. Per-route raw budget for /learn routes.
const sizes = new Map();
function sizeOf(file) {
  if (!sizes.has(file)) sizes.set(file, statSync(join(".next", file)).size);
  return sizes.get(file);
}
for (const [route, files] of Object.entries(manifest.pages)) {
  if (!route.startsWith("/learn")) continue;
  const js = files.filter((f) => f.endsWith(".js"));
  const total = js.reduce((n, f) => n + sizeOf(f), 0);
  const ok = total <= RAW_BUDGET_BYTES;
  console.log(
    `${ok ? "ok " : "OVER"} ${route}: ${(total / 1024).toFixed(0)} kB raw client JS` +
      ` (budget ${(RAW_BUDGET_BYTES / 1024).toFixed(0)} kB)`
  );
  if (!ok) failures++;
}

if (failures > 0) {
  console.error(`${failures} bundle check failure(s)`);
  process.exit(1);
}
console.log("learn bundle checks passed");
