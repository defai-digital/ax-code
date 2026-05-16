import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"

import { ProjectTable } from "@/project/project.sql"
import type { ProjectID } from "@/project/schema"
import type { WorkspaceID } from "./schema"

// `project_id` has a foreign key in the SQL migration
// (20260225215848_workspace) but the Drizzle schema had no
// `.references(...)` call, causing schema drift between generated
// migrations and the ORM model. Declaring the reference here aligns
// Drizzle with the database and makes `drizzle-kit generate` emit a
// matching constraint next time.
//
// The `workspace_project_idx` covers the common lookup path used by
// `list()` and `startSyncing()` which filter by `project_id` — without
// it every such query is a full table scan.
export const WorkspaceTable = sqliteTable(
  "workspace",
  {
    id: text().$type<WorkspaceID>().primaryKey(),
    branch: text(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    type: text().notNull(),
    name: text(),
    directory: text(),
    extra: text({ mode: "json" }).$type<Record<string, any>>(),
  },
  (table) => [index("workspace_project_idx").on(table.project_id)],
)
