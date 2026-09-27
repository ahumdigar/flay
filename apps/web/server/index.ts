import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApiRouter } from './api.js';
import { config } from './config.js';
import { installProcessSafety } from './process-safety.js';

installProcessSafety();

const app = express();
app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use('/api', createApiRouter());

if (config.nodeEnv === 'production') {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(directory, {
    fallthrough: true,
    index: false,
    maxAge: '1h',
    setHeaders(response, filePath) {
      if (filePath.endsWith('index.html')) response.setHeader('cache-control', 'no-cache');
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        response.setHeader('cache-control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.use((request, response, next) => {
    if (!['GET', 'HEAD'].includes(request.method) || request.path.startsWith('/api/')) return next();
    response.setHeader('cache-control', 'no-cache');
    return response.sendFile(path.join(directory, 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(config.port, config.host, () => {
  // Startup output contains no credentials, wallet data, requests, or transactions.
  process.stdout.write(`Flay listening on http://${config.host}:${config.port}\n`);
});
