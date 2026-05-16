-- Deduplicate code_file rows, keeping the most recently updated row per
-- (project_id, path), then enforce uniqueness going forward.
--
-- Background: upsertFile was targeting code_file.id for ON CONFLICT, but
-- the builder generates a fresh id every call, so conflicts never fired
-- and every re-index appended new rows. On the author's machine a 652-
-- file project had accumulated 3639 rows (~10× per path) after a few
-- re-indexes. Fix the schema so this can't happen again.

-- 1. Delete duplicates. Keep the row with the largest time_updated per
-- (project_id, path). Ties are broken by id (lexicographically).
DELETE FROM code_file
WHERE id NOT IN (
  SELECT id FROM code_file cf
  WHERE cf.time_updated = (
    SELECT MAX(time_updated)
    FROM code_file cf2
    WHERE cf2.project_id = cf.project_id AND cf2.path = cf.path
  )
  GROUP BY cf.project_id, cf.path
);
--> statement-breakpoint

-- 2. The old non-unique index is now redundant with the unique one.
DROP INDEX IF EXISTS code_file_project_path_idx;
--> statement-breakpoint

-- 3. Create the unique index. Future upsertFile calls will target this.
CREATE UNIQUE INDEX code_file_project_path_idx ON code_file (project_id, path);
