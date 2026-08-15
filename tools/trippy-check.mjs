#!/usr/bin/env node
/**
 * THE LOOP: run → capture → score → verdict.
 *
 * Builds nothing itself — it boots the production server against `dist/`,
 * drives the real app in headless Chromium through `window.__trip`, reads two
 * real frames back per preset and scores them with the unit-tested analyzer.
 *
 *   node tools/trippy-check.mjs [--shots out/dir] [--threshold 70] [--preset id]
 *
 * Exits non-zero if the experience is not trippy enough. That is the whole
 * point: the work isn't done until this passes.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { tripScore, TRIP_THRESHOLD, TRIP_FLOOR } from './trippiness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', 4319));
const THRESHOLD = Number(arg('threshold', TRIP_THRESHOLD));
const FLOOR = Number(arg('floor', TRIP_FLOOR));
const SHOT_DIR = resolve(root, arg('shots', 'artifacts/frames'));
const ONLY = arg('preset', null);
const SAMPLE = { w: 320, h: 180 };
// Software rendering (SwiftShader) is the only GPU in CI, so keep the surface
// small and the frame counts honest-but-cheap.
const VIEWPORT = { width: Number(arg('width', 720)), height: Number(arg('height', 405)) };
const CHARGE_FRAMES = Number(arg('frames', 90));
/** Extra frames to advance between successive samples along the time horizon. */
const SAMPLE_FRAMES = [0, 105, 105, 105, 105];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Newest mtime under a directory tree. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

/**
 * Refuse to score a stale build. A failed `tsc` leaves the previous bundle in
 * place, and scoring that reports numbers for code that was never compiled —
 * which has already happened twice, both times because of a stray backtick
 * inside a GLSL template literal.
 */
function assertFreshBuild() {
  const src = Math.max(
    newestMtime(join(root, 'src')),
    newestMtime(join(root, 'tools')),
    statSync(join(root, 'index.html')).mtimeMs,
  );
  const built = newestMtime(join(root, 'dist'));
  if (built < src) {
    const age = ((src - built) / 1000).toFixed(0);
    throw new Error(
      `dist/ is ${age}s older than src/ — the build did not succeed. `
      + 'Run `npm run build` and fix the errors before scoring.',
    );
  }
}

