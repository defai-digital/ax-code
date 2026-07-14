import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { buildSignArguments, normalizeThumbprint, resolveSigningConfiguration } =
  require("./sign-windows.cjs").__test

const signingEnv = {
  AZURE_CLIENT_ID: "client-id",
  AZURE_CLIENT_SECRET: "do-not-put-this-in-argv",
  AZURE_KEY_VAULT_CERTIFICATE: "cert-defai",
  AZURE_KEY_VAULT_URL: "https://keyvault-defai.vault.azure.net",
  AZURE_SIGNTOOL_PATH: "C:\\tools\\AzureSignTool.exe",
  AZURE_TENANT_ID: "tenant-id",
  WINDOWS_CERTIFICATE_SHA1: "FC:40:F1:10:99:12:C0:25:E7:51:E8:04:AA:9B:D1:53:8A:2D:12:EF",
  WINDOWS_SIGNING_REQUIRED: "true",
}

describe("Windows Azure Key Vault signing", () => {
  test("allows unsigned local builds when signing was not requested", () => {
    expect(resolveSigningConfiguration({})).toBeNull()
  })

  test("fails closed when release signing configuration is incomplete", () => {
    expect(() => resolveSigningConfiguration({ WINDOWS_SIGNING_REQUIRED: "true" })).toThrow(
      /AZURE_TENANT_ID.*AZURE_CLIENT_ID.*AZURE_CLIENT_SECRET/,
    )
  })

  test("normalizes and validates the pinned certificate thumbprint", () => {
    expect(normalizeThumbprint(signingEnv.WINDOWS_CERTIFICATE_SHA1)).toBe(
      "FC40F1109912C025E751E804AA9BD1538A2D12EF",
    )
    expect(() => normalizeThumbprint("not-a-thumbprint")).toThrow(/40-character/)
  })

  test("uses ambient Azure credentials without putting the client secret in arguments", () => {
    const config = resolveSigningConfiguration(signingEnv)
    const args = buildSignArguments("C:\\release\\AX Code.exe", config)

    expect(args).toContain("--azure-key-vault-managed-identity")
    expect(args).toContain("https://keyvault-defai.vault.azure.net/")
    expect(args).toContain("cert-defai")
    expect(args).toContain("http://timestamp.digicert.com")
    expect(args).toContain("C:\\release\\AX Code.exe")
    expect(args).not.toContain(signingEnv.AZURE_CLIENT_SECRET)
  })

  test("rejects non-Azure or non-HTTPS vault URLs", () => {
    expect(() => resolveSigningConfiguration({ ...signingEnv, AZURE_KEY_VAULT_URL: "http://example.com" })).toThrow(
      /HTTPS Azure Key Vault URL/,
    )
  })
})
