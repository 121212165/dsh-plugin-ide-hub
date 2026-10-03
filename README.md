# dsh-plugin-ide-hub

**EN** · One hub over the coding IDEs you actually run — dsh, Claude Code, Codex, ZCode, Qoder, CatPaw, Trae, OpenCode. It reads each tool's own on-disk state (sessions, usage, prompt-rule files) instead of calling any API, then gives you an inventory (`/ide-hub`), a quota-runway migration plan (`/hub-migrate`), usage breakdowns (`/hub-usage`), resumable sessions (`/hub-sessions`), a ranked "what should I do first" over the sibling plugins (`/today`) and an Obsidian export (`/hub-export`) — and, since `/hub-init`, writes back exactly one thing: a `.hub/` rule body plus a marker-delimited pointer in each tool's project rule file. · 45 `node --test` green · reads real local data on this machine · v0.4's Trae chat reader is **not yet wired into `/hub-sessions`** — see 已知边界.

DeepSeek Harness (dsh) 插件：跨 IDE 统一管理器。各家编码 IDE 都把会话、用量、提示词规则写在自己的磁盘目录里，本插件直接读这些文件（不调任何厂商 API），在 dsh 里出六个命令。读之外只有一处写：`/hub-init` 往**你自己指定的项目目录**里装 `.hub/` 规则本体与各 IDE 的指针段。

## 功能

- **`/ide-hub`**：8 个适配器的在装盘点（`N/8 在装，其中国产 M`）+ 每个工具的提示词规则文件发现（CLAUDE.md / AGENTS.md / .cursorrules 一类）。
- **`/hub-init [目录] [--dry-run] [--only …] [--remove]`**：指针生成器。建 `.hub/AGENTS.md`（规则本体，一份正文多处生效）+ `.hub/PROJECT_NOTES.md` + `.hub/STRUCTURE.json`（深度 2 的结构快照），再放 `hub-pointer` 标记段：**8 个工具全覆盖**——项目根 `AGENTS.md` 一份服务 codex / opencode / zcode / dsh / **qoder / catpaw**，`CLAUDE.md` 服务 Claude Code，Trae 因为它的「项目根 AGENTS.md」是设置里的开关（"Include AGENTS.md in the context"），单独写 `.trae/rules/project_rules.md` **和** `.trae-cn/rules/project_rules.md`（本机装的 TRAE SOLO CN 两条路径都在用）。
- 这些路径不是从文档抄的：2026-10-02 用 grep 从本机安装的厂商二进制里读出来（Trae 的 `ai-modules-chat/dist/index.mjs` 设置文案、Qoder 的 `qoder-worker-runtime.obf.mjs` 里 `AGENTS.override.md → AGENTS.md` 与 `projectConfigName=.qoder/.qoder-cn`、CatPaw 的 `catpaw-cli.exe` 里 `loadProjectRules(.catpaw/rules)` 与 `loadAgentMdFiles`）。**CatPaw 的 `.catpaw` 目录名可被 `CATPAW_DIR` 覆盖，所以指针挂 `AGENTS.md` 而不是它。**
- **`/hub-usage`**：用量。zcode 走本地 `model_usage` 库，出总量、轮数、缓存命中率、非完成态与工具错误数，并按 `provider/model` 逐行拆；claude-code / codex 走各自转录统计。
- **`/hub-sessions`**：最近会话列表 + 一键恢复命令（`claude --resume …` / `codex resume …` / `dsh --profile … --resume …`）。
- **`/today`**：**今天第一件事**。把四个兄弟插件写在磁盘上的事实汇成一个排序结论——quota 的 `summary.json`（预算与下步预估）、cost-ledger 的当月台账、task-forge 的 `ledger.jsonl`（谁卡在等谁）、tool-trace 的调用记录（连败=系统性故障）。规则表在 `src/hub/today.ts`，是纯函数、逐条有测试；读不到哪个文件就在输出里点名「看不到的部分」，不假装全知。
- **`/hub-migrate`**：配额迁移计划。按你配的 `remainingMajor` / `dailyMajor` / `priority` 算每个工具的耗尽倒计时，并给出该把活优先挪给谁。
- **`/hub-export`**：把盘点结果与规则文件导出成 Obsidian 笔记（`IDE-Hub/` 子树），未变化的文件跳过。

## 安装

三步，2026-10-03 在**全新 `DSH_HOME`** 上按本文档重跑通过（`@deepseek-ai/dsh@0.2.0-rc.2` + `pnpm 10.20.0`）：

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

### 装不上时先查这三样（2026-10-03 干净房实测踩点）

1. **git 走了死代理**：pnpm 内部会调 `git ls-remote https://github.com/…`。若你 git 全局配了
   `http.proxy` 而那代理已经不在了，报 `TLS connect error: error:0A000126:SSL routines::unexpected eof`——
   而同一时刻**直连 github 是 200**，所以别怀疑 GitHub。临时绕过（不动你的全局配置）：

   ```sh
   export GIT_CONFIG_COUNT=2 \
     GIT_CONFIG_KEY_0=http.proxy  GIT_CONFIG_VALUE_0= \
     GIT_CONFIG_KEY_1=https.proxy GIT_CONFIG_VALUE_1=
   ```

   永久修法自己定：`git config --global --unset http.proxy`（并 unset `https.proxy`）。
2. **pnpm 拦构建脚本**：git 包要在安装时跑 `prepare` 生成 `lib/`。`pnpm 10.20.0` 实测直接放行；
   若你的版本拦了，按 dsh 的报错提示在 `profiles/web/pnpm-workspace.yaml` 的 `allowBuilds`
   里加上包名再重跑同一条 `dsh plugin … add`。
