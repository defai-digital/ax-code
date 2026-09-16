# Issue #460：Windows Bash 重定向生成真实 nul 文件

- 日期：2026-09-15
- Issue：[#460](https://github.com/defai-digital/ax-code/issues/460)
- 分支：[fix/windows-auto-upgrade-453](https://github.com/defai-digital/ax-code/tree/fix/windows-auto-upgrade-453)
- 本次改动前的分支提交：`8bd9c0b84821dea3377daf9eea1bb6e58e2c3cc4`
- 相关跟踪：[#453](https://github.com/defai-digital/ax-code/issues/453) 为同分支的 Windows 安装升级修复；本报告关注命令执行产生保留名称文件。

## 结论

本次修复的最终五个相关测试套件 **88 项通过、0 失败、1 项非 Windows 测试跳过**。TypeScript 类型检查、修改的 TypeScript 文件格式检查和 `git diff --check` 均通过。

额外启用的完整 `bash.test.ts` 集成套件并非全绿：修改前后均为 **124 通过、21 失败、1 跳过**，失败名称一致。相关基线限制单独记录在下文，不将这些失败计为通过。

## 问题证据

只读查询原会话记录发现，AX Code 的 bash 工具在 2026-09-15 19:18:46.454 UTC 执行了：

```text
cmd /c type TEST.txt 2>nul & echo ---END---
```

工作目录是用户的 Test2 项目。`nul` 文件创建时间为 19:18:47.095 UTC，比命令记录晚约 0.64 秒。工具返回码为 0，记录的输出只有 `---END---`。原文件当前为 140 字节，按 Windows 中文编码解码后，是“过程试图写入的管道不存在。”重复五次。后续快照日志明确将它列入不支持的 Windows 路径。

在独立临时目录、Windows Git Bash 下执行相同命令，确认创建了真实的 `nul` 文件，且返回码仍为 0。该次隔离复现产生的是空文件，没有复现原文件后来累积的 140 字节错误文本；测试只清理自身临时文件，未操作用户原文件。

原会话的 Shell 选择日志已不可用，因此不将历史 Shell 路径作为已直接验证的事实。持久化命令、创建时间、用户确认和 Git Bash 隔离复现共同确定了这条故障路径。

## 根因

`2>nul` 和 `&` 未被包含在内层 CMD 命令的引号中，由外层 Shell 解析。Git Bash 把 `nul` 当作普通重定向文件名，把 `&` 当作后台执行符；命令以 `cmd /c` 开头并不会改变这些规则。原来的 bash 工具路径检查允许这个目标，模型可见的描述也未明确实际配置的 Shell。

Windows 保留名称不适合普通 Git 快照操作。快照排除文件并提示覆盖不完整，是发现异常后的保护措施；隐藏提示不能修复产生文件的命令。

## 改动

1. 对 Windows 上使用 Bash/sh/dash/zsh/ksh 的静态重定向目标，复用快照的 Windows 路径规则，在启动进程前拒绝保留名称及其他不支持的名称。
2. 对原始 Shell 字面量解码后检查，覆盖大小写、引号、拼接、转义、相对路径和扩展名形式。
3. 检查外层重定向，以及现有命令检查流程已解析的 `sh -c` / `bash -c` / `eval` 内层重定向。前台和后台执行共享检查。
4. 错误信息说明外层 Shell 解析规则，提示保留输出或使用 `/dev/null`，不静默改写命令。
5. 普通模型及 AX Engine 的工具描述均显示实际 Shell，并说明 Windows 上 POSIX 重定向与 CMD 的差别。
6. 修正一个已有权限测试的 Windows 路径写法：将文件参数转换为带引号的 Shell 字面量，避免反斜杠被 Bash 吞掉。该测试在修改前代码上同样失败；没有改变权限实现或断言。

## 验证

环境：Windows x64、Node 26.8.1、Git for Windows Bash。集成测试调用真实 `BashTool.execute`，使用隔离临时项目。

| 检查                                          | 结果                                                           |
| --------------------------------------------- | -------------------------------------------------------------- |
| 最终五个相关套件                              | 88 通过，0 失败，1 跳过                                        |
| 原命令及八个变体，逐一验证前台和后台模式      | 执行前拒绝；前置标记文件与保留名称文件均未创建；未触发权限询问 |
| `/dev/null`、普通输出文件、作为文本的 `2>nul` | 正常执行，不创建 `nul`                                         |
| 普通模型及 AX Engine 工具描述                 | 正确显示 Shell 和重定向指导                                    |
| 原生 CMD / 非 Windows 名称判断                | 不因新增检查改变处理行为                                       |
| TypeScript、Prettier、diff 空白检查           | 通过                                                           |

最终套件为 `bash-windows-redirect`、`bash-helpers`、`bash-permissions`、`bash-background`、`snapshot/windows-paths`。跳过项仅验证非 Windows 平台行为。机器可读摘要见 [验证摘要](2026-09-15-issue-460-validation.json)。

### 扩展回归与基线对照

显式启用项目默认排除的真实进程集成套件后，六个套件共 **212 通过、21 失败、2 跳过**。21 个失败全部位于 `bash.test.ts`。

随后将三个生产文件临时恢复到上述已提交基线，仅运行原 `bash.test.ts`，再自动恢复本次修复：结果为 **124 通过、21 失败、1 跳过**，失败名称与修复后完全一致。失败涉及 Windows 路径插入 Shell 命令、外部 Git 配置路径和隔离策略断言等。完整失败名称保存在验证摘要中；此次未扩展修改这些无关的测试或隔离实现。

### 复跑命令

在 `packages/ax-code` 目录，使用 Node 26 和已安装的工作区依赖：

```powershell
$env:AX_TEST_FILES='test/tool/bash-background.test.ts,test/tool/bash-permissions.test.ts,test/snapshot/windows-paths.test.ts,test/tool/bash-windows-redirect.test.ts,test/tool/bash-helpers.test.ts'
node node_modules/vitest/vitest.mjs run
node node_modules/@typescript/native/bin/tsc --noEmit

# 扩展基线套件：当前 Windows 环境仍有上述 21 个既有失败
$env:AX_TEST_FILES='test/tool/bash.test.ts'
node node_modules/vitest/vitest.mjs run
```

## 范围与限制

- 阻止的是 bash 工具中可静态解析的异常重定向；不是对任意脚本、外部程序或所有文件写入途径的全面拦截。
- 没有自动删除、改名或改写用户已有的 `nul`。旧文件仍可能触发快照警告，后续需要单独确认处理。
- 没有隐藏快照覆盖警告，没有更改快照保存或回滚逻辑。
- 本次提交源代码、测试和报告，没有替换用户当前安装的 CLI，也没有发布正式版本。
- 仅向指定修复分支追加提交；保留该分支已有修复，不修改或合并到主分支。
