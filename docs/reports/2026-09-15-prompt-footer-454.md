# 输入框底部中断提示换行修复与测试报告

- 日期：2026-09-15
- 版本基线：AX Code 7.18.2
- 分支：`fix/windows-auto-upgrade-453`
- 修改前提交：`7c6d382c5bd473751a614b583310a5c66c784cc8`
- 问题：[GitHub #454](https://github.com/defai-digital/ax-code/issues/454)

## 结论

已修复忙碌状态下 `esc interrupt` 被其他内容挤压、折成多行的问题。相关 47 项单元测试、312 个原生终端渲染画面、TypeScript 类型检查均通过。旧布局对照测试成功复现提示换行，新组件在相同的宽度压力下保持单行。

## 原因与修改

旧布局用固定 36 列预留状态区域，但实际内容还包括动态状态、词元统计、速率和重试消息。左右两侧多个容器禁止收缩，而中断提示允许收缩和换行，空间不足时提示被压到很窄的区域。此外，快捷键宽度按字符串长度计算，低估中文等宽字符；部分预算文案与实际渲染的文案、快捷键和间距也不一致。

本次修改：

1. 忙碌状态使用独立的一行，右侧上下文信息和快捷键移到下方，避免与中断提示争抢横向空间。
2. 新增 `FooterStatusRow`，按主面板可用宽度为中断提示保留固定区域，长状态内容在自己的区域内裁剪；提示不换行。主面板宽度沿用已有侧栏宽度计算。
3. `KeyHint` 增加可选 `noWrap`，只对该中断提示启用。
4. 快捷键预算改用终端显示列宽，并匹配实际的 `effort` 文案、清空/退出快捷键以及两列间距。
5. 裁剪后的重试消息仍可通过点击打开完整错误；父会话空闲、仅子代理忙碌时继续隐藏不可用的中断提示。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `footer-layout`、`footer-animation`、`footer-view-model`、`prompt-liveness-view-model`、`prompt-escape-rewind`、`session-layout` | 6 个测试文件、47 项测试通过 |
| 原生渲染矩阵 | 13 种语言 × 3 种状态文本 × 8 次宽度变化，共 312 个画面通过 |
| 宽度变化 | 120 → 80 → 40 → 20 → 13 → 8 → 3 → 80 列，同一挂载组件实时缩放 |
| 状态文本 | 普通状态、长词元/速率统计、长重试错误 |
| 关键断言 | 空间足够时完整提示位于首行；极窄窗口仍保留 `esc`；提示不增加后续行；空闲父会话不显示中断提示 |
| 旧布局对照 | 在 20 列窗口中，以不可收缩的 15 列状态区域复现剩余提示换行 |
| TypeScript | `tsc -p packages/ax-code/tsconfig.json --noEmit` 通过 |
| 差异检查 | `git diff --check` 通过 |

## 重跑命令

从仓库根目录运行类型检查：

```powershell
node node_modules/@typescript/native/bin/tsc -p packages/ax-code/tsconfig.json --noEmit
```

在 `packages/ax-code` 目录运行相关单元测试：

```powershell
node ../../node_modules/vitest/vitest.mjs run test/cli/tui/footer-layout.test.ts test/cli/tui/footer-animation.test.ts test/cli/tui/footer-view-model.test.ts test/cli/tui/prompt-liveness-view-model.test.ts test/cli/tui/prompt-escape-rewind.test.ts test/cli/tui/session-layout.test.ts
```

在同一目录使用支持 `node:ffi` 的 Node 26+ 运行原生测试：

```powershell
pnpm run check:prompt-footer
```

若默认 Node 版本低于 26，先将 `AX_CODE_FFI_NODE` 设置为本机 Node 26+ 的可执行文件路径。本次原生测试使用 Node 26.8.1；测试创建临时用户状态目录并在结束后清理。

## 行为边界

忙碌状态会增加底部区域的纵向占用，长状态文本可能被裁剪。可用宽度小于完整中断提示时，优先显示 `esc`，标签按剩余空间裁剪；小于 3 列无法完整容纳 `esc` 本身。

原生测试挂载实际修复组件和主题提供器，用构造的状态与相邻底部内容验证布局；没有启动真实模型请求，也不代表完整交互会话的端到端测试。空闲状态下其他底部控件的整体排版不属于本次中断提示修复的验证范围。
