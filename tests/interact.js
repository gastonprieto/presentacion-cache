// Pruebas de interacción con Chrome headless: motores de caché y escenas.
// Uso: node tests/interact.js [filtro]   (filtro = parte del nombre de la prueba)
// Requiere `npm i` en presentaciones-guideline/tools (usa su puppeteer-core).
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../presentaciones-guideline/tools/node_modules/puppeteer-core'));

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const filter = process.argv[2] || '';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------- helpers ---------- */

async function open(page, idx = 0, mobile = false) {
  await page.goto(`file://${ROOT}/index.html?mobile=${mobile ? 1 : 0}#/${idx}`);
  await sleep(600);
}

// Va a la slide idx y espera a que su escena exista (section._scene)
async function goto(page, idx) {
  await page.evaluate(i => Reveal.slide(i, 0, 99), idx);
  await page.waitForFunction(i => window.__sec(i)._scene, { timeout: 4000 }, idx);
}

// Ejecuta fn(section, ...args) en la página sobre la slide idx
async function evalScene(page, idx, fn, ...args) {
  await goto(page, idx);
  return page.evaluate(`(${fn})(window.__sec(${idx}), ...${JSON.stringify(args)})`);
}

// Ejecuta fn(svg, ...args) con un <svg> nuevo en la página (para probar motores sin slide)
async function engine(page, fn, ...args) {
  return page.evaluate(`(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:fixed;left:0;top:0;width:900px;height:590px;opacity:0;pointer-events:none');
    document.body.appendChild(svg);
    try { return (${fn})(svg, ...${JSON.stringify(args)}); } finally { svg.remove(); }
  })()`);
}

function check(cond, msg) { if (!cond) throw new Error(msg); }

/* ---------- pruebas ---------- */

test('base: carga sin errores de consola', async (page, errors) => {
  await open(page, 0);
  check(errors.length === 0, `errores: ${errors.join(' | ')}`);
});

test('notas: todas las slides tienen pregunta', async page => {
  await open(page, 0);
  const r = await page.evaluate(() => [...document.querySelectorAll('.reveal .slides > section')]
    .map((s, i) => { const n = s.querySelector('aside.notes'); return n && n.textContent.includes('?') ? null : i; }));
  check(!r.filter(x => x !== null).length, `sin pregunta: ${r.filter(x => x !== null)}`);
});

/* ---------- motor CacheKit ---------- */

// Corre una secuencia de claves sobre una Cache (en un miss, set) y devuelve los hits
const RUNSEQ = `(seq, opts) => {
  const c = new CacheKit.Cache(opts);
  let t = 0;
  for (const k of seq) { t++; if (!c.get(k, t)) c.set(k, k, t); }
  return c.stats.hits;
}`;
const SCAN = 'ABC'.repeat(5) + 'DEFGHI' + 'ABC'.repeat(5);
const SHIFT = 'ABCD'.repeat(5) + 'EFGH'.repeat(5);

test('cache: hit y miss', async page => {
  await open(page);
  const r = await page.evaluate(() => {
    const c = new CacheKit.Cache({ capacity: 2 });
    const first = c.get('a', 0);
    c.set('a', 1, 0);
    const second = c.get('a', 1);
    return { first, value: second && second.value, stats: c.stats };
  });
  check(r.first === null, `primer get=${JSON.stringify(r.first)}`);
  check(r.value === 1, `value=${r.value}`);
  check(r.stats.hits === 1 && r.stats.misses === 1, `stats=${JSON.stringify(r.stats)}`);
});

test('cache: scan le gana a LRU', async page => {
  await open(page);
  const r = await page.evaluate(`(() => { const run = ${RUNSEQ}; const seq = '${SCAN}'.split('');
    return { lru: run(seq, { capacity: 4, policy: 'lru' }), lfu: run(seq, { capacity: 4, policy: 'lfu' }), fifo: run(seq, { capacity: 4, policy: 'fifo' }) }; })()`);
  check(r.lru === 24 && r.lfu === 27 && r.fifo === 24, JSON.stringify(r));
});

