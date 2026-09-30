
## 借鉴来源与差异（非盲目复制）

| 借鉴来源 | 借鉴了什么 | 我们的差异 |
|---|---|---|
| [stablyai/orca](https://github.com/stablyai/orca)（82k★，ADE） | ①「读各 agent 写在磁盘上的限额/用量状态，不调 API」的用量追踪思路（usage-tracking）；②「扫描全机会话转录 + 按 CLI 映射 resume 命令」的会话历史模式（session-history） | Orca 只覆盖 18 个海外 CLI；本插件补齐国产 IDE（Trae/Qoder/CatPaw）与 dsh 的适配位，且不解析私有消息格式（只做目录级事实+公开 jsonl 的 usage 字段）。代码为独立实现，未复制 Orca 源码 |
| [ccusage](https://github.com/ccusage/ccusage)、[splitrail](https://github.com/Piebald-AI/splitrail) | 本地 JSONL 用量统计的可行性验证 | ccusage 只读 Claude 格式；splitrail 不含国产 IDE。我们的聚合是自己的实现，口径（按工具/日/模型）独立设计 |
| [kaanozhan/Frame](https://github.com/kaanozhan/Frame)（ADE，394★） | 「指针文件路由」思想已列入 v0.2 计划（一份 `.hub/` 本体 + 每 IDE 一根指针），**尚未实现**，实现时将重新设计而非照搬 | — |

明确原创（无对应借鉴源）：迁移计划算法（耗尽倒计时+优先级跑位）、fact-vault、pinboard 的预算注入模型、eco-scan 的增长评分。
