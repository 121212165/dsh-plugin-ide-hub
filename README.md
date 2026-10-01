# dsh-plugin-ide-hub

**EN** · One hub over the coding IDEs you actually run — dsh, Claude Code, Codex, ZCode, Qoder, CatPaw, Trae, OpenCode. It reads each tool's own on-disk state (sessions, usage, prompt-rule files) instead of calling any API, then gives you an inventory (`/ide-hub`), a quota-runway migration plan (`/hub-migrate`), usage breakdowns (`/hub-usage`), resumable sessions (`/hub-sessions`) and an Obsidian export (`/hub-export`). · 24 `node --test` green · reads real local data on this machine · v0.4's Trae chat reader is **not yet wired into `/hub-sessions`** — see 已知边界.

DeepSeek Harness (dsh) 插件：跨 IDE 统一管理器。各家编码 IDE 都把会话、用量、提示词规则写在自己的磁盘目录里，本插件直接读这些文件（不调任何厂商 API），在 dsh 里出五个命令。

## 功能

- **`/ide-hub`**：8 个适配器的在装盘点（`N/8 在装，其中国产 M`）+ 每个工具的提示词规则文件发现（CLAUDE.md / AGENTS.md / .cursorrules 一类）。
- **`/hub-usage`**：用量。zcode 走本地 `model_usage` 库，出总量、轮数、缓存命中率、非完成态与工具错误数，并按 `provider/model` 逐行拆；claude-code / codex 走各自转录统计。
- **`/hub-sessions`**：最近会话列表 + 一键恢复命令（`claude --resume …` / `codex resume …` / `dsh --profile … --resume …`）。
- **`/hub-migrate`**：配额迁移计划。按你配的 `remainingMajor` / `dailyMajor` / `priority` 算每个工具的耗尽倒计时，并给出该把活优先挪给谁。
- **`/hub-export`**：把盘点结果与规则文件导出成 Obsidian 笔记（`IDE-Hub/` 子树），未变化的文件跳过。

## 安装

三步，实测于 `@deepseek-ai/dsh@0.1.7-alpha.1`（需 `pnpm` 在 PATH 上）：

```sh
# ① 装进 profile：dsh plugin 把参数原样转发给 pnpm，git 包会自动跑 prepare 构建 lib/
dsh plugin --profile web add github:121212165/dsh-plugin-ide-hub
```

② 把本仓库根目录 `cordis.patch.yml` 的内容**并进** `$DSH_HOME/profiles/web/cordis.patch.yml`。
该文件默认是 `[]`，所以要么整份替换，要么把 insert 条目并进同一个数组；**不要直接追加**——
追加会形成两个 YAML 文档，启动即报
`failed to parse overlay ... end of the stream or a document separator is expected`（本机实测踩过）。

③ 重启 dsh。配置层与 client 半都要重启才生效（客户端按 boot 时算出的内容 rev 下发，硬刷新浏览器没用）。

自检挂载：`dsh --profile web --dump-config | grep dsh-plugin-ide-hub`，应看到该条目。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | |
| `vaultDir` | 无 | `/hub-export` 的目标 Obsidian 库；不配则该命令直接报错而不是猜路径 |
| `quotas` | `[]` | `/hub-migrate` 的输入，每项 `{tool, remainingMajor, dailyMajor, priority}`；`priority` 取 `work`/`batch`/`learning` |

## 数据口径（为什么有些数字拿不到）

- 只用磁盘上的**公开事实**：目录、`*.jsonl`、SQLite 里已存在的 usage 字段。不解析任何私有消息体格式，也不逆向加密内容。
- 因此：能看到「某工具有多少会话、用了多少 token、规则文件在哪」，看不到厂商没写下来的东西（例如云端配额、订阅剩余）。`/hub-migrate` 里的剩余量要你手工填 `quotas`，插件不猜。
- CatPaw / Qoder 等国产 IDE 的存储路径随版本变；读不到时该工具在盘点里显示为「不在装」而不是报错。

## 验证状态

- 24 个 `node --test` 全绿（`inventory` / `usage` / `zcode-db` / `obsidian` / `migrate` 五个文件），含损坏行容错与跨月/边界用例。
- `/hub-usage` 的 zcode 明细、`/ide-hub` 的盘点数字来自本机真实目录，实测跑得出数据。
- **未做**：v0.4 的 Trae 聊天读取未在运行中的 dsh 里 live mount 复验。

## 已知边界

- **`/hub-sessions` 里 Trae 还没接上**：`src/plugin.ts` 算出了 `traeLines`，但返回的文本只拼了 claude-code/codex/zcode 的会话行，所以 Trae 会话在这条命令里看不到（`/ide-hub` 盘点能看到 Trae 在装）。修它是一行拼接的事，留在这里是因为 v0.4 的提交信息写成了 "wired into /hub-sessions"——代码没做到，介绍不能跟着吹。
- 读 SQLite 无降级路径：某些工具把库文件锁住时，该工具的 usage 会缺，不会退化成估算。
- `/hub-export` 一个工具多个规则文件时（如 CLAUDE.md + AGENTS.md）曾互相覆盖：现在按 `<tool>-<文件名>` 加后缀，只在同工具多于一个规则文件时生效。

## 借鉴来源与差异（非盲目复制）

| 借鉴来源 | 借鉴了什么 | 我们的差异 |
|---|---|---|
| [stablyai/orca](https://github.com/stablyai/orca)（82k★，ADE） | ①「读各 agent 写在磁盘上的限额/用量状态，不调 API」的用量追踪思路（usage-tracking）；②「扫描全机会话转录 + 按 CLI 映射 resume 命令」的会话历史模式（session-history） | Orca 只覆盖 18 个海外 CLI；本插件补齐国产 IDE（Trae/Qoder/CatPaw）与 dsh 的适配位，且不解析私有消息格式（只做目录级事实+公开 jsonl 的 usage 字段）。代码为独立实现，未复制 Orca 源码 |
| [ccusage](https://github.com/ccusage/ccusage)、[splitrail](https://github.com/Piebald-AI/splitrail) | 本地 JSONL 用量统计的可行性验证 | ccusage 只读 Claude 格式；splitrail 不含国产 IDE。我们的聚合是自己的实现，口径（按工具/日/模型）独立设计 |
| [kaanozhan/Frame](https://github.com/kaanozhan/Frame)（ADE，394★） | 「指针文件路由」思想已列入 v0.2 计划（一份 `.hub/` 本体 + 每 IDE 一根指针），**尚未实现**，实现时将重新设计而非照搬 | — |

明确原创（无对应借鉴源）：迁移计划算法（耗尽倒计时+优先级跑位）、fact-vault、pinboard 的预算注入模型、eco-scan 的增长评分。
