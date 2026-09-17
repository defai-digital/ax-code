# Windows runtime integrity and antivirus reports

Status: Current source; release qualification pending
Scope: Windows CLI installation, update verification, and operator diagnostics
Last reviewed: 2026-09-17
Owner: AX Code runtime maintainers

AX Code uses separate controls for publisher identity, distribution integrity,
installed-file verification, and antivirus qualification. None is a guarantee
that a behavioral antivirus engine will accept every operation.

## Release and update verification

Windows CLI release builds sign previously unsigned PE files using the project's
Azure Key Vault certificate, require valid signatures and timestamps, and audit
the expected DEFAI certificate on first-party native modules. The bundled Node
executable must retain a valid OpenJS/Node.js Foundation signature. Invalid
existing signatures fail the build; they are not repaired by re-signing.

The release publisher creates `runtime-integrity.json` after native signing,
covering the final JavaScript and native payload bytes. Its detached Minisign
signature is included in the ZIP before the final archive is signed. The older
`runtime-manifest.json` remains a non-native Desktop staging contract; it is not
the installed runtime's trust anchor.

The Windows installer verifies the archive before extraction, then authenticates
the integrity manifest and verifies the payload before executing the candidate.
It checks staged copies again and keeps the metadata in the installed runtime.
Older signed releases without this metadata remain installable with an explicit
legacy diagnostic. An invalid manifest or signature is never treated as a legacy
release. The existing explicit signature-verification opt-out also disables
manifest authentication with a warning; hash comparisons still run and do not
establish publisher trust in that mode. Existing installation locks, versioned generations, and rollback remain
in effect.

Self-updates verify the versioned installer script's Minisign signature using the
pinned release public key before executing it, on Windows and Unix. SHA-256
sidecars remain an additional corruption check. Missing signatures fail closed;
they do not fall back to unsigned execution.

These checks protect installation and update admission. They do not enforce
signature validation on every Node module load, and they do not prevent a local
attacker with write access from replacing the launcher or verifier. A separately
signed native launcher would be an additional control, not a prerequisite for
verifying downloaded updates.

## Antivirus qualification

The Windows Installer Qualification workflow tests x64 and ARM64 installation
and rollback. Its manual `defender_scan` input additionally requires enabled
Defender protection, scans the installed runtime without scan-triggered
remediation, and records engine/database versions, file hashes, and scanner
output. An unavailable scanner fails this requested check. This is a Defender
scan snapshot, not evidence of Kaspersky compatibility.

For Kaspersky behavioral qualification, use an isolated Windows VM with current
protection and no exclusions. Record the exact AX Code artifact/version and hash,
Windows build, Kaspersky product/engine/database versions, and settings. Exercise
fresh install, TUI startup, Enter and Shift+Enter, a normal shell/PTY operation,
update while another session remains open, rollback, and uninstall. Capture the
detection event and process ancestry. Retest the same scenario after a change;
changing packaging without a reproducer does not establish a fix.

Kaspersky's [false-detection guidance](https://support.kaspersky.com/viruses/answers/1870)
requests a GSI report for Windows PDM detections. Developers can evaluate the
[Kaspersky Allowlist Program](https://www.kaspersky.com/partners/allowlist-program)
for proactive software review. Keep submissions limited to the relevant public
release files and reviewed diagnostic evidence. Filing a request is not a clean
verdict, and a clean static scan is not behavioral acceptance.

Do not disable protection, add broad installation-directory exclusions, or
restore quarantined files automatically as a product workaround.
