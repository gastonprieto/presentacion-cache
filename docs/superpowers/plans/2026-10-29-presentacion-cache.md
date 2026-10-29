# Presentación de caché y precálculo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `presentacion-cache`, una presentación interactiva de ~21 slides sobre "hacer barata una operación cara" (caché, caché HTTP, CDN, precálculo), con laboratorio Docker, lista para revisión local.

**Architecture:** Copia de `presentaciones-guideline/template`. Hay dos motores nuevos, como `route.js` en proxy reverso y `msg.js` en eventos. El primero es `js/cache.js`, un modelo puro de caché (capacidad, TTL, política de reemplazo) que se prueba sin dibujar. El segundo es `js/cachesim.js`, la simulación visual cliente → servicio(s) → caché → DB que usan las slides 1, 3, 4 y 6 a 9. Las slides de reemplazo, HTTP, CDN y precálculo son escenas manuales con `Clock`, en `js/scenes.js`.

**Tech Stack:** reveal.js 5.1.0, GSAP 3.12.5, Chart.js 4.4.1 (en `vendor/`), SVG a mano, puppeteer-core (de `presentaciones-guideline/tools`) para las pruebas, Docker Compose para el laboratorio (Node 22, Redis 7, nginx, Postgres 16).

**Spec:** `docs/superpowers/specs/2026-10-29-cache-design.md`

## Global Constraints

- Se sigue `presentaciones-guideline/GUIDELINE.md`: scripts clásicos con globals, sin ES modules; abre con doble clic; offline; sin CDN ni Google Fonts.
- Orden de `<script>`: reveal → notes → gsap → chart → `sim.js` → `cache.js` → `cachesim.js` → `widgets.js` → `scenes.js` → `main.js`.
- Lienzo de 1280×720. El panel mide 566px de alto y no puede desbordar. Los botones van en `.actions`, nunca en `.controls`.
- Todas las slides llevan `<aside class="notes">` con guion y una **pregunta para la clase**.
- Colores: request `#7dd3fc` · ok `#4ade80` · lenta `#facc15` · error `#f87171` · caché/Redis rosa `#f472b6` · DB verde agua `#2dd4bf` · servicios cian · cola naranja. Respuesta vieja (*stale*): ámbar `#d97706` con trazo punteado.
- Vocabulario de la tienda: Productos (`GET /productos/42`), Usuarios, Órdenes, Pagos, Envíos, y `tienda.com`.
- La clase es autocontenida: si aparece un proxy, un LB o un evento, se explica en una línea dentro de la slide.
- Todo el texto visible y las notas van en español.
- Repo local con `git init` y commit inicial vacío. **No se crea el remoto ni se hace push** hasta el OK del autor después de revisar localmente.
- Un cambio lógico por commit.

## Review Focus

1. **Cambiar de modo o slider muchas veces seguidas:** no quedan timers ni puntos huérfanos y los contadores no se mezclan con la configuración anterior. Prueba en la Tarea 3: `cachesim: reset limpia estado`.
2. **Valores extremos de los sliders:** con la capacidad mayor o igual a la cantidad de claves, el hit rate tiende a 100% sin errores. Con TTL en 0 (sin caché efectiva), el hit rate es 0 y no se rompe ninguna división. Pruebas en las Tareas 2 y 3: `cache: ttl 0 nunca pega`, `cachesim: capacidad ≥ claves`.
3. **Velocidad global y pausa:** al salir de una slide y volver, la escena sigue donde estaba. Las escenas manuales usan `clock.every/after/animate`, nunca `setTimeout`. Prueba en la Tarea 10: `escenas: stop/start sin errores` (recorre todas).
4. **Celular:** ningún panel desborda y ningún botón queda bloqueado (`mobile.js` en la Tarea 10). Las escenas manuales del mapa y de los casilleros usan coordenadas propias en `NetKit.MOBILE`.
5. **Reset en medio de una secuencia async** (la estampida o el deploy de la CDN): no deja estado mezclado (patrón `sim.gen`). Pruebas en las Tareas 6 y 8: `estampida: reset a mitad` y `cdn: reset a mitad del deploy`.

---

### Task 1: Base desde el template

