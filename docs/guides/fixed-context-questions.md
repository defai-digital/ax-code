# Questions about fixed source files

Status: Current source
Scope: AX Trust fixed-context question command
Last reviewed: 2026-09-18
Owner: AX Code runtime maintainers

Use `ax-code ask` to ask a standalone question about explicitly selected code or
documentation through an existing AX Trust connection:

```bash
ax-code ask --file src/value.py \
  --model defai-01-ax-trust-com/openai/gpt-oss-120b \
  "What does this function return?"
```

Replace the provider/model with an authorized model on your AX Trust connection.
The command reads the file again on every invocation, supplies its complete
contents as fixed context, and adds the gateway's semantic-cache contract. You
do not need to add headers or install embeddings. AX Trust must have the feature
enabled for your pool and runtime; otherwise it can return an ordinary answer.

Ask a paraphrase with the same files and options:

```bash
ax-code ask --file src/value.py \
  --model defai-01-ax-trust-com/openai/gpt-oss-120b \
  "What does the function return?"
```

The answer goes to stdout; stderr reports `AX Trust cache: MISS`, `HIT`,
`EXACT_HIT`, `BYPASS` or `UNREPORTED`. `HIT` means the gateway reported semantic
reuse; `EXACT_HIT` means its exact namespace matched. `UNREPORTED` means the server
did not provide a recognized cache header. A bypass is not retried to force a hit.
Add `--format json` for answer, provider/model identity, context digest, cache
status, optional request ID/score and usage when actually reported by upstream.
Cached responses need not include usage; absent usage is not a savings estimate.

Repeat `--file` to include additional context:

```bash
ax-code ask --file src/value.py --file docs/value.md \
  --model defai-01-ax-trust-com/openai/gpt-oss-120b \
  --max-tokens 1024 --format json \
  "How is the return value determined?"
```

Select all dependencies needed to answer the question. The command sends no
conversation history, discovered repository instructions, tools, search results
or test execution. It does not edit files or run commands. A new invocation reads
current bytes; changed code or options produce different fixed context. A file
may change after it was read, so the answer describes the supplied snapshot.
Use normal `ax-code run` or the TUI for live investigation, edits and tests.

Limits: 1-14 distinct regular UTF-8 files inside the current directory tree,
96 KiB combined file content, and 128 KiB after request encoding. Context is
never truncated. Symlinks cannot escape the directory. Read permissions for the
configured default agent apply; a deny or an unresolved ask stops before model
transport. Select permitted files or use a normal session with approval.

The question must be one line, at most 1024 UTF-8 bytes. Put inline code in files,
not in the question. The output limit is 1-4096 tokens, default 512; temperature
is fixed at zero. Requests are non-streaming, have a 90-second deadline and do
not fall back to a different model. Incomplete or actionable responses are
rejected. Similar questions can still have different meanings: opt in only for
questions whose answer depends on the selected fixed content.
