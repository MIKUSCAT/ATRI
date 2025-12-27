# 主动消息功能实现计划

## 概述

实现 ATRI 在一天中随机几次主动给用户发送消息的功能，模拟真人朋友的互动模式。

## 架构方案

采用**客户端轮询 + 服务端决策**模式：
- Android 端使用 WorkManager 定期轮询
- 服务端决定是否有待发送消息并生成内容
- 通过本地通知提醒用户

```
┌─────────────┐     轮询(30-60min)     ┌─────────────┐
│  Android    │ ──────────────────────▶│   Worker    │
│  WorkManager│                        │   API       │
└─────────────┘◀────────────────────── └─────────────┘
                   返回消息/空              │
       │                                   │
       ▼                                   ▼
┌─────────────┐                     ┌─────────────┐
│  本地通知   │                     │  LLM 生成   │
│  Room 存储  │                     │  D1 记录    │
└─────────────┘                     └─────────────┘
```

---

## 实现步骤

### 第一阶段：数据库扩展

**文件**: `worker/db/schema.sql`

```sql
-- 主动消息计划表
CREATE TABLE IF NOT EXISTS proactive_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  slot INTEGER NOT NULL,
  scheduled_hour INTEGER NOT NULL,
  scheduled_minute INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  trigger_type TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_proactive_user_date 
  ON proactive_schedules(user_id, date, status);

-- 主动消息记录表
CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  schedule_id TEXT,
  content TEXT NOT NULL,
  context_type TEXT,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proactive_msg_user 
  ON proactive_messages(user_id, timestamp);

-- 用户主动消息偏好
CREATE TABLE IF NOT EXISTS proactive_settings (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  daily_count INTEGER DEFAULT 2,
  quiet_start INTEGER DEFAULT 22,
  quiet_end INTEGER DEFAULT 8,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

### 第二阶段：服务端实现

#### 2.1 新增路由文件

**文件**: `worker/src/routes/proactive.ts`

```typescript
import { Router } from 'itty-router';
import { Env } from '../types';
import { checkAndGenerateProactiveMessage, updateProactiveSettings, getProactiveSettings } from '../services/proactive-service';

export const proactiveRouter = Router({ base: '/proactive' });

// 检查是否有待发送消息
proactiveRouter.get('/check', async (req, env: Env) => {
  const { userId, timeZone } = req.query;
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });
  
  const result = await checkAndGenerateProactiveMessage(env, userId, timeZone || 'Asia/Shanghai');
  return Response.json(result);
});

// 获取用户设置
proactiveRouter.get('/settings', async (req, env: Env) => {
  const { userId } = req.query;
  const settings = await getProactiveSettings(env, userId);
  return Response.json(settings);
});

// 更新用户设置
proactiveRouter.post('/settings', async (req, env: Env) => {
  const body = await req.json();
  await updateProactiveSettings(env, body);
  return Response.json({ ok: true });
});
```

#### 2.2 核心服务

**文件**: `worker/src/services/proactive-service.ts`

核心函数：
- `checkAndGenerateProactiveMessage()` - 检查并生成消息
- `generateDailySchedule()` - 生成每日随机时间计划
- `buildProactiveContext()` - 构建消息生成上下文
- `generateProactiveContent()` - 调用 LLM 生成内容

#### 2.3 Cron 扩展

**文件**: `worker/src/jobs/proactive-cron.ts`

每日凌晨为所有活跃用户生成当天的发送计划。

---

### 第三阶段：Android 端实现

#### 3.1 添加依赖

**文件**: `ATRI/app/build.gradle.kts`

```kotlin
implementation("androidx.work:work-runtime-ktx:2.9.0")
```

#### 3.2 新增文件

| 文件 | 说明 |
|:-----|:-----|
| `ProactiveCheckWorker.kt` | WorkManager Worker 实现 |
| `NotificationHelper.kt` | 通知显示工具类 |
| `ProactiveRepository.kt` | 主动消息数据仓库 |
| `ProactiveSettingsScreen.kt` | 设置界面 |

#### 3.3 API 接口扩展

**文件**: `AtriApiService.kt`

```kotlin
@GET("/proactive/check")
suspend fun checkProactiveMessage(
    @Query("userId") userId: String,
    @Query("timeZone") timeZone: String
): Response<ProactiveCheckResponse>

