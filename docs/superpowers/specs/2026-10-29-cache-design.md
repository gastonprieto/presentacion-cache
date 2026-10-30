# Presentación: Caché y precálculo — diseño

Fecha: 2026-10-29 · Carpeta: `~/projects/personal/presentacion-cache`

## Intención

Una presentación interactiva cuyo tema de fondo es **cómo hacer barata una operación cara**. La caché es la herramienta principal y ocupa la mayor parte de la clase, pero no la única: también entra el **precálculo** (un job que deja agregados listos, desnormalizar, vistas materializadas, sumar al escribir). Como casos particulares de caché se ven la **caché HTTP** y la **CDN**; de la CDN lo importante es la **idea de distribución del contenido** (copias cerca del usuario, el origen recibe sólo lo que el borde no tiene).

Lo que la clase tiene que llevarse es **criterio**, no "la caché acelera":

- ventajas (latencia, carga en el origen, absorber picos) y desventajas (datos viejos, invalidación, memoria, caché fría);
- restricciones: qué se puede cachear y qué no;
- qué hay que decidir al usar una caché: **algoritmo de reemplazo**, **tiempo de expiración (TTL)** y cómo se **mide y de qué depende el hit rate**;
- qué es una caché HTTP y una CDN;
- que calcular antes (precálculo) es otra forma de resolver lo mismo, con otros costos: la caché es *lazy* (el primero que pide paga, se calcula sólo lo pedido), el precálculo es *eager* (nadie paga al pedir, se calcula todo aunque no se use). Las dos sirven datos que pueden estar viejos; cambia quién decide cuándo se refrescan.

## Lugar en la serie y audiencia

Forma parte de la serie (load balancer → microservicios → proxy reverso → colas → eventos) pero **no tiene un lugar fijo**: puede darse en cualquier punto. Por eso es **autocontenida**: no da por sabido load balancer, proxy reverso ni eventos. Si aparece un proxy o un evento, se explica en una línea dentro de la slide.

Sí comparte con la serie el vocabulario (la **tienda**: Usuarios, Órdenes, Pagos, Envíos, más **Productos** como catálogo), el estilo y los colores. En notas del orador puede haber puentes opcionales del tipo "si vieron load balancer, esto es el '+ Caché' de la slide de la DB", que no son necesarios para seguir la clase.

Duración: **unas 2 horas**, con tiempo para demos y preguntas → ~21 slides.

## Objetivos

- Mostrar el costo de calcular cada vez y que la caché lo baja (latencia y carga en la DB) con hits y misses visibles.
- Que el hit rate se entienda como algo que **depende** de cosas (tamaño, cantidad de claves distintas, patrón de acceso, TTL) y que se puede tocar en vivo.
- Comparar algoritmos de reemplazo en una demo donde la diferencia se vea siempre, incluido un patrón donde LRU sale mal.
- Mostrar el trade-off del TTL (frescura vs. hit rate) con números.
- Mostrar invalidación, caché fría / estampida y sus mitigaciones.
- Explicar caché HTTP (`Cache-Control`, `max-age`, `ETag`/304, `private`/`public`/`no-store`) y CDN como distribución.
- Presentar el precálculo y compararlo con la caché sobre **el mismo problema**.

## No-objetivos

- No es una clase de Redis ni de una CDN en particular (comandos, productos, precios). Se nombran como ejemplos.
- No se profundiza en caché de CPU, caché del sistema operativo, ni algoritmos avanzados (ARC, W-TinyLFU, 2Q): a lo sumo una mención en notas.
- No se desarrollan consistencia distribuida, CQRS ni event sourcing. "Sumar al escribir vía un evento" se muestra con un dibujo simple, sin depender de la clase de eventos.
- No entran detalles finos de HTTP como `Vary`, `stale-while-revalidate`, `s-maxage` más allá de una mención (en notas o en una viñeta).

## Anti-objetivos (sería un fracaso aunque funcione)

- Que quede "caché = bueno, siempre poner caché". Los costos (datos viejos, invalidación, estampida, cachear lo que no hay que cachear) tienen que **verse en demos**, no sólo listarse.
- Que el precálculo parezca un apéndice desconectado. Tiene que resolver el mismo tipo de problema que la caché y terminar en una comparación lado a lado.
- Que los efectos dependan de la suerte (p. ej. LRU vs. LFU con diferencias de 2%). Calibrar hasta que se vea siempre.
- Que la CDN se explique como "una caché más" sin que se vea la **distancia** y la **distribución geográfica**.
- Que se sienta como otra serie.

## Cómo se hace (decidido)

