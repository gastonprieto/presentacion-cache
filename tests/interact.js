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
  check(r.zipf - r.uniform >= 0.2, JSON.stringify(r));
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
      local: run(svg, { cache: 'local', replicas: 3, capacity: 10, ttl: 15 }, 60, 40).hitRate,
      shared: run(svg, { cache: 'shared', replicas: 3, capacity: 10, ttl: 15 }, 60, 40).hitRate
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

/* ---------- escenas: el problema y hit/miss ---------- */

// Índices de slide (0-based)
const SL = { cara: 1, caminos: 2, hitmiss: 3, hitrate: 4 };

// Mueve un slider de la slide y dispara 'input'
const SLIDE_INPUT = `(sec, sel, v) => { const r = sec.querySelector(sel); r.value = v; r.dispatchEvent(new Event('input')); }`;

test('escena cara: subir tráfico satura la DB', async page => {
  await open(page);
  const r = await evalScene(page, SL.cara, `(sec, SI) => {
    eval(SI)(sec, 'input.rate', 10);
    sec._scene.sim.fastForward(15);
    const w = sec._scene.sim.window(5);
    const p95 = sec.querySelector('[data-f=p95]');
    return { err: w.err, p95: w.p95, cls: p95.className, errTxt: sec.querySelector('[data-f=err]').textContent };
  }`, SLIDE_INPUT);
  check(r.err > 0 || r.p95 > 1.5, JSON.stringify(r));
  check(r.cls === 'bad' || +r.errTxt > 0, `widget: ${JSON.stringify(r)}`);
});

test('escena hitmiss: prender la caché sube el hit rate', async page => {
  await open(page);
  const r = await evalScene(page, SL.hitmiss, sec => {
    sec.querySelector('[data-act=cache]').click();
    const sim = sec._scene.sim;
    sim.fastForward(10);
    return { cache: sim.o.cache, hitRate: sim.window(5).hitRate };
  });
  check(r.cache === 'local', `cache=${r.cache}`);
  check(r.hitRate > 0.5, `hitRate=${r.hitRate}`);
});

test('escena hitrate: sliders cambian opciones', async page => {
  await open(page);
  const r = await evalScene(page, SL.hitrate, `(sec, SI) => {
    const sim = sec._scene.sim;
    eval(SI)(sec, 'input.capacity', 25);
    eval(SI)(sec, 'input.keys', 120);
    const cap = sim.o.capacity, keys = sim.o.keys;
    sec.querySelector('.seg[data-group=pattern] [data-v=uniform]').click();
    const z0 = sim.o.zipf;
    sec.querySelector('.seg[data-group=pattern] [data-v=zipf]').click();
    return { cap, keys, z0, z1: sim.o.zipf, chart: !!sec.querySelector('canvas.cache-chart') };
  }`, SLIDE_INPUT);
  check(r.cap === 25 && r.keys === 120, JSON.stringify(r));
  check(r.z0 === 0 && r.z1 === 1.1, JSON.stringify(r));
  check(r.chart, 'falta canvas.cache-chart');
});

/* ---------- escena de reemplazo ---------- */

SL.reemplazo = 5;

test('escena reemplazo: tabla coincide con el modelo', async page => {
  await open(page);
  const r = await evalScene(page, SL.reemplazo, sec => {
    const cell = a => +sec.querySelector(`.algo-table [data-algo=${a}]`).textContent;
    const pick = v => sec.querySelector(`.seg[data-group=pattern] [data-v=${v}]`).click();
    pick('populares');
    const pop = { lru: cell('lru'), lfu: cell('lfu'), fifo: cell('fifo') };
    pick('cambia');
    const cam = { lru: cell('lru'), lfu: cell('lfu') };
    return { pop, cam };
  });
  check(r.pop.lru === 24 && r.pop.lfu === 27 && r.pop.fifo === 24, JSON.stringify(r.pop));
  check(r.cam.lru === 32 && r.cam.lfu === 16, JSON.stringify(r.cam));
});

