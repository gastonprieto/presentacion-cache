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
  check(r.cache === 'shared', `cache=${r.cache}`);
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

Object.assign(SL, { ttl: 6, invalidar: 7, fria: 8, donde: 9, nocachear: 10 });

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