**Files:**
- Create: `presentacion-cache/` (copia de `presentaciones-guideline/template`, sin pisar `docs/`)
- Modify: `index.html` (título, portada), `CLAUDE.md` (tema, audiencia y motores), `js/scenes.js` (borrar `S.demo`, `S.modes` y `S.manual`, dejar `S.title`)
- Create: `tests/interact.js` (runner y helpers copiados de `presentacion-proxy-reverso/tests/interact.js`: `open`, `goto`, `evalScene`, `engine`, `check`; sin las pruebas de route)

- [ ] **Step 1:** `cp -R presentaciones-guideline/template/. presentacion-cache/`, después `git init`, un commit inicial vacío (`git commit --allow-empty -m "Commit inicial"`) y un commit con `docs/` (spec y este plan).
- [ ] **Step 2:** Portada: kicker `Arquitectura · Caché`, h1 `Hacer <span class="grad">barata</span><br>una operación cara`, y una línea de subtítulo sobre caché, HTTP, CDN y precálculo. Borrar las slides de ejemplo, menos la portada y el resumen (que queda como placeholder del cierre).
- [ ] **Step 3:** Pruebas en `tests/interact.js`: `base: carga sin errores de consola` y `notas: todas las slides tienen pregunta` (cada `aside.notes` contiene `?`).
- [ ] **Step 4:** Correr `node tests/interact.js` y `node ../presentaciones-guideline/tools/smoke.js .`. Esperado: `2/2 ok` y smoke sin errores.
- [ ] **Step 5:** Commit: `Base de la presentación desde el template`.

### Task 2: Modelo de caché `CacheKit`

**Files:**
- Create: `js/cache.js`
- Modify: `index.html` (script), `tests/interact.js`

**Interfaces:**
- Produces: `window.CacheKit = { Cache, rng, zipfPicker }`
  - `new Cache({ capacity, ttl = Infinity, policy = 'lru' | 'lfu' | 'fifo' | 'random', jitter = 0, seed = 1 })`
  - `get(key, now) → { value, version, storedAt } | null`. Si la entrada venció, se borra y devuelve `null`. Suma a `stats.hits` o a `stats.misses`.
  - `set(key, value, now, version = 0) → evictedKey | null`. El TTL efectivo es `ttl × (1 + (r·2−1)·jitter)`.
  - `delete(key)`, `clear()`, `keys() → string[]` (en el orden en que se dibujan los casilleros: orden de inserción), `peek(key)` (sin tocar stats ni recencia), `freq(key)`.
  - `stats = { hits, misses, evictions, expirations }`
  - `rng(seed) → () => [0,1)` (mulberry32, el mismo de `route.js`).
  - `zipfPicker(n, s, rand) → () => int` en `[0, n)`; con `s = 0` es uniforme.
- LFU: saca la de menor frecuencia y, si hay empate, la usada hace más tiempo. LRU: la usada hace más tiempo. FIFO: la insertada primero, sin importar los accesos. Random: una al azar con el `rng` sembrado.

- [ ] **Step 1: Pruebas que fallan** (con `engine`, sin slide):
  - `cache: hit y miss`. Con `capacity: 2`: `get('a')` da null; después `set('a',1)`, `get('a').value === 1` y `stats` queda en `{hits:1, misses:1}`.
  - `cache: scan le gana a LRU`. Con `capacity 4`, secuencia `'ABC'×5 + 'DEFGHI' + 'ABC'×5` (en un miss, `set` y seguir): los hits dan `lru 24`, `lfu 27`, `fifo 24`.
  - `cache: cambio de popularidad le gana a LFU`. Con `capacity 4`, secuencia `'ABCD'×5 + 'EFGH'×5`: los hits dan `lru 32`, `lfu 16`.
  - `cache: ttl vence`. Con `ttl 10`: `set` en t=0, `get` en t=9 es hit, `get` en t=10 es null y `stats.expirations === 1`.
  - `cache: ttl 0 nunca pega`. Con `ttl 0`: 100 `get`/`set` de la misma clave dan `hits 0`.
  - `cache: jitter reparte vencimientos`. Con 50 claves, `ttl 10` y `jitter 0.2`, todas en t=0: en t=9 quedan vivas entre 15 y 40.
  - `cache: zipf concentra`. `zipfPicker(50, 1.1, rng(1))`, 10 000 sorteos: la clave 0 sale más del 15% de las veces. Con `s=0` ninguna clave pasa el 4%.
