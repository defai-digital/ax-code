import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import type { ProjectID } from "@/project/schema"
import type { PromptHistoryEntry } from "./schema"

export const PromptHistoryTable = sqliteTable(
  "prompt_history",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    mode: text().$type<PromptHistoryEntry["mode"]>(),
    input: text().notNull(),
    parts: text({ mode: "json" }).notNull().$type<PromptHistoryEntry["parts"]>(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer().$onUpdate(() => Date.now()),
  },
  (table) => [index("prompt_history_project_time_idx").on(table.project_id, table.time_created, table.id)],
)
