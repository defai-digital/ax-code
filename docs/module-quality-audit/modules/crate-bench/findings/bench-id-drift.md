# Finding: bench_index `gen_id` drifts from production `id::ascending`

| Field    | Value                                                                                     |
| -------- | ----------------------------------------------------------------------------------------- |
| Severity | MEDIUM                                                                                    |
| Category | correctness-of-measurement                                                                |
| Origin   | ax-code-glm (primary review, step 3)                                                      |
| Status   | accepted                                                                                  |
| Location | `crates/ax-code-bench/src/bench_index.rs:32-45` vs `crates/ax-code-index/src/id.rs:33-95` |

## Evidence

The benchmark inlines a simplified `gen_id()` that diverges from the production hot path in three material ways:

1. **Modulo bias** — bench uses `BASE62[(rng.random::<u8>() % 62) as usize]` (`bench_index.rs:42`). Production `random_base62` in `id.rs:35-44` uses rejection sampling with `limit = 248` specifically to remove this bias. The bench therefore measures a _different_ (and cheaper) random-byte path than the one that runs in production.
2. **Missing atomic CAS** — production `ascending` (`id.rs:88-95`) goes through `reserve_timestamp_counter` (`id.rs:69-86`), a `compare_exchange` loop on the `LAST_ID_STATE` atomic with `yield_now()` back-off. The bench has no atomic, no counter, no back-off — so the reported `ascending ID` ns/op does not include the synchronization cost that real concurrent callers pay.
3. **Sort-key packing** — production packs `(ts << 8) | cnt` via `encode_sort_key` (`id.rs:97-106`); the bench's `hex` closure (`bench_index.rs:38-40`) only encodes the raw timestamp with no counter bits.

## Impact

The headline `ascending ID` number in the bench report understates the cost of the real `id::ascending` function under contention, and the random byte generation it times is not the rejection-sampled path shipped to users. Perf regressions in `reserve_timestamp_counter` (e.g., a tighter CAS loop, counter-overflow handling) would not be caught.

## Suggested action

Either (a) call the real `ax_code_index::id::ascending("code_node")` from the bench by adding `ax-code-index` as a `dev-dependency` / path dep and benching through the public API, or (b) if the goal is purely to characterize the building blocks, rename the bench to `id building blocks (no CAS, biased sample)` and document the divergence at the call site so the printed number is not misread as the production ID cost.
