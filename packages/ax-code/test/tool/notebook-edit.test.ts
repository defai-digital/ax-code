import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import type { Permission } from "../../src/permission"
import type { Tool } from "../../src/tool/tool"
import { NotebookEditTool } from "../../src/tool/notebook_edit"
import { Instance } from "../../src/project/instance"
import { Isolation } from "../../src/isolation"
import { BlastRadius } from "../../src/session/blast-radius"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const sessionID = SessionID.make("ses_notebook_edit_test")

function notebook(source = "print('before')\n") {
  return {
    cells: [
      {
        cell_type: "code",
        execution_count: 1,
        id: "cell-one",
        metadata: {},
        outputs: [{ output_type: "stream", text: ["before\n"] }],
        source: [source],
      },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  }
}

function context(isolation: Isolation.State, ask: Tool.Context["ask"] = async () => {}): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    extra: { isolation },
    ask,
  }
}

afterEach(async () => {
  BlastRadius.reset(sessionID)
  await Instance.disposeAll()
})

describe("tool.notebook_edit", () => {
  test("replaces a cell through the guarded edit flow and reports its diff", async () => {
    await using tmp = await tmpdir({ git: true })
    const notebookPath = path.join(tmp.path, "analysis.ipynb")
    await fs.writeFile(notebookPath, JSON.stringify(notebook(), null, 1) + "\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const tool = await NotebookEditTool.init()
        const result = await tool.execute(
          {
            notebook_path: notebookPath,
            cell_index: 0,
            new_source: "print('after')\n",
          },
          context(isolation, async (request) => {
            requests.push(request)
          }),
        )

        const updated = JSON.parse(await fs.readFile(notebookPath, "utf8"))
        expect(updated.cells[0].source).toEqual(["print('after')\n", ""])
        expect(updated.cells[0].outputs).toEqual([])
        expect(updated.cells[0].execution_count).toBeNull()
        expect(result.metadata.cellCount).toBe(1)

        const editRequest = requests.find((request) => request.permission === "edit")
        expect(editRequest?.patterns).toEqual(["analysis.ipynb"])
        expect(editRequest?.metadata.diff).toContain("print('after')")
      },
    })
  })

  test("read-only isolation rejects the edit before reading or writing", async () => {
    await using tmp = await tmpdir({ git: true })
    const notebookPath = path.join(tmp.path, "analysis.ipynb")
    const original = JSON.stringify(notebook(), null, 1) + "\n"
    await fs.writeFile(notebookPath, original)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "read-only", network: false }, tmp.path, tmp.path)
        const tool = await NotebookEditTool.init()
        await expect(
          tool.execute(
            {
              notebook_path: notebookPath,
              cell_index: 0,
              new_source: "blocked",
            },
            context(isolation),
          ),
        ).rejects.toMatchObject({
          name: "IsolationDeniedError",
          reason: "write",
        })
        expect(await fs.readFile(notebookPath, "utf8")).toBe(original)
      },
    })
  })

  test("deletes a cell without requiring new_source", async () => {
    await using tmp = await tmpdir({ git: true })
    const notebookPath = path.join(tmp.path, "analysis.ipynb")
    await fs.writeFile(notebookPath, JSON.stringify(notebook(), null, 1) + "\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const tool = await NotebookEditTool.init()
        const result = await tool.execute(
          {
            notebook_path: notebookPath,
            cell_id: "cell-one",
            edit_mode: "delete",
          },
          context(isolation),
        )

        const updated = JSON.parse(await fs.readFile(notebookPath, "utf8"))
        expect(updated.cells).toEqual([])
        expect(result.metadata.cellCount).toBe(0)
      },
    })
  })

  test("removes code-only fields when converting a cell to markdown", async () => {
    await using tmp = await tmpdir({ git: true })
    const notebookPath = path.join(tmp.path, "analysis.ipynb")
    await fs.writeFile(notebookPath, JSON.stringify(notebook(), null, 1) + "\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const tool = await NotebookEditTool.init()
        await tool.execute(
          {
            notebook_path: notebookPath,
            cell_index: 0,
            cell_type: "markdown",
            new_source: "# Analysis",
          },
          context(isolation),
        )

        const [cell] = JSON.parse(await fs.readFile(notebookPath, "utf8")).cells
        expect(cell.cell_type).toBe("markdown")
        expect(cell).not.toHaveProperty("outputs")
        expect(cell).not.toHaveProperty("execution_count")
      },
    })
  })

  test("workspace-write isolation rejects an approved external notebook", async () => {
    await using project = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const notebookPath = path.join(outside.path, "outside.ipynb")
    const original = JSON.stringify(notebook(), null, 1) + "\n"
    await fs.writeFile(notebookPath, original)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, project.path, project.path)
        const tool = await NotebookEditTool.init()
        await expect(
          tool.execute(
            {
              notebook_path: notebookPath,
              cell_index: 0,
              new_source: "blocked",
            },
            context(isolation),
          ),
        ).rejects.toMatchObject({
          name: "IsolationDeniedError",
          reason: "write",
        })
        expect(await fs.readFile(notebookPath, "utf8")).toBe(original)
      },
    })
  })

  test("rejects a notebook changed while edit approval is pending", async () => {
    await using tmp = await tmpdir({ git: true })
    const notebookPath = path.join(tmp.path, "analysis.ipynb")
    await fs.writeFile(notebookPath, JSON.stringify(notebook(), null, 1) + "\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const tool = await NotebookEditTool.init()
        await expect(
          tool.execute(
            {
              notebook_path: notebookPath,
              cell_index: 0,
              new_source: "model edit",
            },
            context(isolation, async (request) => {
              if (request.permission === "edit") {
                await fs.writeFile(notebookPath, JSON.stringify(notebook("external edit\n"), null, 1) + "\n")
              }
            }),
          ),
        ).rejects.toThrow(/modified since it was last read|changed while edit approval was pending/)
        expect(await fs.readFile(notebookPath, "utf8")).toContain("external edit")
      },
    })
  })

  test("rejects fractional cell indices at schema validation", async () => {
    const tool = await NotebookEditTool.init()
    await expect(
      tool.execute(
        {
          notebook_path: path.resolve("analysis.ipynb"),
          cell_index: 0.5,
          new_source: "invalid",
        },
        context({
          mode: "workspace-write",
          network: false,
          protected: [],
        }),
      ),
    ).rejects.toThrow("invalid arguments")
  })
})
