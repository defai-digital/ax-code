import type { CommandOption } from "@/context/command"

export const buildLayoutCommands = <Scheme extends string, Locale extends string>(input: {
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
  sidebarToggle: () => void
  chooseProject: () => void
  projectOffset: (offset: number) => void
  connectProvider: () => void
  openServer: () => void
  openSettings: () => void
  sessionOffset: (offset: number) => void
  unseenOffset: (offset: number) => void
  canArchive: boolean
  archive: () => void
  workspaceEnabled: boolean
  createWorkspace: () => void
  canToggleWorkspace: boolean
  toggleWorkspace: () => void
  cycleTheme: (offset: number) => void
  themes: readonly [string, string][]
  setTheme: () => void
  previewTheme: (id: string) => void
  cancelTheme: () => void
  cycleScheme: (offset: number) => void
  schemes: Scheme[]
  schemeLabel: (scheme: Scheme) => string
  setScheme: () => void
  previewScheme: (scheme: Scheme) => void
  cancelScheme: () => void
  cycleLanguage: (offset: number) => void
  locales: Locale[]
  localeLabel: (locale: Locale) => string
  setLocale: (locale: Locale) => void
}) => {
  const commands: CommandOption[] = [
    {
      id: "sidebar.toggle",
      title: input.t("command.sidebar.toggle"),
      category: input.t("command.category.view"),
      keybind: "mod+b",
      onSelect: input.sidebarToggle,
    },
    {
      id: "project.open",
      title: input.t("command.project.open"),
      category: input.t("command.category.project"),
      keybind: "mod+o",
      onSelect: input.chooseProject,
    },
    {
      id: "project.previous",
      title: input.t("command.project.previous"),
      category: input.t("command.category.project"),
      keybind: "mod+alt+arrowup",
      onSelect: () => input.projectOffset(-1),
    },
    {
      id: "project.next",
      title: input.t("command.project.next"),
      category: input.t("command.category.project"),
      keybind: "mod+alt+arrowdown",
      onSelect: () => input.projectOffset(1),
    },
    {
      id: "provider.connect",
      title: input.t("command.provider.connect"),
      category: input.t("command.category.provider"),
      onSelect: input.connectProvider,
    },
    {
      id: "server.switch",
      title: input.t("command.server.switch"),
      category: input.t("command.category.server"),
      onSelect: input.openServer,
    },
    {
      id: "settings.open",
      title: input.t("command.settings.open"),
      category: input.t("command.category.settings"),
      keybind: "mod+comma",
      onSelect: input.openSettings,
    },
    {
      id: "session.previous",
      title: input.t("command.session.previous"),
      category: input.t("command.category.session"),
      keybind: "alt+arrowup",
      onSelect: () => input.sessionOffset(-1),
    },
    {
      id: "session.next",
      title: input.t("command.session.next"),
      category: input.t("command.category.session"),
      keybind: "alt+arrowdown",
      onSelect: () => input.sessionOffset(1),
    },
    {
      id: "session.previous.unseen",
      title: input.t("command.session.previous.unseen"),
      category: input.t("command.category.session"),
      keybind: "shift+alt+arrowup",
      onSelect: () => input.unseenOffset(-1),
    },
    {
      id: "session.next.unseen",
      title: input.t("command.session.next.unseen"),
      category: input.t("command.category.session"),
      keybind: "shift+alt+arrowdown",
      onSelect: () => input.unseenOffset(1),
    },
    {
      id: "session.archive",
      title: input.t("command.session.archive"),
      category: input.t("command.category.session"),
      keybind: "mod+shift+backspace",
      disabled: !input.canArchive,
      onSelect: input.archive,
    },
    {
      id: "workspace.new",
      title: input.t("workspace.new"),
      category: input.t("command.category.workspace"),
      keybind: "mod+shift+w",
      disabled: !input.workspaceEnabled,
      onSelect: input.createWorkspace,
    },
    {
      id: "workspace.toggle",
      title: input.t("command.workspace.toggle"),
      description: input.t("command.workspace.toggle.description"),
      category: input.t("command.category.workspace"),
      slash: "workspace",
      disabled: !input.canToggleWorkspace,
      onSelect: input.toggleWorkspace,
    },
    {
      id: "theme.cycle",
      title: input.t("command.theme.cycle"),
      category: input.t("command.category.theme"),
      keybind: "mod+shift+t",
      onSelect: () => input.cycleTheme(1),
    },
  ]

  for (const [id, name] of input.themes) {
    commands.push({
      id: `theme.set.${id}`,
      title: input.t("command.theme.set", { theme: name }),
      category: input.t("command.category.theme"),
      onSelect: input.setTheme,
      onHighlight: () => {
        input.previewTheme(id)
        return () => input.cancelTheme()
      },
    })
  }

  commands.push({
    id: "theme.scheme.cycle",
    title: input.t("command.theme.scheme.cycle"),
    category: input.t("command.category.theme"),
    keybind: "mod+shift+s",
    onSelect: () => input.cycleScheme(1),
  })

  for (const scheme of input.schemes) {
    commands.push({
      id: `theme.scheme.${scheme}`,
      title: input.t("command.theme.scheme.set", { scheme: input.schemeLabel(scheme) }),
      category: input.t("command.category.theme"),
      onSelect: input.setScheme,
      onHighlight: () => {
        input.previewScheme(scheme)
        return () => input.cancelScheme()
      },
    })
  }

  commands.push({
    id: "language.cycle",
    title: input.t("command.language.cycle"),
    category: input.t("command.category.language"),
    onSelect: () => input.cycleLanguage(1),
  })

  for (const locale of input.locales) {
    commands.push({
      id: `language.set.${locale}`,
      title: input.t("command.language.set", { language: input.localeLabel(locale) }),
      category: input.t("command.category.language"),
      onSelect: () => input.setLocale(locale),
    })
  }

  return commands
}
