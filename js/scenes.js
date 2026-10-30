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

  window.Scenes = S;
})();