- [ ] **Step 2:** Correr `node tests/interact.js cache:`. Esperado: FAIL con `CacheKit is not defined`.
- [ ] **Step 3:** Implementar `js/cache.js`. Usar un `Map` con metadatos por entrada (`storedAt`, `expiresAt`, `lastUsed` con un contador lógico, `freq`, `version`) y desalojo por recorrido lineal (capacidades chicas, alcanza).
- [ ] **Step 4:** Correr `node tests/interact.js cache:`. Esperado: `7/7 ok`.
- [ ] **Step 5:** Commit: `Modelo de caché CacheKit: capacidad, TTL y políticas de reemplazo`.

### Task 3: Simulación visual `CacheSim` y widgets

**Files:**
- Create: `js/cachesim.js`
- Modify: `js/widgets.js` (agregar `cacheStats` y `cacheChart`), `css/theme.css` (colores de caché y de stale), `tests/interact.js`

**Interfaces:**
- Consumes: `NetKit.{ Clock, svgEl, cubic, curve, edge, pop, C, MOBILE, W, H }`, `CacheKit.{ Cache, rng, zipfPicker }`
- Produces: `window.CacheSimKit = { CacheSim, DEFAULTS }`
  - `new CacheSim(svg, opts)`. Defaults: `{ seed: 1, rate: 3, keys: 50, zipf: 1.1, replicas: 1, cache: null | 'shared' | 'local', capacity: 10, ttl: 30, policy: 'lru', jitter: 0, coalesce: false, invalidate: 'none' | 'delete' | 'update', dbWorkers: 4, dbTime: 0.8, dbQueueMax: 12, cacheTime: 0.03, netTime: 0.02, writeRate: 0, slowThreshold: 1.5, travel: 0.3 }`
  - Métodos: `start()`, `stop()`, `reset(opts)` (incrementa `gen` y emite `'reset'`), `set(key, value)` (cambia una opción en vivo; `capacity`/`policy`/`cache` recrean la caché), `setRate(r)`, `writePrice(key = 0)` (sube `dbVersion[key]` y aplica `invalidate`), `flushCache()`, `prewarm(n)`, `fastForward(sec)` (avanza el reloj sin animar), `on('tick'|'reset', fn)`.
  - `window(sec) → { n, hits, misses, hitRate, stale, staleRate, dbReqs, dbBusy, dbQueue, err, p50, p95 }`. `hitRate` y `staleRate` son fracciones de 0 a 1; con `n = 0` valen 0. La latencia es el tiempo en servicio + caché + DB, sin la animación.
  - `log` con entradas `{ t, key, hit, stale, latency, status }`.
- Comportamiento:
  - Una respuesta es *stale* si `version < dbVersion[key]` (el precio se pinta ámbar y punteado).
  - Con `coalesce`, los misses de una clave que ya se está consultando esperan esa consulta en vez de ir a la DB.
  - DB llena (`dbQueueMax`) → 503.
  - Con `cache: 'local'`, cada réplica tiene su propia `Cache`, y los pedidos se reparten round robin con "algo adelante" (un nodo `→` sin nombre de LB).
- Dibujo: Cliente(s) → Productos (1 a 3 réplicas) → Redis (rosa, solo con `shared`) → DB. Con `local`, una cajita rosa dentro de cada réplica. Los hits vuelven desde la caché y los misses bajan a la DB. En la DB se ven la cola y los workers ocupados.
- Widgets: `Widgets.cacheStats(el, sim, fields, windowSec)` con los campos `hitRate`, `p50`, `p95`, `dbReqs` (req/s a la DB), `stale` y `err`. `Widgets.cacheChart(canvas, sim)` usa `canvas.cache-chart` y dibuja dos series en el tiempo: hit rate (%) y pedidos/s a la DB.

