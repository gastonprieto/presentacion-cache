// Servicio Productos del laboratorio de caché. Sin dependencias: habla RESP con Redis por TCP.
// GET /productos/:id → cache-aside: busca en Redis; si no está, "consulta la DB" (demora DEMORA_MS) y guarda con TTL_S.
// PUT /productos/:id/precio?valor=N → cambia el precio en la "DB"; con INVALIDAR=1 (o ?invalidar=1) borra la clave.
// Si Redis no responde, sigue andando sin caché (X-Cache: BYPASS): lento, pero vivo.
const http = require('node:http');
const net = require('node:net');

const DEMORA_MS = +(process.env.DEMORA_MS || 800);
const TTL_S = +(process.env.TTL_S || 30);
const INVALIDAR = process.env.INVALIDAR === '1';
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const PORT = 3000;

// "DB": 200 productos con precio y versión
const db = new Map(Array.from({ length: 200 }, (_, i) => [String(i), { id: i, titulo: `Producto ${i}`, precio: 1000 + i * 10, version: 1 }]));
let consultas = 0;
// Cada valor cacheado lleva ~20 KB de relleno (la "ficha completa" del producto) para que los 2 MB de Redis
// alcancen para unos 15 productos y se vean desalojos. No se devuelve en la respuesta.
const RELLENO = 'x'.repeat(20000);

/* ---------- cliente Redis mínimo (un comando por conexión, con timeout) ---------- */
function redis(...args) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: REDIS_HOST, port: 6379 });
    let buf = '';
    sock.setTimeout(300, () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('error', reject);
    sock.on('connect', () => sock.write(`*${args.length}\r\n` + args.map(a => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('')));
    sock.on('data', d => {
      buf += d;
      const t = buf[0], nl = buf.indexOf('\r\n');
      if (nl < 0) return;
      const head = buf.slice(1, nl);
      if (t === '$') {
        const len = +head;
        if (len === -1) { sock.end(); return resolve(null); }
        if (Buffer.byteLength(buf) < nl + 2 + len + 2) return;
        sock.end(); return resolve(buf.slice(nl + 2, nl + 2 + len));
      }
      sock.end();
      if (t === '-') return reject(new Error(head));
      resolve(t === ':' ? +head : head);
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[productos]', ...a);

async function consultarDb(id) {
  consultas++;
  await sleep(DEMORA_MS);
  return db.get(id);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/productos\/(\d+)(\/precio)?$/);
  const send = (code, body, headers = {}) => {
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
    res.end(JSON.stringify(body) + '\n');
  };
  if (url.pathname === '/health') return send(200, { ok: true });
  if (!m || !db.has(m[1])) return send(404, { error: 'no existe' });
  const id = m[1], key = `producto:${id}`;
  const t0 = Date.now();

  if (req.method === 'PUT' && m[2]) {
    const p = db.get(id);
    p.precio = +(url.searchParams.get('valor') || p.precio + 100);
    p.version++;
    const inv = url.searchParams.has('invalidar') ? url.searchParams.get('invalidar') === '1' : INVALIDAR;
    if (inv) await redis('DEL', key).catch(() => {});
    log(`PUT ${key} precio=${p.precio} v${p.version}${inv ? ' · clave borrada de la caché' : ' · la caché NO se enteró'}`);
    return send(200, Object.assign({ invalidada: inv }, p));
  }

  let cached = null, estado = 'MISS';
  try { cached = await redis('GET', key); } catch { estado = 'BYPASS'; }
  if (cached) {
    log(`GET ${key} HIT (${Date.now() - t0} ms)`);
    const { _relleno, ...prod } = JSON.parse(cached);
    return send(200, prod, { 'X-Cache': 'HIT' });
  }
  const p = await consultarDb(id);
  if (estado === 'MISS') await redis('SET', key, JSON.stringify(Object.assign({ _relleno: RELLENO }, p)), 'EX', TTL_S).catch(() => {});
  log(`GET ${key} ${estado} → DB (${Date.now() - t0} ms) · consultas a la DB: ${consultas}`);
  send(200, p, { 'X-Cache': estado });
}).listen(PORT, () => log(`escuchando en :${PORT} · demora DB ${DEMORA_MS} ms · TTL ${TTL_S} s · invalidar ${INVALIDAR ? 'sí' : 'no'}`));

process.on('SIGTERM', () => process.exit(0));
