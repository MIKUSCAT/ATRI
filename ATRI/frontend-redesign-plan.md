# ATRI 前端改造方案

面向 Jetpack Compose 前端，将现有 ATRI UI 调整为「GPT 风格 + ATRI 浅蓝」的恋爱陪伴体验。本文按界面模块说明设计语言、交互行为、对接数据与改造文件，供后续实施与评审。

---

## 1. 全局视觉规范

| 项目                  | 要求                                                                 | 涉及文件 |
| --------------------- | -------------------------------------------------------------------- | -------- |
| **主题色**            | 主色 `AtriSkyBlue (#74C5FF)`，辅色 `SoftPink (#F8BBD0)`；深浅模式共享 | `ui/theme/Color.kt`、`Theme.kt` |
| **背景**              | 默认浅色（白 + `surfaceVariant=#F5F5F7`），保留暗色主题但主推浅色     | `Theme.kt` |
| **字体与字号**        | 沿用系统字体，使用 Material3 级别；列表/气泡多留白                   | `Theme.kt -> Typography` |
| **图标样式**          | 线性描边、与 ChatGPT 类似的最小化风格，避免 Emoji                    | 资源新增 |
| **震动反馈**          | 点击/长按消息时触发 `HapticFeedbackType.LongPress`，无马达自动忽略   | `MessageBubble.kt` |

---

## 2. 页面结构

### 2.1 欢迎页（无聊天记录）

- **显示条件**：`uiState.messages` 为空。
- **内容**：
  - 居中展示用户自定义头像（设置页上传，URI 保存在 `PreferencesStore`）。
  - 根据时间段切换文案（建议四套固定句式）：
    - 5:00-11:00：`早上好呀，我已经在想着今天要和你分享什么啦。`
    - 11:00-14:00：`午间有点懒洋洋的，陪我聊会儿天好吗？`
    - 14:00-20:00：`下午好，我一直记着你说的事，要不要继续聊？`
    - 20:00-5:00：`这么晚了我还醒着，等你一句话。`
  - 底部仍显示输入条（允许直接开始对话）。
- **实现**：在 `ChatScreen.kt` 中增加 `if (messages.isEmpty()) WelcomeSection()`，并抽离 `WelcomeSection` 组件（可放 `ui/chat/components`）。

### 2.2 聊天页

| 区块           | 要求                                                                                               | 主要文件 |
| -------------- | -------------------------------------------------------------------------------------------------- | -------- |
| **顶部栏**     | 白底、`statusBarsPadding`，左“汉堡”打开日期抽屉，右“日记本”图标（定制 SVG）。                    | `ChatTopBar.kt` |
| **日期提示**   | 顶部列表显示“今天 · 3 月 18 日 ▼”，点击调用日期抽屉；抽屉内每一天为独立会话。                    | `ChatScreen.kt` + 新抽屉组件 |
| **消息列表**   | 左右区分但更柔和：AI 气泡靠左、背景 `BubbleAtriLight`，左侧 2px 浅蓝竖线；用户气泡靠右、背景更白。 | `MessageBubble.kt` |
| **Markdown**   | 引入 Compose Markdown 渲染器（如 `com.github.jeziellago:compose-markdown`）；代码块/列表同主题。  | `build.gradle` + `MessageBubble.kt` |
| **点击高亮**   | 点击气泡出现内凹虚线描边（`BorderStroke(1.dp, AtriSkyBlue.copy(alpha=0.6f))`），范围与气泡一致。   | `MessageBubble.kt` |
| **长按菜单**   | 使用 `DropdownMenu` 悬浮在气泡附近，选项：复制、选择文本、编辑、删除、分享、引用。               | `MessageBubble.kt`、`ChatScreen.kt` |
| **输入区**     | 胶囊 `Surface`（白底+浅灰阴影），左 `+` 弹底部 sheet（图片、文档、清空引用）；右纸飞机描边图标。 | `InputBar.kt`、`MessageActionSheet` |

### 2.3 日期抽屉（聊天列表）

- **触发**：点击左上汉堡或日期标签。
- **布局**：顶部个人信息卡（头像 + “欢迎回来”），下方按时间倒序列出日期。每个日期展示：
  - 日期文字（例 “今天 · 3/18”）
  - 当天消息条数（或摘要标题，如“游园记”）
