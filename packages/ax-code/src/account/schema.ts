type Brand<T, Name extends string> = T & { readonly __brand: Name }

function stringBrand<Name extends string>() {
  return {
    make: (value: string) => value as Brand<string, Name>,
  }
}

export type AccountID = Brand<string, "AccountID">
export const AccountID = stringBrand<"AccountID">()

export type OrgID = Brand<string, "OrgID">
export const OrgID = stringBrand<"OrgID">()

export type AccessToken = Brand<string, "AccessToken">
export const AccessToken = stringBrand<"AccessToken">()

export type RefreshToken = Brand<string, "RefreshToken">
export const RefreshToken = stringBrand<"RefreshToken">()

export type DeviceCode = Brand<string, "DeviceCode">
export const DeviceCode = stringBrand<"DeviceCode">()

export type UserCode = Brand<string, "UserCode">
export const UserCode = stringBrand<"UserCode">()

export interface Info {
  id: AccountID
  email: string
  url: string
  active_org_id: OrgID | null
}

export interface Org {
  id: OrgID
  name: string
}

export class AccountRepoError extends Error {
  readonly _tag = "AccountRepoError"
  override readonly cause?: unknown

  constructor(input: { message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause })
    this.name = "AccountRepoError"
    this.cause = input.cause
  }
}

export class AccountServiceError extends Error {
  readonly _tag = "AccountServiceError"
  override readonly cause?: unknown

  constructor(input: { message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause })
    this.name = "AccountServiceError"
    this.cause = input.cause
  }
}

export type AccountError = AccountRepoError | AccountServiceError

export class Login {
  readonly code: DeviceCode
  readonly user: UserCode
  readonly url: string
  readonly server: string
  readonly expiry: number
  readonly interval: number

  constructor(input: {
    code: DeviceCode
    user: UserCode
    url: string
    server: string
    expiry: number
    interval: number
  }) {
    this.code = input.code
    this.user = input.user
    this.url = input.url
    this.server = input.server
    this.expiry = input.expiry
    this.interval = input.interval
  }
}

export class PollSuccess {
  readonly _tag = "PollSuccess"
  readonly email: string

  constructor(input: { email: string }) {
    this.email = input.email
  }
}

export class PollPending {
  readonly _tag = "PollPending"
}

export class PollSlow {
  readonly _tag = "PollSlow"
}

export class PollExpired {
  readonly _tag = "PollExpired"
}

export class PollDenied {
  readonly _tag = "PollDenied"
}

export class PollError {
  readonly _tag = "PollError"
  readonly cause: unknown

  constructor(input: { cause: unknown }) {
    this.cause = input.cause
  }
}

export type PollResult = PollSuccess | PollPending | PollSlow | PollExpired | PollDenied | PollError
