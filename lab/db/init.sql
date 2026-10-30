-- Órdenes de la tienda: 2 millones de filas en 90 días, para que la consulta "cruda" sea cara.
CREATE TABLE ordenes (
  id          bigserial PRIMARY KEY,
  fecha       date        NOT NULL,
  usuario_id  int         NOT NULL,
  producto_id int         NOT NULL,
  total       numeric(10,2) NOT NULL
);
INSERT INTO ordenes (fecha, usuario_id, producto_id, total)
SELECT CURRENT_DATE - (random() * 89)::int,
       (random() * 9999)::int,
       (random() * 199)::int,
       round((500 + random() * 9500)::numeric, 2)
FROM generate_series(1, 2000000);
ANALYZE ordenes;

-- Precalculada por el job (lab/job/agregar.sql)
CREATE TABLE ventas_por_dia (
  fecha        date PRIMARY KEY,
  ordenes      int  NOT NULL,
  total        numeric(14,2) NOT NULL,
  calculado_en timestamptz NOT NULL
);

-- La misma pregunta como vista materializada: la base la guarda y se refresca a mano
CREATE MATERIALIZED VIEW mv_ventas_por_dia AS
SELECT fecha, count(*) AS ordenes, sum(total) AS total FROM ordenes GROUP BY fecha;
