import { sqliteTable, text } from "drizzle-orm/sqlite-core"

import type { ProjectID } from "@/project/schema"
import type { WorkspaceID } from "./schema"

export const WorkspaceTable = sqliteTable("workspace", {
  id: text().$type<WorkspaceID>().primaryKey(),
  branch: text(),
  project_id: text().$type<ProjectID>().notNull(),
  type: text().notNull(),
  name: text(),
  directory: text(),
  extra: text({ mode: "json" }).$type<Record<string, any>>(),
})