3. **`missing peer @deepseek-ai/cordis@>=4.0.0` 是预期噪音**：cordis 由宿主 profile 提供，不用补装。

**装完立刻可用的含义**：只要 `bundles` 里有 `dsh-plugin-ide-hub`，它就会以 `config: {enabled: true}` 挂载，
`/hub-init` 与 `/today` 直接可用；上面第 ② 步的 `cordis.patch.yml` 只是往里加配置项（`vaultDir` 之类），
不配不影响主功能。确认到"真的挂上且带默认配置"：

```sh
dsh --profile web --dump-config | grep -A2 dsh-plugin-ide-hub
# → - id: ide-hub / name: dsh-plugin-ide-hub / config: / enabled: true
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | |
| `vaultDir` | 无 | `/hub-export` 的目标 Obsidian 库；不配则该命令直接报错而不是猜路径 |
| `quotaSummaryPath` | `~/.dsh/quota/summary.json` | `/today` 读它（预算、下步预估） |
| `costLedgerDir` | `~/.dsh/cost-ledger` | `/today` 读当月 `ledger-YYYY-MM.jsonl` |
| `taskForgeLedger` | `~/.dsh/task-forge/ledger.jsonl` | `/today` 读交接台账 |
| `toolTraceDir` | `~/.dsh/tool-trace` | `/today` 读工具追踪，窗口 `todayWindowDays` |
| `quotas` | `[]` | `/hub-migrate` 的输入，每项 `{tool, remainingMajor, dailyMajor, priority}`；`priority` 取 `work`/`batch`/`learning` |

## /today 的优先级（为什么是这个顺序）

规则表只有 6 条，顺序是**"现在能不能干活" > "钱" > "别人在等我的东西" > "我在等别人的东西" > "可以开工了"**：

1. tool-trace 里有工具**连败 ≥ 3**（与 error-radar 同阈值）→ 先修工具链：这条路现在就是走不通，别派活；
2. quota 预算 ≥ 80%，或**最热会话 + 下步预估 > 预算** → 先谈钱，因为这是不可逆的；
3. 有任务的回读列了缺口（`缺口 N 条`）→ 那是**别人在等你答**，答完版本才推进；
4. `relayed` 超过 24 小时没人 `/ack` → 催回读（未到 24 小时不算卡住，只列出来）；
5. 有 `ready`/`in-progress` → 让它开工；
6. 都没有 → "没有阻塞，可以开新需求"，指向 `/forge`。

本月花费（`/forecast`）永远列在最后：它是"想看再看"的信息，不该压过阻塞项。窗口默认 3 天（`todayWindowDays`），窗口外的数字不算"现在的健康"。

## 写盘原则（一个只读插件第一次往磁盘上写东西）

- **只写进你点名的项目目录**，绝不碰 `~/.claude`、`~/.codex` 这类全局规则文件。
- **不覆盖别人的正文**：目标文件已有内容时只在末尾**追加**一段带标记的指针；`.hub/AGENTS.md` 与 `PROJECT_NOTES.md` 一旦存在就永不改写（`= 保留`），只有 `STRUCTURE.json` 是纯生成物、每次重算。
- **幂等**：再跑一次不产生第二个指针段、不改字节（测试断言到 byte 级）；`--dry-run` 报同样的计划但零写盘。
- **卸载零残留**：`/hub-init --remove` 精确摘掉自己那段，摘完发现文件里没别的内容才删文件，删完把**空掉的目录**（`.trae/rules/` 这类）从下往上剪掉——但只在它真的为空时剪，且绝不越过项目根；`.hub` 里被你自己改过的模板**不删**，只告诉你它还在、请你确认后手工删。

## 数据口径（为什么有些数字拿不到）

- 只用磁盘上的**公开事实**：目录、`*.jsonl`、SQLite 里已存在的 usage 字段。不解析任何私有消息体格式，也不逆向加密内容。
- 因此：能看到「某工具有多少会话、用了多少 token、规则文件在哪」，看不到厂商没写下来的东西（例如云端配额、订阅剩余）。`/hub-migrate` 里的剩余量要你手工填 `quotas`，插件不猜。
- CatPaw / Qoder 等国产 IDE 的存储路径随版本变；读不到时该工具在盘点里显示为「不在装」而不是报错。

## 验证状态

- 45 个 `node --test` 全绿（`inventory` / `usage` / `zcode-db` / `obsidian` / `migrate` / `pointers` / `hub-init` / `today` 八个文件），含损坏行容错、跨月边界，以及 `/today` 六条规则的相对顺序与各来源缺失时的降级。
- `/hub-init` 的 8/8 是**文件级**跑通：临时项目上装→重跑字节不变→`--remove` 后连空目录都不留。**还没有在任何真实 IDE 里让那边的 AI 读过一次 `.hub/AGENTS.md`**（那是端到端验证，需要额度与人工开一次窗口，目前 0/8）。`hub-init` 那组是真临时目录上的端到端：安装、二次运行 byte 级不变、`--remove` 的"该删的删/该留的留"、`--only` 收窄、坏输入点名报错。
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
| [kaanozhan/Frame](https://github.com/kaanozhan/Frame)（ADE，394★） | 「指针文件路由」思想（一份本体 + 每 IDE 一根指针） | 已按本仓库口径实现为 `/hub-init`（v0.5，v0.7 补到 8/8）：指针段带标记可精确卸载、只写项目目录不碰全局、每根指针的落点都用本机厂商二进制核实过——不是照搬其文件布局 |

明确原创（无对应借鉴源）：迁移计划算法（耗尽倒计时+优先级跑位）、fact-vault、pinboard 的预算注入模型、eco-scan 的增长评分。
