/* Modelo de caché sin dibujo: capacidad, TTL (con jitter opcional) y política de reemplazo.
   Políticas: 'lru' (la usada hace más tiempo), 'lfu' (la menos pedida; empate → la usada hace más tiempo),
   'fifo' (la que entró primero, sin importar los accesos) y 'random' (al azar, con semilla).
   El tiempo lo pasa quien llama (segundos de simulación). Lo usan cachesim.js y la slide de reemplazo.
   Expone window.CacheKit = { Cache, rng, zipfPicker }. */
(function () {
  'use strict';

  // mulberry32: el mismo generador sembrado que route.js de proxy reverso
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Sorteo de claves 0..n-1 con popularidad Zipf (la clave k pesa 1/(k+1)^s). s = 0 → uniforme.
  function zipfPicker(n, s, rand) {
    const cdf = [];
    let acc = 0;
    for (let k = 0; k < n; k++) { acc += 1 / Math.pow(k + 1, s); cdf.push(acc); }
    return () => {
      const x = rand() * acc;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < x) lo = mid + 1; else hi = mid; }
      return lo;
    };
  }

  class Cache {
    constructor({ capacity, ttl = Infinity, policy = 'lru', jitter = 0, seed = 1 } = {}) {
      this.capacity = capacity;
      this.ttl = ttl;
      this.policy = policy;
      this.jitter = jitter;
      this.rand = rng(seed);
      this.map = new Map();
      this.tick = 0; // reloj lógico de accesos (desempata recencia aunque el tiempo sea el mismo)
      this.stats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };
    }

    _alive(e, now) { return now < e.expiresAt; }

    get(key, now) {
      const e = this.map.get(key);
      if (e && !this._alive(e, now)) {
        this.map.delete(key);
        this.stats.expirations++;
      } else if (e) {
        e.lastUsed = ++this.tick;
        e.freq++;
        this.stats.hits++;
        return { value: e.value, version: e.version, storedAt: e.storedAt };
      }
      this.stats.misses++;
      return null;
    }

    set(key, value, now, version = 0) {
      if (this.capacity <= 0) return null;
      const ttl = this.ttl * (1 + (this.rand() * 2 - 1) * this.jitter);
      const old = this.map.get(key);
      if (old) {
        Object.assign(old, { value, version, storedAt: now, expiresAt: now + ttl, lastUsed: ++this.tick });
        return null;
      }
      let evicted = null;
      if (this.map.size >= this.capacity) {
        evicted = this._victim();
        this.map.delete(evicted);
        this.stats.evictions++;
      }
      this.map.set(key, { value, version, storedAt: now, expiresAt: now + ttl, lastUsed: ++this.tick, freq: 1 });
      return evicted;
    }

    _victim() {
      const keys = [...this.map.keys()];
      if (this.policy === 'fifo') return keys[0];
      if (this.policy === 'random') return keys[Math.floor(this.rand() * keys.length)];
      let best = null, bk = null;
      for (const [k, e] of this.map) {
        const worse = !best ||
          (this.policy === 'lfu' && (e.freq < best.freq || (e.freq === best.freq && e.lastUsed < best.lastUsed))) ||
          (this.policy !== 'lfu' && e.lastUsed < best.lastUsed);
        if (worse) { best = e; bk = k; }
      }
      return bk;
    }

    delete(key) { return this.map.delete(key); }
    clear() { this.map.clear(); }
    keys() { return [...this.map.keys()]; }
    peek(key) { return this.map.get(key) || null; }
    freq(key) { const e = this.map.get(key); return e ? e.freq : 0; }
  }

  window.CacheKit = { Cache, rng, zipfPicker };
})();