test('cache: cambio de popularidad le gana a LFU', async page => {
  await open(page);
  const r = await page.evaluate(`(() => { const run = ${RUNSEQ}; const seq = '${SHIFT}'.split('');
    return { lru: run(seq, { capacity: 4, policy: 'lru' }), lfu: run(seq, { capacity: 4, policy: 'lfu' }) }; })()`);
  check(r.lru === 32 && r.lfu === 16, JSON.stringify(r));
});

test('cache: ttl vence', async page => {
  await open(page);
  const r = await page.evaluate(() => {
    const c = new CacheKit.Cache({ capacity: 4, ttl: 10 });
    c.set('a', 1, 0);
    const at9 = !!c.get('a', 9), at10 = c.get('a', 10);
    return { at9, at10, exp: c.stats.expirations };
  });
  check(r.at9 && r.at10 === null && r.exp === 1, JSON.stringify(r));
});

test('cache: ttl 0 nunca pega', async page => {
  await open(page);
  const hits = await page.evaluate(() => {
    const c = new CacheKit.Cache({ capacity: 4, ttl: 0 });
    for (let t = 0; t < 100; t++) if (!c.get('a', t)) c.set('a', 1, t);
    return c.stats.hits;
  });
  check(hits === 0, `hits=${hits}`);
});

test('cache: jitter reparte vencimientos', async page => {
  await open(page);
  const alive = await page.evaluate(() => {
    const c = new CacheKit.Cache({ capacity: 100, ttl: 10, jitter: 0.2, seed: 1 });
    for (let k = 0; k < 50; k++) c.set(k, k, 0);
    let n = 0;
    for (let k = 0; k < 50; k++) if (c.get(k, 9)) n++;
    return n;
  });
  check(alive >= 15 && alive <= 40, `vivas en t=9: ${alive}`);
});

test('cache: zipf concentra', async page => {
  await open(page);
  const r = await page.evaluate(() => {
    const count = s => {
      const pick = CacheKit.zipfPicker(50, s, CacheKit.rng(1)), n = new Array(50).fill(0);
      for (let i = 0; i < 10000; i++) n[pick()]++;
      return n;
    };
    const z = count(1.1), u = count(0);
    return { top: z[0] / 10000, maxU: Math.max(...u) / 10000, inRange: z.reduce((a, b) => a + b, 0) === 10000 };
  });
  check(r.top > 0.15, `clave 0 con zipf: ${r.top}`);
  check(r.maxU < 0.04, `máx uniforme: ${r.maxU}`);
  check(r.inRange, 'sorteos fuera de rango');
});

/* ---------- motor CacheSim ---------- */

// Crea una CacheSim sobre un svg suelto, avanza `ff` segundos y devuelve window(win)
const CSIM = `(svg, opts, ff, win) => {
  const s = new CacheSimKit.CacheSim(svg, opts);
  s.fastForward(ff);
  return s.window(win);
}`;

test('cachesim: sin caché la DB se satura', async page => {
  await open(page);
  const w = await engine(page, `(svg) => (${CSIM})(svg, { rate: 8, cache: null }, 30, 20)`);
  check(w.err > 0, `err=${w.err}`);
  check(w.p95 > 1.5, `p95=${w.p95}`);
});

test('cachesim: con caché baja la carga', async page => {
  await open(page);
  const w = await engine(page, `(svg) => (${CSIM})(svg, { rate: 8, cache: 'shared', capacity: 20 }, 30, 20)`);
  check(w.hitRate > 0.6, `hitRate=${w.hitRate}`);
  check(w.err === 0, `err=${w.err}`);
  check(w.dbReqs < w.n * 0.4, `dbReqs=${w.dbReqs} n=${w.n}`);
});

test('cachesim: el hit rate depende del tamaño y del patrón', async page => {
  await open(page);
  const r = await engine(page, `(svg) => {
    const run = ${CSIM};
    return {
      small: run(svg, { cache: 'shared', capacity: 5 }, 60, 40).hitRate,
      big: run(svg, { cache: 'shared', capacity: 25 }, 60, 40).hitRate,
      zipf: run(svg, { cache: 'shared', capacity: 10, zipf: 1.1 }, 60, 40).hitRate,
      uniform: run(svg, { cache: 'shared', capacity: 10, zipf: 0 }, 60, 40).hitRate
    };
  }`);
  check(r.big > r.small, JSON.stringify(r));
  check(r.zipf - r.uniform >= 0.25, JSON.stringify(r));
});

