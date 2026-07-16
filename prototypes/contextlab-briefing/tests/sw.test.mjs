/**
 * Service-worker asset-reference tests: every precached path must exist on
 * disk, and the shell's essential files must be in the precache list.
 * Run: node --test "prototypes/contextlab-briefing/tests/*.test.mjs"
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const swSource = await readFile(path.join(root, 'sw.js'), 'utf8');

function extractPrecache(source) {
  const match = source.match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(match, 'sw.js must declare a PRECACHE array');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const precache = extractPrecache(swSource);

test('every precached asset exists on disk', async () => {
  for (const entry of precache) {
    if (entry === './') continue; // served as index.html
    await assert.doesNotReject(
      access(path.join(root, entry)),
      `precached asset missing on disk: ${entry}`,
    );
  }
});

test('the app shell and edition data are precached for offline reading', () => {
  for (const required of [
    './index.html',
    './styles.css',
    './app.mjs',
    './model.mjs',
    './manifest.webmanifest',
    './data/stories.json',
  ]) {
    assert.ok(precache.includes(required), `${required} must be precached`);
  }
});

test('index.html references only assets the prototype ships', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
    .map((m) => m[1])
    .filter((href) => !href.startsWith('http'));
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    await assert.doesNotReject(access(path.join(root, ref)), `index.html references missing file: ${ref}`);
  }
});

test('manifest icons exist and manifest parses', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.icons.length >= 1);
  for (const icon of manifest.icons) {
    await assert.doesNotReject(access(path.join(root, icon.src)), `manifest icon missing: ${icon.src}`);
  }
});
