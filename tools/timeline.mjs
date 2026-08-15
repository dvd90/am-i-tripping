#!/usr/bin/env node
/**
 * Diagnostic: score one preset densely along time and print the curve.
 *
 * A single-instant score cannot tell a slow decay from an oscillation that
 * happens to be sampled at its trough, and the two have completely different
 * fixes. This shows which it is.
 *
 *   node tools/timeline.mjs salvia-wheel [--frames 1500] [--every 60]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { tripScore } from './trippiness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preset = process.argv[2] ?? 'salvia-wheel';
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d;
};
const TOTAL = arg('frames', 1500);
const EVERY = arg('every', 60);
const PORT = 4333;
const SAMPLE = { w: 200, h: 112 };  // coarser: this runs many more samples
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [join(root, 'server.mjs')], {
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) break; } catch {}
  await sleep(250);
}

const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__trip?.ready === true);

async function grab() {
  const b64 = await page.evaluate(({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(document.querySelector('#stage'), 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let s = '';
    for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
    return btoa(s);
  }, SAMPLE);
  return { data: new Uint8ClampedArray(Buffer.from(b64, 'base64')), width: SAMPLE.w, height: SAMPLE.h };
}

const pins = process.argv.slice(3).filter((a) => a.includes('=') && !a.startsWith('--'));
const pinObj = Object.fromEntries(pins.map((p) => { const [k, v] = p.split('='); return [k, Number(v)]; }));

await page.evaluate(({ id, ov }) => {
  window.__trip.hideUi();
  window.__trip.setSeed(42);
  window.__trip.setCalm(false);
  window.__trip.take();
  window.__trip.forceIntensity(1);
  window.__trip.forceDissolve(0.8);
  window.__trip.reset();
  window.__trip.setPreset(id, true);
  for (const [k, v] of Object.entries(ov)) window.__trip.overrideParam(k, v);
}, { id: preset, ov: pinObj });

console.log(`\ntimeline for ${preset}${pins.length ? ' [' + pins.join(' ') + ']' : ''}`
  + ` — ${TOTAL} frames, every ${EVERY}\n`);
const rows = [];
for (let f = 0; f <= TOTAL; f += EVERY) {
  const a = await grab();
  await page.evaluate(() => window.__trip.advance(6));
  const b = await grab();
  const { score, metrics } = tripScore(a, b);
  rows.push({ f, score, metrics });
  await page.evaluate((n) => window.__trip.advance(n), EVERY - 6);
}

const BLOCKS = '▁▂▃▄▅▆▇█';
const lo = Math.min(...rows.map((r) => r.score));
const hi = Math.max(...rows.map((r) => r.score));
for (const { f, score, metrics } of rows) {
  const norm = hi > lo ? (score - lo) / (hi - lo) : 0;
  const block = BLOCKS[Math.min(7, Math.floor(norm * 8))];
  const secs = (f / 60).toFixed(1).padStart(5);
  console.log(`  t=${secs}s f=${String(f).padStart(4)} ${block} ${score.toFixed(1).padStart(5)}  `
    + Object.entries(metrics).map(([k, v]) => `${k.slice(0, 4)}=${v.toFixed(2)}`).join(' '));
}
console.log(`\n  range ${lo.toFixed(1)} … ${hi.toFixed(1)}\n`);

await browser.close();
server.kill();
