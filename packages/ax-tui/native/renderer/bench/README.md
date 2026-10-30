# AX TUI Benchmarks

This directory contains benchmarks for the AX TUI core library.

## Running Benchmarks

From this repository's `native/renderer` directory, with Zig 0.15.2:

```bash
zig build bench -Doptimize=ReleaseFast
zig build bench -Doptimize=ReleaseFast -- --mem
```

Pass `-Dmacos-sdk=/path/to/MacOSX.sdk` when required by the host toolchain.
See the root `MAINTENANCE.md` for compiler and SDK setup.

## Adding New Benchmarks

To add a new benchmark:

1. Create a new `*_bench.zig` file in the `bench/` directory
2. Import shared types from `bench-utils.zig`:
   ```zig
   const bench_utils = @import("../bench-utils.zig");
   const BenchResult = bench_utils.BenchResult;
   const MemStats = bench_utils.MemStats;
   ```
3. Implement a `pub fn run(allocator: std.mem.Allocator, show_mem: bool) ![]BenchResult` function:
   - Set up any benchmark-specific dependencies (grapheme pool, Unicode data, etc.)
   - Run your benchmarks and collect results
   - Return a slice of `BenchResult` (caller will free it)
   - The `show_mem` flag indicates whether to include memory statistics
4. Import it in `bench.zig`:
   ```zig
   const my_new_bench = @import("bench/my_new_bench.zig");
   ```
5. Call it and print results in `main()`:
   ```zig
   const my_results = try my_new_bench.run(allocator, show_mem);
   defer allocator.free(my_results);
   try bench_utils.printResults(stdout, my_results);
   ```

Each benchmark manages its own dependencies, so you only set up what you need.

See `bench/text-buffer-view_bench.zig` for a complete example.
