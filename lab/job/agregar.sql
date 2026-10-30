-- Job de agregados: recalcula ventas_por_dia desde cero (lo corre el contenedor "job" cada 30 s).
BEGIN;
TRUNCATE ventas_por_dia;
INSERT INTO ventas_por_dia (fecha, ordenes, total, calculado_en)
SELECT fecha, count(*), sum(total), now() FROM ordenes GROUP BY fecha;
COMMIT;
SELECT 'ventas_por_dia actualizada: ' || count(*) || ' días · ' || max(calculado_en) AS job FROM ventas_por_dia;
