import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as tvSyncFn from './functions/api/tv-sync.js';
import * as tvImageFn from './functions/api/tv-image.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.text({ type: '*/*', limit: '2mb' }));

async function invokePagesFunction(
  req: express.Request,
  res: express.Response,
  handler?: (ctx: { request: Request }) => Promise<Response>
) {
  if (!handler) {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      }
    }

    const init: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && typeof req.body === 'string' && req.body.length > 0) {
      init.body = req.body;
    }

    const webRequest = new Request(fullUrl, init);
    const webResponse = await handler({ request: webRequest });

    res.status(webResponse.status);
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const arrayBuffer = await webResponse.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
}

app.options('/api/tv-sync', (req, res) => invokePagesFunction(req, res, tvSyncFn.onRequestOptions));
app.get('/api/tv-sync', (req, res) => invokePagesFunction(req, res, tvSyncFn.onRequestGet));
app.post('/api/tv-sync', (req, res) => invokePagesFunction(req, res, tvSyncFn.onRequestPost));

app.options('/api/tv-image', (req, res) => invokePagesFunction(req, res, tvImageFn.onRequestOptions));
app.get('/api/tv-image', (req, res) => invokePagesFunction(req, res, tvImageFn.onRequestGet));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pizarra Animaltec TV corriendo en http://0.0.0.0:${PORT}`);
});