test('escena reemplazo: paso a paso', async page => {
  await open(page);
  const st = await evalScene(page, SL.reemplazo, sec => {
    sec.querySelector('.seg[data-group=policy] [data-v=lru]').click();
    sec.querySelector('.seg[data-group=pattern] [data-v=populares]').click();
    for (let i = 0; i < 3; i++) sec.querySelector('[data-act=step]').click();
    return sec._scene.state();
  });
  check(st.misses === 3 && st.hits === 0, JSON.stringify(st));
  check(JSON.stringify(st.slots) === JSON.stringify(['A', 'B', 'C']), JSON.stringify(st.slots));
});

/* ---------- escenas: TTL, invalidación, caché fría, dónde vive ---------- */

Object.assign(SL, { ttl: 6, invalidar: 7, escalar: 8, donde: 9, fria: 10, nocachear: 11 });

test('escena ttl: ttl 0 da hit rate 0', async page => {
  await open(page);
  const r = await evalScene(page, SL.ttl, `(sec, SI) => {
    eval(SI)(sec, 'input.ttl', 0);
    const sim = sec._scene.sim;
    sim.fastForward(20);
    return { ttl: sim.o.ttl, hitRate: sim.window(15).hitRate, n: sim.window(15).n };
  }`, SLIDE_INPUT);
  check(r.ttl === 0 && r.n > 0 && r.hitRate === 0, JSON.stringify(r));
});

test('escena invalidar: delete elimina stale', async page => {
  await open(page);
  const r = await evalScene(page, SL.invalidar, sec => {
    const sim = sec._scene.sim;
    sec.querySelector('.seg[data-group=inv] [data-v=delete]').click();
    for (let i = 0; i < 3; i++) { sec.querySelector('[data-act=write]').click(); sim.fastForward(3); }
    sim.fastForward(2);
    const del = sim.window(11).stale;
    sec.querySelector('.seg[data-group=inv] [data-v=none]').click();
    sim.fastForward(8);
    for (let i = 0; i < 3; i++) { sec.querySelector('[data-act=write]').click(); sim.fastForward(3); }
    return { inv: sim.o.invalidate, del, none: sim.window(9).stale };
  });
  check(r.del === 0, `stale con delete=${r.del}`);
  check(r.none > 0, `stale sin invalidar=${r.none}`);
});

test('escena fria: reiniciar causa errores y las mitigaciones los evitan', async page => {
  await open(page);
  const r = await evalScene(page, SL.fria, sec => {
    const run = () => {
      const sim = sec._scene.sim;
      sec.querySelector('[data-act=reset]').click();
      sim.fastForward(8);
      sec.querySelector('[data-act=flush]').click();
      sim.fastForward(6);
      return sim.window(6).err;
    };
    const plain = run();
    sec.querySelector('input[data-opt=coalesce]').click();
    const mitigated = run();
    return { plain, mitigated };
  });
  check(r.plain > 0, `sin mitigación err=${r.plain}`);
  check(r.mitigated === 0, `con coalescing err=${r.mitigated}`);
});

test('estampida: reset a mitad', async (page, errors) => {
  await open(page);
  const r = await evalScene(page, SL.fria, sec => {
    const sim = sec._scene.sim;
    sim.fastForward(5);
    sec.querySelector('[data-act=flush]').click();
    sim.fastForward(0.3);
    sec.querySelector('input[data-opt=jitter]').click();
    sim.fastForward(6);
    return { old: sim.log.filter(e => e.gen !== sim.gen).length, n: sim.log.length };
  });
  check(r.old === 0 && r.n > 0, JSON.stringify(r));
  check(errors.length === 0, errors.join(' | '));
});

test('escena donde: local deja réplicas con precio viejo', async page => {
  await open(page);
  const r = await evalScene(page, SL.donde, sec => {
    const sim = sec._scene.sim;
    const run = v => {
      sec.querySelector(`.seg[data-group=where] [data-v=${v}]`).click();
      sim.fastForward(10);
      sec.querySelector('[data-act=write]').click();
      sim.fastForward(8);
      return sim.window(8).stale;
    };
    return { local: run('local'), shared: run('shared') };
  });
  check(r.local > 0, `stale local=${r.local}`);
  check(r.shared === 0, `stale compartida=${r.shared}`);
});

/* ---------- escenas: caché HTTP ---------- */