@POST("/proactive/settings")
suspend fun updateProactiveSettings(@Body settings: ProactiveSettings): Response<Unit>

@GET("/proactive/settings")
suspend fun getProactiveSettings(@Query("userId") userId: String): Response<ProactiveSettings>
```

#### 3.4 Worker 注册

**文件**: `AtriApplication.kt`

```kotlin
private fun scheduleProactiveCheck() {
    val request = PeriodicWorkRequestBuilder<ProactiveCheckWorker>(
        30, TimeUnit.MINUTES,
        15, TimeUnit.MINUTES
    )
        .setConstraints(Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build())
        .build()
    
    WorkManager.getInstance(this)
        .enqueueUniquePeriodicWork(
            "proactive_check",
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
}
```

---

### 第四阶段：提示词配置

**文件**: `shared/prompts.json`

```json
{
  "proactive": {
    "system": "你是亚托莉，正在主动给{userName}发消息。保持简短自然，像真人朋友一样，不要太正式。",
    "types": {
      "greeting": "生成一条早安问候，简短温馨，不超过20字",
      "caring": "生成一条关心对方的消息，询问近况或提醒注意身体，不超过30字",
      "sharing": "基于最近话题，分享一个相关的小发现或想法，不超过40字",
      "reminder": "生成一条晚安提醒，温柔体贴，不超过25字",
      "missing": "已经很久没聊天了，表达想念但不要太黏人，不超过30字"
    }
  }
}
```

---

## 随机时间策略

### 时间槽配置

| 时段 | 时间范围 | 权重 | 说明 |
|:-----|:---------|:----:|:-----|
| 上午 | 9:00-12:00 | 2 | 较活跃 |
| 午间 | 12:00-14:00 | 1 | 一般 |
| 下午 | 14:00-18:00 | 3 | 最活跃 |
| 晚间 | 18:00-21:00 | 2 | 较活跃 |

### 消息类型选择逻辑

```
if 超过24小时未对话 → missing
else if 早上且今日未对话 → greeting  
else if 晚间(21点后) → reminder
else → 随机(caring/sharing)
```

---

## 用户设置项

| 设置 | 默认值 | 说明 |
|:-----|:-------|:-----|
| 启用主动消息 | 开启 | 总开关 |
| 每日消息数 | 2条 | 1-5条可选 |
| 免打扰开始 | 22:00 | 晚间静默 |
| 免打扰结束 | 08:00 | 早间静默 |

---

## 文件清单

### Worker 端新增/修改

| 文件 | 操作 |
|:-----|:-----|
| `worker/db/migrations/0004_proactive_messages.sql` | 新增 |
| `worker/src/routes/proactive.ts` | 新增 |
| `worker/src/services/proactive-service.ts` | 新增 |
| `worker/src/services/proactive-scheduler.ts` | 新增 |
| `worker/src/jobs/proactive-cron.ts` | 新增 |
| `worker/src/index.ts` | 修改(注册路由) |
| `worker/wrangler.toml` | 修改(添加cron) |
| `shared/prompts.json` | 修改(添加proactive) |

### Android 端新增/修改

| 文件 | 操作 |
|:-----|:-----|
| `app/build.gradle.kts` | 修改(添加WorkManager) |
| `data/api/AtriApiService.kt` | 修改(添加接口) |
| `data/api/response/ProactiveResponse.kt` | 新增 |
| `data/repository/ProactiveRepository.kt` | 新增 |
| `worker/ProactiveCheckWorker.kt` | 新增 |
| `utils/NotificationHelper.kt` | 新增 |
| `ui/settings/ProactiveSettingsSection.kt` | 新增 |
| `AtriApplication.kt` | 修改(注册Worker) |
| `AndroidManifest.xml` | 修改(通知渠道) |

---

## 注意事项

1. **电量优化**: WorkManager 会自动处理 Doze 模式，但间隔不能小于15分钟
2. **网络依赖**: 设置 `NetworkType.CONNECTED` 约束，无网络时跳过
3. **消息去重**: 服务端标记已发送状态，避免重复推送
4. **时区处理**: 客户端传递时区，服务端按用户本地时间计算
5. **隐私保护**: 主动消息内容不应包含敏感信息