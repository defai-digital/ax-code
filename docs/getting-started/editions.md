# AX Code Standard and Business

Status: Active product direction; Business is planned
Scope: current-state
Last reviewed: 2026-09-16
Owner: ax-code runtime

AX Code Standard is the open-source coding workspace. AX Code Business is the planned,
separately licensed proprietary offering for organizations that need managed AI access,
central records, and connected business workflows. v8.0 is upcoming; this page describes
the edition direction, not a statement that Business features have shipped.

## Which edition should I choose?

Choose **Standard** to work on your own projects or with a team using local or cloud
models. It is free for both personal and commercial use under Apache-2.0, subject to
that license and the notices for included upstream code. A company can use Standard
without purchasing Business. Model-provider charges and hardware costs are separate.

Discuss **Business** when your organization needs to manage developers' AI access,
agree where shared records are retained, or connect development to internal approvals
and systems. Business pricing, deployment requirements, and availability will be
announced separately. Contact us through [AutomatosX](https://automatosx.com/#contactForm).

| Area | Standard | Business direction (planned) |
| --- | --- | --- |
| License | Open source, Apache-2.0 with upstream notices | Separate commercial license for proprietary Business components |
| Coding workspace | CLI/TUI, local and cloud models, code changes and review | Same core workspace with organization integrations |
| Local inference | AX Engine on supported Apple Silicon Macs and other supported runtimes | Organization-approved models and deployment configurations |
| Safety | Core permissions, isolation capabilities, and change review | Organization policies and managed access in addition to core safeguards |
| Records | Existing local session evidence, snapshots, and export capabilities | Central retention, organization access controls, and managed audit workflows |
| AX Trust | Provider connectivity where supported | Organization identity, credentials, policy, and AI access management |
| AutomatosX | Existing integration interfaces where supported | Internal workflows, approvals, and business-system connections |
| Support | Public documentation and community channels when accessible | Deployment assistance and contracted support |

Existing runtime capabilities remain part of Standard. Local evidence, audit exports,
basic safety, and ordinary performance are not being moved behind a Business paywall.
An available integration interface does not establish that a complete Business workflow
has been implemented or qualified.

## Local models and company data

AX Code targets Apple Silicon macOS, Windows x64/ARM64, and Ubuntu 24.04+ amd64/arm64.
AX Engine's native local inference path is specific to supported Apple Silicon Macs.
The model and runtime determine hardware needs and tool compatibility.

For Standard, the aim is an approachable local-model workflow with reviewable changes.
For Business, the aim is to connect that work to AX Trust governance and AutomatosX
workflows: for example, a proposed fix, project validation, approval, retained evidence,
and an update to an internal system. That end-to-end example is a product direction,
not an available automated workflow promised by this document.

Record storage and model routing are separate decisions. Keeping records in a company
system does not automatically stop cloud providers, external tools, or network commands
from receiving data. A Business deployment must define both paths.

## Open core, separate Business components

Standard remains independently buildable and usable without proprietary Business
modules. Business components are intended to be maintained separately against shared
interfaces instead of creating a second, diverging coding runtime.

Rust may be used for appropriate proprietary Business components. Compiling a component
in Rust does not itself provide a security or licensing boundary. Organization-side
services must enforce access to their credentials, records, and protected capabilities;
a client-side toggle is not sufficient. These are intended product boundaries, not a
claim that a private Rust Business package is already available.

The existing [Apache-2.0 license](../../LICENSE), [MIT license](../../LICENSE-MIT), and
[NOTICE](../../NOTICE) remain applicable to this repository. The Business direction does
not revoke the licenses of previously distributed code or relicense upstream work.

## Availability and installation

Public source and download availability are separate from the license choice. As of
2026-09-16, the original AX Code GitHub repository is private and anonymous requests for
its release installers return 404. The public Homebrew formula also points at those
unavailable release assets. Announcing open-source Standard does not by itself restore
that access.

See the [website installation guide](https://ax-code.app/en/download/) for public
installation updates and the [runtime guide](install-runtime.md) for channel details.
Do not treat the existing GitHub commands as usable public downloads until access is
restored or a replacement distribution channel is verified.

Computer use (CUA) is planned for v8.1. It is not part of the v8.0 launch promise;
edition coverage and platform availability will be announced with that release.
