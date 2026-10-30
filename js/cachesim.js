/* Simulación visual de una caché: Usuarios → (reparto) → Productos (1..3 réplicas) → caché → DB.
   cache: null (todo a la DB) · 'shared' (una caché externa para todas las réplicas) · 'local' (una caché en la memoria de cada réplica).
   Cache-aside: el servicio busca en la caché; si no está (miss), consulta la DB y guarda el resultado.
   Cada producto tiene una versión de precio en la DB; una respuesta es vieja (stale) si la caché tenía una versión anterior.
   La latencia registrada es tiempo de caché + cola y consulta de la DB; el viaje animado de los puntos no cuenta.
   Usa el Clock y la geometría de NetKit y la Cache de CacheKit. Expone window.CacheSimKit = { CacheSim, DEFAULTS, COL }. */
(function () {
  'use strict';

  const { Clock, Speed, svgEl, cubic, curve, edge, pop, C, MOBILE, W, H } = window.NetKit;
  const { Cache, rng, zipfPicker } = window.CacheKit;

  const COL = { req: C.req, hit: '#f472b6', ok: C.ok, stale: '#d97706', err: C.err, db: C.db, write: '#fb923c' };

  const DEFAULTS = {
    seed: 1, rate: 3, keys: 50, zipf: 1.1, replicas: 1,
    cache: null, capacity: 10, ttl: 30, policy: 'lru', jitter: 0, coalesce: false,
    invalidate: 'none', dbWorkers: 4, dbTime: 0.8, dbQueueMax: 8,
    cacheTime: 0.03, netTime: 0.02, writeRate: 0, slowThreshold: 1.5, travel: 0.48,
    showKeys: false // dibuja debajo de cada caché la tabla de claves que guarda (rosa: al día · ámbar: precio viejo)
  };
  const TOPOLOGY = ['cache', 'replicas'];
  const CACHE_CONF = ['capacity', 'policy', 'ttl', 'jitter'];

  class CacheSim {
    constructor(svg, opts) {
      this.svg = svg;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.classList.add('netsim');
      this.v = MOBILE;
      this.clock = new Clock();
      this.clock.onTick = () => this._frame();
      this.listeners = {};
      this.o = Object.assign({}, DEFAULTS);
      this.reset(opts);
    }

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    emit(ev, ...a) { (this.listeners[ev] || []).forEach(f => f(...a)); }
    start() { this.clock.start(); }
    stop() { this.clock.stop(); }
    get now() { return this.clock.now; }

    reset(opts) {
      if (opts) this.o = Object.assign({}, DEFAULTS, opts);
      this.gen = (this.gen || 0) + 1;
      this.clock.clear();
      this.rand = rng(this.o.seed);
      this.pick = zipfPicker(this.o.keys, this.o.zipf, this.rand);
      this.log = [];
      this.dbLog = [];
      this.dbVersion = new Array(this.o.keys).fill(0);
      this.db = { busy: 0, queue: [] };
      this.rr = 0;
      this._makeCaches();
      this._build();
      this._scheduleArrival();
      this._scheduleWrites();
      this._frame();
      this.emit('reset');
    }

    _makeCaches() {
      const o = this.o, mk = i => new Cache({ capacity: o.capacity, ttl: o.ttl, policy: o.policy, jitter: o.jitter, seed: o.seed + i });
      this.caches = o.cache === 'shared' ? [mk(0)] : o.cache === 'local' ? Array.from({ length: o.replicas }, (_, i) => mk(i)) : [];
      this.pending = this.caches.map(() => new Map()); // coalescing: clave → pedidos esperando la misma consulta
    }

    // Cambia una opción en vivo. Topología → reset; configuración de la caché → caché nueva (vacía); el resto, al vuelo.
    set(key, value) {
      this.o[key] = value;
      if (TOPOLOGY.includes(key)) return this.reset();
      if (CACHE_CONF.includes(key)) { this._makeCaches(); this._frame(); return; }
      if (key === 'keys' || key === 'zipf') {
        this.pick = zipfPicker(this.o.keys, this.o.zipf, this.rand);
        while (this.dbVersion.length < this.o.keys) this.dbVersion.push(0);
      }
      if (key === 'writeRate') this._scheduleWrites();
    }
    setRate(r) { this.o.rate = r; }

    _cacheFor(replica) { return this.o.cache === 'shared' ? 0 : this.o.cache === 'local' ? replica : -1; }

    writePrice(key = 0, replica = 0) {
      this.dbVersion[key]++;
      const ci = this._cacheFor(replica);
      if (ci >= 0 && this.o.invalidate === 'delete') this.caches[ci].delete(key);
      if (ci >= 0 && this.o.invalidate === 'update') this.caches[ci].set(key, key, this.now, this.dbVersion[key]);
      this._pop(this.dbNode, `precio #${key} v${this.dbVersion[key]}`, COL.write);
      if (ci >= 0 && this.o.invalidate !== 'none') {
        const at = this.o.cache === 'shared' ? this.redis : this.svcs[replica];
        this._pop(at, this.o.invalidate === 'delete' ? `✕ borra #${key}` : `↻ #${key}`, COL.write);
      }
    }

    flushCache() {
      this.caches.forEach(c => c.clear());
      (this.o.cache === 'shared' ? [this.redis] : this.svcs).forEach(n => n && this._pop(n, 'caché vacía', COL.err));
    }

    prewarm(n) {
      this.caches.forEach(c => { for (let k = 0; k < Math.min(n, this.o.keys); k++) c.set(k, k, this.now, this.dbVersion[k]); });
    }

    fastForward(sec) {
      const sp = Speed.value;
      Speed.value = 1;
      try { for (let i = 0, n = Math.round(sec / 0.05); i < n; i++) this.clock._tick(0, 50); }
      finally { Speed.value = sp; }
    }

    window(sec) {
      const from = this.now - sec;
      let n = 0, hits = 0, stale = 0, err = 0;
      const lats = [];
      for (let i = this.log.length - 1; i >= 0 && this.log[i].t >= from; i--) {
        const e = this.log[i];
        n++;
        if (e.status === 'err') { err++; continue; }
        if (e.hit) hits++;
        if (e.stale) stale++;
        lats.push(e.lat);
      }
      let dbReqs = 0;
      for (let i = this.dbLog.length - 1; i >= 0 && this.dbLog[i] >= from; i--) dbReqs++;
      lats.sort((a, b) => a - b);
      const q = p => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(p * lats.length))] : null);
      const served = n - err;
      return {
        n, hits, misses: served - hits, hitRate: served ? hits / served : 0,
        stale, staleRate: n ? stale / n : 0, dbReqs, dbBusy: this.db.busy, dbQueue: this.db.queue.length,
        err, p50: q(0.5), p95: q(0.95)
      };
    }

    /* ---------- tráfico ---------- */

    _scheduleArrival() {
      const gen = this.gen;
      const next = () => {
        if (gen !== this.gen) return;
        if (this.o.rate > 0) this._arrive();
        const r = Math.max(this.o.rate, 0.2);
        this.clock.after(-Math.log(1 - this.rand()) / r, next);
      };
      this.clock.after(0.2, next);
    }

    _scheduleWrites() {
      if (this.writer) this.writer.cancel();
      this.writer = this.o.writeRate > 0 ? this.clock.every(1 / this.o.writeRate, () => this.writePrice(0)) : null;
    }

    _arrive() {
      const key = this.pick();
      const replica = this.rr++ % this.svcs.length;
      const req = { key, replica, gen: this.gen, lat: 0, t0: this.now };
      const svc = this.svcs[replica];
      const hops = this.front ? [this.client, this.front, svc] : [this.client, svc];
      this._path(hops, COL.req, () => this._atService(req));
    }

    _atService(req) {
      const ci = this._cacheFor(req.replica);
      if (ci < 0) return this._toDb(req, -1);
      const lookup = () => {
        const cache = this.caches[ci];
        if (!cache) return this._toDb(req, -1);
        req.lat += this.o.cacheTime + (this.o.cache === 'shared' ? this.o.netTime : 0);
        const e = cache.get(req.key, this.now);
        if (e) {
          const stale = e.version < this.dbVersion[req.key];
          return this._respond(req, true, stale, this.o.cache === 'shared' ? [this.redis, this.svcs[req.replica]] : [this.svcs[req.replica]]);
        }
        if (this.o.cache === 'shared') this._fly(this.redis, this.svcs[req.replica], COL.req, () => this._miss(req, ci), 3.5);
        else this._miss(req, ci);
      };
      if (this.o.cache === 'shared') this._fly(this.svcs[req.replica], this.redis, COL.req, lookup, 3.5);
      else lookup();
    }

    _miss(req, ci) {
      if (this.o.coalesce) {
        const waiting = this.pending[ci].get(req.key);
        if (waiting) { req.waitFrom = this.now; waiting.push(req); return; }
        this.pending[ci].set(req.key, []);
      }
      this._toDb(req, ci);
    }

    _toDb(req, ci) {
      const svc = this.svcs[req.replica];
      this._fly(svc, this.dbNode, COL.db, () => {
        if (req.gen !== this.gen) return;
        this.dbLog.push(this.now);
        if (this.db.busy < this.o.dbWorkers) this._query(req, ci, this.now);
        else if (this.db.queue.length < this.o.dbQueueMax) this.db.queue.push({ req, ci, at: this.now });
        else {
          this._pop(this.dbNode, '503', COL.err);
          this._fail(req, ci);
        }
      }, 3.5);
    }

    _query(req, ci, queuedAt) {
      this.db.busy++;
      const dur = this.o.dbTime * (0.75 + this.rand() * 0.5);
      this.clock.after(dur, () => {
        if (req.gen !== this.gen) return;
        this.db.busy--;
        const nx = this.db.queue.shift();
        if (nx) this._query(nx.req, nx.ci, nx.at);
        req.lat += (this.now - queuedAt);
        const version = this.dbVersion[req.key];
        if (ci >= 0) this.caches[ci] && this.caches[ci].set(req.key, req.key, this.now, version);
        this._respond(req, false, false, [this.dbNode, this.svcs[req.replica]]);
        if (ci >= 0 && this.o.coalesce) {
          const waiting = this.pending[ci].get(req.key) || [];
          this.pending[ci].delete(req.key);
          waiting.forEach(w => { w.lat += this.now - w.waitFrom; this._respond(w, false, false, [this.svcs[w.replica]]); });
        }
      });
    }

    _fail(req, ci) {
      this._log(req, 'err');
      this._path([this.dbNode, this.svcs[req.replica], this.client], COL.err, () => {});
      if (ci >= 0 && this.o.coalesce) {
        const waiting = this.pending[ci].get(req.key) || [];
        this.pending[ci].delete(req.key);
        waiting.forEach(w => { this._log(w, 'err'); this._path([this.svcs[w.replica], this.client], COL.err, () => {}); });
      }
    }

    _respond(req, hit, stale, from) {
      req.hit = hit; req.stale = stale;
      this._log(req, 'ok');
      const color = stale ? COL.stale : hit ? COL.hit : COL.ok;
      const back = this.front ? [this.front, this.client] : [this.client];
      this._path(from.concat(back), color, () => {}, stale);
    }

    _log(req, status) {
      if (req.gen !== this.gen) return;
      this.log.push({ t: this.now, key: req.key, hit: !!req.hit, stale: !!req.stale, lat: req.lat, status, gen: req.gen });
      if (this.log.length > 6000) this.log.splice(0, 2000);
      if (this.dbLog.length > 6000) this.dbLog.splice(0, 2000);
    }

    /* ---------- dibujo ---------- */

    _pop(n, text, color) { if (n) pop(this.gTop, n.x, n.y - n.hh - 10, text, color); }

    _fly(a, b, color, done, r = 5.5, dashed = false) {
      const gen = this.gen;
      const el = svgEl('circle', { r, fill: color, class: 'pk' + (dashed ? ' stale' : '') }, this.gPk);
      // el salto servicio ↔ caché externa es corto (está al lado): medio viaje
      const short = this.redis && (a === this.redis || b === this.redis);
      this.clock.animate(this.o.travel * (short ? 0.5 : 1), p => {
        const P = cubic(edge(a, b, this.v), edge(b, a, this.v), p, this.v);
        el.setAttribute('cx', P.x); el.setAttribute('cy', P.y);
      }, () => { el.remove(); if (gen === this.gen) done(); });
    }

    _path(nodes, color, done, dashed) {
      if (nodes.length < 2) return done();
      this._fly(nodes[0], nodes[1], color, () => this._path(nodes.slice(1), color, done, dashed), 5.5, dashed);
    }

    _box(kind, x, y, hw, hh, title, emoji) {
      const n = { kind, x, y, hw, hh };
      const g = svgEl('g', { class: kind, transform: `translate(${x},${y})` }, this.gNodes);
      svgEl('rect', { class: 'node-box', x: -hw, y: -hh, width: hw * 2, height: hh * 2, rx: 10 }, g);
      const tx = emoji ? -hw + 36 : 0, anchor = emoji ? 'start' : 'middle';
      if (emoji) svgEl('text', { x: -hw + 19, y: 7, class: 't-emoji', 'text-anchor': 'middle' }, g).textContent = emoji;
      svgEl('text', { x: tx, y: -3, class: 't-title small', 'text-anchor': anchor }, g).textContent = title;
      n.sub = svgEl('text', { x: tx, y: 14, class: 't-sub', 'text-anchor': anchor }, g);
      n.g = g;
      return n;
    }

    _link(a, b, cls = '') {
      this.links.push({ a, b, el: svgEl('path', { class: 'link ' + cls, d: curve(edge(a, b, this.v), edge(b, a, this.v), this.v) }, this.gLinks) });
    }

    _build() {
      const o = this.o, v = this.v, m = o.replicas;
      this.svg.innerHTML = '';
      this.gLinks = svgEl('g', {}, this.svg);
      this.gNodes = svgEl('g', {}, this.svg);
      this.gPk = svgEl('g', {}, this.svg);
      this.gTop = svgEl('g', {}, this.svg);
      this.links = [];

      this.client = v ? this._box('client', W / 2, 36, 70, 24, 'Usuarios', '👥') : this._box('client', 90, H / 2, 66, 28, 'Usuarios', '👥');
      this.client.g.style.setProperty('--c', C.req);
      this.client.sub.textContent = 'GET /productos';
      this.front = null;
      if (m > 1) {
        this.front = v ? this._box('front', W / 2, 104, 52, 20, 'Reparto') : this._box('front', 235, H / 2, 46, 26, 'Reparto');
        this.front.sub.textContent = '';
      }
      this.svcs = [];
      for (let i = 0; i < m; i++) {
        const hw = v ? Math.min(62, W / (m + 1) / 2 - 6) : 82, hh = v ? 30 : 34;
        const x = v ? W * (i + 1) / (m + 1) : 420, y = v ? 200 : H * (i + 1) / (m + 1);
        const s = this._box('srv', x, y, hw, hh, m > 1 ? (v ? `P${i + 1}` : `Productos ${i + 1}`) : 'Productos', v && m > 1 ? null : '🏷');
        if (o.cache === 'local') {
          const mw = v ? 14 : 28;
          s.mem = svgEl('rect', { class: 'mem', x: hw - mw - 6, y: -hh + 6, width: mw, height: hh * 2 - 12, rx: 4 }, s.g);
          s.memFill = svgEl('rect', { class: 'mem-fill', x: hw - mw - 6, y: hh - 6, width: mw, height: 0, rx: 4 }, s.g);
          if (v) s.g.querySelectorAll('text').forEach(t => t.setAttribute('x', -8));
        }
        this.svcs.push(s);
      }
      this.redis = null;
      if (o.cache === 'shared') this.redis = v ? this._box('redis', 105, 340, 92, 30, 'Caché ext.', '⚡') : this._box('redis', 700, 150, 90, 36, 'Caché externa', '⚡');
      this.dbNode = v ? this._box('srv data', o.cache === 'shared' ? 295 : W / 2, 340, 92, 30, 'DB', '🗄') : this._box('srv data', 700, o.cache === 'shared' ? 430 : H / 2, 90, 36, 'DB', '🗄');
      this.dbNode.qg = svgEl('g', {}, this.dbNode.g);
      // Tablas de claves: una por caché (debajo de cada réplica, o debajo de la caché externa)
      this.keyTables = [];
      if (o.showKeys && o.cache) {
        const hosts = o.cache === 'shared' ? [this.redis] : this.svcs;
        hosts.forEach(n => {
          const g = svgEl('g', { class: 'keytable', transform: `translate(${n.x},${n.y + n.hh + 6})` }, this.gNodes);
          this.keyTables.push({ g, n, sig: '' });
        });
      }

      this.svcs.forEach(s => {
        this._link(this.front || this.client, s);
        if (this.redis) this._link(s, this.redis, 'cache-link');
        this._link(s, this.dbNode, 'db-link');
      });
      if (this.front) this._link(this.client, this.front);
    }

    _drawKeys(t, cache) {
      const keys = cache.keys().filter(k => cache.peek(k).expiresAt > this.now).sort((a, b) => a - b);
      const sig = keys.map(k => `${k}:${cache.peek(k).version < this.dbVersion[k] ? 1 : 0}`).join(',');
      if (sig === t.sig) return;
      t.sig = sig;
      t.g.innerHTML = '';
      const per = 5, cw = this.v ? 16 : 30, ch = this.v ? 12 : 15, gap = this.v ? 2 : 3;
      const x0 = -(per * (cw + gap) - gap) / 2;
      keys.slice(0, per * 2).forEach((k, j) => {
        const stale = cache.peek(k).version < this.dbVersion[k];
        const c = svgEl('g', { class: 'kchip' + (stale ? ' stale' : ''), transform: `translate(${x0 + (j % per) * (cw + gap)},${Math.floor(j / per) * (ch + gap)})` }, t.g);
        svgEl('rect', { width: cw, height: ch, rx: 3 }, c);
        svgEl('text', { x: cw / 2, y: ch - (this.v ? 3 : 4), 'text-anchor': 'middle' }, c).textContent = `#${k}`;
      });
    }

    _frame() {
      const o = this.o;
      const w = this.window(5);
      this.dbNode.sub.textContent = `${this.db.busy}/${o.dbWorkers} ocupada · cola ${this.db.queue.length}`;
      this.dbNode.g.classList.toggle('hot', this.db.queue.length > o.dbQueueMax * 0.6);
      const sq = this.dbNode.qg;
      while (sq.childNodes.length > this.db.queue.length) sq.lastChild.remove();
      while (sq.childNodes.length < this.db.queue.length) {
        const i = sq.childNodes.length;
        svgEl('rect', { class: 'qsq', x: -this.dbNode.hw + 4 + i * 8, y: this.dbNode.hh + 5, width: 6, height: 6, rx: 1 }, sq);
      }
      if (this.redis) this.redis.sub.textContent = `${this.caches[0].keys().length}/${o.capacity} · hit ${Math.round(w.hitRate * 100)}%`;
      this.svcs.forEach((s, i) => {
        if (o.cache === 'local') {
          const f = Math.min(1, this.caches[i].keys().length / Math.max(1, o.capacity)), h = (s.hh * 2 - 12) * f;
          s.memFill.setAttribute('y', s.hh - 6 - h); s.memFill.setAttribute('height', h);
          s.sub.textContent = `${this.v ? '' : 'caché '}${this.caches[i].keys().length}/${o.capacity}`;
        } else s.sub.textContent = o.cache ? 'busca en la caché' : 'consulta la DB';
      });
      if (this.front) this.front.sub.textContent = 'round robin';
      this.keyTables.forEach((t, i) => this._drawKeys(t, this.caches[i]));
      this.emit('tick', this.now);
    }
  }

  window.CacheSimKit = { CacheSim, DEFAULTS, COL };
})();
