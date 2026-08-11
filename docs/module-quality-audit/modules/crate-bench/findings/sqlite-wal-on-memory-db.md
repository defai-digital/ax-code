# Finding: `PRAGMA journal_mode = WAL` against an in-memory SQLite is a no-op

| Field    | Value                                           |
| -------- | ----------------------------------------------- |
| Severity | LOW                                             |
| Category | correctness-of-measurement                      |
| Origin   | ax-code-glm (primary review, step 4)            |
| Status   | accepted                                        |
| Location | `crates/ax-code-bench/src/bench_index.rs:57-65` |

## Evidence

`open_db` opens the connection with `Connection::open_in_memory()` (`bench_index.rs:58`) and immediately runs:

```sql
PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000; PRAGMA cache_size = -64000;
```

SQLite ignores `journal_mode = WAL` for `:memory:` databases — in-memory DBs always use `journal_mode=memory` and the WAL pragma returns `memory` rather than `wal`. `synchronous` and `busy_timeout` are likewise moot on a single in-memory connection with no concurrent writer. The benchmark therefore does not exercise the same I/O path as production (`schema.rs` applies these pragmas to a file-backed DB).

## Impact

The `bulk insert`, `findByName`, `count`, and `ingest_file atomic` numbers are still internally useful for relative comparisons, but the absolute ns/op is not representative of file-backed production SQLite — readers of the bench report may over-estimate real throughput. The misleading pragma row also implies WAL was configured when it was not.

## Suggested action

Either (a) document at the call site that the pragmas are no-ops on `:memory:` and that the bench measures the in-memory hot path only (call the section `[SQLite Operations (in-memory, no WAL)]`), or (b) add a second `open_db_file()` variant that opens a `tempfile()`-backed connection so the WAL/synchronous pragmas take effect and the bench can characterize the disk-bound path too. At minimum, assert the pragma result so the bench fails loudly if WAL is silently dropped: `assert_eq!(conn.pragma_query_value(...), "wal")` for the file-backed variant.
