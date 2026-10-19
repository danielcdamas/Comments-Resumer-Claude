/**
 * Servidor local para desenvolvimento e testes, equivalente ao ambiente da Vercel:
 * serve a pasta public/ e encaminha /api/<nome> para api/<nome>.js (handlers GET/POST no formato Web).
 * Uso: npm run dev   (variáveis opcionais em .env; porta em PORT, padrão 3000)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');
const vercelConfig = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const securityHeaders = Object.fromEntries(vercelConfig.headers[0].headers.map((h) => [h.key, h.value]));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function handleApi(req, res, name) {
  if (!/^[a-z-]+$/.test(name)) return send(res, 404, { error: 'Not found' });
  let mod;
  try {
    mod = await import(pathToFileURL(join(root, 'api', `${name}.js`)).href);
  } catch {
    return send(res, 404, { error: 'Not found' });
  }
  const handler = mod[req.method];
  if (typeof handler !== 'function') return send(res, 405, { error: 'Method not allowed' });

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(publicDir, rel);
  if (!file.startsWith(publicDir + sep) && file !== publicDir) return send(res, 403, { error: 'Forbidden' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', ...securityHeaders });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname.slice(5));
    return await handleStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Erro interno do servidor local.' });
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Servidor local em http://localhost:${port}`));
