const std = @import("std");

fn module(b: *std.Build, target: std.Build.ResolvedTarget, kernel_path: []const u8, utf8_path: []const u8, fields: []const []const u8) *std.Build.Module {
    const uucode = b.dependency("uucode", .{
        .target = target,
        .optimize = @as(std.builtin.OptimizeMode, .ReleaseFast),
        .fields = fields,
    }).module("uucode");
    const utf8 = b.createModule(.{
        .root_source_file = .{ .cwd_relative = utf8_path },
        .target = target,
        .optimize = .ReleaseFast,
        .imports = &.{.{ .name = "uucode", .module = uucode }},
    });
    return b.createModule(.{
        .root_source_file = .{ .cwd_relative = kernel_path },
        .target = target,
        .optimize = .ReleaseFast,
        .imports = &.{.{ .name = "utf8", .module = utf8 }},
    });
}

pub fn build(b: *std.Build) void {
    const kernel_path = b.option([]const u8, "kernel", "Experiment source") orelse @panic("Missing kernel path");
    const utf8_path = b.option([]const u8, "utf8", "Production UTF-8 source") orelse @panic("Missing UTF-8 path");
    const fields = b.option([]const []const u8, "fields", "Production Unicode table fields") orelse @panic("Missing Unicode fields");
    const native = b.addLibrary(.{
        .name = "ax-tui-text-width",
        .linkage = .dynamic,
        .root_module = module(b, b.graph.host, kernel_path, utf8_path, fields),
    });
    b.installArtifact(native);
    const wasm = b.addExecutable(.{
        .name = "ax-tui-text-width",
        .root_module = module(b, b.resolveTargetQuery(.{
            .cpu_arch = .wasm32,
            .os_tag = .freestanding,
            .cpu_features_add = std.Target.wasm.featureSet(&.{.simd128}),
        }), kernel_path, utf8_path, fields),
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    wasm.stack_size = 256 * 1024;
    wasm.max_memory = 16 * 1024 * 1024;
    b.installArtifact(wasm);
}