- Se copia `presentaciones-guideline/template` y se siguen `GUIDELINE.md` y su checklist (sección 12): reveal.js 5.1.0, GSAP 3.12.5 y Chart.js 4.4.1 en `vendor/`, scripts clásicos con globals, abre con doble clic, offline.
- Una idea por slide, kicker + título, demo a la izquierda y panel a la derecha, notas del orador (guion + pregunta para la clase) en todas.
- Versión de celular (`html.mobile`, diagramas verticales o coordenadas propias en escenas manuales).
- Pruebas: `node smoke.js` y `node mobile.js` desde `presentaciones-guideline/tools`, más `tests/interact.js` propio (motor de caché, algoritmos, escenas), como en proxy reverso.
- Colores de la serie: request en viaje celeste, ok verde, lenta amarillo, error rojo; **caché/Redis rosa** (`#f472b6`), **DB verde agua**, servicios cian, cola naranja. Respuesta vieja (*stale*): color propio, distinguible de ok (decisión del builder; sugerido ámbar/marrón con borde punteado).
- **Laboratorio con Docker** (`docker-compose.yml` + `lab/` + sección en el README), como en las otras.
- Publicación en GitHub Pages (`gastonprieto.github.io/presentacion-cache`), rama `main`, raíz, push por HTTPS.

## Recorrido y lista de slides (acordado; actualizado tras la revisión local del autor, 2026-10-30)

Hilo conductor: la tienda. Un producto (`GET /productos/42`) para la parte de caché, estáticos (`app.js`, `/logo.png`) y `/perfil` para HTTP/CDN, y el **panel de ventas** (suma de todas las órdenes) para el precálculo.

La parte de caché **arranca con una caché en memoria del propio proceso**, muestra el problema al **escalar horizontalmente** (N cachés repetidas: N× memoria, N× misses, y quien invalida sólo invalida la suya) y recién ahí pasa a **una caché externa compartida**. **No se nombran productos (Redis, Memcached…) hasta la slide "Herramientas reales"**, al final.

| # | Kicker · Título | Demo | Qué se toca |
|---|---|---|---|
| 0 | Portada · "Hacer barata una operación cara" | fondo animado | — |
| **El problema** |||
| 1 | El problema · "Una operación cara" | cliente → Productos → DB; ~800 ms por consulta, 4 a la vez; con tráfico se satura | slider de tráfico |
| 2 | Tres caminos · "Calcular cada vez, guardar o calcular antes" | estática con un mini flujo por camino | fragmentos |
| **Caché** |||
| 3 | Caché · "Hit y miss" | caché **en memoria del proceso** de Productos (cache-aside) | prender/apagar, tráfico |
| 4 | Hit rate · "¿De qué depende el hit rate?" | ídem; hit rate y consultas a la DB en vivo | lugar, productos distintos, patrón |
| 5 | Reemplazo · "Se llenó: ¿a quién saco?" | casilleros paso a paso | LRU/LFU/FIFO/random, dos patrones |
| 6 | Expiración · "TTL: fresco o rápido" | precio viejo hasta que vence | slider TTL, cambiar precio |
| 7 | Invalidación · "Al escribir, avisar a la caché" | con una sola instancia, el que escribe borra su copia | no avisar / borrar / actualizar |
| 8 | Escalar · "Escalar horizontalmente: N cachés repetidas" | 1 instancia vs 3 réplicas, cada una con **su tabla de claves visible**; cambiar precio desde la réplica 1 deja `#0` viejo (ámbar) en las otras; clic en una réplica abre sus entradas (clave, precio, vence) para comparar precios | 1 / 3 réplicas, cambiar precio, clic en réplica |
| 9 | Caché externa · "Sacar la caché del proceso" | en cada réplica vs externa compartida (una sola tabla); un borrado alcanza | local / externa, cambiar precio |
| 10 | Caché fría · "Se vació la caché" | estampida al vaciarse o vencer todo junto | reiniciar; coalescing, jitter, precalentar |
| 11 | Restricciones · "¿Qué cachear y qué no?" | dos columnas: conviene / no conviene (datos de usuario: sí, con la clave del usuario) | fragmentos |
| **Caché HTTP** |||
| 12 | "El navegador también cachea" | `max-age` | max-age 0/10/60 |
| 13 | "Validar en vez de bajar de nuevo" | `ETag` → 304 | sin/con ETag, cambiar archivo |
| 14 | "¿Quién puede guardar la respuesta?" | Ana y Beto con **su caché de navegador** y una **caché compartida del camino** (proxy/CDN) con tabla por URL; `/logo.png` compartido es lo bueno, `/perfil` con `public` le da a Beto el perfil de Ana | pedir /perfil o /logo.png; public/private/no-store para /perfil |
| **CDN** |||
| 15 | "Llevar el contenido cerca" | mapa con siluetas de continentes, rutas usuario→origen vs usuario→borde y latencia sobre cada usuario | prender CDN, sólo Sídney |
| 16 | "Distribuir e invalidar" | purga vs nombres versionados | estrategia, publicar |
| **Precálculo** |||
| 17 | "Un job que deja todo listo" | calcular al abrir vs job | modo, frecuencia, abrir panel |
| 18 | "Guardar el dato como se lee" | normalizado vs desnormalizado / vista materializada | fragmentos |
| 19 | "Sumar al escribir" | en la misma operación o por evento; si falla, el total queda mal | nueva orden, órdenes automáticas, falla, recalcular |
| 20 | "Caché, job o sumar al escribir" | tabla comparativa | fragmentos |
| **Cierre** |||
| 21 | Ejemplos · "Herramientas reales" | en memoria (Caffeine, lru-cache…), externa (Redis, Memcached), HTTP (nginx, Varnish), CDN, precálculo, laboratorio | fragmentos |
| 22 | Resumen · "Lo que nos llevamos" | seis ideas | fragmentos |