- [ ] **Step 1: Pruebas que fallan** (con `engine` y `fastForward`):
  - `cachesim: sin caché la DB se satura`. Con `rate: 8` y `cache: null`, 30 s: `err > 0` y `p95 > 1.5`.
  - `cachesim: con caché baja la carga`. Mismo tráfico con `cache: 'shared'` y `capacity: 20`: `hitRate > 0.6`, `err === 0` y `dbReqs` menor que el 40% de `n`.
  - `cachesim: el hit rate depende del tamaño y del patrón`. Con `capacity` 5 contra 25, el hit rate crece. Con `zipf` 1.1 contra 0 (con `capacity` 10), el hit rate con zipf supera al uniforme en al menos 0,25.
  - `cachesim: capacidad ≥ claves`. Con `keys: 10`, `capacity: 10` y `ttl: Infinity`, 60 s: `hitRate > 0.9`.
  - `cachesim: ttl y datos viejos`. Con `ttl: 30`, `writePrice(0)` cada 5 s y `invalidate: 'none'`: `stale > 0`. Con `invalidate: 'delete'`: `stale === 0`.
  - `cachesim: flush provoca estampida`. Caché caliente con `rate: 8`, después `flushCache()`: en los 3 s siguientes `dbQueue` llega a su máximo o hay `err > 0`. Con `coalesce: true` y `jitter: 0.3`, mismo escenario: `err === 0`.
  - `cachesim: local vs compartida`. Con 3 réplicas, `capacity` 10 cada una y el mismo tráfico: el `hitRate` local es menor que el compartido.
  - `cachesim: reset limpia estado`. Después de `reset`, `window(60).n === 0`, el SVG no tiene puntos `.pk` y `gen` aumentó.
- [ ] **Step 2:** Correr `node tests/interact.js cachesim:`. Esperado: FAIL.
- [ ] **Step 3:** Implementar `js/cachesim.js` siguiendo la forma de `RouteSim` (`presentacion-proxy-reverso/js/route.js`): el constructor llama a `reset`, `_build` dibuja, `_arrive` agenda los pedidos con `clock.after` y `fastForward` avanza el `Clock` sin animar. Agregar los widgets.
- [ ] **Step 4:** Correr `node tests/interact.js`. Esperado: todas ok. Si una prueba "depende de la suerte", calibrar los defaults (no la prueba) hasta que pase con las semillas 1, 2 y 3.
- [ ] **Step 5:** Commit: `Simulación CacheSim: servicio, caché y DB con hit rate, TTL e invalidación`.

### Task 4: Slides del problema y de hit/miss (0–4)

**Files:**
- Modify: `index.html`, `js/scenes.js`, `tests/interact.js`

**Interfaces:**
- Consumes: `CacheSim`, `Widgets.cacheStats`, `Widgets.cacheChart`. Se agrega a `scenes.js` el helper `setupCache(slide, opts) → CacheSim`, equivalente a `setup()` pero con los widgets de caché.

Slides según la tabla del spec. Escenas `S.title` (CacheSim decorativa), `S.cara` (1), `S.hitmiss` (3) y `S.hitrate` (4). La slide 2, "Tres caminos", es estática: tres columnas `.layer-card` con fragmentos.

- [ ] **Step 1: Pruebas**:
  - `escena cara: subir tráfico satura la DB`. Con el slider de tráfico en 8, después de 6 s reales: el `.stats` muestra errores o un p95 en amarillo o rojo.
  - `escena hitmiss: prender la caché sube el hit rate`. El botón `[data-act=cache]` pasa a `sim.o.cache === 'shared'` y, después de 6 s, `hitRate > 0.5`.
  - `escena hitrate: sliders cambian opciones`. El slider de capacidad cambia `sim.o.capacity`; el seg `pattern` (`zipf`/`uniform`) cambia `sim.o.zipf` entre 1.1 y 0.
- [ ] **Step 2:** Correr las pruebas. Esperado: FAIL.
- [ ] **Step 3:** Implementar las slides y escenas. Panel de la slide 4: sliders de capacidad (2–40) y de cantidad de productos (10–200), seg de patrón, `canvas.cache-chart` de 118px y `.cstats` con `hitRate,dbReqs,p95`.
- [ ] **Step 4:** Correr `node tests/interact.js` y `smoke.js`. Revisar las capturas `d01`–`d05`: nada desborda y los hits rosa se distinguen de los misses.
- [ ] **Step 5:** Commit: `Slides del problema, tres caminos, hit/miss y hit rate`.

### Task 5: Slide de reemplazo (5)

**Files:**
- Modify: `index.html`, `js/scenes.js`, `tests/interact.js`

**Interfaces:**
- Consumes: `CacheKit.Cache` (no usa `CacheSim`).
- La escena manual `S.reemplazo` expone en `section._scene` el método `state() → { policy, pattern, hits, misses, slots: string[] }`, para las pruebas.

