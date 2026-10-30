# Caché y precálculo

Presentación interactiva (reveal.js + simulaciones en SVG) sobre cómo hacer barata una operación cara: hit y miss, hit rate, algoritmos de reemplazo (LRU, LFU, FIFO, random), TTL, invalidación, caché fría y estampida, caché local o compartida, qué no cachear, caché HTTP (`max-age`, `ETag`, `private`/`public`/`no-store`), CDN (distribución, purga y nombres versionados) y precálculo (jobs, desnormalización, vistas materializadas y sumar al escribir).

Es parte de la serie de arquitectura (load balancer, microservicios, proxy reverso, colas, eventos), pero se puede dar sola y en cualquier orden.

Teclas: `→` avanzar · `S` notas del orador · `F` pantalla completa · `O` vista general · `-` / `+` velocidad de las simulaciones. En el celular se ve como documento vertical.

## Probar

Desde `presentaciones-guideline/tools` (después de `npm i`):

```bash
node smoke.js ../../presentacion-cache    # escritorio
node mobile.js ../../presentacion-cache   # celular
```

Y desde esta carpeta: `node tests/interact.js [filtro]` (modelo de caché `CacheKit`, simulación `CacheSim` y escenas).

## Cómo está armada

- `js/cache.js` (`CacheKit`): modelo de caché sin dibujo. Capacidad, TTL con jitter y políticas `lru`, `lfu`, `fifo` y `random`, más un sorteo de claves con popularidad Zipf.
- `js/cachesim.js` (`CacheSim`): Usuarios → Productos (1 a 3 réplicas) → caché (Redis compartido o local) → DB. Hit rate, precios viejos, invalidación, estampida y coalescing. La usan las slides de la 1 a la 9.
- `js/scenes.js`: una escena por slide. Las de reemplazo, HTTP, CDN y precálculo son escenas manuales con su propio `Clock`.

Basada en [presentaciones-guideline](../presentaciones-guideline).
