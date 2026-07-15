import React, { act } from "react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, type Root } from "react-dom/client"

import { I18nProvider } from "@/lib/i18n"
import { ProjectSwitcher } from "./ProjectSwitcher"

const projects = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
]

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")

describe("ProjectSwitcher", () => {
  let container: HTMLDivElement
  let root: Root
  let onSelect = vi.fn<(projectId: string) => void>()
  let onAddProject = vi.fn<() => void>()

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onSelect = vi.fn<(projectId: string) => void>()
    onAddProject = vi.fn<() => void>()

    act(() => {
      root.render(
        <I18nProvider>
          <ProjectSwitcher
            projects={projects}
            selectedProjectId="alpha"
            renderLabel={(project) => project.label}
            getSearchText={(project) => project.label}
            onSelect={onSelect}
            onAddProject={onAddProject}
          />
        </I18nProvider>,
      )
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView)
    else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  const open = () => {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Switch project"]')
    expect(trigger).not.toBeNull()
    act(() => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  }

  const setSearch = (value: string) => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Search projects"]')
    expect(input).not.toBeNull()
    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      descriptor?.set?.call(input, value)
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new Event("change", { bubbles: true }))
    })
  }

  test("filters project choices and selects the matching project", () => {
    open()
    expect(document.body.textContent).toContain("Alpha")
    expect(document.body.textContent).toContain("Beta")

    setSearch("beta")
    const projectItems = [...document.querySelectorAll<HTMLElement>('[cmdk-item]')].filter(
      (item) => !item.textContent?.includes("Add project"),
    )
    expect(projectItems.map((item) => item.textContent)).toEqual(["Beta"])

    const beta = projectItems.find((item) => item.textContent?.includes("Beta"))
    expect(beta).toBeDefined()
    act(() => {
      beta?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith("beta")
  })

  test("shows an explicit empty state without hiding the add-project action", () => {
    open()
    setSearch("missing")

    expect(document.body.textContent).toContain("No projects found")
    const addProject = [...document.querySelectorAll<HTMLElement>('[cmdk-item]')].find((item) =>
      item.textContent?.includes("Add project"),
    )
    expect(addProject).toBeDefined()
    act(() => {
      addProject?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onAddProject).toHaveBeenCalledTimes(1)
  })
})