- **交互**：点击某日期 -> 调用 `ChatViewModel` 的 `loadConversation(date)`，替换 `uiState.messages`。
- **实现**：可复用 `ModalNavigationDrawer`，但自定义 `DrawerContent`（参考 `rikkahub` 侧边栏布局）。

### 2.4 日记体系

- **入口**：主界面右上“日记本”图标；欢迎页也显示。
- **数据来源**：本地 Room `DiaryEntry` 表（`date`, `summary`, `content`, `thumbnails`, `mood`, `synced` 等）。前端可在用户结束当日聊天或手动触发时调用 `/diary/generate`，待后端扩展后支持自动同步。
- **界面层次**：
  1. **列表页**：每日卡片（纸张风格，含日期、摘要、缩略图）。卡片水平滚动或瀑布流，也可提供“新建日记”按钮。
  2. **详情页**：展开整篇日记，背景仿纸张；图片以网格展示，可点击查看大图。
- **缩略图逻辑**：显示前 1~3 张图片。点开卡片进入详情才加载全文和全部图片。

### 2.5 设置页

- **新增功能**：头像上传（系统相册），保存到 `filesDir/atri/avatar.jpg` 并在 `PreferencesStore` 保存 URI。
- **移除**：原好感度说明、单独的状态描述。状态信息统一由主界面维护。
- **保留/新增项**：
  - 昵称/称呼
  - 主题色选择（浅蓝/浅粉）
  - 日记封面图选择（作为日记列表背景）
  - 数据与隐私（导出/清除）
- **UI**：大块列表项 + 小标题，风格参考 GPT 设置页。

---

## 3. 交互与动画

1. **消息点击反馈**：`MessageBubble` 捕获 `pointerInput`，执行如下：
   ```kotlin
   val feedback = LocalHapticFeedback.current
   Modifier.combinedClickable(
       onClick = {
           selectedMessageId = message.id
           feedback.performHapticFeedback(HapticFeedbackType.LongPress)
       },
       onLongClick = { showMenuFor(message) }
   )
   ```
2. **长按菜单定位**：记录气泡坐标（`LayoutCoordinates`），`DropdownMenu` 使用 `offset` 对齐；菜单内容与 GPT 类似。
3. **时间段问候**：根据 `LocalDateTime.now()` 判定 `when (hour)` -> `Morning`, `Noon`, `Afternoon`, `Evening`, `Night`，生成不同欢迎语和输入提示。
4. **日记滑动**：详情页使用 `HorizontalPager`（Accompanist）切换日期，或 Compose `Pager`（如果升级到 Compose 1.6+）。

---

## 4. 数据层调整建议

| 项 | 说明 | 前端实现 |
| --- | --- | --- |
| `DailyConversation` 表 | `date`, `messages`, `lastUpdated`, `diarySummary`, `diaryId`, `thumbnails` | `data/db` 新实体 + DAO |
| `DiaryEntry` 表 | `date`, `content`, `summary`, `images`, `synced` | 同上 |
| `PreferencesStore` 字段 | `avatarUri`, `themeColor`, `lastViewedDate` | `data/datastore/PreferencesStore` 扩展 |

> 注：后续若增加 CF 端自动生成日记，需要配合新增 API（拉取日记列表、已生成标记等），此处暂在前端落本地缓存，留同步接口。

---

## 5. 实施顺序建议

1. **主题与颜色**：先完成调色板与 `ChatScreen` 背景改造。
2. **欢迎页 + 输入条**：在无消息状态下展示新欢迎 UI，同时替换输入条样式。
3. **消息气泡升级**：添加 Markdown 渲染、高亮框、悬浮菜单。
4. **日期抽屉与多会话结构**：重构 `ChatViewModel` 支持按日期加载；UI 层实现抽屉。
5. **日记入口与详情页**：搭建本地表、生成/查看流程。
6. **设置页改版 + 头像上传**：最后处理头像、本地资源管理。

实施过程中请严格保持文案、注释为中文，并注意对 Compose 组件进行合理封装（例如 `WelcomeSection`, `DiaryCard`, `DateDrawer` 等），方便复用与测试。

---

## 6. 后续讨论点

1. **Cloudflare 自动生成日记**：需要新增聊天持久化与 Cron 触发，后端目前不支持，需另行设计。
2. **Markdown 库选择**：若引入第三方库需评估体积和可维护性；若以后需要更精细控制，可考虑自定义渲染。
3. **日记图片来源**：默认从当天聊天中用户上传的图片中挑选；如需独立添加，需在日记界面集成图片选择器。