Object.assign(SL, { http: 12, etag: 13, privada: 14 });

test('escena http: max-age 60 evita el segundo pedido', async page => {
  await open(page);
  const st = await evalScene(page, SL.http, sec => {
    sec.querySelector('.seg[data-group=maxage] [data-v="60"]').click();
    sec.querySelector('[data-act=get]').click(); sec._scene.ff(3);
    sec.querySelector('[data-act=get]').click(); sec._scene.ff(3);
    return sec._scene.state();
  });
  check(st.sent === 1 && st.fromCache === 1, JSON.stringify(st));
});

test('escena http: max-age 0 siempre sale', async page => {
  await open(page);
  const st = await evalScene(page, SL.http, sec => {
    sec.querySelector('.seg[data-group=maxage] [data-v="0"]').click();
    for (let i = 0; i < 3; i++) { sec.querySelector('[data-act=get]').click(); sec._scene.ff(3); }
    return sec._scene.state();
  });
  check(st.sent === 3 && st.fromCache === 0, JSON.stringify(st));
});

test('escena etag: 304 sin cambio y 200 con cambio', async page => {
  await open(page);
  const r = await evalScene(page, SL.etag, sec => {
    sec.querySelector('.seg[data-group=etag] [data-v=on]').click();
    const get = () => { sec.querySelector('[data-act=get]').click(); sec._scene.ff(3); };
    get(); get(); get();
    const a = sec._scene.state();
    sec.querySelector('[data-act=change]').click();
    get();
    const b = sec._scene.state();
    return { a, b };
  });
  check(r.a.r304 === 2 && r.a.r200 === 1, JSON.stringify(r.a));
  check(r.b.r200 === 2 && r.b.r304 === 2, JSON.stringify(r.b));
  check(r.a.bytes < 200, `KB=${r.a.bytes}`);
});

test('escena privada: public filtra, private no', async page => {
  await open(page);
  const r = await evalScene(page, SL.privada, sec => {
    const run = mode => {
      sec.querySelector(`.seg[data-group=cc] [data-v=${mode}]`).click();
      ['ana', 'beto', 'ana', 'beto'].forEach(u => { sec.querySelector(`[data-act=${u}]`).click(); sec._scene.ff(4.5); });
      return sec._scene.state().leaks;
    };
    return { pub: run('public'), priv: run('private'), nostore: run('no-store') };
  });
  check(r.pub > 0, `public leaks=${r.pub}`);
  check(r.priv === 0 && r.nostore === 0, JSON.stringify(r));
});

/* ---------- escenas: CDN ---------- */

Object.assign(SL, { cdn: 15, distribuir: 16 });

test('escena cdn: con CDN baja la latencia y la carga del origen', async page => {
  await open(page);
  const r = await evalScene(page, SL.cdn, sec => {
    const sc = sec._scene;
    sc.setCdn(false); sc.ff(10);
    const off = sc.state();
    sc.setCdn(true); sc.ff(10);
    const on = sc.state();
    return { off, on };
  });
  check(r.on.byRegion.oc.avgMs < r.off.byRegion.oc.avgMs / 2, `oc: ${r.off.byRegion.oc.avgMs} → ${r.on.byRegion.oc.avgMs}`);
  check(r.on.originReqs <= 5 + r.on.total * 0.1, `origen=${r.on.originReqs} de ${r.on.total}`);
  check(r.off.originReqs === r.off.total, `sin CDN todo al origen: ${r.off.originReqs}/${r.off.total}`);
});

test('escena distribuir: purga mezcla versiones, versionado no', async page => {
  await open(page);
  const r = await evalScene(page, SL.distribuir, sec => {
    const sc = sec._scene;
    sec.querySelector('.seg[data-group=strategy] [data-v=purga]').click();
    sc.ff(3);
    sec.querySelector('[data-act=deploy]').click();
    let mixed = false;
    for (let i = 0; i < 40; i++) { sc.ff(0.25); const st = sc.state(); if (st.served.v1 > 0 && st.served.v2 > 0) mixed = true; }
    sec.querySelector('.seg[data-group=strategy] [data-v=versionado]').click();
    sc.ff(3);
    sec.querySelector('[data-act=deploy]').click();
    sc.ff(1);
    const v1a = sc.state().served.v1;
    sc.ff(8);
    const st = sc.state();
    return { mixed, v1a, v1b: st.served.v1, v2: st.served.v2 };
  });
  check(r.mixed, 'con purga nunca hubo mezcla de versiones');
  check(r.v1a === r.v1b && r.v2 > 0, JSON.stringify(r));
});