test('cachesim: capacidad ≥ claves', async page => {
  await open(page);
  const w = await engine(page, `(svg) => (${CSIM})(svg, { cache: 'shared', keys: 10, capacity: 10, ttl: Infinity }, 60, 40)`);
  check(w.hitRate > 0.9, `hitRate=${w.hitRate}`);
});

test('cachesim: ttl y datos viejos', async page => {
  await open(page);
  const r = await engine(page, `(svg) => {
    const run = invalidate => {
      const s = new CacheSimKit.CacheSim(svg, { cache: 'shared', ttl: 30, invalidate });
      for (let i = 0; i < 6; i++) { s.fastForward(5); s.writePrice(0); }
      s.fastForward(5);
      return s.window(35).stale;
    };
    return { none: run('none'), del: run('delete') };
  }`);
  check(r.none > 0, `stale sin invalidar=${r.none}`);
  check(r.del === 0, `stale con delete=${r.del}`);
});

test('cachesim: flush provoca estampida', async page => {
  await open(page);
  const r = await engine(page, `(svg) => {
    const run = extra => {
      const s = new CacheSimKit.CacheSim(svg, Object.assign({ cache: 'shared', capacity: 30, rate: 16, ttl: Infinity }, extra));
      s.prewarm(30);
      s.fastForward(10);
      const before = s.window(8).err;
      s.flushCache();
      s.fastForward(4);
      return { before, after: s.window(4).err };
    };
    return { plain: run({}), mitigated: run({ coalesce: true, jitter: 0.3 }) };
  }`);
  check(r.plain.before === 0, `errores antes del flush=${r.plain.before}`);
  check(r.plain.after > 0, `sin mitigación err=${r.plain.after}`);
  check(r.mitigated.after === 0, `con coalescing err=${r.mitigated.after}`);
});

test('cachesim: local vs compartida', async page => {
  await open(page);
  const r = await engine(page, `(svg) => {
    const run = ${CSIM};
    return {
      local: run(svg, { cache: 'local', replicas: 3, capacity: 10 }, 60, 40).hitRate,
      shared: run(svg, { cache: 'shared', replicas: 3, capacity: 10 }, 60, 40).hitRate
    };
  }`);
  check(r.local < r.shared, JSON.stringify(r));
});

test('cachesim: local invalida sólo la réplica que escribe', async page => {
  await open(page);
  const stale = await engine(page, `(svg) => {
    const s = new CacheSimKit.CacheSim(svg, { cache: 'local', replicas: 3, capacity: 10, ttl: 60, invalidate: 'delete' });
    s.fastForward(10); s.writePrice(0); s.fastForward(10);
    return s.window(10).stale;
  }`);
  check(stale > 0, `stale=${stale}`);
});

test('cachesim: reset limpia estado', async page => {
  await open(page);
  const r = await engine(page, `(svg) => {
    const s = new CacheSimKit.CacheSim(svg, { cache: 'shared', rate: 6 });
    s.fastForward(5);
    const gen = s.gen;
    s.reset(Object.assign({}, s.o, { capacity: 3 }));
    return { n: s.window(60).n, pk: svg.querySelectorAll('.pk').length, gen: s.gen > gen };
  }`);
  check(r.n === 0 && r.pk === 0 && r.gen, JSON.stringify(r));
});

/* ---------- runner ---------- */

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  let fails = 0, ran = 0;
  for (const t of tests.filter(t => t.name.includes(filter))) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.evaluateOnNewDocument(() => {
      window.__sec = i => document.querySelectorAll('.reveal .slides > section')[i];
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    ran++;
    try {
      await t.fn(page, errors);
      check(errors.length === 0, `errores de consola: ${errors.join(' | ')}`);
      console.log(`  ok   ${t.name}`);
    } catch (e) {
      fails++;
      console.log(`  FAIL ${t.name}\n       ${e.message.split('\n')[0]}`);
    }
    await page.close();
  }
  console.log(`${ran - fails}/${ran} ok`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();

module.exports = { open, goto, evalScene, engine, check, sleep };
