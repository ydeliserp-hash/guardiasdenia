-- ============================================================================
-- Esquema inicial — App de Guardias de Residentes (Hospital U. de Dénia)
-- PostgreSQL. Toda la validación crítica vive también en el backend; aquí
-- se replican las invariantes que la BD puede garantizar por sí misma.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role     AS ENUM ('tutor', 'r4', 'residente', 'externo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pastel_color  AS ENUM ('rosa','melocoton','amarillo','menta','salvia','cielo','bebe','lavanda','lila','coral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plan_estado   AS ENUM ('borrador', 'publicado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE request_tipo  AS ENUM ('intercambio', 'cesion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE request_estado AS ENUM ('pend_companero', 'pend_tutor', 'aprobada', 'rechazada', 'cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE noti_tipo     AS ENUM ('solicitud', 'plan', 'estado', 'aprobada', 'recordatorio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE noti_icono    AS ENUM ('swap', 'cal', 'clock', 'check', 'bell');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_entidad AS ENUM ('solicitud', 'planilla', 'usuario', 'guardia');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_accion  AS ENUM ('creada','aceptada','rechazada','aprobada','cancelada','publicada','borrador','alta_usuario','baja_usuario','editado_usuario','asignacion_guardia');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- USERS
-- Usamos id TEXT para conservar los identificadores legibles del prototipo
-- ('carmen', 'lucia', ...) que el frontend ya referencia. Los usuarios nuevos
-- reciben un uuid textual por defecto.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nombre          TEXT NOT NULL,
  trato           TEXT NOT NULL,
  iniciales       VARCHAR(2) NOT NULL,
  dni             TEXT NOT NULL UNIQUE,
  password_hash   TEXT,                 -- NULL hasta el primer acceso
  role            user_role NOT NULL,
  anio            TEXT NOT NULL,        -- "R1".."R4", "Tutora", "Externo"
  color           pastel_color NOT NULL,
  hace_guardias   BOOLEAN NOT NULL DEFAULT TRUE,
  aplica_limites  BOOLEAN NOT NULL DEFAULT TRUE,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  activation_code TEXT,                 -- un solo uso, sin caducidad; NULL si ya se consumió
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Color único SOLO entre usuarios activos (una baja libera su color).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_color_activo
  ON users (color) WHERE activo;

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ---------------------------------------------------------------------------
-- MONTH_PLANS (planilla mensual)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS month_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio          INTEGER NOT NULL,
  mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  estado        plan_estado NOT NULL DEFAULT 'borrador',
  publicado_por TEXT REFERENCES users(id),
  publicado_en  TIMESTAMPTZ,
  UNIQUE (anio, mes)
);

-- ---------------------------------------------------------------------------
-- SHIFTS (guardia asignada)
-- Cada fecha admite 1 o 2 residentes: lo garantizamos con un 'slot' (1|2)
-- único por fecha, y un único usuario por fecha.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha    DATE NOT NULL,
  user_id  TEXT NOT NULL REFERENCES users(id),
  plan_id  UUID REFERENCES month_plans(id) ON DELETE CASCADE,
  slot     SMALLINT NOT NULL CHECK (slot IN (1, 2)),
  UNIQUE (fecha, slot),      -- como máximo 2 guardias por día
  UNIQUE (fecha, user_id)    -- un residente no puede estar dos veces el mismo día
);

CREATE INDEX IF NOT EXISTS idx_shifts_user  ON shifts (user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_fecha ON shifts (fecha);

-- ---------------------------------------------------------------------------
-- CHANGE_REQUESTS (solicitud de cambio o cesión)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        request_tipo NOT NULL,
  de_user_id  TEXT NOT NULL REFERENCES users(id),
  a_user_id   TEXT NOT NULL REFERENCES users(id),
  guardia_de  DATE NOT NULL,
  guardia_a   DATE,                          -- NULL en cesión
  estado      request_estado NOT NULL DEFAULT 'pend_companero',
  flag_exceso JSONB,                         -- { tipo, actual, nuevo, ... }
  nota        TEXT CHECK (nota IS NULL OR char_length(nota) <= 240),
  motivo      TEXT,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- En intercambio guardia_a es obligatoria; en cesión debe ser NULL.
  CONSTRAINT chk_guardia_a CHECK (
    (tipo = 'intercambio' AND guardia_a IS NOT NULL) OR
    (tipo = 'cesion'      AND guardia_a IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_req_de     ON change_requests (de_user_id);
CREATE INDEX IF NOT EXISTS idx_req_a      ON change_requests (a_user_id);
CREATE INDEX IF NOT EXISTS idx_req_estado ON change_requests (estado);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL REFERENCES users(id),
  tipo           noti_tipo NOT NULL,
  icono          noti_icono NOT NULL,
  titulo         TEXT NOT NULL,
  cuerpo         TEXT NOT NULL,
  leida          BOOLEAN NOT NULL DEFAULT FALSE,
  ref_request_id UUID REFERENCES change_requests(id) ON DELETE SET NULL,
  creada_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_noti_user ON notifications (user_id, leida);

-- ---------------------------------------------------------------------------
-- AUDIT_LOG (histórico inmutable)
-- Solo INSERT. Un trigger impide UPDATE/DELETE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad         audit_entidad NOT NULL,
  entidad_id      TEXT NOT NULL,
  accion          audit_accion NOT NULL,
  actor_id        TEXT REFERENCES users(id),
  estado_anterior TEXT,
  estado_nuevo    TEXT,
  detalle         JSONB,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entidad ON audit_log (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_audit_fecha   ON audit_log (creado_en);

CREATE OR REPLACE FUNCTION audit_log_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El histórico de auditoría es inmutable: no se permite % en audit_log', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_inmutable ON audit_log;
CREATE TRIGGER trg_audit_log_inmutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_inmutable();

-- ---------------------------------------------------------------------------
-- YEAR_STATS (contadores anuales almacenados)
-- Fuente de verdad de los contadores Vi/Sa/Do por residente y año natural.
-- guardias_mes NO se almacena: se calcula en vivo desde la tabla shifts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS year_stats (
  user_id       TEXT NOT NULL REFERENCES users(id),
  anio          INTEGER NOT NULL,
  guardias_anio INTEGER NOT NULL DEFAULT 0,  -- total de guardias del año (informativo)
  vi            INTEGER NOT NULL DEFAULT 0 CHECK (vi >= 0),
  sa            INTEGER NOT NULL DEFAULT 0 CHECK (sa >= 0),
  do_           INTEGER NOT NULL DEFAULT 0 CHECK (do_ >= 0),  -- 'do' es palabra reservada
  PRIMARY KEY (user_id, anio)
);