test('cdn: reset a mitad del deploy', async (page, errors) => {
  await open(page);
  const st = await evalScene(page, SL.distribuir, sec => {
    const sc = sec._scene;
    sec.querySelector('.seg[data-group=strategy] [data-v=purga]').click();
    sec.querySelector('[data-act=deploy]').click();
    sc.ff(0.5);
    sec.querySelector('.seg[data-group=strategy] [data-v=versionado]').click();
    sc.ff(6);
    return sc.state();
  });
  check(st.purgedEdges === 0, JSON.stringify(st));
  check(errors.length === 0, errors.join(' | '));
});

/* ---------- escenas: precálculo ---------- */

Object.assign(SL, { job: 17, desnormalizar: 18, alescribir: 19, comparacion: 20, herramientas: 21, cierre: 22 });

test('escena job: el job hace rápido el panel y deja dato viejo', async page => {
  await open(page);
  const r = await evalScene(page, SL.job, sec => {
    const sc = sec._scene, open = () => { sec.querySelector('[data-act=panel]').click(); sc.ff(4); return sc.state(); };
    sec.querySelector('.seg[data-group=mode] [data-v=ondemand]').click();
    sc.ff(2);
    const early = open().panelMs;
    sc.ff(20);
    const late = open().panelMs;
    sec.querySelector('.seg[data-group=mode] [data-v=job]').click();
    sc.ff(15);
    const j = open();
    return { early, late, job: j };
  });
  check(r.late > r.early, `bajo demanda: ${r.early} → ${r.late}`);
  check(r.job.panelMs < 100, `panel con job=${r.job.panelMs}`);
  check(r.job.dataAge > 0 && r.job.jobRuns > 0, JSON.stringify(r.job));
});

test('escena alescribir: falla desincroniza', async page => {
  await open(page);
  const r = await evalScene(page, SL.alescribir, sec => {
    const sc = sec._scene;
    const orders = n => { for (let i = 0; i < n; i++) { sec.querySelector('[data-act=order]').click(); sc.ff(1.5); } sc.ff(3); return sc.state(); };
    const ok = orders(3);
    sec.querySelector('input[data-opt=fail]').click();
    const bad = orders(5);
    return { ok, bad };
  });
  check(r.ok.total === r.ok.trueTotal, JSON.stringify(r.ok));
  check(r.bad.total < r.bad.trueTotal && r.bad.failures > 0, JSON.stringify(r.bad));
});

/* ---------- recorrido de la caché: en el proceso → escalar → externa ---------- */

test('texto: las herramientas reales recién al final', async page => {
  await open(page);
  const r = await page.evaluate(herr => {
    const secs = [...document.querySelectorAll('.reveal .slides > section')];
    const early = secs.slice(0, herr).map((s, i) => /Redis|Memcached/.test(s.textContent) ? i : null).filter(i => i !== null);
    return { early, herr: /Redis/.test(secs[herr].textContent) && /Memcached/.test(secs[herr].textContent) };
  }, SL.herramientas);
  check(!r.early.length, `nombran productos antes de tiempo: ${r.early}`);
  check(r.herr, 'la slide de herramientas no nombra Redis/Memcached');
});

test('cachesim: la caché compartida se dibuja como caché externa', async page => {
  await open(page);
  const txt = await engine(page, svg => { new CacheSimKit.CacheSim(svg, { cache: 'shared' }); return svg.textContent; });
  check(!/Redis/.test(txt) && /Caché externa/.test(txt), txt.slice(0, 200));
});

