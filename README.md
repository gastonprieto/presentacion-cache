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

## Laboratorio con Docker

Lo mismo que muestran las simulaciones, con piezas reales. Hace falta Docker con Compose.

- **Productos** (`localhost:8081`): servicio lento (800 ms por consulta a su "DB") con **Redis** adelante en modo cache-aside. Contesta `X-Cache: HIT | MISS | BYPASS`.
- **nginx** (`localhost:8080`): caché HTTP compartida delante de un origen de estáticos. Contesta `X-Cache-Status`.
- **Postgres** con 2 millones de órdenes y un **job** que cada 30 s recalcula `ventas_por_dia`.

```bash
docker compose up -d --build     # la primera vez Postgres tarda ~30 s en cargar las órdenes
docker compose logs -f productos web nginx job    # en otra terminal: qué pasa en cada pieza
docker compose down -v           # al terminar
```

La configuración está en `docker-compose.yml` (TTL, demora, invalidación) y en `lab/nginx/nginx.conf`.

### Recorrido

**Hit y miss.** El primer pedido va a la DB y tarda ~800 ms. El segundo sale de Redis en pocos milisegundos.

```bash
curl -s -D - -w "%{time_total}s\n" localhost:8081/productos/42 | grep -iE "x-cache|s$"   # MISS · 0.85s
curl -s -D - -w "%{time_total}s\n" localhost:8081/productos/42 | grep -iE "x-cache|s$"   # HIT  · 0.004s
docker compose exec redis redis-cli INFO stats | grep keyspace    # hits y misses: el hit rate se mide
```

**TTL.** Cada clave vence a los 30 s (`TTL_S`).

```bash
docker compose exec redis redis-cli TTL producto:42      # segundos que le quedan
```

**Invalidación.** Cambiar el precio sin avisar a la caché sigue mostrando el viejo hasta el TTL. Con `invalidar=1`, el servicio borra la clave y el próximo pedido trae el nuevo (para que sea el comportamiento por defecto: `INVALIDAR: "1"` en el compose).

```bash
curl -s localhost:8081/productos/42                       # la deja en la caché
curl -s -X PUT "localhost:8081/productos/42/precio?valor=5000"
curl -s localhost:8081/productos/42                       # precio viejo (HIT), hasta que venza
curl -s -X PUT "localhost:8081/productos/42/precio?valor=6000&invalidar=1"
curl -s -D - localhost:8081/productos/42 | grep -iE "x-cache|precio"   # MISS con el precio nuevo
```

**Reemplazo.** Redis tiene 2 MB (`maxmemory`, entran unos 15 productos) y saca claves con LRU. Para ver desalojos, llenalo y mirá `evicted_keys`. Después cambiá la política en caliente:

```bash
for i in $(seq 0 199); do curl -s -o /dev/null localhost:8081/productos/$i & done; wait
docker compose exec redis redis-cli INFO stats | grep evicted_keys
docker compose exec redis redis-cli CONFIG SET maxmemory-policy allkeys-lfu
```

**Caché fría.** `FLUSHALL` vacía Redis: los pedidos siguientes vuelven a ir todos a la DB.

```bash
docker compose exec redis redis-cli FLUSHALL
for i in $(seq 10); do curl -s -o /dev/null -w "%{time_total}s " localhost:8081/productos/42 & done; wait; echo
docker compose logs productos --tail 10      # sin coalescing: varias consultas a la DB por la misma clave
```

**Caché HTTP.** `app.js` (~180 KB) viene con `Cache-Control: public, max-age=60` y un `ETag`. nginx la guarda: el primer pedido es `MISS` y los siguientes `HIT` (el origen no se entera). Pasados 60 s, nginx revalida con el origen (`REVALIDATED`, un 304 entre nginx y el origen).

```bash
curl -s -o /dev/null -D - localhost:8080/static/app.js | grep -iE "x-cache-status|etag|cache-control"
curl -s -o /dev/null -D - localhost:8080/static/app.js | grep -i x-cache-status         # HIT
docker compose logs web --tail 3                                                         # el origen vio uno solo
```

**Validar con ETag.** Lo que hace el navegador con su copia vencida: pregunta con `If-None-Match` y recibe `304` sin cuerpo.

```bash
ETAG=$(curl -s -o /dev/null -D - localhost:8080/static/app.js | grep -i etag | awk '{print $2}' | tr -d '\r')
curl -s -o /dev/null -w "%{http_code} · %{size_download} bytes\n" -H "If-None-Match: $ETAG" localhost:8080/static/app.js   # 304 · 0 bytes
docker compose exec web wget -qO- --post-data= localhost:3000/static/app.js/nueva-version   # cambia el archivo (y el ETag)
```

**Privada o compartida.** `/mi-cuenta` viene con `Cache-Control: private` y nginx no la guarda. `/mi-cuenta-mal` es la misma respuesta detrás de una configuración que ignora ese header, y le muestra a Beto la cuenta de Ana.

```bash
curl -s -H 'X-Usuario: ana'  localhost:8080/mi-cuenta        # Cuenta de ana
curl -s -H 'X-Usuario: beto' localhost:8080/mi-cuenta        # Cuenta de beto
curl -s -H 'X-Usuario: ana'  localhost:8080/mi-cuenta-mal    # Cuenta de ana
curl -s -H 'X-Usuario: beto' localhost:8080/mi-cuenta-mal    # Cuenta de ana (!)
```

**Precálculo.** La consulta "cruda" recorre las órdenes. La tabla del job, en cambio, ya tiene la respuesta (mirá `calculado_en`: es la antigüedad del dato). La vista materializada es lo mismo, pero se refresca a mano.

```bash
docker compose exec db psql -U postgres -d tienda
\timing on
SELECT fecha, count(*), sum(total) FROM ordenes GROUP BY fecha ORDER BY fecha DESC LIMIT 3;   -- 100 a 300 ms: recorre 2 millones de filas
SELECT * FROM ventas_por_dia ORDER BY fecha DESC LIMIT 3;                                    -- < 1 ms
REFRESH MATERIALIZED VIEW mv_ventas_por_dia;
SELECT * FROM mv_ventas_por_dia ORDER BY fecha DESC LIMIT 3;
```

### Romper cosas

| Qué romper | Comando | Qué se ve | Volver |
|---|---|---|---|
| Redis | `docker compose stop redis` | Productos sigue andando sin caché: todo `X-Cache: BYPASS` y ~800 ms | `docker compose start redis` |
| Vaciar la caché con tráfico | `docker compose exec redis redis-cli FLUSHALL` | Estampida: todos los pedidos van a la DB a la vez | se vuelve a llenar sola |
| Precio sin invalidar | `curl -X PUT "localhost:8081/productos/42/precio?valor=1"` | Precio viejo hasta 30 s después | esperar el TTL o `?invalidar=1` |
| El job | `docker compose stop job` | `calculado_en` deja de avanzar: el panel muestra datos cada vez más viejos | `docker compose start job` |
| Un proxy mal configurado | `curl -H 'X-Usuario: beto' localhost:8080/mi-cuenta-mal` | Datos de otro usuario | no usar `proxy_ignore_headers` con respuestas privadas |

La CDN no está en el laboratorio (no se simula bien en una sola máquina). Para verla en un sitio real, mirá sus headers: `curl -sI https://www.cloudflare.com | grep -iE "cf-cache-status|age|cache-control"`. Otros proveedores usan `x-cache` o `age`.