La escena dibuja una fila de 4 casilleros, una cinta con la secuencia de pedidos que entra y, en cada paso, marca hit (rosa) o miss (la clave que sale vuela afuera con `pop('sale X')`). Abajo hay una tabla con los hits por algoritmo para la misma secuencia, calculada con `Cache` sin animar. Las secuencias son las mismas de las pruebas de la Tarea 2: `populares` = `'ABC'×5 + 'DEFGHI' + 'ABC'×5` (el scan) y `cambia` = `'ABCD'×5 + 'EFGH'×5`. El paso automático va cada 0,7 s de reloj y el botón "paso" avanza de a uno.

- [ ] **Step 1: Pruebas**:
  - `escena reemplazo: tabla coincide con el modelo`. Con el patrón `populares`, la tabla muestra LRU 24, LFU 27 y FIFO 24. Con `cambia`, LRU 32 y LFU 16.
  - `escena reemplazo: paso a paso`. Tres clics en "paso" con LRU y el patrón `populares` dan `state().misses === 3` y `slots` igual a `['A','B','C']`.
- [ ] **Step 2:** Correr las pruebas. Esperado: FAIL.
- [ ] **Step 3:** Implementar, con coordenadas propias para `NetKit.MOBILE` (casilleros en 2×2 y cinta arriba).
- [ ] **Step 4:** Correr las pruebas y `smoke.js`, y revisar la captura.
- [ ] **Step 5:** Commit: `Slide de algoritmos de reemplazo`.

### Task 6: Slides de TTL, invalidación, caché fría, dónde vive y qué no cachear (6–10)

**Files:**
- Modify: `index.html`, `js/scenes.js`, `tests/interact.js`

Escenas `S.ttl` (6), `S.invalidar` (7), `S.fria` (8) y `S.donde` (9), todas sobre `CacheSim`. La slide 10 es estática: `.summary` con tarjetas `.bad` (stock al pagar, saldo, `/mi-cuenta` en caché compartida, escrituras más frecuentes que lecturas) y `.good` (catálogo, precios con TTL corto, configuración).

- Slide 6: slider de TTL (0–60 s), botón "cambiar precio" (`writePrice(0)`) y `writeRate` automático opcional. Métricas `hitRate` y `stale`.
- Slide 7: seg `invalidate` con los valores `none`, `delete` y `update`, y botón "cambiar precio".
- Slide 8: botón "reiniciar caché" (`flushCache`) y toggles de jitter (0 / 0,3), coalescing y "precalentar" (`prewarm(20)` antes de abrir el tráfico). El flush corre como secuencia async con guardia de `sim.gen`.
- Slide 9: seg `local`/`compartida` con 3 réplicas y botón "cambiar precio". Con `local` y `invalidate: 'delete'`, solo se borra la clave en la réplica que hizo la escritura, así que las otras siguen sirviendo el precio viejo. Eso es lo que la slide tiene que mostrar.

- [ ] **Step 1: Pruebas**:
  - `escena ttl: ttl 0 da hit rate 0`.
  - `escena invalidar: delete elimina stale` (después de 3 cambios de precio, `stale === 0`).
  - `escena fria: reiniciar causa errores y las mitigaciones los evitan`.
  - `estampida: reset a mitad`. Clic en "reiniciar caché" e inmediatamente cambiar un toggle: el `log` no tiene entradas con `gen` viejo y no hay errores de consola.
  - `escena donde: local deja réplicas con precio viejo` (`stale > 0` con `local`, `stale === 0` con compartida e invalidación).
- [ ] **Step 2:** Correr las pruebas. Esperado: FAIL.
- [ ] **Step 3:** Implementar. Si `cachesim` necesita invalidar por réplica, el cambio va en `cachesim.js` con su prueba de motor.
- [ ] **Step 4:** Correr `node tests/interact.js` y `smoke.js`, y revisar las capturas.
- [ ] **Step 5:** Commit: `Slides de TTL, invalidación, caché fría, dónde vive y qué no cachear`.

### Task 7: Slides de caché HTTP (11–13)

**Files:**
- Modify: `index.html`, `js/scenes.js`, `tests/interact.js`