test('escena escalar: N réplicas repiten la caché e invalidan sólo la propia', async page => {
  await open(page);
  const r = await evalScene(page, SL.escalar, sec => {
    const sim = sec._scene.sim, reps = v => sec.querySelector(`.seg[data-group=reps] [data-v="${v}"]`).click();
    reps(1); sim.fastForward(40); const one = sim.window(25).hitRate;
    reps(3); sim.fastForward(40); const three = sim.window(25).hitRate;
    sec.querySelector('[data-act=write]').click(); sim.fastForward(8);
    return { one, three, cache: sim.o.cache, replicas: sim.o.replicas, stale: sim.window(8).stale };
  });
  check(r.cache === 'local' && r.replicas === 3, JSON.stringify(r));
  check(r.three < r.one, `hit rate 1 réplica=${r.one} · 3 réplicas=${r.three}`);
  check(r.stale > 0, `stale=${r.stale}`);
});

test('escena escalar: cada réplica muestra su propia tabla de caché', async page => {
  await open(page);
  const r = await evalScene(page, SL.escalar, sec => {
    const sim = sec._scene.sim;
    sec.querySelector('.seg[data-group=reps] [data-v="3"]').click();
    sim.fastForward(20);
    sec.querySelector('[data-act=write]').click();
    sim.fastForward(3);
    const tables = [...sec.querySelectorAll('svg.sim .keytable')].map(t => [...t.querySelectorAll('.kchip')].map(c => c.textContent + (c.classList.contains('stale') ? '*' : '')).join(' '));
    return { tables, stale: sec.querySelectorAll('svg.sim .kchip.stale').length };
  });
  check(r.tables.length === 3, `tablas=${r.tables.length}`);
  check(new Set(r.tables).size > 1, `las tablas son iguales: ${JSON.stringify(r.tables)}`);
  check(r.stale > 0, `sin claves viejas marcadas: ${JSON.stringify(r.tables)}`);
});

test('escena escalar: clic en una réplica muestra sus entradas con precio', async page => {
  await open(page);
  const r = await evalScene(page, SL.escalar, sec => {
    const sim = sec._scene.sim, click = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    sec.querySelector('.seg[data-group=reps] [data-v="3"]').click();
    sim.fastForward(20);
    sim.writePrice(0, 0); sim.writePrice(0, 0); // si #0 vuelve a la réplica 1, entra con el precio nuevo
    sim.fastForward(2);
    const read = i => {
      click(sim.svcs[i].g);
      const box = sec.querySelector('svg.sim .cinspect');
      if (!box) return null;
      return {
        title: box.querySelector('.ci-title').textContent,
        rows: [...box.querySelectorAll('.ci-row')].map(row => ({ key: row.dataset.key, text: row.textContent, stale: row.classList.contains('stale') }))
      };
    };
    const a = read(0), b = read(1), c = read(2);
    click(sim.svcs[2].g); // otro clic en la misma la cierra
    return { a, b, c, closed: !sec.querySelector('svg.sim .cinspect'), sel: sec.querySelectorAll('svg.sim .srv.inspected').length };
  });
  check(r.a && r.b && r.c, `sin inspector: ${JSON.stringify(r)}`);
  check(/Productos 1/.test(r.a.title) && /Productos 2/.test(r.b.title), `títulos: ${r.a.title} · ${r.b.title}`);
  check(r.a.rows.length > 0 && r.a.rows.every(x => /\$/.test(x.text)), `filas sin precio: ${JSON.stringify(r.a.rows)}`);
  check(!r.a.rows.some(x => x.stale), `la réplica que escribió no debería tener viejos: ${JSON.stringify(r.a.rows)}`);
  const old = [r.b, r.c].flatMap(t => t.rows).filter(x => x.key === '0');
  check(old.length > 0 && old.every(x => x.stale), `#0 en las otras réplicas debería ser viejo: ${JSON.stringify(old)}`);
  check(r.closed && r.sel === 0, `no se cerró: ${JSON.stringify({ closed: r.closed, sel: r.sel })}`);
});

