// Origen de estáticos y de /mi-cuenta para el laboratorio de caché HTTP. Sin dependencias.
// /static/app.js: 180 KB con Cache-Control: public, max-age=60 y ETag (responde 304 a If-None-Match).
// /mi-cuenta: datos del usuario del header X-Usuario, con Cache-Control: private.
// POST /static/app.js/nueva-version: cambia el contenido (y el ETag).
const http = require('node:http');
const crypto = require('node:crypto');

let version = 1;
const build = v => '// app.js de la tienda · versión ' + v + '\n' + Array.from({ length: 2350 }, (_, i) =>
  `export function componente${i}() { return 'tienda.com v${v}: componente ${i}'; }`).join('\n') + '\n';
let bundle = build(version);
const etag = () => '"' + crypto.createHash('sha1').update(bundle).digest('hex').slice(0, 8) + '"';
let pedidos = 0;
const log = (...a) => console.log('[web]', ...a);

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/health') return res.end('ok\n');
  if (path === '/static/app.js/nueva-version' && req.method === 'POST') {
    bundle = build(++version);
    log(`nueva versión v${version} · ETag ${etag()}`);
    return res.end(`app.js ahora es v${version} · ETag ${etag()}\n`);
  }
  if (path === '/static/app.js') {
    pedidos++;
    const tag = etag();
    if (req.headers['if-none-match'] === tag) {
      log(`#${pedidos} ${path} → 304 (If-None-Match ${tag})`);
      res.writeHead(304, { ETag: tag, 'Cache-Control': 'public, max-age=60' });
      return res.end();
    }
    log(`#${pedidos} ${path} → 200 (${Buffer.byteLength(bundle)} bytes)`);
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', ETag: tag, 'Cache-Control': 'public, max-age=60' });
    return res.end(bundle);
  }
  if (path === '/mi-cuenta') {
    const u = req.headers['x-usuario'] || 'anónimo';
    log(`/mi-cuenta de ${u}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=60' });
    return res.end(`Cuenta de ${u} · saldo $${u.length * 1234}\n`);
  }
  res.writeHead(404); res.end('no existe\n');
}).listen(3000, () => log('escuchando en :3000'));

process.on('SIGTERM', () => process.exit(0));
