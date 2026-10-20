-- Forward repair for installations where 006 was already recorded before
-- the JOINED-history backfill was made safe for an unknown historical actor.
-- Widening NOT NULL to NULL preserves every existing creator value.
ALTER TABLE employment_history
  MODIFY COLUMN created_by CHAR(36) NULL;