test('escena donde: clic en la caché externa muestra sus entradas', async page => {
  await open(page);
  const r = await evalScene(page, SL.donde, sec => {
    const sim = sec._scene.sim, click = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    click(sim.svcs[1].g);
    const local = !!sec.querySelector('svg.sim .cinspect');
    sec.querySelector('.seg[data-group=where] [data-v=shared]').click();
    sim.fastForward(10);
    const closedOnSwitch = !sec.querySelector('svg.sim .cinspect');
    click(sim.redis.g);
    const box = sec.querySelector('svg.sim .cinspect');
    return { local, closedOnSwitch, title: box && box.querySelector('.ci-title').textContent, rows: box ? box.querySelectorAll('.ci-row').length : 0 };
  });
  check(r.local && r.closedOnSwitch, JSON.stringify(r));
  check(/externa/i.test(r.title) && r.rows > 0, JSON.stringify(r));
});

test('escena donde: la caché externa muestra una sola tabla', async page => {
  await open(page);
  const n = await evalScene(page, SL.donde, sec => {
    sec.querySelector('.seg[data-group=where] [data-v=shared]').click();
    sec._scene.sim.fastForward(5);
    return sec.querySelectorAll('svg.sim .keytable').length;
  });
  check(n === 1, `tablas=${n}`);
});

/* ---------- privada o compartida: navegador, caché del camino y la URL como clave ---------- */

const ASK = `(sec, who, path) => {
  sec.querySelector('.seg[data-group=path] [data-v="' + path + '"]').click();
  sec.querySelector('[data-act=' + who + ']').click();
  sec._scene.ff(4.5);
}`;

test('privada: /logo.png se comparte y ahorra el viaje al origen', async page => {
  await open(page);
  const st = await evalScene(page, SL.privada, `(sec, ASK) => {
    const ask = eval(ASK);
    ask(sec, 'ana', '/logo.png'); ask(sec, 'beto', '/logo.png');
    return sec._scene.state();
  }`, ASK);
  check(st.origin === 1 && st.sharedHits === 1 && st.leaks === 0, JSON.stringify(st));
});

test('privada: private guarda sólo en el navegador', async page => {
  await open(page);
  const st = await evalScene(page, SL.privada, `(sec, ASK) => {
    const ask = eval(ASK);
    sec.querySelector('.seg[data-group=cc] [data-v=private]').click();
    ask(sec, 'ana', '/perfil'); ask(sec, 'ana', '/perfil'); ask(sec, 'beto', '/perfil');
    return sec._scene.state();
  }`, ASK);
  check(st.origin === 2 && st.browserHits === 1 && st.sharedHits === 0 && st.leaks === 0, JSON.stringify(st));
});

test('privada: no-store no guarda en ningún lado', async page => {
  await open(page);
  const st = await evalScene(page, SL.privada, `(sec, ASK) => {
    const ask = eval(ASK);
    sec.querySelector('.seg[data-group=cc] [data-v=no-store]').click();
    ask(sec, 'ana', '/perfil'); ask(sec, 'ana', '/perfil');
    return sec._scene.state();
  }`, ASK);
  check(st.origin === 2 && st.browserHits === 0, JSON.stringify(st));
});

test('privada: las tablas muestran qué guarda cada caché y de quién', async page => {
  await open(page);
  const r = await evalScene(page, SL.privada, `(sec, ASK) => {
    const ask = eval(ASK);
    ask(sec, 'ana', '/perfil');
    const t = [...sec.querySelectorAll('svg.sim .ctable')].map(x => x.textContent);
    return t;
  }`, ASK);
  check(r.length === 3, `tablas=${r.length}`);
  check(r.some(t => /\/perfil/.test(t) && /Ana/.test(t)), JSON.stringify(r));
});

/* ---------- revisión final: estado en vuelo al cambiar de modo ---------- */

test('privada: una respuesta en vuelo no cuenta en el modo nuevo', async page => {
  await open(page);
  const st = await evalScene(page, SL.privada, sec => {
    const sc = sec._scene, mode = v => sec.querySelector(`.seg[data-group=cc] [data-v=${v}]`).click();
    mode('public');
    sec.querySelector('[data-act=ana]').click(); sc.ff(4.5);
    sec.querySelector('[data-act=beto]').click(); sc.ff(1.2);
    mode('private'); sc.ff(4);
    return sc.state();
  });
  check(st.leaks === 0, JSON.stringify(st));
});

