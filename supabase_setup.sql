-- ============================================================================
-- guardias-residentes — ESQUEMA + DATOS (Supabase). Pega TODO y pulsa Run.
-- Contraseña de los 9 usuarios de ejemplo: Denia2026!
-- Generado por src/db/gen-supabase-sql.js — re-ejecutable (hace TRUNCATE).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ESQUEMA
-- ----------------------------------------------------------------------------
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

-- ============================================================================
-- 002 — Dos colores pastel nuevos (turquesa, arena) y color opcional para
-- el tutor (no aparece en el calendario, no necesita color ni gastar uno).
-- El índice de unicidad parcial sobre usuarios activos admite NULL sin choque.
-- ============================================================================

ALTER TYPE pastel_color ADD VALUE IF NOT EXISTS 'turquesa';
ALTER TYPE pastel_color ADD VALUE IF NOT EXISTS 'arena';

ALTER TABLE users ALTER COLUMN color DROP NOT NULL;

-- ============================================================================
-- 003 — Notificaciones push (Web Push)
--   push_subscriptions: suscripciones del navegador/PWA de cada usuario
--   push_config: par de claves VAPID (se genera solo la primera vez)
-- ============================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint  TEXT NOT NULL UNIQUE,
  claves    JSONB NOT NULL,            -- { p256dh, auth }
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS push_config (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- ----------------------------------------------------------------------------
-- 2) DATOS DE EJEMPLO
-- ----------------------------------------------------------------------------
TRUNCATE notifications, audit_log, shifts, change_requests, year_stats, month_plans, users RESTART IDENTITY CASCADE;

-- Usuarios (password_hash bcrypt embebido)
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('carmen', 'Carmen Bisbal', 'Dra. Carmen Bisbal', 'CB', '21456789X', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'tutor', 'Tutora', 'lavanda', FALSE, TRUE, TRUE, NULL);
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('marta', 'Marta Espí', 'Marta Espí', 'ME', '48721903K', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'r4', 'R4', 'cielo', TRUE, TRUE, TRUE, NULL);
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('javier', 'Javier Morand', 'Javier Morand', 'JM', '20098451T', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'r4', 'R4', 'salvia', TRUE, TRUE, TRUE, NULL);
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('lucia', 'Lucía Sendra', 'Lucía Sendra', 'LS', '53110874P', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'residente', 'R3', 'rosa', TRUE, TRUE, TRUE, NULL);
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('hugo', 'Hugo Ferrer', 'Hugo Ferrer', 'HF', '44903217M', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'residente', 'R2', 'melocoton', TRUE, TRUE, TRUE, NULL);
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('aitana', 'Aitana Roselló', 'Aitana Roselló', 'AR', '49872013D', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'residente', 'R2', 'amarillo', TRUE, TRUE, TRUE, NULL);
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('pablo', 'Pablo Mengual', 'Pablo Mengual', 'PM', '26540918L', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'residente', 'R1', 'menta', TRUE, TRUE, TRUE, NULL);
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('nerea', 'Nerea Vidal', 'Nerea Vidal', 'NV', '51230496G', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'residente', 'R1', 'bebe', TRUE, TRUE, TRUE, NULL);
INSERT INTO users (id, nombre, trato, iniciales, dni, password_hash, role, anio, color, hace_guardias, aplica_limites, activo, activation_code) VALUES ('tomas', 'Tomás Gilabert', 'Dr. Tomás Gilabert', 'TG', '30019283F', '$2a$10$HIjPNdFwGi1n4J22YQBHNuJft.Ib9Ekb6WmRncCkAv5vJ3jnTDmnW', 'externo', 'Externo', 'coral', TRUE, FALSE, TRUE, NULL);

INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'carmen', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Carmen Bisbal","role":"tutor","color":"lavanda"}'::jsonb, now() - interval '240 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'marta', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Marta Espí","role":"r4","color":"cielo"}'::jsonb, now() - interval '240 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'javier', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Javier Morand","role":"r4","color":"salvia"}'::jsonb, now() - interval '240 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'lucia', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Lucía Sendra","role":"residente","color":"rosa"}'::jsonb, now() - interval '240 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'hugo', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Hugo Ferrer","role":"residente","color":"melocoton"}'::jsonb, now() - interval '240 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'aitana', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Aitana Roselló","role":"residente","color":"amarillo"}'::jsonb, now() - interval '240 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'pablo', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Pablo Mengual","role":"residente","color":"menta"}'::jsonb, now() - interval '240 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'nerea', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Nerea Vidal","role":"residente","color":"bebe"}'::jsonb, now() - interval '240 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('usuario', 'tomas', 'alta_usuario', 'carmen', 'activo', '{"nombre":"Tomás Gilabert","role":"externo","color":"coral"}'::jsonb, now() - interval '240 hours');

-- Contadores anuales (year_stats)
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('marta', 2025, 46, 7, 7, 6);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('javier', 2025, 44, 6, 7, 7);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('lucia', 2025, 49, 8, 6, 7);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('hugo', 2025, 41, 5, 6, 6);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('aitana', 2025, 47, 7, 7, 8);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('pablo', 2025, 38, 5, 5, 4);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('nerea', 2025, 40, 6, 5, 5);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('tomas', 2025, 18, 3, 4, 3);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('marta', 2026, 28, 5, 6, 4);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('javier', 2026, 25, 4, 5, 6);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('lucia', 2026, 31, 7, 7, 6);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('hugo', 2026, 30, 6, 7, 5);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('aitana', 2026, 33, 7, 8, 7);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('pablo', 2026, 29, 6, 6, 5);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('nerea', 2026, 34, 9, 7, 6);
INSERT INTO year_stats (user_id, anio, guardias_anio, vi, sa, do_) VALUES ('tomas', 2026, 12, 2, 3, 2);

-- Planilla junio 2026 (publicada por la tutora)
INSERT INTO month_plans (id, anio, mes, estado, publicado_por, publicado_en) VALUES ('00000000-0000-4000-8000-000000000001', 2026, 6, 'publicado', 'carmen', now() - interval '6 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('planilla', '00000000-0000-4000-8000-000000000001', 'publicada', 'carmen', 'borrador', 'publicado', '{"anio":2026,"mes":6}'::jsonb, now() - interval '6 hours');

-- Guardias de junio 2026
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-01', 'lucia', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-02', 'hugo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-02', 'pablo', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-03', 'aitana', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-04', 'nerea', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-04', 'tomas', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-05', 'marta', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-05', 'hugo', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-06', 'javier', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-07', 'pablo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-07', 'aitana', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-08', 'lucia', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-09', 'nerea', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-10', 'hugo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-10', 'javier', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-11', 'aitana', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-12', 'pablo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-12', 'nerea', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-13', 'lucia', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-13', 'hugo', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-14', 'tomas', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-15', 'marta', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-16', 'aitana', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-16', 'pablo', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-17', 'nerea', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-18', 'hugo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-18', 'lucia', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-19', 'javier', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-20', 'aitana', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-20', 'marta', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-21', 'pablo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-22', 'nerea', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-22', 'tomas', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-23', 'lucia', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-24', 'hugo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-24', 'aitana', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-25', 'pablo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-26', 'nerea', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-26', 'javier', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-27', 'lucia', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-27', 'marta', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-28', 'hugo', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-29', 'aitana', '00000000-0000-4000-8000-000000000001', 1);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-29', 'pablo', '00000000-0000-4000-8000-000000000001', 2);
INSERT INTO shifts (fecha, user_id, plan_id, slot) VALUES ('2026-06-30', 'nerea', '00000000-0000-4000-8000-000000000001', 1);

