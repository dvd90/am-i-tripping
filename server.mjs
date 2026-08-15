/**
 * Production server (Railway). Serves the built SPA with long-lived caching on
 * fingerprinted assets and no caching on the HTML shell.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import compression from 'compression';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const port = Number(process.env.PORT) || 8080;

if (!existsSync(dist)) {
  console.error('dist/ is missing — run `npm run build` before `npm start`.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(compression());

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'am-i-tripping', tripping: true });
});

app.use(express.static(dist, {
  index: false,
  etag: true,
  setHeaders(res, path) {
    if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(join(dist, 'index.html'));
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`am-i-tripping listening on :${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
