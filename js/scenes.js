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

  window.Scenes = S;
})();
