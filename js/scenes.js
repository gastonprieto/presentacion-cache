/* Una función por slide interactiva. Cada una recibe el <section> y devuelve { start, stop }.
   main.js las crea la primera vez que se visita la slide y las pausa al salir.
   Para una slide nueva: <section data-scene="nombre"> en index.html + S.nombre = slide => { … } acá. */
(function () {
  'use strict';

  const { Clock, svgEl, cubic, curve, edge, pop, C } = window.NetKit;
  const { CacheSim } = window.CacheSimKit;
  const S = {};

  /* ---------- helpers ---------- */

  // Crea la Sim sobre <svg class="sim"> y conecta los widgets que haya en la slide:
  // .stats (data-fields, data-window), .strip, canvas.chart, canvas.histo
  function setup(slide, opts) {
    const sim = new Sim(slide.querySelector('svg.sim'), opts);
    const st = slide.querySelector('.stats');
    if (st) Widgets.stats(st, sim, st.dataset.fields ? st.dataset.fields.split(',') : null, +(st.dataset.window || 5));
    const strip = slide.querySelector('.strip');
    if (strip) Widgets.strip(strip, sim);
    const cv = slide.querySelector('canvas.chart');
    if (cv) Widgets.chart(cv, sim);
    const hist = slide.querySelector('canvas.histo');
    if (hist) Widgets.histogram(hist, sim);
    return sim;
  }

  function on(slide, sel, fn) {
    slide.querySelectorAll(sel).forEach(b => b.addEventListener('click', e => { fn(b, e); b.blur(); }));
  }

  // Control segmentado: <div class="seg" data-group="x"><button data-v="a">…
  function seg(slide, group, fn) {
    const root = slide.querySelector(`.seg[data-group="${group}"]`);
    root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      root.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      b.blur();
      fn(b.dataset.v);
    }));
  }

  // Muestra solo los elementos [data-mode] que coinciden
  function showMode(slide, mode) {
    slide.querySelectorAll('[data-mode]').forEach(el => { el.hidden = el.dataset.mode !== mode; });
  }

  // Muestra sólo los .mode-text[data-mode] que coinciden (sin tocar otros [data-mode] de la slide)
  function showModeIn(slide, mode) {
    slide.querySelectorAll('.mode-text[data-mode]').forEach(el => { el.hidden = el.dataset.mode !== mode; });
  }

  const life = sim => ({ start: () => sim.start(), stop: () => sim.stop(), sim });

  /* ---------- 0. portada: simulación decorativa de fondo ---------- */

  S.title = slide => {
    const sim = new CacheSim(slide.querySelector('svg.bg'), { cache: 'shared', rate: 5, capacity: 20, replicas: 3 });
    sim.prewarm(15);
    return life(sim);
  };

  /* ---------- helpers de caché ---------- */

  // Crea la CacheSim sobre <svg class="sim"> y conecta .cstats (data-fields, data-window) y canvas.cache-chart
  function setupCache(slide, opts) {
    const sim = new CacheSim(slide.querySelector('svg.sim'), opts);
    const st = slide.querySelector('.cstats');
    if (st) Widgets.cacheStats(st, sim, st.dataset.fields ? st.dataset.fields.split(',') : null, +(st.dataset.window || 5));
    const cv = slide.querySelector('canvas.cache-chart');
    if (cv) Widgets.cacheChart(cv, sim);
    return sim;
  }

  // Slider de tráfico input.rate + .rate-out
  function rateSlider(slide, sim) {
    const range = slide.querySelector('input.rate'), out = slide.querySelector('.rate-out');
    const sync = () => { sim.setRate(+range.value); out.textContent = `${range.value} req/s`; };
    range.addEventListener('input', sync);
    sync();
    return range;
  }

  /* ---------- 1. una operación cara ---------- */

  S.cara = slide => {
    const sim = setupCache(slide, { cache: null, rate: 3 });
    rateSlider(slide, sim);
    return life(sim);
  };

  /* ---------- 3. hit y miss ---------- */

  S.hitmiss = slide => {
    const sim = setupCache(slide, { cache: null, rate: 8, capacity: 20 });
    const range = rateSlider(slide, sim);
    const out = slide.querySelector('.rate-out');
    const btn = slide.querySelector('[data-act=cache]');
    const label = () => { btn.textContent = sim.o.cache ? '⏻ Apagar caché' : '💾 Prender caché'; };
    on(slide, '[data-act=cache]', () => { sim.set('cache', sim.o.cache ? null : 'local'); label(); });
    on(slide, '[data-act=reset]', () => { range.value = 8; out.textContent = '8 req/s'; sim.reset({ cache: null, rate: 8, capacity: 20 }); label(); });
    return life(sim);
  };

  /* ---------- 4. de qué depende el hit rate ---------- */

  S.hitrate = slide => {
    const sim = setupCache(slide, { cache: 'local', rate: 6, capacity: 10, keys: 50, zipf: 1.1 });
    const bind = (cls, key, out) => {
      const r = slide.querySelector(`input.${cls}`), o = slide.querySelector(out);
      r.addEventListener('input', () => { sim.set(key, +r.value); o.textContent = r.value; });
    };
    bind('capacity', 'capacity', '.cap-val');
    bind('keys', 'keys', '.keys-val');
    seg(slide, 'pattern', v => sim.set('zipf', v === 'zipf' ? 1.1 : 0));
    return life(sim);
  };

  /* ---------- 6. TTL ---------- */

  S.ttl = slide => {
    const sim = setupCache(slide, { cache: 'local', rate: 6, capacity: 20, ttl: 30 });
    const r = slide.querySelector('input.ttl'), out = slide.querySelector('.ttl-val');
    r.addEventListener('input', () => { sim.set('ttl', +r.value); out.textContent = `${r.value} s`; });
    on(slide, '[data-act=write]', () => sim.writePrice(0));
    slide.querySelector('input[data-opt=auto]').addEventListener('change', e => sim.set('writeRate', e.target.checked ? 0.2 : 0));
    return life(sim);
  };

  /* ---------- 7. invalidación ---------- */

  S.invalidar = slide => {
    const sim = setupCache(slide, { cache: 'local', rate: 6, capacity: 20, ttl: 60, invalidate: 'none' });
    seg(slide, 'inv', v => { sim.set('invalidate', v); showModeIn(slide, v); });
    on(slide, '[data-act=write]', () => sim.writePrice(0));
    return life(sim);
  };

  /* ---------- 8. escalar horizontalmente: N cachés en memoria ---------- */

  S.escalar = slide => {
    const opts = replicas => ({ cache: 'local', replicas, rate: 6, capacity: 10, ttl: 30, invalidate: 'delete' });
    const sim = setupCache(slide, opts(1));
    seg(slide, 'reps', v => { sim.reset(opts(+v)); showModeIn(slide, v); });
    on(slide, '[data-act=write]', () => sim.writePrice(0, 0));
    return life(sim);
  };

  /* ---------- 10. caché fría y estampida ---------- */

  S.fria = slide => {
    const opt = k => slide.querySelector(`input[data-opt=${k}]`).checked;
    const opts = () => ({ cache: 'shared', rate: 16, capacity: 30, ttl: 20, coalesce: opt('coalesce'), jitter: opt('jitter') ? 0.3 : 0 });
    const sim = setupCache(slide, opts());
    const restart = () => { sim.reset(opts()); if (opt('prewarm')) sim.prewarm(30); };
    if (opt('prewarm')) sim.prewarm(30);
    on(slide, '[data-act=flush]', () => sim.flushCache());
    on(slide, '[data-act=reset]', restart);
    slide.querySelectorAll('input[data-opt]').forEach(i => i.addEventListener('change', restart));
    return life(sim);
  };

  /* ---------- 9. una caché externa ---------- */

  S.donde = slide => {
    const sim = setupCache(slide, { cache: 'local', replicas: 3, rate: 6, capacity: 10, ttl: 60, invalidate: 'delete' });
    seg(slide, 'where', v => { sim.set('cache', v); showModeIn(slide, v); });
    on(slide, '[data-act=write]', () => sim.writePrice(0, 0));
    return life(sim);
  };

  /* ---------- 5. reemplazo: casilleros paso a paso ---------- */

  const SEQS = {
    populares: 'ABC'.repeat(5) + 'DEFGHI' + 'ABC'.repeat(5),
    cambia: 'ABCD'.repeat(5) + 'EFGH'.repeat(5)
  };
  const SLOTS = 4;

  S.reemplazo = slide => {
    const { Cache } = window.CacheKit;
    const svg = slide.querySelector('svg.sim');
    svg.setAttribute('viewBox', `0 0 ${NetKit.W} ${NetKit.H}`);
    svg.classList.add('netsim', 'evict');
    const clock = new Clock();
    const M = NetKit.MOBILE, W = NetKit.W;
    let policy = 'lru', pattern = 'populares', playing = true, timer = null;
    let cache, seq, i, slots, entered, order, hits, misses, view;

    const hitsFor = (pol, sq) => {
      const c = new Cache({ capacity: SLOTS, policy: pol, seed: 7 });
      sq.forEach((k, t) => { if (!c.get(k, t)) c.set(k, k, t); });
      return c.stats.hits;
    };
    const table = () => {
      ['lru', 'lfu', 'fifo', 'random'].forEach(a => { slide.querySelector(`.algo-table [data-algo=${a}]`).textContent = hitsFor(a, seq); });
      slide.querySelector('.algo-n').textContent = `de ${seq.length}`;
      slide.querySelectorAll('.algo-table td[data-algo]').forEach(td => td.classList.toggle('cur', td.dataset.algo === policy));
    };

    // geometría: cinta arriba (1 fila en escritorio, 2 en celular) y casilleros en fila (2×2 en celular)
    const cellW = M ? 18 : 21;
    const perRow = M ? 20 : 40;
    const tapeX = k => (M ? 20 : (W - seq.length * cellW) / 2) + (k % perRow) * cellW;
    const tapeY = k => (M ? 36 : 70) + Math.floor(k / perRow) * (cellW + 6);
    const slotSize = M ? 92 : 132;
    const slotPos = j => M
      ? { x: 105 + (j % 2) * 190, y: 175 + Math.floor(j / 2) * 120 }
      : { x: 135 + j * 210, y: 300 };

    const build = () => {
      clock.clear();
      svg.innerHTML = '';
      cache = new Cache({ capacity: SLOTS, policy, seed: 7 });
      seq = SEQS[pattern].split('');
      i = 0; hits = 0; misses = 0; order = 0;
      slots = new Array(SLOTS).fill(null);
      entered = {};
      view = { tape: [], slots: [] };
      const gt = svgEl('g', {}, svg);
      seq.forEach((k, j) => {
        const g = svgEl('g', { class: 'tape-cell', transform: `translate(${tapeX(j)},${tapeY(j)})` }, gt);
        svgEl('rect', { x: 0, y: 0, width: cellW - 3, height: cellW + 2, rx: 4 }, g);
        svgEl('text', { x: (cellW - 3) / 2, y: cellW - 4, 'text-anchor': 'middle' }, g).textContent = k;
        view.tape.push(g);
      });
      svgEl('text', { x: M ? 20 : (W - seq.length * cellW) / 2, y: M ? 26 : 58, class: 't-sub' }, svg).textContent = 'pedidos que llegan →';
      for (let j = 0; j < SLOTS; j++) {
        const P = slotPos(j);
        const g = svgEl('g', { class: 'slot', transform: `translate(${P.x},${P.y})` }, svg);
        svgEl('rect', { class: 'node-box', x: -slotSize / 2, y: -slotSize / 2, width: slotSize, height: slotSize, rx: 14 }, g);
        const key = svgEl('text', { x: 0, y: M ? 10 : 14, class: 'slot-key', 'text-anchor': 'middle' }, g);
        const meta = svgEl('text', { x: 0, y: slotSize / 2 - 12, class: 't-sub', 'text-anchor': 'middle' }, g);
        view.slots.push({ g, key, meta, P });
      }
      view.count = svgEl('text', { x: W / 2, y: M ? 425 : 500, class: 'evict-count', 'text-anchor': 'middle' }, svg);
      table();
      draw();
      schedule();
    };

    const draw = () => {
      view.tape.forEach((g, j) => g.setAttribute('class', 'tape-cell' + (j < i ? ' done' : '') + (j === i ? ' next' : '')));
      slots.forEach((k, j) => {
        const v = view.slots[j];
        v.key.textContent = k || '';
        const e = k && cache.peek(k);
        v.meta.textContent = !e ? 'vacío'
          : policy === 'lru' ? `usada hace ${cache.tick - e.lastUsed}`
          : policy === 'lfu' ? `${e.freq} pedido${e.freq > 1 ? 's' : ''}`
          : policy === 'fifo' ? `entró ${entered[k]}°` : '';
      });
      view.count.innerHTML = `<tspan class="pinkt">${hits} hits</tspan> · ${misses} misses · hit rate ${i ? Math.round(hits / i * 100) : 0}%`;
    };

    const flash = (j, cls) => {
      const g = view.slots[j].g;
      g.classList.add(cls);
      clock.after(0.45, () => g.classList.remove(cls));
    };

    const step = () => {
      if (i >= seq.length) return;
      const k = seq[i], t = i;
      i++;
      if (cache.get(k, t)) {
        hits++;
        const j = slots.indexOf(k);
        flash(j, 'hit');
        pop(svg, view.slots[j].P.x, view.slots[j].P.y - slotSize / 2 - 8, 'hit', '#f472b6');
      } else {
        misses++;
        const out = cache.set(k, k, t);
        let j = out != null ? slots.indexOf(out) : slots.indexOf(null);
        if (out != null) pop(svg, view.slots[j].P.x, view.slots[j].P.y + slotSize / 2 + 22, `sale ${out}`, '#f87171');
        slots[j] = k;
        entered[k] = ++order;
        flash(j, 'miss');
      }
      draw();
    };

    const schedule = () => {
      if (timer) timer.cancel();
      timer = playing ? clock.every(0.7, () => { if (i >= seq.length) { playing = false; label(); timer.cancel(); } else step(); }) : null;
    };
    const label = () => { slide.querySelector('[data-act=play]').textContent = playing ? '⏸ Pausa' : i >= seq.length ? '↻ Otra vez' : '▶ Seguir'; };

    seg(slide, 'policy', v => { policy = v; showModeIn(slide, v); build(); });
    seg(slide, 'pattern', v => { pattern = v; build(); });
    on(slide, '[data-act=step]', () => { playing = false; schedule(); label(); step(); });
    on(slide, '[data-act=play]', () => { if (i >= seq.length) build(); playing = !playing || i === 0 ? true : false; schedule(); label(); });
    on(slide, '[data-act=reset]', () => { playing = true; build(); label(); });
    build();
    return {
      start: () => clock.start(), stop: () => clock.stop(),
      state: () => ({ policy, pattern, hits, misses, slots: slots.filter(Boolean) })
    };
  };

  /* ---------- helpers de escenas manuales ---------- */

  // Prepara <svg class="sim"> para una escena manual con su propio Clock
  function manual(slide, cls) {
    const svg = slide.querySelector('svg.sim');
    svg.setAttribute('viewBox', `0 0 ${NetKit.W} ${NetKit.H}`);
    svg.classList.add('netsim', cls);
    return { svg, clock: new Clock(), M: NetKit.MOBILE };
  }

  // Avanza un Clock sin animar (para las pruebas): mismo paso que fastForward de las simulaciones
  function ffClock(clock, sec) {
    const sp = NetKit.Speed.value;
    NetKit.Speed.value = 1;
    try { for (let i = 0, n = Math.round(sec / 0.05); i < n; i++) clock._tick(0, 50); }
    finally { NetKit.Speed.value = sp; }
  }

  // Caja con título (y emoji opcional) y una línea de subtítulo; devuelve el nodo con .sub
  function nbox(layer, n, title, emoji, cls) {
    const g = svgEl('g', { class: cls || 'srv', transform: `translate(${n.x},${n.y})` }, layer);
    svgEl('rect', { class: 'node-box', x: -n.hw, y: -n.hh, width: n.hw * 2, height: n.hh * 2, rx: 10 }, g);
    const tx = emoji ? -n.hw + 36 : 0, anchor = emoji ? 'start' : 'middle';
    if (emoji) svgEl('text', { x: -n.hw + 19, y: 7, class: 't-emoji', 'text-anchor': 'middle' }, g).textContent = emoji;
    svgEl('text', { x: tx, y: -3, class: 't-title small', 'text-anchor': anchor }, g).textContent = title;
    n.sub = svgEl('text', { x: tx, y: 14, class: 't-sub', 'text-anchor': anchor }, g);
    n.g = g;
    return n;
  }

  function link(layer, a, b, M, cls) {
    return svgEl('path', { class: 'link ' + (cls || ''), d: curve(edge(a, b, M), edge(b, a, M), M) }, layer);
  }

  // Punto que viaja de a hacia b (con el reloj de la escena)
  function fly(clock, layer, a, b, M, color, done, r = 6, dur = 0.5) {
    const el = svgEl('circle', { r, fill: color, class: 'pk' }, layer);
    clock.animate(dur, p => {
      const P = cubic(edge(a, b, M), edge(b, a, M), p, M);
      el.setAttribute('cx', P.x); el.setAttribute('cy', P.y);
    }, () => { el.remove(); done && done(); });
  }

  // Contadores HTML simples: [['clave', 'etiqueta'], …] → update(obj)
  function hstats(slide, fields) {
    const el = slide.querySelector('.hstats');
    el.className = 'hstats stats';
    el.style.gridTemplateColumns = `repeat(${fields.length}, 1fr)`;
    el.innerHTML = fields.map(([k, l]) => `<div class="stat s-${k}"><b data-f="${k}">0</b><span>${l}</span></div>`).join('');
    return v => fields.forEach(([k]) => { el.querySelector(`[data-f="${k}"]`).textContent = v[k]; });
  }

  const PINK = '#f472b6', GREEN = C.ok, REQ = C.req, RED = C.err;
  const fmtKB = kb => (kb >= 1000 ? `${(kb / 1000).toFixed(1)} MB` : `${Math.round(kb * 10) / 10} KB`);

  /* ---------- 11. caché HTTP en el navegador ---------- */

  S.http = slide => {
    const { svg, clock, M } = manual(slide, 'httpc');
    const W = NetKit.W;
    let maxAge = 60, copy = null, sent = 0, fromCache = 0, kb = 0, auto = null;
    const nav = M ? { x: W / 2, y: 80, hw: 120, hh: 46 } : { x: 190, y: 250, hw: 130, hh: 40 };
    const srv = M ? { x: W / 2, y: 330, hw: 110, hh: 34 } : { x: 700, y: 250, hw: 110, hh: 40 };
    const gl = svgEl('g', {}, svg), gn = svgEl('g', {}, svg), gp = svgEl('g', {}, svg);
    link(gl, nav, srv, M);
    nbox(gn, nav, 'Navegador', '💻', 'client');
    nav.g.style.setProperty('--c', REQ);
    nav.sub.textContent = 'pide /static/app.js';
    nbox(gn, srv, 'tienda.com', '🖥');
    srv.sub.textContent = 'sirve /static/app.js';
    const drawer = svgEl('g', { transform: `translate(${nav.x},${nav.y + nav.hh + (M ? 34 : 46)})` }, gn);
    svgEl('rect', { class: 'drawer', x: -nav.hw, y: -26, width: nav.hw * 2, height: 52, rx: 10 }, drawer);
    const dTitle = svgEl('text', { x: -nav.hw + 12, y: -6, class: 't-sub' }, drawer);
    const dAge = svgEl('text', { x: -nav.hw + 12, y: 14, class: 't-info' }, drawer);
    dTitle.textContent = '💾 caché del navegador';
    const hdr = svgEl('text', { x: M ? 20 : 60, y: M ? 420 : 470, class: 'hdr' }, svg);
    const upd = hstats(slide, [['sent', 'Salieron'], ['fromCache', 'Desde caché'], ['kb', 'Bajado']]);

    const draw = () => {
      if (!copy) dAge.textContent = 'vacía';
      else {
        const age = Math.floor(clock.now - copy.at), fresh = age < copy.maxAge;
        dAge.textContent = `app.js · edad ${age} s / max-age ${copy.maxAge} → ${fresh ? 'fresca' : 'vencida'}`;
        dAge.setAttribute('class', 't-info ' + (fresh ? 'fresh' : 'stale'));
      }
      upd({ sent, fromCache, kb: fmtKB(kb) });
    };
    clock.onTick = draw;

    const get = () => {
      if (copy && clock.now - copy.at < copy.maxAge) {
        fromCache++;
        pop(gp, nav.x, nav.y - nav.hh - 8, 'desde caché · 0 ms', PINK);
        draw();
        return;
      }
      sent++;
      const ma = maxAge;
      fly(clock, gp, nav, srv, M, REQ, () => {
        fly(clock, gp, srv, nav, M, GREEN, () => {
          copy = { at: clock.now, maxAge: ma };
          kb += 180;
          hdr.textContent = `200 OK · 180 KB · Cache-Control: max-age=${ma}`;
          draw();
        }, 9);
      });
      draw();
    };

    seg(slide, 'maxage', v => { maxAge = +v; });
    on(slide, '[data-act=get]', get);
    slide.querySelector('input[data-opt=auto]').addEventListener('change', e => {
      if (auto) auto.cancel();
      auto = e.target.checked ? clock.every(4, get) : null;
    });
    draw();
    return { start: () => clock.start(), stop: () => clock.stop(), ff: sec => ffClock(clock, sec), state: () => ({ sent, fromCache, age: copy ? clock.now - copy.at : null }) };
  };

  /* ---------- 12. validación con ETag ---------- */

  S.etag = slide => {
    const { svg, clock, M } = manual(slide, 'httpc');
    const W = NetKit.W;
    let useEtag = false, version = 1, copy = null, r200 = 0, r304 = 0, kb = 0;
    const nav = M ? { x: W / 2, y: 80, hw: 120, hh: 46 } : { x: 190, y: 250, hw: 130, hh: 40 };
    const srv = M ? { x: W / 2, y: 330, hw: 110, hh: 34 } : { x: 700, y: 250, hw: 110, hh: 40 };
    const gl = svgEl('g', {}, svg), gn = svgEl('g', {}, svg), gp = svgEl('g', {}, svg);
    link(gl, nav, srv, M);
    nbox(gn, nav, 'Navegador', '💻', 'client');
    nav.g.style.setProperty('--c', REQ);
    nbox(gn, srv, 'tienda.com', '🖥');
    const req = svgEl('text', { x: M ? 20 : 60, y: M ? 400 : 440, class: 'hdr' }, svg);
    const res = svgEl('text', { x: M ? 20 : 60, y: M ? 425 : 470, class: 'hdr' }, svg);
    const upd = hstats(slide, [['r200', '200 OK'], ['r304', '304'], ['kb', 'Bajado']]);
    const draw = () => {
      nav.sub.textContent = !copy ? 'sin copia' : useEtag ? `copia vencida · ETag "v${copy.v}"` : 'copia vencida';
      srv.sub.textContent = `app.js versión "v${version}"`;
      upd({ r200, r304, kb: fmtKB(kb) });
    };

    const get = () => {
      const cond = useEtag && copy;
      req.textContent = 'GET /static/app.js' + (cond ? `  ·  If-None-Match: "v${copy.v}"` : '');
      fly(clock, gp, nav, srv, M, REQ, () => {
        if (cond && copy.v === version) {
          r304++; kb += 0.3;
          res.textContent = '304 Not Modified · sin cuerpo · 0,3 KB';
          fly(clock, gp, srv, nav, M, PINK, () => { pop(gp, nav.x, nav.y - nav.hh - 8, '304: usá la tuya', PINK); draw(); }, 4);
        } else {
          r200++; kb += 180;
          res.textContent = `200 OK · 180 KB` + (useEtag ? ` · ETag: "v${version}"` : '');
          const v = version;
          fly(clock, gp, srv, nav, M, GREEN, () => { copy = { v }; draw(); }, 10);
        }
        draw();
      });
    };

    seg(slide, 'etag', v => {
      clock.clear(); gp.innerHTML = ''; req.textContent = res.textContent = '';
      useEtag = v === 'on'; copy = null; r200 = r304 = kb = 0; showModeIn(slide, v); draw();
    });
    on(slide, '[data-act=get]', get);
    on(slide, '[data-act=change]', () => { version++; pop(gp, srv.x, srv.y - srv.hh - 8, `nueva versión v${version}`, '#fb923c'); draw(); });
    draw();
    return { start: () => clock.start(), stop: () => clock.stop(), ff: sec => ffClock(clock, sec), state: () => ({ r200, r304, bytes: kb }) };
  };

  /* ---------- 13. caché privada o compartida ---------- */

  S.privada = slide => {
    const { svg, clock, M } = manual(slide, 'httpc');
    const W = NetKit.W;
    const USERS = { ana: { name: 'Ana', emoji: '👩', color: '#38bdf8' }, beto: { name: 'Beto', emoji: '👨', color: '#a3e635' } };
    let cc = 'public', shared = null, leaks = 0;
    const own = { ana: null, beto: null };
    const U = M
      ? { ana: { x: 100, y: 50, hw: 80, hh: 30 }, beto: { x: 300, y: 50, hw: 80, hh: 30 } }
      : { ana: { x: 120, y: 160, hw: 90, hh: 40 }, beto: { x: 120, y: 420, hw: 90, hh: 40 } };
    const px = M ? { x: W / 2, y: 210, hw: 120, hh: 36 } : { x: 440, y: 290, hw: 120, hh: 44 };
    const org = M ? { x: W / 2, y: 370, hw: 110, hh: 32 } : { x: 760, y: 290, hw: 100, hh: 40 };
    const gl = svgEl('g', {}, svg), gn = svgEl('g', {}, svg), gp = svgEl('g', {}, svg);
    Object.values(U).forEach(u => link(gl, u, px, M));
    link(gl, px, org, M);
    Object.entries(U).forEach(([k, u]) => { nbox(gn, u, USERS[k].name, USERS[k].emoji, 'client'); u.g.style.setProperty('--c', USERS[k].color); });
    nbox(gn, px, 'Caché compartida', '🗃', 'redis');
    nbox(gn, org, 'tienda.com', '🖥');
    org.sub.textContent = '/perfil';
    const upd = hstats(slide, [['leaks', 'Datos ajenos'], ['origin', 'Al origen']]);
    let origin = 0;
    const draw = () => {
      px.sub.textContent = shared ? `guarda /perfil (de ${USERS[shared].name})` : 'vacía';
      Object.entries(U).forEach(([k, u]) => { u.sub.textContent = own[k] ? `su copia: de ${USERS[own[k]].name}` : 'sin copia'; });
      upd({ leaks, origin });
    };

    const ask = who => {
      const u = U[who];
      if (cc === 'private' && own[who]) { pop(gp, u.x, u.y - u.hh - 8, 'desde su navegador', PINK); return; }
      fly(clock, gp, u, px, M, USERS[who].color, () => {
        if (cc === 'public' && shared) {
          const owner = shared;
          fly(clock, gp, px, u, M, USERS[owner].color, () => {
            own[who] = owner;
            if (owner !== who) { leaks++; pop(gp, u.x, u.y - u.hh - 8, '¡datos de otro!', RED); }
            draw();
          }, 8);
          return;
        }
        fly(clock, gp, px, org, M, USERS[who].color, () => {
          origin++;
          fly(clock, gp, org, px, M, USERS[who].color, () => {
            if (cc === 'public') shared = who;
            fly(clock, gp, px, u, M, USERS[who].color, () => { if (cc !== 'no-store') own[who] = who; draw(); }, 8);
            draw();
          }, 8);
        });
      });
    };

    seg(slide, 'cc', v => { clock.clear(); gp.innerHTML = ''; cc = v; shared = null; own.ana = own.beto = null; leaks = 0; origin = 0; showModeIn(slide, v); draw(); });
    on(slide, '[data-act=ana]', () => ask('ana'));
    on(slide, '[data-act=beto]', () => ask('beto'));
    draw();
    return { start: () => clock.start(), stop: () => clock.stop(), ff: sec => ffClock(clock, sec), state: () => ({ leaks, origin }) };
  };

  /* ---------- 14–15. CDN: mapa estilizado ---------- */

  // Proyección equirectangular simple sobre el lienzo de escritorio (900×590)
  const proj = (lon, lat) => ({ x: 40 + (lon + 170) * 2.333, y: 90 + (80 - lat) * 3.48 });
  const REGIONS = [
    Object.assign({ id: 'na', name: 'Nueva York' }, proj(-74, 41)),
    Object.assign({ id: 'sa', name: 'Buenos Aires' }, proj(-58, -35)),
    Object.assign({ id: 'eu', name: 'Madrid' }, proj(-4, 40)),
    Object.assign({ id: 'as', name: 'Tokio' }, proj(140, 36)),
    Object.assign({ id: 'oc', name: 'Sídney' }, proj(151, -34))
  ];
  const ORIGIN = proj(-118, 22);
  // Siluetas simplificadas de los continentes (lon, lat)
  const CONTINENTS = [
    [[-165, 65], [-140, 70], [-95, 72], [-75, 62], [-55, 52], [-66, 45], [-75, 35], [-81, 25], [-97, 26], [-97, 18], [-87, 15], [-80, 8], [-105, 20], [-117, 32], [-124, 40], [-125, 48], [-140, 58], [-165, 60]],
    [[-55, 60], [-20, 70], [-22, 80], [-60, 80], [-70, 75]],
    [[-80, 8], [-60, 10], [-50, 0], [-35, -5], [-40, -22], [-48, -28], [-58, -38], [-65, -55], [-75, -50], [-72, -30], [-70, -18], [-81, -5]],
    [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [8, 54], [5, 58], [10, 63], [20, 70], [30, 70], [40, 66], [40, 45], [28, 41], [20, 40], [12, 44], [10, 38], [0, 38]],
    [[-17, 21], [-10, 30], [-5, 36], [10, 37], [30, 31], [33, 28], [43, 12], [51, 12], [40, -5], [40, -15], [35, -25], [20, -35], [15, -28], [12, -15], [9, 0], [-8, 5], [-17, 14]],
    [[40, 45], [40, 66], [60, 70], [80, 73], [110, 77], [140, 72], [170, 68], [180, 65], [160, 58], [142, 50], [130, 42], [122, 40], [122, 30], [110, 20], [105, 10], [100, 13], [98, 8], [92, 22], [80, 8], [72, 20], [60, 25], [56, 25], [52, 17], [43, 12], [35, 30], [45, 40]],
    [[130, 31], [135, 34], [141, 38], [142, 45], [140, 41], [133, 33]],
    [[114, -22], [122, -17], [130, -12], [137, -12], [142, -11], [146, -19], [153, -26], [150, -37], [141, -38], [130, -32], [115, -34]]
  ];
  // Celular: el mismo mapa escalado al lienzo de 400×440
  const mp = (x, y) => (NetKit.MOBILE ? { x: 8 + x * 0.42, y: 20 + y * 0.66 } : { x, y });
  const msBetween = (a, b) => Math.round(15 + Math.hypot(a.x - b.x, a.y - b.y) * 0.45); // en coordenadas de escritorio
  const msColor = ms => (ms < 80 ? C.ok : ms < 180 ? C.slow : C.err);

  function drawMap(svg) {
    const g = svgEl('g', { class: 'map' }, svg);
    CONTINENTS.forEach(poly => {
      const pts = poly.map(([lon, lat]) => { const P0 = proj(lon, lat), P = mp(P0.x, P0.y); return `${P.x.toFixed(1)},${P.y.toFixed(1)}`; });
      svgEl('polygon', { points: pts.join(' ') }, g);
    });
  }

  // Punto que viaja en línea recta entre dos posiciones de escritorio (se escalan en celular)
  function flyLine(clock, layer, a, b, color, dur, done, r = 5) {
    const A = mp(a.x, a.y), B = mp(b.x, b.y);
    const el = svgEl('circle', { r, fill: color, class: 'pk' }, layer);
    clock.animate(dur, p => { el.setAttribute('cx', A.x + (B.x - A.x) * p); el.setAttribute('cy', A.y + (B.y - A.y) * p); },
      () => { el.remove(); done && done(); });
  }
  const travel = ms => 0.25 + ms / 350; // duración animada (s) de un tramo según su latencia

  function cdnBase(slide) {
    const m = manual(slide, 'cdnmap');
    drawMap(m.svg);
    const M = NetKit.MOBILE;
    const gl = svgEl('g', {}, m.svg), gn = svgEl('g', {}, m.svg), gp = svgEl('g', {}, m.svg);
    const O = mp(ORIGIN.x, ORIGIN.y);
    const regions = REGIONS.map(r => {
      const edgeAt = { x: r.x + (r.x > 600 ? -38 : 38), y: r.y - 30 };
      const P = mp(r.x, r.y), E = mp(edgeAt.x, edgeAt.y);
      const toOrigin = svgEl('line', { class: 'route origin-route', x1: P.x, y1: P.y, x2: O.x, y2: O.y }, gl);
      const toEdge = svgEl('line', { class: 'route edge-route', x1: P.x, y1: P.y, x2: E.x, y2: E.y }, gl);
      const edgeOrigin = svgEl('line', { class: 'route back-route', x1: E.x, y1: E.y, x2: O.x, y2: O.y }, gl);
      const ug = svgEl('g', { class: 'user', transform: `translate(${P.x},${P.y})` }, gn);
      svgEl('circle', { r: M ? 7 : 11 }, ug);
      svgEl('text', { x: 0, y: M ? 4 : 5, 'text-anchor': 'middle', class: 'user-ico' }, ug).textContent = '👤';
      svgEl('text', { x: 0, y: M ? 20 : 28, 'text-anchor': 'middle', class: 'city' }, ug).textContent = r.name;
      const eg = svgEl('g', { class: 'edge-node', transform: `translate(${E.x},${E.y})` }, gn);
      const s = M ? 9 : 14;
      svgEl('rect', { x: -s, y: -s, width: s * 2, height: s * 2, rx: 5 }, eg);
      const elabel = svgEl('text', { x: 0, y: -s - 5, 'text-anchor': 'middle', class: 'edge-label' }, eg);
      return Object.assign({}, r, { edgeAt, eg, elabel, ug, P, routes: { toOrigin, toEdge, edgeOrigin } });
    });
    const og = svgEl('g', { class: 'origin', transform: `translate(${O.x},${O.y})` }, gn);
    const ow = M ? 30 : 46, oh = M ? 13 : 20;
    svgEl('rect', { x: -ow, y: -oh, width: ow * 2, height: oh * 2, rx: 7 }, og);
    svgEl('text', { x: 0, y: M ? 4 : 5, 'text-anchor': 'middle', class: 'origin-label' }, og).textContent = '🖥 origen';
    const setRoutes = cdn => regions.forEach(r => {
      r.routes.toOrigin.classList.toggle('on', !cdn);
      r.routes.toEdge.classList.toggle('on', cdn);
      r.routes.edgeOrigin.classList.toggle('on', cdn);
    });
    // Latencia de una respuesta, sobre el usuario
    const showMs = (r, ms) => pop(gp, r.P.x + (r.x > 600 ? 1 : -1) * (M ? 26 : 48), r.P.y + 5, `${Math.round(ms)} ms`, msColor(ms));
    return Object.assign(m, { gl, gn, gp, regions, setRoutes, showMs });
  }

  /* ---------- 14. CDN: llevar el contenido cerca ---------- */

  S.cdn = slide => {
    const { svg, clock, gp, regions, setRoutes, showMs } = cdnBase(slide);
    const rand = CacheKit.rng(3);
    let cdn = false, focus = false, cached, stats, originReqs, total;
    const bars = slide.querySelector('.region-bars');
    bars.innerHTML = regions.map(r => `<div class="rb" data-r="${r.id}"><span>${r.name}</span><i><b></b></i><em>—</em></div>`).join('');
    const upd = hstats(slide, [['total', 'Pedidos'], ['originReqs', 'Al origen']]);
    const resetStats = () => {
      cached = {}; originReqs = 0; total = 0;
      stats = Object.fromEntries(regions.map(r => [r.id, { n: 0, sum: 0 }]));
    };
    const draw = () => {
      regions.forEach(r => {
        r.eg.classList.toggle('on', cdn);
        r.eg.classList.toggle('warm', cdn && cached[r.id] === true);
        r.elabel.textContent = cdn ? (cached[r.id] === true ? 'borde ✓' : 'borde vacío') : '';
        const st = stats[r.id], avg = st.n ? st.sum / st.n : null;
        const row = bars.querySelector(`[data-r=${r.id}]`);
        row.querySelector('b').style.width = avg ? `${Math.min(100, avg / 3.2)}%` : '0';
        row.querySelector('b').className = avg == null ? '' : avg < 80 ? 'fast' : avg < 180 ? 'mid' : 'slow';
        row.querySelector('em').textContent = avg ? `${Math.round(avg)} ms` : '—';
      });
      upd({ total, originReqs });
    };
    const request = r => {
      total++;
      const done = ms => { stats[r.id].n++; stats[r.id].sum += ms; showMs(r, ms); draw(); };
      if (!cdn) {
        const ms = msBetween(r, ORIGIN);
        originReqs++;
        flyLine(clock, gp, r, ORIGIN, REQ, travel(ms) / 2, () => flyLine(clock, gp, ORIGIN, r, GREEN, travel(ms) / 2, () => done(ms), 6));
        return;
      }
      const e = r.edgeAt, toEdge = msBetween(r, e);
      if (cached[r.id] === true) {
        flyLine(clock, gp, r, e, REQ, travel(toEdge) / 2, () => flyLine(clock, gp, e, r, PINK, travel(toEdge) / 2, () => done(toEdge), 6));
        return;
      }
      const toOrigin = msBetween(e, ORIGIN);
      originReqs++;
      cached[r.id] = 'pending';
      flyLine(clock, gp, r, e, REQ, travel(toEdge) / 2, () =>
        flyLine(clock, gp, e, ORIGIN, REQ, travel(toOrigin) / 2, () =>
          flyLine(clock, gp, ORIGIN, e, GREEN, travel(toOrigin) / 2, () => {
            cached[r.id] = true;
            flyLine(clock, gp, e, r, GREEN, travel(toEdge) / 2, () => done(toEdge + toOrigin), 6);
          }, 6)));
    };
    const schedule = () => regions.forEach(r => {
      const tick = () => {
        if (!focus || r.id === 'oc') request(r);
        clock.after(focus ? 0.5 + rand() * 0.4 : 0.9 + rand() * 0.8, tick);
      };
      clock.after(rand() * 1.2, tick);
    });
    const restart = () => { clock.clear(); gp.innerHTML = ''; resetStats(); setRoutes(cdn); schedule(); draw(); };
    const setCdn = v => {
      cdn = v;
      slide.querySelector('[data-act=cdn]').textContent = cdn ? '⏻ Apagar CDN' : '🌐 Prender CDN';
      restart();
    };
    on(slide, '[data-act=cdn]', () => setCdn(!cdn));
    on(slide, '[data-act=focus]', b => { focus = !focus; b.textContent = focus ? 'Todas las regiones' : 'Sólo desde Sídney'; restart(); });
    restart();
    return {
      start: () => clock.start(), stop: () => clock.stop(), ff: sec => ffClock(clock, sec), setCdn,
      state: () => ({
        originReqs, total,
        byRegion: Object.fromEntries(regions.map(r => [r.id, { n: stats[r.id].n, avgMs: stats[r.id].n ? stats[r.id].sum / stats[r.id].n : null }]))
      })
    };
  };

  /* ---------- 15. distribuir e invalidar ---------- */

  S.distribuir = slide => {
    const { svg, clock, gp, regions, setRoutes } = cdnBase(slide);
    const rand = CacheKit.rng(5);
    setRoutes(true);
    const VCOL = { 1: '#94a3b8', 2: '#fb923c' };
    const NAME = { 1: 'app.3f2a.js', 2: 'app.9c1e.js' };
    let strategy = 'purga', originV, edgeV, served, purgedEdges, deployed, gen = 0;
    const upd = hstats(slide, [['v1', 'Sirvieron v1'], ['v2', 'Sirvieron v2'], ['purged', 'Bordes purgados']]);
    const draw = () => {
      regions.forEach(r => {
        const v = edgeV[r.id];
        r.elabel.textContent = v ? (strategy === 'purga' ? `app.js v${v}` : NAME[v]) : 'vacío';
        r.eg.classList.add('on');
        r.eg.style.setProperty('--v', v ? VCOL[v] : '#475569');
      });
      upd({ v1: served.v1, v2: served.v2, purged: strategy === 'purga' ? `${purgedEdges}/${regions.length}` : '—' });
    };
    const request = r => {
      const e = r.edgeAt, want = originV; // con versionado, el HTML (sin caché) ya apunta al nombre nuevo
      const v = strategy === 'purga' ? edgeV[r.id] : edgeV[r.id] === want ? want : null;
      if (v) {
        flyLine(clock, gp, r, e, REQ, 0.3, () => flyLine(clock, gp, e, r, VCOL[v], 0.3, () => { if (deployed) served[`v${v}`]++; draw(); }, 6));
        return;
      }
      flyLine(clock, gp, r, e, REQ, 0.3, () => flyLine(clock, gp, e, ORIGIN, REQ, 0.6, () => {
        const got = originV;
        flyLine(clock, gp, ORIGIN, e, VCOL[got], 0.6, () => {
          edgeV[r.id] = got;
          flyLine(clock, gp, e, r, VCOL[got], 0.3, () => { if (deployed) served[`v${got}`]++; draw(); }, 6);
        }, 6);
      }));
    };
    const restart = () => {
      gen++;
      clock.clear(); gp.innerHTML = '';
      originV = 1; deployed = false; purgedEdges = 0;
      served = { v1: 0, v2: 0 };
      edgeV = Object.fromEntries(regions.map(r => [r.id, 1]));
      regions.forEach(r => {
        const tick = () => { request(r); clock.after(0.8 + rand() * 0.6, tick); };
        clock.after(rand(), tick);
      });
      draw();
    };
    const deploy = () => {
      if (deployed) restart();
      const g = gen;
      originV = 2; deployed = true;
      pop(gp, mp(ORIGIN.x, ORIGIN.y).x, mp(ORIGIN.x, ORIGIN.y).y - 22, 'v2 publicada', VCOL[2]);
      if (strategy !== 'purga') { draw(); return; }
      regions.forEach(r => {
        const delay = 0.6 + rand() * 4;
        flyLine(clock, gp, ORIGIN, r.edgeAt, RED, delay, () => {
          if (g !== gen) return;
          edgeV[r.id] = null; purgedEdges++;
          const E = mp(r.edgeAt.x, r.edgeAt.y);
          pop(gp, E.x, E.y - 18, 'purgado', RED);
          draw();
        }, 4);
      });
      draw();
    };
    seg(slide, 'strategy', v => { strategy = v; showModeIn(slide, v); restart(); });
    on(slide, '[data-act=deploy]', deploy);
    restart();
    return {
      start: () => clock.start(), stop: () => clock.stop(), ff: sec => ffClock(clock, sec),
      state: () => ({ mode: strategy, served: Object.assign({}, served), purgedEdges })
    };
  };

  /* ---------- 16. un job que deja todo listo ---------- */

  S.job = slide => {
    const { svg, clock, M } = manual(slide, 'pre');
    const ORANGE = '#fb923c', TEAL = '#2dd4bf';
    const PER_ORDER = 0.002, RATE = 20;
    let mode = 'ondemand', every = 10, orders = 500, lastRunAt = null, jobRuns = 0, jobCostSec = 0;
    let panelMs = null, dataAge = null, busy = false, jobTimer = null, running = false, gen = 0;
    const N = M
      ? { src: { x: 110, y: 40, hw: 80, hh: 24 }, ord: { x: 110, y: 140, hw: 90, hh: 32 }, job: { x: 110, y: 260, hw: 90, hh: 32 }, agg: { x: 110, y: 380, hw: 90, hh: 30 }, pan: { x: 300, y: 260, hw: 88, hh: 34 } }
      : { src: { x: 110, y: 120, hw: 80, hh: 28 }, ord: { x: 400, y: 120, hw: 110, hh: 40 }, job: { x: 400, y: 300, hw: 110, hh: 40 }, agg: { x: 400, y: 470, hw: 110, hh: 36 }, pan: { x: 740, y: 300, hw: 120, hh: 44 } };
    const gl = svgEl('g', {}, svg), gn = svgEl('g', {}, svg), gp = svgEl('g', {}, svg);
    const lk = { panOrd: link(gl, N.pan, N.ord, M), panAgg: link(gl, N.pan, N.agg, M) };
    link(gl, N.src, N.ord, M); link(gl, N.ord, N.job, M, 'job-link'); link(gl, N.job, N.agg, M, 'job-link');
    nbox(gn, N.src, 'Tienda', '🛒', 'client'); N.src.g.style.setProperty('--c', ORANGE);
    N.src.sub.textContent = `${RATE} órdenes/s`;
    nbox(gn, N.ord, 'ordenes', '🗄', 'srv data');
    nbox(gn, N.job, 'Job', '⏱', 'jobn');
    nbox(gn, N.agg, 'ventas_por_dia', '📋', 'srv data');
    nbox(gn, N.pan, 'Panel de ventas', '📊', 'srv');
    const bar = (n, cls) => {
      svgEl('rect', { class: 'bar-bg', x: -n.hw + 10, y: n.hh - 10, width: n.hw * 2 - 20, height: 5, rx: 2.5 }, n.g);
      return svgEl('rect', { class: cls, x: -n.hw + 10, y: n.hh - 10, width: 0, height: 5, rx: 2.5 }, n.g);
    };
    const panBar = bar(N.pan, 'prog'), jobBar = bar(N.job, 'jobprog');
    const upd = hstats(slide, [['panel', 'Tardó el panel'], ['age', 'Antigüedad del dato'], ['cost', 'Trabajo del job']]);

    const draw = () => {
      N.ord.sub.textContent = `${Math.round(orders).toLocaleString('es-AR')} filas`;
      const jobOn = mode === 'job';
      N.job.g.classList.toggle('off', !jobOn);
      N.agg.g.classList.toggle('off', !jobOn);
      N.job.sub.textContent = !jobOn ? 'apagado' : running ? 'recorriendo…' : `cada ${every} s · ${jobRuns} corridas`;
      N.agg.sub.textContent = jobOn && lastRunAt != null ? `al ${Math.floor(lastRunAt)} s` : 'vacía';
      lk.panOrd.classList.toggle('off', jobOn);
      lk.panAgg.classList.toggle('off', !jobOn);
      N.pan.sub.textContent = busy ? 'calculando…' : panelMs == null ? 'cerrado' : `listo en ${Widgets.fmtLat(panelMs / 1000)}`;
      upd({
        panel: panelMs == null ? '—' : Widgets.fmtLat(panelMs / 1000),
        age: dataAge == null ? '—' : dataAge < 0.5 ? 'al día' : `${Math.round(dataAge)} s`,
        cost: jobOn ? `${jobCostSec.toFixed(1)} s` : '—'
      });
    };
    clock.onTick = draw;

    const progress = (el, n, dur, done) => {
      const g = gen;
      clock.animate(dur, p => { if (g === gen) el.setAttribute('width', (n.hw * 2 - 20) * p); }, () => { if (g === gen) { el.setAttribute('width', 0); done(); } });
    };

    const runJob = () => {
      if (running || mode !== 'job') return;
      running = true;
      const g = gen, snapshotAt = clock.now, dur = orders * PER_ORDER;
      fly(clock, gp, N.ord, N.job, M, TEAL, null, 4, 0.3);
      progress(jobBar, N.job, dur, () => {
        if (g !== gen) return;
        jobRuns++; jobCostSec += dur;
        fly(clock, gp, N.job, N.agg, M, TEAL, () => { if (g !== gen) return; lastRunAt = snapshotAt; running = false; pop(gp, N.agg.x, N.agg.y - N.agg.hh - 8, '✔ actualizada', TEAL); draw(); }, 6, 0.3);
      });
    };

    const openPanel = () => {
      if (busy) return;
      busy = true;
      const g = gen, t0 = clock.now, jobOn = mode === 'job';
      const target = jobOn ? N.agg : N.ord;
      const work = jobOn ? 0.05 : 0.2 + orders * PER_ORDER;
      fly(clock, gp, N.pan, target, M, REQ, () => progress(panBar, N.pan, work, () => {
        fly(clock, gp, target, N.pan, M, jobOn ? TEAL : GREEN, () => {
          if (g !== gen) return;
          busy = false;
          panelMs = Math.round(work * 1000);
          dataAge = jobOn ? (lastRunAt == null ? null : t0 - lastRunAt) : 0;
          draw();
        }, 7, 0.3);
      }), 6, 0.3);
      draw();
    };

    const restartJob = () => {
      if (jobTimer) jobTimer.cancel();
      jobTimer = null;
      if (mode === 'job') { runJob(); jobTimer = clock.every(every, runJob); }
    };
    clock.every(0.05, () => { orders += RATE * 0.05; });
    clock.every(0.35, () => fly(clock, gp, N.src, N.ord, M, ORANGE, null, 4, 0.4));
    seg(slide, 'mode', v => {
      mode = v; showModeIn(slide, v);
      slide.querySelector('.job-only').hidden = v !== 'job';
      gen++; busy = running = false; panBar.setAttribute('width', 0); jobBar.setAttribute('width', 0);
      panelMs = dataAge = null; lastRunAt = null; jobRuns = 0; jobCostSec = 0;
      restartJob(); draw();
    });
    const r = slide.querySelector('input.every'), out = slide.querySelector('.every-val');
    r.addEventListener('input', () => { every = +r.value; out.textContent = `${every} s`; restartJob(); });
    on(slide, '[data-act=panel]', openPanel);
    draw();
    return { start: () => clock.start(), stop: () => clock.stop(), ff: sec => ffClock(clock, sec), state: () => ({ mode, lastRunAt, dataAge, panelMs, jobRuns, jobCostSec }) };
  };

  /* ---------- 18. sumar al escribir ---------- */

  S.alescribir = slide => {
    const { svg, clock, M } = manual(slide, 'pre');
    const ORANGE = '#fb923c', TEAL = '#2dd4bf';
    const AMOUNTS = [1200, 850, 3000, 450, 2100];
    let how = 'directo', fail = false, total = 0, trueTotal = 0, failures = 0, writeMs = null, k = 0, attempt = 0;
    const N = M
      ? { src: { x: W2(), y: 40, hw: 80, hh: 24 }, svc: { x: W2(), y: 140, hw: 90, hh: 30 }, db: { x: 105, y: 270, hw: 90, hh: 30 }, ev: { x: 300, y: 270, hw: 80, hh: 28 }, tot: { x: W2(), y: 390, hw: 110, hh: 32 } }
      : { src: { x: 110, y: 290, hw: 80, hh: 28 }, svc: { x: 340, y: 290, hw: 100, hh: 36 }, db: { x: 680, y: 140, hw: 110, hh: 40 }, ev: { x: 560, y: 470, hw: 80, hh: 30 }, tot: { x: 780, y: 400, hw: 100, hh: 44 } };
    function W2() { return NetKit.W / 2; }
    const gl = svgEl('g', {}, svg), gn = svgEl('g', {}, svg), gp = svgEl('g', {}, svg);
    link(gl, N.src, N.svc, M); link(gl, N.svc, N.db, M);
    const lDirect = link(gl, N.svc, N.tot, M), lEv1 = link(gl, N.svc, N.ev, M, 'job-link'), lEv2 = link(gl, N.ev, N.tot, M, 'job-link');
    nbox(gn, N.src, 'Tienda', '🛒', 'client'); N.src.g.style.setProperty('--c', ORANGE);
    N.src.sub.textContent = 'nueva orden';
    nbox(gn, N.svc, 'Órdenes', '🧾');
    nbox(gn, N.db, 'ordenes', '🗄', 'srv data');
    nbox(gn, N.ev, 'Eventos', '📣', 'jobn');
    N.ev.sub.textContent = 'orden creada';
    nbox(gn, N.tot, 'total_ventas', '💰', 'srv data');
    const upd = hstats(slide, [['real', 'Suma real'], ['total', 'Total guardado'], ['write', 'Escritura']]);
    const warn = slide.querySelector('.warn-line');
    const money = v => `$${v.toLocaleString('es-AR')}`;
    const draw = () => {
      const ev = how === 'evento';
      [N.ev.g, lEv1, lEv2].forEach(e => e.classList.toggle('off', !ev));
      lDirect.classList.toggle('off', ev);
      N.svc.sub.textContent = ev ? 'guarda y publica' : 'guarda y suma';
      N.db.sub.textContent = `${k} órdenes · ${money(trueTotal)}`;
      N.tot.sub.textContent = money(total);
      N.tot.g.classList.toggle('bad', total !== trueTotal && failures > 0);
      warn.hidden = !(failures > 0 && total !== trueTotal);
      upd({ real: money(trueTotal), total: money(total), write: writeMs == null ? '—' : `${writeMs} ms` });
    };

    const applyTotal = (amount, from) => {
      attempt++;
      if (fail && attempt % 2 === 0) {
        failures++;
        fly(clock, gp, from, N.tot, M, RED, () => { pop(gp, N.tot.x, N.tot.y - N.tot.hh - 8, '✕ no se sumó', RED); draw(); }, 5, 0.4);
        return;
      }
      fly(clock, gp, from, N.tot, M, TEAL, () => { total += amount; pop(gp, N.tot.x, N.tot.y - N.tot.hh - 8, `+${money(amount)}`, TEAL); draw(); }, 5, 0.4);
    };

    const order = () => {
      const amount = AMOUNTS[k % AMOUNTS.length];
      fly(clock, gp, N.src, N.svc, M, ORANGE, () => {
        fly(clock, gp, N.svc, N.db, M, ORANGE, () => { k++; trueTotal += amount; draw(); }, 5, 0.4);
        if (how === 'directo') { writeMs = 8; applyTotal(amount, N.svc); }
        else { writeMs = 5; fly(clock, gp, N.svc, N.ev, M, TEAL, () => clock.after(0.8, () => applyTotal(amount, N.ev)), 5, 0.4); }
        draw();
      }, 6, 0.4);
    };

    seg(slide, 'how', v => { how = v; showModeIn(slide, v); draw(); });
    slide.querySelector('input[data-opt=fail]').addEventListener('change', e => { fail = e.target.checked; attempt = 0; });
    on(slide, '[data-act=order]', order);
    on(slide, '[data-act=fix]', () => { total = trueTotal; failures = 0; pop(gp, N.tot.x, N.tot.y - N.tot.hh - 8, '⟲ recalculado', TEAL); draw(); });
    clock.every(2.5, order);
    draw();
    return { start: () => clock.start(), stop: () => clock.stop(), ff: sec => ffClock(clock, sec), state: () => ({ total, trueTotal, writeMs, failures }) };
  };

  window.Scenes = S;
})();