async function startServer() {
  const child = spawn(process.execPath, [join(root, 'server.mjs')], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return child;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  child.kill();
  throw new Error('server failed to start');
}

/** Pull the canvas back as raw RGBA at a small analysis resolution. */
async function grab(page) {
  const base64 = await page.evaluate(({ w, h }) => {
    const stage = document.querySelector('#stage');
    const probe = document.createElement('canvas');
    probe.width = w; probe.height = h;
    const ctx = probe.getContext('2d');
    ctx.drawImage(stage, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < data.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, data.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }, SAMPLE);
  return {
    data: new Uint8ClampedArray(Buffer.from(base64, 'base64')),
    width: SAMPLE.w,
    height: SAMPLE.h,
  };
}

const bar = (v, width = 22) => '█'.repeat(Math.round(v * width)).padEnd(width, '·');

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  assertFreshBuild();
  const server = await startServer();

  // Use the pre-installed full Chromium (the headless shell has no WebGL) and
  // fall back to whatever Playwright resolves if it isn't there.
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({
    executablePath: existsSync(preinstalled) ? preinstalled : undefined,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage',
    ],
  });

  const results = [];
  let fatal = null;

  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__trip?.ready === true, null, { timeout: 20000 });
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);

    const presets = await page.evaluate(() => window.__trip.presetIds());
    const targets = ONLY ? presets.filter((p) => p === ONLY) : presets;
    if (targets.length === 0) throw new Error(`no preset matching "${ONLY}"`);

    await page.evaluate(() => {
      window.__trip.hideUi();
      window.__trip.setSeed(42); // fixed seed: the run must be reproducible
      window.__trip.setCalm(false);
      window.__trip.take();
      window.__trip.forceIntensity(1);   // hold at peak for a fair comparison
      window.__trip.forceDissolve(0.8);  // sheet mostly torn, ghost grid remains
    });

    for (const [index, id] of targets.entries()) {
      const started = Date.now();
      process.stdout.write(`   [${index + 1}/${targets.length}] ${id} … `);
      await page.evaluate(({ preset, frames }) => {
        // Wipe the feedback history first: without this each preset inherits
        // the previous one's trails and the scores stop being comparable.
        window.__trip.reset();
        window.__trip.setPreset(preset, true);
        window.__trip.advance(frames); // let the feedback loop fully charge
      }, { preset: id, frames: CHARGE_FRAMES });

      // Score at several points along a time horizon, not at one instant.
      // Nobody watches this for a second and a half; if the picture decays as
      // it runs, a single early sample will never see it. The preset's score
      // is its WORST moment, because that is what a viewer actually sits with.
      const samples = [];
      for (const [step, gap] of SAMPLE_FRAMES.entries()) {
        if (gap > 0) await page.evaluate((n) => window.__trip.advance(n), gap);
        const a = await grab(page);
        await page.evaluate(() => window.__trip.advance(6));
        const b = await grab(page);
        const scored = tripScore(a, b);
        samples.push({ atFrame: CHARGE_FRAMES + SAMPLE_FRAMES.slice(0, step + 1)
          .reduce((x, y) => x + y, 0), ...scored });
      }

      const worstSample = samples.reduce((lo, x) => (x.score < lo.score ? x : lo));
      const mean = samples.reduce((sum, x) => sum + x.score, 0) / samples.length;
      results.push({
        id,
        score: mean,
        floor: worstSample.score,
        metrics: worstSample.metrics,
        overTime: samples.map((x) => ({ atFrame: x.atFrame, score: x.score })),
      });
      await page.screenshot({ path: join(SHOT_DIR, `${id}.png`) });
      console.log(`${mean.toFixed(1)} (floor ${worstSample.score.toFixed(1)})  `
        + `[${samples.map((x) => x.score.toFixed(0)).join(' ')}]  `
        + `(${((Date.now() - started) / 1000).toFixed(1)}s)`);
    }

    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  } catch (error) {
    fatal = error;
  } finally {
    await browser.close();
    server.kill();
  }

  if (fatal) {
    console.error(`\n💀 harness failed: ${fatal.message}\n`);
    process.exit(2);
  }

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                   A M   I   T R I P P I N G ?                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  for (const { id, score, floor, metrics } of results) {
    const verdict = score >= THRESHOLD && floor >= FLOOR ? '✅' : '❌';
    console.log(`${verdict}  ${id.padEnd(18)} ${String(score.toFixed(1)).padStart(5)} / 100`
      + `   floor ${floor.toFixed(1)}`);
    for (const [key, value] of Object.entries(metrics)) {
      console.log(`      ${key.padEnd(15)} ${bar(value)} ${value.toFixed(3)}`);
    }
    console.log('');
  }

  const scores = results.map((r) => r.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const worst = Math.min(...scores);
  const lowestFloor = Math.min(...results.map((r) => r.floor));
  const passed = worst >= THRESHOLD && lowestFloor >= FLOOR;

  await writeFile(
    join(SHOT_DIR, 'report.json'),
    JSON.stringify({ threshold: THRESHOLD, floor: FLOOR, mean, worst, lowestFloor, results }, null, 2),
  );

  console.log(`   mean ${mean.toFixed(1)}   worst preset ${worst.toFixed(1)} (need ${THRESHOLD})`
    + `   lowest moment ${lowestFloor.toFixed(1)} (need ${FLOOR})`);
  console.log(passed
    ? '\n🌈 VERDICT: yes. you are tripping.\n'
    : '\n😐 VERDICT: not trippy enough. go again.\n');
  console.log(`   frames written to ${SHOT_DIR}\n`);

  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
