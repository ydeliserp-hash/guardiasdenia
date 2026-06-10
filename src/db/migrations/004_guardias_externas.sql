-- ============================================================================
-- 004 — Guardias externas (rotatorios en otros hospitales)
-- Cada residente apunta SUS guardias hechas fuera. Cuentan para las
-- estadísticas y límites Vi/Sa/Do y para la regla de días consecutivos,
-- pero no pertenecen a ninguna planilla ni admiten cambios/cesiones.
-- ============================================================================

CREATE TABLE IF NOT EXISTS guardias_externas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fecha     DATE NOT NULL,
  lugar     TEXT CHECK (lugar IS NULL OR char_length(lugar) <= 80),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fecha)  -- una guardia externa por residente y día
);

CREATE INDEX IF NOT EXISTS idx_gext_fecha ON guardias_externas (fecha);
CREATE INDEX IF NOT EXISTS idx_gext_user  ON guardias_externas (user_id);
