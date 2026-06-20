import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { AccountID, Account, OrgID, PollExpired, type PollResult } from "@/account"
import open from "open"

const openBrowser = (url: string) => open(url).catch(() => undefined)

const println = (msg: string) => UI.println(msg)

const select = async <Value>(opts: Parameters<typeof prompts.select<Value>>[0]) => {
  const result = await prompts.select(opts)
  return prompts.isCancel(result) ? undefined : result
}

const dim = (value: string) => UI.Style.TEXT_DIM + value + UI.Style.TEXT_NORMAL

const activeSuffix = (isActive: boolean) => (isActive ? dim(" (active)") : "")

export const formatAccountLabel = (account: { email: string; url: string }, isActive: boolean) =>
  `${account.email} ${dim(account.url)}${activeSuffix(isActive)}`

const formatOrgChoiceLabel = (account: { email: string }, org: { name: string }, isActive: boolean) =>
  `${org.name} (${account.email})${activeSuffix(isActive)}`

export const formatOrgLine = (
  account: { email: string; url: string },
  org: { id: string; name: string },
  isActive: boolean,
) => {
  const dot = isActive ? UI.Style.TEXT_SUCCESS + "●" + UI.Style.TEXT_NORMAL : " "
  const name = isActive ? UI.Style.TEXT_HIGHLIGHT_BOLD + org.name + UI.Style.TEXT_NORMAL : org.name
  return `  ${dot} ${name}  ${dim(account.email)}  ${dim(account.url)}  ${dim(org.id)}`
}

const isActiveOrgChoice = (
  active: { id: AccountID; active_org_id: OrgID | null } | undefined,
  choice: { accountID: AccountID; orgID: OrgID },
) => active !== undefined && active.id === choice.accountID && active.active_org_id === choice.orgID

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function pollUntilAuthorized(login: Awaited<ReturnType<typeof Account.login>>): Promise<PollResult> {
  let waitMs = Account.durationToMillis(login.interval)
  const deadline = Date.now() + Account.durationToMillis(login.expiry)

  while (true) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return new PollExpired()

    await sleep(Math.min(waitMs, remainingMs))
    if (Date.now() >= deadline) return new PollExpired()

    const result = await Account.poll(login)
    if (result._tag === "PollPending") continue
    if (result._tag === "PollSlow") {
      waitMs += 5_000
      continue
    }
    return result
  }
}

async function loginCommand(url: string) {
  prompts.intro("Log in")
  const login = await Account.login(url)

  prompts.log.info("Go to: " + login.url)
  prompts.log.info("Enter code: " + login.user)
  await openBrowser(login.url)

  const s = prompts.spinner()
  s.start("Waiting for authorization...")

  const result = await pollUntilAuthorized(login)
  switch (result._tag) {
    case "PollSuccess":
      s.stop("Logged in as " + result.email)
      prompts.outro("Done")
      return
    case "PollExpired":
      s.error("Device code expired")
      return
    case "PollDenied":
      s.error("Authorization denied")
      return
    case "PollError":
      s.error("Error: " + String(result.cause))
      return
    case "PollPending":
    case "PollSlow":
      s.error("Unexpected state")
      return
  }
}

async function logoutCommand(email?: string) {
  const accounts = await Account.list()
  if (accounts.length === 0) return println("Not logged in")

  if (email) {
    const match = accounts.find((a) => a.email === email)
    if (!match) return println("Account not found: " + email)
    await Account.remove(match.id)
    prompts.outro("Logged out from " + email)
    return
  }

  const active = await Account.active()
  const activeID = active?.id

  prompts.intro("Log out")

  const opts = accounts.map((a) => {
    const isActive = activeID === a.id
    return {
      value: a,
      label: formatAccountLabel(a, isActive),
    }
  })

  const selected = await select({ message: "Select account to log out", options: opts })
  if (!selected) return

  await Account.remove(selected.id)
  prompts.outro("Logged out from " + selected.email)
}

interface OrgChoice {
  orgID: OrgID
  accountID: AccountID
  label: string
}

async function switchCommand() {
  const groups = await Account.orgsByAccount()
  if (groups.length === 0) return println("Not logged in")

  const active = await Account.active()

  const opts = groups.flatMap((group) =>
    group.orgs.map((org) => {
      const isActive = isActiveOrgChoice(active, { accountID: group.account.id, orgID: org.id })
      return {
        value: { orgID: org.id, accountID: group.account.id, label: org.name },
        label: formatOrgChoiceLabel(group.account, org, isActive),
      }
    }),
  )
  if (opts.length === 0) return println("No orgs found")

  prompts.intro("Switch org")

  const choice = await select<OrgChoice>({ message: "Select org", options: opts })
  if (!choice) return

  await Account.use(choice.accountID, choice.orgID)
  prompts.outro("Switched to " + choice.label)
}

async function orgsCommand() {
  const groups = await Account.orgsByAccount()
  if (groups.length === 0) return println("No accounts found")
  if (!groups.some((group) => group.orgs.length > 0)) return println("No orgs found")

  const active = await Account.active()

  for (const group of groups) {
    for (const org of group.orgs) {
      const isActive = isActiveOrgChoice(active, { accountID: group.account.id, orgID: org.id })
      println(formatOrgLine(group.account, org, isActive))
    }
  }
}

async function openCommand() {
  const active = await Account.active()
  if (!active) return println("No active account")

  const url = active.url
  await openBrowser(url)
  prompts.outro("Opened " + url)
}

export const LoginCommand = cmd({
  command: "login <url>",
  describe: false,
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "server URL",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    UI.empty()
    await loginCommand(args.url)
  },
})

export const LogoutCommand = cmd({
  command: "logout [email]",
  describe: false,
  builder: (yargs) =>
    yargs.positional("email", {
      describe: "account email to log out from",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    await logoutCommand(args.email)
  },
})

export const SwitchCommand = cmd({
  command: "switch",
  describe: false,
  async handler() {
    UI.empty()
    await switchCommand()
  },
})

export const OrgsCommand = cmd({
  command: "orgs",
  describe: false,
  async handler() {
    UI.empty()
    await orgsCommand()
  },
})

export const OpenCommand = cmd({
  command: "open",
  describe: false,
  async handler() {
    UI.empty()
    await openCommand()
  },
})

export const ConsoleCommand = cmd({
  command: "console",
  describe: false,
  builder: (yargs) =>
    yargs
      .command({
        ...LoginCommand,
        describe: "log in to console",
      })
      .command({
        ...LogoutCommand,
        describe: "log out from console",
      })
      .command({
        ...SwitchCommand,
        describe: "switch active org",
      })
      .command({
        ...OrgsCommand,
        describe: "list orgs",
      })
      .command({
        ...OpenCommand,
        describe: "open active console account",
      })
      .demandCommand(),
  async handler() {},
})
