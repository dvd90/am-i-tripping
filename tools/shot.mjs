import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
const root = '/home/user/am-i-tripping';
const PORT = 4331;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [`${root}/server.mjs`], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) break; } catch {} await sleep(250); }
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__trip?.ready === true);
// 1. the landing sheet, exactly as a visitor first sees it
await page.evaluate(() => window.__trip.advance(120));
await page.screenshot({ path: `${root}/artifacts/frames/00-landing.png` });
// 2. the sheet with the UI out of the way
await page.evaluate(() => { window.__trip.hideUi(); window.__trip.forceIntensity(0.3); window.__trip.forceDissolve(0); window.__trip.advance(120); });
await page.screenshot({ path: `${root}/artifacts/frames/01-sheet.png` });
// 3. mid-dissolve
await page.evaluate(() => { window.__trip.forceIntensity(0.6); window.__trip.forceDissolve(0.45); window.__trip.advance(120); });
await page.screenshot({ path: `${root}/artifacts/frames/02-tearing.png` });
await browser.close(); server.kill();
console.log('ok');
