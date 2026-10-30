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
    const btn = slide.querySelector('[data-act=cache]');
    const label = () => { btn.textContent = sim.o.cache ? '⏻ Apagar caché' : '💾 Prender caché'; };
    on(slide, '[data-act=cache]', () => { sim.set('cache', sim.o.cache ? null : 'shared'); label(); });
    on(slide, '[data-act=reset]', () => { range.value = 8; sim.reset({ cache: null, rate: 8, capacity: 20 }); label(); });
    return life(sim);
  };

  /* ---------- 4. de qué depende el hit rate ---------- */

  S.hitrate = slide => {
    const sim = setupCache(slide, { cache: 'shared', rate: 6, capacity: 10, keys: 50, zipf: 1.1 });
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
    const sim = setupCache(slide, { cache: 'shared', rate: 6, capacity: 20, ttl: 30 });
    const r = slide.querySelector('input.ttl'), out = slide.querySelector('.ttl-val');
    r.addEventListener('input', () => { sim.set('ttl', +r.value); out.textContent = `${r.value} s`; });
    on(slide, '[data-act=write]', () => sim.writePrice(0));
    slide.querySelector('input[data-opt=auto]').addEventListener('change', e => sim.set('writeRate', e.target.checked ? 0.2 : 0));
    return life(sim);
  };

  /* ---------- 7. invalidación ---------- */

  S.invalidar = slide => {
    const sim = setupCache(slide, { cache: 'shared', rate: 6, capacity: 20, ttl: 60, invalidate: 'none' });
    seg(slide, 'inv', v => { sim.set('invalidate', v); showModeIn(slide, v); });
    on(slide, '[data-act=write]', () => sim.writePrice(0));
    return life(sim);
  };

  /* ---------- 8. caché fría y estampida ---------- */

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

  /* ---------- 9. dónde vive la caché ---------- */

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
      nav.sub.textContent = copy ? `copia vencida · ETag "v${copy.v}"` : 'sin copia';
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

    seg(slide, 'etag', v => { useEtag = v === 'on'; copy = null; showModeIn(slide, v); draw(); });
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
    org.sub.textContent = '/mi-cuenta';
    const upd = hstats(slide, [['leaks', 'Datos ajenos'], ['origin', 'Al origen']]);
    let origin = 0;
    const draw = () => {
      px.sub.textContent = shared ? `guarda /mi-cuenta (de ${USERS[shared].name})` : 'vacía';
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

    seg(slide, 'cc', v => { cc = v; shared = null; own.ana = own.beto = null; leaks = 0; origin = 0; showModeIn(slide, v); draw(); });
    on(slide, '[data-act=ana]', () => ask('ana'));
    on(slide, '[data-act=beto]', () => ask('beto'));
    draw();
    return { start: () => clock.start(), stop: () => clock.stop(), ff: sec => ffClock(clock, sec), state: () => ({ leaks, origin }) };
  };

  window.Scenes = S;
})();
