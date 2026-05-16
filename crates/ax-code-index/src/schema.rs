pub const CREATE_TABLES: &str = r#"
CREATE TABLE IF NOT EXISTS code_node (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  file TEXT NOT NULL,
  range_start_line INTEGER NOT NULL,
  range_start_char INTEGER NOT NULL,
  range_end_line INTEGER NOT NULL,
  range_end_char INTEGER NOT NULL,
  signature TEXT,
  visibility TEXT,
  metadata TEXT,
  indexed_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
  time_created INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
  time_updated INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS code_node_project_idx ON code_node (project_id);
CREATE INDEX IF NOT EXISTS code_node_project_name_idx ON code_node (project_id, name);
CREATE INDEX IF NOT EXISTS code_node_project_file_idx ON code_node (project_id, file);
CREATE INDEX IF NOT EXISTS code_node_project_kind_idx ON code_node (project_id, kind);
CREATE INDEX IF NOT EXISTS code_node_qualified_idx ON code_node (project_id, qualified_name);

CREATE TABLE IF NOT EXISTS code_edge (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  file TEXT NOT NULL,
  range_start_line INTEGER NOT NULL DEFAULT 0,
  range_start_char INTEGER NOT NULL DEFAULT 0,
  range_end_line INTEGER NOT NULL DEFAULT 0,
  range_end_char INTEGER NOT NULL DEFAULT 0,
  time_created INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
  time_updated INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS code_edge_project_idx ON code_edge (project_id);
CREATE INDEX IF NOT EXISTS code_edge_from_idx ON code_edge (project_id, from_node);
CREATE INDEX IF NOT EXISTS code_edge_to_idx ON code_edge (project_id, to_node);
CREATE INDEX IF NOT EXISTS code_edge_project_file_idx ON code_edge (project_id, file);
CREATE INDEX IF NOT EXISTS code_edge_project_kind_idx ON code_edge (project_id, kind);

CREATE TABLE IF NOT EXISTS code_file (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  sha TEXT NOT NULL,
  size INTEGER NOT NULL,
  lang TEXT NOT NULL,
  indexed_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
  completeness TEXT NOT NULL DEFAULT 'partial',
  time_created INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
  time_updated INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS code_file_project_idx ON code_file (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS code_file_project_path_idx ON code_file (project_id, path);

CREATE TABLE IF NOT EXISTS code_index_cursor (
  project_id TEXT PRIMARY KEY NOT NULL,
  commit_sha TEXT,
  node_count INTEGER NOT NULL DEFAULT 0,
  edge_count INTEGER NOT NULL DEFAULT 0,
  time_created INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
  time_updated INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
"#;

pub const PRAGMAS: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA mmap_size = 268435456;
"#;