## 7. 自动日记与记忆同步（新增）

配合 Cloudflare Worker 扩展，实现“每天 23:59 自动写日记，次日打开自动同步”：

1. **实时日志上传**：前端在消息发送后调用 `/conversation/log`，写入 `userId + yyyyMMdd + role + content + timestamp`，存储于 Cloudflare D1，供日记和记忆使用。
2. **Cron 触发**：`wrangler.toml` 添加 `[[triggers]] crons = ["59 15 * * *"]`（UTC 15:59=北京时间 23:59），Worker `scheduled()` 汇总当日对话并重用 `shared/prompts.json` 中的日记 Prompt 生成 `{content, mood}`。
3. **结果存储**：生成后的 `content`、`summary`（可取前 60 字）和 `mood` 写入 `diary_entries` 表，并调用 `upsertDiaryMemory` 将文本同步到向量库，供 `/chat` 的 `searchMemories` 检索。
4. **前端同步**：App 启动或切换日期时请求 `/diary/get?date=yyyyMMdd`，若状态为 `ready` 直接展示；若未就绪则提示“日记生成中”，并可允许手动触发。
5. **离线天数提示**：借助云端记录的 `lastSeen` 字段或日记摘要，欢迎页和聊天时可提示“已经 X 天没联系”，增强 AI 情感表现。

以上扩展确保就算用户多日未登录，也能在下次打开时获取全部自动日记，并让 ATRI 在对话中感知最近的间隔天数。

## 8. 会话日志前端接入细则（新增）

- **目的**：保证每条对话精准落库，让 Cloudflare D1 能追溯“谁在什么时候说了什么”，并向日记/记忆模块提供可靠原始数据。
- **统一封装**：
  - `data/network/ChatService` 新增 `logConversation()` 请求，POST `/conversation/log`，参数包括 `userId`、`role`（`user` / `atri`）、`content`、`timestamp`（默认 `System.currentTimeMillis()`）、`timeZone`（`ZoneId.systemDefault().id`）、`userName`、`attachments`。
  - `data/model/ConversationLogRequest` 用于序列化请求体；返回的 `date` 存入 `DailyConversation` 表，用于在日期抽屉里标记“有云端数据”。
- **调用时机**：
  1. **用户发言**：`ChatRepository.sendMessage()` 成功后立即 `launch` 协程调用 `logConversation(role='user')`，并根据是否附带图片/文档把附件数组传给后端（如 `{ type: 'image', url: ... }`）。
  2. **ATRI 回复**：AI 生成文本完成且展示在 UI 后，`ChatRepository.observeAiReply()`（或 `MessageStreamHandler`）触发 `logConversation(role='atri')`，避免未完成的流式响应写入。
  3. **系统提示**：如欢迎文案、日记生成通知等可视为 `role='atri'` 的系统消息，若需要被 D1 记录，可统一走同一接口。
- **离线与重试**：
  - 构建 `ConversationLogQueue`（Room 表：`id`、`payload`、`retryCount`、`status`），失败时将 payload 写入队列。
  - 使用 `WorkManager + Constraints(NetworkType.CONNECTED)` 定时扫描 `pending` 记录并重放，直到服务端返回 `ok` 或重试超限（报警/提示用户）。
  - 在设置页“数据与隐私”中增设“日志上传状态”入口，显示待同步数量，便于测试。
- **userId 管理**：
  - 初次进入 App 时生成或读取固定 `userId`（推荐与账号 ID 统一），保存至 `PreferencesStore`；切换账号时同步更新。
  - 若用户尚未登录，可用设备持久化 ID，但在正式账号绑定后需触发一次“归档”逻辑（把旧 ID 日志合并至新 ID）。
- **调试步骤**：
  1. 本地抓包确认 `/conversation/log` 请求参数包含 `timestamp`、`timeZone`。
  2. 登录 Cloudflare D1 控制台执行 `SELECT * FROM conversation_logs ORDER BY created_at DESC LIMIT 10;`，检查最新数据是否与 App 行为一致。
  3. 在 App 内访问“日志上传状态”界面，确保 pending 为 0，再进行日记生成流程验证。

---

以上即前端详细改造方案，可作为 PR 说明或任务拆解基线。欢迎补充需求或提出疑问。**