-- Solicitudes rq1..rq6 (5 estados; rq4 con flag_exceso)
INSERT INTO change_requests (id, tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota, motivo, creada_en, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'intercambio', 'hugo', 'lucia', '2026-06-10', '2026-06-08', 'pend_companero', NULL, '¿Te viene bien cambiar? Tengo una cita médica el día 10.', NULL, now() - interval '2 hours', now() - interval '2 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '11111111-1111-4111-8111-111111111111', 'creada', 'hugo', 'pend_companero', '{"tipo":"intercambio","de":"hugo","a":"lucia","guardia_de":"2026-06-10","guardia_a":"2026-06-08","flag_exceso":null}'::jsonb, now() - interval '2 hours');
INSERT INTO change_requests (id, tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota, motivo, creada_en, updated_at) VALUES ('22222222-2222-4222-8222-222222222222', 'cesion', 'lucia', 'aitana', '2026-06-23', NULL, 'pend_tutor', NULL, 'Te cedo la guardia del 23.', NULL, now() - interval '26 hours', now() - interval '26 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '22222222-2222-4222-8222-222222222222', 'creada', 'lucia', 'pend_companero', '{"tipo":"cesion","de":"lucia","a":"aitana","guardia_de":"2026-06-23","guardia_a":null,"flag_exceso":null}'::jsonb, now() - interval '26 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '22222222-2222-4222-8222-222222222222', 'aceptada', 'aitana', 'pend_companero', 'pend_tutor', '{"aceptado_por":"aitana","flag_exceso":null}'::jsonb, now() - interval '1530 minutes');
INSERT INTO change_requests (id, tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota, motivo, creada_en, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', 'intercambio', 'nerea', 'javier', '2026-06-17', '2026-06-19', 'aprobada', NULL, NULL, NULL, now() - interval '72 hours', now() - interval '72 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '33333333-3333-4333-8333-333333333333', 'creada', 'nerea', 'pend_companero', '{"tipo":"intercambio","de":"nerea","a":"javier","guardia_de":"2026-06-17","guardia_a":"2026-06-19","flag_exceso":null}'::jsonb, now() - interval '72 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '33333333-3333-4333-8333-333333333333', 'aceptada', 'javier', 'pend_companero', 'pend_tutor', '{"aceptado_por":"javier","flag_exceso":null}'::jsonb, now() - interval '4290 minutes');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '33333333-3333-4333-8333-333333333333', 'aprobada', 'carmen', 'pend_tutor', 'aprobada', '{"tipo":"intercambio","solicitante":"nerea","companero":"javier","tutor":"carmen","guardia_de":"2026-06-17","guardia_a":"2026-06-19","flag_exceso":null,"forzado_pese_a_exceso":false}'::jsonb, now() - interval '4260 minutes');
INSERT INTO change_requests (id, tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota, motivo, creada_en, updated_at) VALUES ('44444444-4444-4444-8444-444444444444', 'cesion', 'pablo', 'aitana', '2026-06-27', NULL, 'pend_tutor', '{"tipo":"sábados","actual":8,"nuevo":9,"user_id":"aitana"}'::jsonb, '¿Me cubres el sábado 27? Te lo devuelvo en julio.', NULL, now() - interval '5 hours', now() - interval '5 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '44444444-4444-4444-8444-444444444444', 'creada', 'pablo', 'pend_companero', '{"tipo":"cesion","de":"pablo","a":"aitana","guardia_de":"2026-06-27","guardia_a":null,"flag_exceso":{"tipo":"sábados","actual":8,"nuevo":9,"user_id":"aitana"}}'::jsonb, now() - interval '5 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '44444444-4444-4444-8444-444444444444', 'aceptada', 'aitana', 'pend_companero', 'pend_tutor', '{"aceptado_por":"aitana","flag_exceso":{"tipo":"sábados","actual":8,"nuevo":9,"user_id":"aitana"}}'::jsonb, now() - interval '270 minutes');
INSERT INTO change_requests (id, tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota, motivo, creada_en, updated_at) VALUES ('55555555-5555-4555-8555-555555555555', 'intercambio', 'tomas', 'nerea', '2026-06-22', '2026-06-09', 'rechazada', NULL, NULL, 'No puedo ese día, lo siento.', now() - interval '96 hours', now() - interval '96 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '55555555-5555-4555-8555-555555555555', 'creada', 'tomas', 'pend_companero', '{"tipo":"intercambio","de":"tomas","a":"nerea","guardia_de":"2026-06-22","guardia_a":"2026-06-09","flag_exceso":null}'::jsonb, now() - interval '96 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '55555555-5555-4555-8555-555555555555', 'rechazada', 'nerea', 'pend_companero', 'rechazada', '{"rechazado_por":"nerea","motivo":"No puedo ese día, lo siento."}'::jsonb, now() - interval '5730 minutes');
INSERT INTO change_requests (id, tipo, de_user_id, a_user_id, guardia_de, guardia_a, estado, flag_exceso, nota, motivo, creada_en, updated_at) VALUES ('66666666-6666-4666-8666-666666666666', 'cesion', 'marta', 'pablo', '2026-06-15', NULL, 'cancelada', NULL, NULL, NULL, now() - interval '168 hours', now() - interval '168 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '66666666-6666-4666-8666-666666666666', 'creada', 'marta', 'pend_companero', '{"tipo":"cesion","de":"marta","a":"pablo","guardia_de":"2026-06-15","guardia_a":null,"flag_exceso":null}'::jsonb, now() - interval '168 hours');
INSERT INTO audit_log (entidad, entidad_id, accion, actor_id, estado_anterior, estado_nuevo, detalle, creado_en) VALUES ('solicitud', '66666666-6666-4666-8666-666666666666', 'cancelada', 'marta', 'pend_companero', 'cancelada', '{"cancelado_por":"marta"}'::jsonb, now() - interval '10050 minutes');

-- Notificaciones del residente actual (lucia)
INSERT INTO notifications (user_id, tipo, icono, titulo, cuerpo, leida, ref_request_id, creada_en) VALUES ('lucia', 'solicitud', 'swap', 'Hugo Ferrer te propone un intercambio', 'Su guardia del 10 jun por la tuya del 8 jun.', FALSE, '11111111-1111-4111-8111-111111111111', now() - interval '2 hours');
INSERT INTO notifications (user_id, tipo, icono, titulo, cuerpo, leida, ref_request_id, creada_en) VALUES ('lucia', 'plan', 'cal', 'Plan de guardias de junio publicado', 'La Dra. Bisbal ha publicado el calendario del mes.', FALSE, NULL, now() - interval '6 hours');
INSERT INTO notifications (user_id, tipo, icono, titulo, cuerpo, leida, ref_request_id, creada_en) VALUES ('lucia', 'estado', 'clock', 'Tu cesión a Aitana está pendiente del tutor', 'Aitana aceptó la guardia del 23 jun. Esperando aprobación.', TRUE, '22222222-2222-4222-8222-222222222222', now() - interval '26 hours');
INSERT INTO notifications (user_id, tipo, icono, titulo, cuerpo, leida, ref_request_id, creada_en) VALUES ('lucia', 'aprobada', 'check', 'Cambio aprobado por la tutora', 'El intercambio entre Nerea y Javier ha sido aprobado.', TRUE, '33333333-3333-4333-8333-333333333333', now() - interval '72 hours');
INSERT INTO notifications (user_id, tipo, icono, titulo, cuerpo, leida, ref_request_id, creada_en) VALUES ('lucia', 'recordatorio', 'bell', 'Recordatorio de guardia', 'Tienes guardia el sábado 13 de junio junto a Hugo.', TRUE, NULL, now() - interval '72 hours');

-- ✓ Listo. Usuarios de prueba (contraseña arriba): DNI 53110874P = Lucía, 21456789X = Carmen (tutora).
