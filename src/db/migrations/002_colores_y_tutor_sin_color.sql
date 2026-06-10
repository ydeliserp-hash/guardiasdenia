-- ============================================================================
-- 002 — Dos colores pastel nuevos (turquesa, arena) y color opcional para
-- el tutor (no aparece en el calendario, no necesita color ni gastar uno).
-- El índice de unicidad parcial sobre usuarios activos admite NULL sin choque.
-- ============================================================================

ALTER TYPE pastel_color ADD VALUE IF NOT EXISTS 'turquesa';
ALTER TYPE pastel_color ADD VALUE IF NOT EXISTS 'arena';

ALTER TABLE users ALTER COLUMN color DROP NOT NULL;
