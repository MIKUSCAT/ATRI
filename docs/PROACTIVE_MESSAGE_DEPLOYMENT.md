# 主动消息功能部署指南

## 服务端部署步骤

### 1. 数据库迁移

```bash
cd worker
npx wrangler d1 execute atri_diary --file=migrations/0004_add_proactive_messages.sql
```

### 2. 同步提示词

```bash
cd ..
python scripts/sync_shared.py
```

### 3. 部署 Worker

```bash
cd worker
npm run deploy
```

### 4. 验证部署

测试 API 端点：

```bash
# 检查主动消息
curl "https://your-worker.workers.dev/proactive/check?userId=test-user&timeZone=Asia/Shanghai" \
  -H "X-App-Token: your-token"

# 获取用户设置
curl "https://your-worker.workers.dev/proactive/settings?userId=test-user" \
  -H "X-App-Token: your-token"
```

## Cron 任务说明

系统会在每日 UTC 15:59（北京时间 23:59）自动执行两个任务：

1. **日记生成** (`runDiaryCron`) - 为当天有对话的用户生成日记
2. **主动消息计划生成** (`runProactiveCron`) - 为活跃用户生成次日的主动消息发送计划

## 配置说明

### 默认设置

- 每日消息数：2条
- 免打扰时段：22:00 - 08:00
- 功能状态：默认启用

### 用户可自定义

用户可通过 `/proactive/settings` API 修改：
- `enabled`: 是否启用主动消息
- `dailyCount`: 每日消息数（1-5条）
- `quietStart`: 免打扰开始时间
- `quietEnd`: 免打扰结束时间

## 工作流程

```
1. 每日 23:59 → Cron 生成次日消息计划
2. Android 端每 30-60 分钟轮询一次
3. 服务端检查是否有待发送消息
4. 如有消息 → 生成内容并返回
5. Android 显示通知
```

## 注意事项

1. **时区处理**：所有时间计算基于用户时区
2. **消息去重**：已发送的消息会标记为 `sent` 状态
3. **免打扰**：在免打扰时段不会返回消息
4. **活跃用户**：只为最近 7 天有对话的用户生成计划

## 故障排查

### 问题：Cron 未执行

检查 `wrangler.toml` 中的 cron 配置：
```toml
[triggers]
crons = ["59 15 * * *"]
```

### 问题：消息未生成

1. 检查用户设置是否启用
2. 检查是否在免打扰时段
3. 查看 Worker 日志：`npx wrangler tail`

### 问题：提示词未生效

确保运行了 `python scripts/sync_shared.py` 并重新部署