**Interfaces:**
- Las escenas manuales `S.http`, `S.etag` y `S.privada` exponen `state()` para las pruebas:
  - `S.http`: `{ sent, fromCache, age }`
  - `S.etag`: `{ r200, r304, bytes }`
  - `S.privada`: `{ leaks }`

- Slide 11: Navegador (con su caché, un cajón rosa) → `tienda.com`. Botón "pedir `app.js`" y seg `max-age` (0 / 10 / 60). Un reloj muestra la edad de la copia. Si la copia está fresca, el punto no sale del navegador y aparece `pop('desde caché')`. Debajo se ven los headers de la respuesta (`Cache-Control: max-age=60`).
- Slide 12: seg sin ETag / con ETag y botón "cambiar archivo". Pedido vencido con ETag: se manda `If-None-Match: "v1"` y vuelve `304` (punto chico). Si el archivo cambió, vuelve `200` (punto grande). El contador muestra los KB transferidos: el archivo pesa 180 KB y la respuesta 304 pesa 0,3 KB.
- Slide 13: dos usuarios (colores distintos), una caché compartida en el medio ("un proxy: un servidor intermedio que guarda respuestas para todos", explicado en una línea) y el origen. Seg `public`/`private`/`no-store` aplicado a `/mi-cuenta`. Con `public`, el segundo usuario recibe el punto con el color del primero y aparece `pop('¡datos de otro!')` en rojo (`leaks++`).

- [ ] **Step 1: Pruebas**:
  - `escena http: max-age 60 evita el segundo pedido` (2 clics: `sent === 1`, `fromCache === 1`).
  - `escena http: max-age 0 siempre sale`.
  - `escena etag: 304 sin cambio y 200 con cambio`. Con ETag: 3 pedidos vencidos dan `r304 === 2`. Después de "cambiar archivo", el siguiente da `r200`.
  - `escena privada: public filtra, private no` (`leaks > 0` contra `leaks === 0` después de 4 pedidos alternados).
- [ ] **Step 2:** Correr las pruebas. Esperado: FAIL.
- [ ] **Step 3:** Implementar con `Clock`, `clock.after` y `clock.animate`. Layout propio en celular (vertical).
- [ ] **Step 4:** Correr las pruebas y `smoke.js`, y revisar las capturas.
- [ ] **Step 5:** Commit: `Slides de caché HTTP: max-age, ETag y privada vs. compartida`.

### Task 8: Slides de CDN (14–15)

**Files:**
- Modify: `index.html`, `js/scenes.js`, `tests/interact.js`, `css/theme.css`

**Interfaces:**
- `S.cdn` expone `state() → { originReqs, byRegion: { [id]: { n, avgMs } } }`.
- `S.distribuir` expone `state() → { mode, served: { v1, v2 }, purgedEdges }`.

- Mapa estilizado: continentes como formas simples, en el color `--muted` con baja opacidad. Las regiones de usuarios son `sa` (Buenos Aires), `na` (Nueva York), `eu` (Madrid), `as` (Tokio) y `oc` (Sídney). El origen está en `na`. La latencia de ida y vuelta se calcula de la distancia en el SVG: `ms = 20 + distanciaPx × 0,35`, calibrada para que Sídney al origen ronde los 300 ms y el borde local los 20 ms.
- Slide 14: toggle CDN. Sin CDN, todos los pedidos van al origen. Con CDN aparece un borde por región: el primer pedido de cada región es miss (va al borde → origen → borde) y los siguientes son hit en el borde. Métricas: latencia promedio por región (barras) y pedidos al origen. Hay un botón para mandar tráfico solo desde una región (tiempo de calentamiento por región).
- Slide 15: seg `purga` / `versionado` y botón "deploy nueva versión".
  - Purga: la purga viaja a cada borde con demora distinta. Mientras tanto, unas regiones sirven `v1` y otras `v2`, y se ve la mezcla.
  - Versionado: el HTML (con `max-age` corto) apunta a `app.3f2a.js`; todas las regiones piden el nombre nuevo (un miss por región) y nadie sirve `v1`.

- [ ] **Step 1: Pruebas**:
  - `escena cdn: con CDN baja la latencia y la carga del origen`. Después de 10 s de reloj (vía `state()`), el `avgMs` de `oc` con CDN es menor que la mitad del valor sin CDN, y `originReqs` con CDN es como mucho 5 + 10% de los pedidos.
  - `escena distribuir: purga mezcla versiones, versionado no`. Durante la purga hay un instante con `v1` y `v2` > 0 a la vez; en versionado, `v1` no crece después del deploy.
  - `cdn: reset a mitad del deploy`. Clic en deploy y enseguida cambiar de modo: sin errores, `purgedEdges` vuelve a 0.