Ritmo: los pedidos y respuestas viajan pausados (escenas manuales 1,6× más lentas que el primer corte; 0,48 s por tramo en la simulación).

## Laboratorio con Docker (decisión del diseño, el autor no lo objetó)

Lo mismo que las simulaciones, con piezas reales. Mínimo:

- **Servicio Productos lento** (respuesta con demora artificial, p. ej. 800 ms) con **Redis** en modo cache-aside: el servicio devuelve un header (`X-Cache: HIT|MISS`) y el TTL es configurable; `redis-cli` para ver claves, TTL restante, `FLUSHALL` (caché fría) y política de reemplazo (`maxmemory` + `maxmemory-policy allkeys-lru` / `allkeys-lfu`, con `INFO stats` para hits/misses).
- **nginx como caché HTTP** delante de un servidor de estáticos: `curl -I` para ver `Cache-Control`, `ETag`, `If-None-Match` → 304, y `X-Cache-Status` del proxy (HIT/MISS/EXPIRED).
- **Postgres** con órdenes de ejemplo y un **job de agregados** (cron en un contenedor o comando manual) que llena una tabla resumen; comparar el tiempo de la consulta cruda vs. la tabla (y opcionalmente una vista materializada con `REFRESH MATERIALIZED VIEW`).
- README con recorrido por slide y una tabla "Romper cosas", como proxy reverso.

La CDN no se puede simular de forma creíble en una sola máquina: queda fuera del laboratorio (se puede sugerir en el README mirar los headers de un sitio real con `curl -I`).

## Repo y publicación

Repo `gastonprieto/presentacion-cache`, público, Pages desde `main` raíz, push por HTTPS. **Antes de publicar, el autor la revisa local** (abrir `index.html` en Chrome); no se crea el repo remoto ni se hace push hasta su OK.

## Lo que queda a criterio del que construye

- Motor: partir del `sim.js` del template (que ya tiene `db: { mode: 'cache' }`) extendiéndolo con una caché real (claves, capacidad, TTL, algoritmo), o escenas manuales con `Clock` donde la `Sim` no alcance (reemplazo, HTTP, CDN, precálculo).
- Calibrar números (tasas, capacidades, tiempos, tamaños) para que cada efecto se vea siempre.
- Textos finales de slides y notas, en el tono de la serie.
- Fusionar o partir slides si una queda pobre o el panel desborda (p. ej. 6 y 7, 11 y 12, 17 dentro de 16).
- Si agregar una slide "Playground" como en load balancer.
- Dibujo del mapa de la CDN (estilizado, sin depender de datos geográficos reales).

Decisiones ya tomadas por el diseño (no del autor; revisables):

- El `db: { mode: 'cache' }` del template decide hits con una probabilidad fija: no sirve para las slides 3–9. Hace falta un modelo de caché real (claves, capacidad, TTL, algoritmo), testeado en `tests/interact.js`.
- Slide 9: las réplicas reciben pedidos repartidos por "algo adelante" que se explica en una línea, sin desarrollar load balancing.
- Slide 7: el modo "actualizar clave" no muestra la carrera entre una escritura y un miss concurrente (queda en notas como pregunta para la clase).
- Lab: el servicio lento reutiliza la estructura de `lab/servicio` de proxy reverso.

## Criterio de terminado

- Las slides de la tabla con sus demos funcionando en escritorio y celular.
- `smoke.js`, `mobile.js` y `tests/interact.js` en verde, y capturas revisadas.
- Laboratorio levanta con `docker compose up -d --build` y el recorrido del README funciona.
- Revisada localmente por el autor y, con su OK, publicada en GitHub Pages.
