# Issue report：大消息响应被截断，导致 Failed to load session

- 日期：2026-09-09
- 版本：AX Code 7.14.11，包含本地快照性能优化
- 分支：`local/v7.14.11-fixes-performance-20260909`
- 状态：源码已修复；本机安装版已应用修复并完成真实会话验证
- 影响路径：Node 进程模式 TUI → stdio RPC → `session.messages`

## 现象与证据

打开既有会话后显示 `Failed to load session: <sessionID>`，随后返回首页。再次打开同一会话仍然失败。

2026-09-09 15:48 UTC 前后的日志中，同一请求先出现多次 `TUI backend stdout line buffer exceeded cap, truncating`，随后出现 `TUI backend process wrote non-protocol stdout`，最终为 `session.messages timed out after 10000ms`。

针对报错会话，临时启动后端并只读请求原消息接口（`limit=101`），将同一 stdout 数据流交给旧、新解码器：

| 项目 | 结果 |
|---|---:|
| RPC 响应帧 UTF-8 大小 | 4,741,793 字节 |
| HTTP JSON 正文大小 | 4,351,073 字节 |
| 返回消息数 | 101 |
| 修复前对照的后端响应耗时 | 约 587 ms |
| 旧解码器 | 截断 4 次，未交付响应 |
| 新解码器 | 完整交付，正文哈希与后端输出一致 |
| 安装后实际复验 | 约 702 ms，完整交付同一响应 |

未修改会话数据库，未调用模型，未在本报告或仓库中保存会话正文、会话标识、用户日志或凭据。以上时间是本次局部实测，不是整体交互性能承诺。

## 根因

`packages/ax-code/src/cli/cmd/tui/thread.ts` 的 `createProcessWire()` 将后端 stdout 累积到字符串中，在解析换行分帧**之前**检查 `buffer.length > 1024 * 1024`。超过阈值就清空整个缓冲区并直接返回。

这个阈值假定正常协议行不会超过 1 MB，但一个 `rpc.result` 行包含完整的会话消息响应，工具输出较多时可以轻易超过阈值。另一个问题是：一次 stdout 回调可能携带多个完整协议行，旧实现却对回调累积总量应用同一阈值。

清空缓冲区会丢失响应开头，剩余片段变成无法解析的输出噪声，RPC 客户端因收不到对应结果而等待到超时。TUI 的会话同步失败处理随后显示提示并导航回首页。真实后端响应不足 1 秒，故障不是数据库读取超时，也不是本地快照扫描优化造成。

## 修复方法

1. 按换行处理完整协议帧，支持任意 stdout 分块，以及一个块内包含多条消息。
2. 用字符串片段数组累积当前帧，收到换行后一次拼接，避免每次分块都重新扫描不断增大的整个缓冲区。
3. 将限制改为**单帧 64 MiB UTF-8 字节数**，每处理完一帧重置计数。该边界仍限制异常无换行输出的累计内存，不是无界缓冲。
4. 超限时记录长度元数据并关闭逻辑 RPC wire，立即拒绝所有待处理请求；不再静默丢弃响应并等到超时，也不再尝试把截断尾部当作新消息。
5. stdout 流错误同样触发 wire 关闭；关闭时清理片段。正常空行、CRLF 和非协议噪声的处理保持兼容。

未增加会话请求超时、未截短消息正文、未降低消息上限，未修改模型或推理参数。

## 验证

- **先失败再修复**：新增的大于 1 MiB 的分块响应测试和多帧同块测试，在旧实现上均失败；应用修复后通过。
- **39 项相关测试全部通过**：process-wire 8 项、RPC 23 项、session-entry-sync 4 项、sync-session-fetch 4 项。
- 覆盖大响应、Unicode 正文、分块与合并消息、噪声/CRLF/残留半帧、单帧上限、超限后的拒绝行为、stdout 错误、进程退出及启动失败。
- TypeScript 类型检查、Prettier 和 Git 空白检查通过。
- 真实报错会话的只读对照和安装后复验均通过，响应正文哈希一致；未以模拟小响应代替真实故障数据验证。
- 本机仅替换安装 bundle 中的 `createProcessWire()`，安装前保留入口文件备份，安装后检查版本、哈希及真实会话响应；已有快照性能补丁保持不变。安装脚本在验证失败时自动恢复原入口。

源码验证命令（在 `packages/ax-code` 目录，使用 Node 24+）：

```powershell
$env:AX_TEST_FILES = 'test/cli/tui/process-wire.test.ts,test/util/rpc.test.ts,test/cli/tui/sync-session-fetch.test.ts,test/cli/tui/session-entry-sync.test.ts'
node ../../node_modules/vitest/vitest.mjs run --retry=0
node ../../node_modules/@typescript/native-preview/bin/tsgo.js --noEmit
```

## 生效与限制

已运行的 TUI 进程仍持有旧代码，需要退出后重新启动并打开该会话。现有会话内容不需要删除、重建或迁移。

本次验证覆盖了实际后端、真实响应和正式安装文件中的分帧函数，没有自动操作用户当前的交互式终端。单帧超过 64 MiB 时仍会明确关闭通信；若以后需要支持更大的单帧，应设计协议级分片或分页，而不是继续无界增加缓冲。