- [ ] **Step 2:** Correr las pruebas. Esperado: FAIL.
- [ ] **Step 3:** Implementar. En celular, el mapa va en un lienzo de 400×440 con las mismas regiones reubicadas.
- [ ] **Step 4:** Correr las pruebas y `smoke.js`, y revisar las capturas: el mapa se lee en el proyector.
- [ ] **Step 5:** Commit: `Slides de CDN: distribución, purga y nombres versionados`.

### Task 9: Slides de precálculo, comparación y cierre (16–20)

**Files:**
- Modify: `index.html`, `js/scenes.js`, `tests/interact.js`

**Interfaces:**
- `S.job` expone `state() → { mode, lastRunAt, dataAge, panelMs, jobRuns, jobCostSec }`.
- `S.alescribir` expone `state() → { total, trueTotal, writeMs, failures }`.

- Slide 16: entran órdenes continuamente (puntos naranja hacia Órdenes/DB). Seg `bajo demanda` / `job`.
  - Bajo demanda: "abrir panel" dispara una consulta que recorre todas las órdenes. Tarda `0,2 + órdenes × 0,002` s y crece con el tiempo.
  - Job: corre cada N s (slider 5–60) y escribe la tabla `ventas_por_dia` (caja chica). El panel la lee en ~0,05 s. Se ven la antigüedad del dato (`dataAge`) y el costo acumulado del job.
- Slide 17: estática con fragmentos. Un join de 3 tablas (Órdenes × Usuarios × Productos) contra una tabla desnormalizada o vista materializada. Costos: dato duplicado, mantenerlo al día y `REFRESH`.
- Slide 18: botón "nueva orden" (o flujo automático) y toggle "falla la actualización".
  - Cada orden suma al total en la misma operación ("o al recibir el evento *orden creada*: un aviso que Órdenes publica para quien le interese", explicado en una línea).
  - `writeMs` sube.
  - Con falla, `total` deja de coincidir con `trueTotal`, y aparece un aviso de que hace falta reconciliar (por ejemplo, un job que recalcula).
- Slide 19: tabla de comparación con las filas *quién paga el costo*, *frescura*, *qué se calcula de más* y *qué puede salir mal*, y las columnas caché, job y sumar al escribir. Fragmentos por columna.
- Slide 20: resumen `.summary` con las ideas: medir antes (hit rate), decidir TTL/reemplazo/invalidación, no cachear lo que necesita consistencia fuerte, caché HTTP y CDN para lo estático y distribuido, y precalcular cuando la pregunta se conoce de antemano.

- [ ] **Step 1: Pruebas**:
  - `escena job: el job hace rápido el panel y deja dato viejo`. Con job: `panelMs < 100` y `dataAge > 0` entre corridas. Bajo demanda, después de 20 s: `panelMs` es mayor que bajo demanda a los 2 s.
  - `escena alescribir: falla desincroniza`. Sin falla, `total === trueTotal`. Con falla y 5 órdenes, `total < trueTotal` y `failures > 0`.
- [ ] **Step 2:** Correr las pruebas. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr `node tests/interact.js` y `smoke.js`, y revisar las capturas. La prueba `notas: todas las slides tienen pregunta` pasa con las 21 slides.
- [ ] **Step 5:** Commit: `Slides de precálculo, comparación y cierre`.

### Task 10: Celular, recorrido completo y README

**Files:**
- Modify: `css/theme.css`, `js/scenes.js` (ajustes móviles), `tests/interact.js`
- Create: `README.md` (con la misma estructura que el de proxy reverso: qué es, link, teclas, cómo probar)

- [ ] **Step 1:** Prueba `escenas: stop/start sin errores`. Recorre todas las slides con `Reveal.slide(i)`, vuelve a la 3 y a la 14, y verifica que `_scene` exista y no haya errores de consola.
- [ ] **Step 2:** Correr `node ../presentaciones-guideline/tools/mobile.js .` y corregir hasta que pase sin desbordes, sin scroll horizontal y sin botones bloqueados. Revisar las capturas `mNN.png` una por una.
- [ ] **Step 3:** Correr `node tests/interact.js`, `smoke.js` y `mobile.js`. Esperado: todo ok.
- [ ] **Step 4:** Escribir el README, sin la sección del laboratorio todavía.
- [ ] **Step 5:** Commit: `Versión de celular y README`.

