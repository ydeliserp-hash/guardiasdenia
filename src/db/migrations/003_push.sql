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
