#!/usr/bin/env node
/**
 * Diagnostic: score one preset while pinning individual parameters, to find
 * which term is collapsing the picture. Not part of the build — a scalpel.
 *
 *   node tools/bisect.mjs liquid-sunshine feedback=0 melt=0 warp=0.3
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { tripScore } from './trippiness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [preset, ...pins] = process.argv.slice(2);
const PORT = 4327;
const SAMPLE = { w: 200, h: 112 };
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
const page = await browser.newPage({ viewport: { width: 720, height: 405 } });
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

async function measure(label, overrides) {
  await page.evaluate(({ id, ov }) => {
    window.__trip.overrideParam(null);
    for (const [k, v] of Object.entries(ov)) window.__trip.overrideParam(k, v);
    window.__trip.setPreset(id, true);
    window.__trip.advance(90);
  }, { id: preset, ov: overrides });
  const a = await grab();
  await page.evaluate(() => window.__trip.advance(6));
  const b = await grab();
  const { score, metrics } = tripScore(a, b);
  const m = Object.entries(metrics).map(([k, v]) => `${k.slice(0, 4)}=${v.toFixed(2)}`).join(' ');
  console.log(`${label.padEnd(28)} ${score.toFixed(1).padStart(5)}   ${m}`);
  return score;
}

await page.evaluate(() => {
  window.__trip.hideUi();
  window.__trip.setCalm(false);
  window.__trip.take();
  window.__trip.forceIntensity(1);
  window.__trip.forceDissolve(0.8);
});

console.log(`\nbisecting ${preset}\n`);
await measure('baseline', {});
for (const pin of pins) {
  const [key, value] = pin.split('=');
  await measure(`${key}=${value}`, { [key]: Number(value) });
}

await browser.close();
server.kill();