### Task 11: Laboratorio con Docker

**Files:**
- Create: `docker-compose.yml` (`name: lab-cache`), `lab/productos/{server.js,Dockerfile}`, `lab/web/{server.js,Dockerfile}`, `lab/nginx/nginx.conf`, `lab/db/init.sql`, `lab/job/agregar.sql`
- Modify: `README.md` (sección "Laboratorio con Docker")

Servicios (solo nginx y productos publican puertos):

- `redis` (`redis:7-alpine`): `--maxmemory 2mb --maxmemory-policy allkeys-lru`.
- `productos` (Node 22, sin dependencias externas salvo un cliente Redis mínimo; si hace falta una dependencia, `redis@4` fijada en el `package.json`), en `localhost:8081`:
  - `GET /productos/:id` hace cache-aside con una demora artificial de `DEMORA_MS=800`, `TTL_S=30` y el header `X-Cache: HIT|MISS`.
  - `PUT /productos/:id/precio` cambia el precio. Con `INVALIDAR=1` borra la clave.
- `web` + `nginx`, en `localhost:8080`:
  - `/static/app.js` (180 KB) con `Cache-Control: public, max-age=60` y `ETag`.
  - `/mi-cuenta` con `Cache-Control: private`.
  - nginx con `proxy_cache` y `add_header X-Cache-Status $upstream_cache_status`.
- `db` (`postgres:16-alpine`): `init.sql` crea `ordenes` con unas 2 millones de filas (`generate_series`), la tabla `ventas_por_dia` y una vista materializada `mv_ventas_por_dia`.
- `job`: un contenedor con `psql` que corre `agregar.sql` cada 30 s (loop con `sleep`). También se puede correr a mano con `docker compose run --rm job`.

README: recorrido por slide (comandos con `curl -s -D -`, `redis-cli`, `INFO stats`, `FLUSHALL`, `CONFIG SET maxmemory-policy allkeys-lfu`, `If-None-Match`, `\timing` en `psql` comparando la consulta cruda contra la tabla) y una tabla "Romper cosas": parar Redis (el servicio sigue andando, pero lento), `FLUSHALL` con tráfico (estampida), cambiar el precio sin invalidar (dato viejo hasta el TTL) y parar el job (los datos envejecen). Agregar una nota de que la CDN no está en el laboratorio, y la sugerencia de `curl -I` contra un sitio real para ver `cf-cache-status`/`x-cache`/`age`.

- [ ] **Step 1:** `docker compose up -d --build`. Esperado: todos los contenedores `healthy` o `running`.
- [ ] **Step 2:** Correr el recorrido del README completo y verificar cada salida esperada:
  - el segundo `curl` a `/productos/42` da `HIT` y tarda menos de 50 ms;
  - el segundo `curl -H 'If-None-Match: …'` da `304`;
  - `X-Cache-Status: HIT` en nginx;
  - la consulta a `ventas_por_dia` es al menos 10 veces más rápida que la cruda.
- [ ] **Step 3:** `docker compose down -v`.
- [ ] **Step 4:** Commit: `Laboratorio con Docker: Redis, caché HTTP con nginx y job de agregados`.

### Task 12: Revisión local del autor

- [ ] **Step 1:** Correr `node tests/interact.js`, `smoke.js` y `mobile.js` una última vez. Esperado: todo ok.
- [ ] **Step 2:** `open -a "Google Chrome" presentacion-cache/index.html` y avisarle al autor. **Esperar su OK.** No crear el repo remoto ni hacer push antes de eso.
- [ ] **Step 3 (con el OK):** `gh repo create gastonprieto/presentacion-cache --public --source . --remote origin`, después configurar el remote HTTPS y hacer push de `main`. Activar Pages (`gh api -X POST repos/gastonprieto/presentacion-cache/pages -f "source[branch]=main" -f "source[path]=/"`) y esperar el build (`gh api repos/gastonprieto/presentacion-cache/pages/builds/latest`). Agregar el link al README en un commit propio.
