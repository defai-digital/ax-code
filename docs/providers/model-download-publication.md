# Updating the model download page

Status: Active
Scope: current-state
Last reviewed: 2026-10-19
Owner: ax-code runtime

The [model download page](ax-code-model-downloads.md) is generated from collection observations in `docs/data/ax-code-model-downloads.json` and reviewed mirror receipts in `docs/data/ax-code-model-mirrors.json`.

After a successful upload and update of the `AutomatosX/ax-code` Hugging Face collection, the publisher should notify AX Code:

```bash
gh api --method POST repos/defai-digital/ax-code/dispatches \
  -f event_type=ax-code-collection-updated
```

Use the publisher's existing GitHub App or repository credential with the required repository-dispatch permission. Do not reuse an HF token for GitHub. Send the event only after the published files and collection update are verified. No model names, URLs, credentials or executable commands are accepted from the event payload; the workflow reads the fixed official collection itself.

The `model-downloads` workflow also runs daily and can be started manually. It generates a validated reviewable PR using the existing models App configuration. When the App is not configured, the workflow retains the validated patch artifact for manual review. Unchanged inventories do not request write credentials. Merging the PR and exporting the approved public docs snapshot publishes the page through the normal documentation release process. A dispatch does not itself publish the website or change runtime model support.

Local maintenance commands:

```bash
pnpm --dir packages/ax-code exec tsx script/model-download-docs.ts --refresh
pnpm --dir packages/ax-code exec tsx script/model-download-docs.ts --check
```

Without `--refresh`, generation and checking use only checked-in data. The runtime catalog refresh also updates this page. New collection members appear as pending review until the runtime's own reviewed selection changes. Repeated observations of unchanged metadata preserve the previous timestamp, avoiding empty daily proposals.

Add R2 records only after redistribution review and exact-byte verification. Each record requires the source repository and exact commit, a production HTTPS manifest URL, detached signature URL, manifest SHA-256, public verification receipt URL and verification time. Links must use the approved download hosts. A mirror for another revision is shown as unavailable for the current model. Never infer R2 availability from the HF upload alone, and never overwrite a versioned manifest or receipt.

Page publication does not change the runtime download source or publish model weights. Review mirror availability and native compatibility separately before recommending a download to users.
