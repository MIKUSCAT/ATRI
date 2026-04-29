# 记忆系统改造 RE 自查

## 对照计划检查

- [x] fact 不再只是一句 content：新增 type / importance / confidence / source / source_date / recall_count / last_recalled_at。
- [x] 新增 episodic_memories：用于保存日记里可自然联想的场景。
- [x] 新增 memory_intentions：用于保存日记里“心里挂着、以后找机会说”的话。
- [x] 新增 memory_events：用于记录 recalled / used / archived / merged。
- [x] 日记生成输出扩展：diary / mood / highlights / episodicMemories / factCandidates / innerThoughts。
- [x] 日记后写入情景记忆、心里念头、严格筛选后的 fact。
- [x] fact 清洗 prompt 改成杀伐果断：流水、临时状态、单日小事、重复事实必须归档或合并。
- [x] 聊天前主动联想：自动查 fact / episodic / intention，并注入“脑海里自然浮现”。
- [x] prompt 加入人味要求：不说“数据库/检索/记录显示”，合适才提旧事。
- [x] 白天不额外调用 LLM：主动联想使用 D1 + Vectorize，主回复 LLM 调用链路不变。
- [x] 晚上 LLM 次数控制：日记、情景记忆、fact 候选、inner thoughts 合并在日记生成这一次输出里。
- [x] 参考 soul 文档：加入稳定身份、人格连续性、真诚朋友、功能性情绪、不是客服腔等设计。

## 自检结果

1. `npx wrangler deploy --dry-run` 已通过 Worker 打包检查；过程中 wrangler 想写 `/root/.config` 日志报 EROFS，但 dry-run 本身完成并显示 `--dry-run: exiting now`。
2. `npm run typecheck` 当前仍会报仓库既有 TypeScript 类型问题，主要是 itty-router 类型、request.json unknown、runtime-settings BufferSource 等老问题；新增代码相关的语法打包已通过 wrangler dry-run。
3. 线上 CF 清洗还没执行，必须先备份 D1，再迁移，再清洗。

## 还要做的线上动作

1. 导出远程 D1 备份。
2. 应用 `0010_memory_system_overhaul.sql`。
3. 查询线上实际表结构，DROP 明确废弃表，比如 `atri_self_reviews`。
4. 跑一次 fact 清洗/归档/合并。
5. 如数据量允许，从旧日记回填一批 episodic memories。