test('etag: cambiar de modo reinicia los contadores', async page => {
  await open(page);
  const st = await evalScene(page, SL.etag, sec => {
    const sc = sec._scene;
    sec.querySelector('.seg[data-group=etag] [data-v=on]').click();
    for (let i = 0; i < 2; i++) { sec.querySelector('[data-act=get]').click(); sc.ff(3); }
    sec.querySelector('.seg[data-group=etag] [data-v=off]').click();
    return sc.state();
  });
  check(st.r200 === 0 && st.r304 === 0 && st.bytes === 0, JSON.stringify(st));
});

test('job: un panel en vuelo no se mezcla al cambiar de modo', async page => {
  await open(page);
  const st = await evalScene(page, SL.job, sec => {
    const sc = sec._scene;
    sec.querySelector('.seg[data-group=mode] [data-v=ondemand]').click();
    sc.ff(2);
    sec.querySelector('[data-act=panel]').click(); sc.ff(0.3);
    sec.querySelector('.seg[data-group=mode] [data-v=job]').click(); sc.ff(4);
    return sc.state();
  });
  check(st.panelMs === null && st.dataAge === null, JSON.stringify(st));
});

/* ---------- revisión final: detalles menores ---------- */

test('reemplazo: pausa responde justo después de reiniciar', async page => {
  await open(page);
  const st = await evalScene(page, SL.reemplazo, sec => {
    sec.querySelector('[data-act=reset]').click();
    sec.querySelector('[data-act=play]').click();
    return sec._scene.state();
  });
  check(st.playing === false, JSON.stringify(st));
});

test('alescribir: recalcular con una orden en viaje no la suma dos veces', async page => {
  await open(page);
  const r = await evalScene(page, SL.alescribir, sec => {
    const sc = sec._scene;
    sec.querySelector('input[data-opt=auto]').click();
    for (let i = 0; i < 40 && sc.state().pending; i++) sc.ff(0.25);
    sec.querySelector('.seg[data-group=how] [data-v=evento]').click();
    sec.querySelector('[data-act=order]').click();
    sc.ff(1.6);
    sec.querySelector('[data-act=fix]').click();
    for (let i = 0; i < 60; i++) { sc.ff(0.25); if (sc.state().pending === 0) break; }
    return sc.state();
  });
  check(r.pending === 0 && r.total === r.trueTotal, JSON.stringify(r));
});

test('cachesim: cambiar la capacidad no pierde pedidos que esperaban (coalescing)', async page => {
  await open(page);
  const r = await engine(page, svg => {
    const s = new CacheSimKit.CacheSim(svg, { cache: 'shared', coalesce: true, rate: 12, capacity: 20 });
    s.fastForward(1.5);
    s.set('capacity', 8);
    s.setRate(0);
    s.fastForward(12);
    return { arrived: s.arrived, logged: s.log.length };
  });
  check(r.arrived > 0 && r.arrived === r.logged, JSON.stringify(r));
});

test('cachesim: staleRate usa los pedidos servidos', async page => {
  await open(page);
  const w = await engine(page, svg => {
    const s = new CacheSimKit.CacheSim(svg, { cache: 'shared', rate: 16, ttl: 60, capacity: 30 });
    s.fastForward(4);
    for (let i = 0; i < 6; i++) { s.writePrice(0); s.fastForward(1); }
    return s.window(10);
  });
  check(w.err > 0 && w.stale > 0, `escenario sin errores o sin viejas: ${JSON.stringify(w)}`);
  check(Math.abs(w.staleRate - w.stale / (w.n - w.err)) < 1e-9, JSON.stringify(w));
});

/* ---------- recorrido completo ---------- */

test('escenas: stop/start sin errores', async (page, errors) => {
  await open(page);
  const n = await page.evaluate(() => document.querySelectorAll('.reveal .slides > section').length);
  for (let i = 0; i < n; i++) {
    await page.evaluate(i => Reveal.slide(i, 0, 99), i);
    await sleep(250);
  }
  for (const i of [3, 14]) {
    await page.evaluate(i => Reveal.slide(i, 0, 99), i);
    await sleep(400);
    check(await page.evaluate(i => !!window.__sec(i)._scene, i), `sin escena en ${i}`);
  }
  check(errors.length === 0, errors.join(' | '));
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
