# ATRI - AI 情感陪伴系统

<div align="center">

**具有革命性混合记忆检索的 AI 情感陪伴系统**

现代化的 Android 客户端 + Cloudflare Worker 边缘计算后端

</div>

---

## 🚀 技术创新亮点

ATRI 不仅仅是普通的AI聊天应用，我们在以下领域实现了重大技术突破：

### 🧠 **混合记忆检索系统 (Hybrid Memory Retrieval)**
业界首创的多层记忆架构，让AI真正拥有"记忆"和"回忆"能力：

- **长期日记记忆**：通过 Vectorize 向量数据库检索历史日记，匹配时自动回溯完整对话记录
- **短期工作记忆**：实时构建当日对话时间线，保持对话的连贯性和上下文
- **动态记忆组合**：智能融合长期记忆与短期记忆，为每次对话提供个性化的历史上下文

**实现原理**：当用户输入内容时，系统会：
1. 向量检索相关记忆片段（日记、对话片段等）
2. 匹配到日记记录时，获取当天的完整对话历史
3. 将相关记忆动态注入到AI的提示词中，形成连贯的"回忆"体验

### 🎭 **动态提示词系统**
突破传统静态提示词限制，实现实时动态人格构建：

- **时空感知**：根据客户端时间自动调整AI状态（清晨的困意、深夜的感性）
- **分阶段关系模型**：5个情感阶段（初遇→熟识→亲近→心动→挚爱），每阶段不同的表达方式
- **记忆上下文注入**：实时检索的相关记忆、长期回忆、工作记忆动态组合
- **人格一致性**：核心记忆碎片确保亚托莉的性格特征在对话中保持一致

### 🌐 **Cloudflare Workers 边缘计算**
充分利用现代云原生技术的优势：

- **全球低延迟**：基于 Cloudflare 全球网络，智能路由到最近的边缘节点
- **无服务器架构**：自动扩缩容，按实际使用量付费，零运维成本
- **现代技术栈**：TypeScript + itty-router + Vectorize + D1 + R2 的全栈解决方案

### 📔 **智能日记生成系统**
让AI拥有真正的"自我反思"能力：

- **自动化生成**：定时任务分析每日对话，自动生成个性化日记
- **情感状态分析**：智能检测对话中的情绪变化，记录真实情感历程
- **记忆巩固机制**：生成的日记自动向量化存储，成为长期记忆的一部分
- **混合回忆触发**：日记内容可通过向量检索触发完整的历史回忆

### 🎨 **多模态交互体验**
丰富的交互方式，让沟通更自然：

- **图片理解**：支持图片输入和描述
- **流式响应**：SSE实时流式输出，如同真人对话
- **附件处理**：支持文档、图片等多种文件类型
- **跨平台同步**：Android客户端与云端无缝同步

---

## 🏗️ 技术架构详解

### 核心架构图

```
Android客户端 ──────── Cloudflare Workers (边缘计算)
                      │
    ├─ 对话路由 ─────┤
    │  ├─ 混合记忆检索系统 (Vectorize)
    │  │  ├─ 长期日记记忆检索
    │  │  ├─ 短期工作记忆构建
    │  │  └─ 动态记忆组合注入
    │  │
    │  ├─ 动态提示词构建器
    │  │  ├─ 时空感知适配
    │  │  ├─ 关系阶段判断
    │  │  ├─ 记忆上下文注入
    │  │  └─ 人格一致性维护
    │  │
    │  ├─ AI 对话服务 (GPT-5)
    │  └─ 智能日记生成器
    │
    ├─ 数据存储层
    │  ├─ D1: 对话日志 + 日记条目
    │  ├─ Vectorize: 向量记忆索引
    │  └─ R2: 多媒体文件存储
    │
    └─ 自动化任务
       └─ 定时日记生成 (Cron Triggers)
```

### 系统组成与创新

| 组件 | 技术栈 | 核心创新 | 主要职责 |
|------|--------|----------|----------|
| **Android 客户端** | Kotlin + Jetpack Compose + Room | 响应式UI + 本地缓存 | 用户界面、实时交互、离线支持 |
| **Cloudflare Worker** | TypeScript + itty-router | **混合记忆检索 + 动态提示词** | API 服务、AI 调用、记忆管理 |
| **向量数据库** | Cloudflare Vectorize | **多层记忆架构** | 日记向量化、语义检索、记忆关联 |
| **结构化存储** | Cloudflare D1 | 对话日志 + 日记管理 | 历史对话、日记条目、用户数据 |
| **文件存储** | Cloudflare R2 | 多媒体处理 | 图片、文档、附件存储 |
| **AI 服务** | GPT-5 + BGE-M3 | **情感化对话 + 智能日记** | 自然语言生成、语义嵌入 |

### 应用图标设计

当前应用图标采用ATRI的可爱照片设计：

<div align="center">

![ATRI应用截图](ATRI-APP.jpg)

</div>



## 快速部署

### 环境要求

**开发环境**：
- Node.js 18+
- Python 3.8+
- Android Studio Arctic Fox+
- Cloudflare 账号

**运行环境**：
- Android 7.0+ (API Level 24+)
- 稳定的网络连接

### 一键部署流程

```bash
# 1. 克隆项目仓库
git clone https://github.com/MIKUSCAT/ATRI.git
cd ATRI

# 2. 部署 Cloudflare Worker 后端
cd worker
npm install
npm run deploy

# 3. 构建 Android 应用
cd ../ATRI
python ../scripts/sync_shared.py
./gradlew assembleDebug

# 4. 安装到设备
adb install app/build/outputs/apk/debug/app-debug.apk
```

部署完成后，在手机应用中输入 Worker URL 即可开始使用。

---

## Cloudflare Worker 部署指南

### 资源创建

在 Cloudflare Dashboard 中依次创建：

1. **D1 数据库**
   ```bash
   wrangler d1 create atri_diary
   ```

2. **Vectorize 向量索引**
   ```bash
   wrangler vectorize create atri-memories
   ```

3. **R2 存储桶**
   ```bash
   wrangler r2 bucket create atri-media
   ```

### 环境变量配置

```bash
# OpenAI API 密钥
wrangler secret put OPENAI_API_KEY

# SiliconFlow 嵌入服务密钥
wrangler secret put EMBEDDINGS_API_KEY

# 管理员 API 密钥（可选）
wrangler secret put ADMIN_API_KEY
```

### 数据库初始化

```bash
# 执行数据库架构
wrangler d1 execute atri_diary --file=db/schema.sql

# 验证表创建
wrangler d1 execute atri_diary --command "SELECT name FROM sqlite_master WHERE type='table';"
```

### 自定义域名绑定

1. 在 Cloudflare DNS 中添加 CNAME 记录
2. 在 Worker 设置中绑定自定义域名
3. 配置 SSL 证书（自动管理）

推荐域名格式：`atri.yourdomain.com`

---

## Android 客户端配置

### 应用签名（发布版本）

```bash
# 生成签名密钥
keytool -genkey -v -keystore atri-release.keystore -alias atri -keyalg RSA -keysize 2048 -validity 10000

# 配置签名信息
# 在 app/build.gradle.kts 中添加签名配置
```

### 应用图标自定义

1. 替换图标文件：
   - 前景：`app/src/main/res/drawable/ic_launcher_foreground.xml`
   - 背景：`app/src/main/res/values/colors.xml`

2. 生成多分辨率图标：
   ```bash
   # 使用 Android Studio 的 Image Asset Studio
   # 或使用命令行工具生成各种尺寸
   ```

3. 适配不同设备：
   - 确保图标在启动器、设置、通知栏中显示正常
   - 测试深色模式和浅色模式下的效果

### 应用配置选项

在设置页面中，用户可以配置：
- Worker 服务地址
- 用户昵称
- 模型选择
- 超时设置
- 数据清理选项

---

## 🔌 API 接口文档

### 智能对话接口 - 混合记忆检索

#### 核心聊天接口

```http
POST /chat
Content-Type: application/json

{
  "userId": "user_unique_identifier",
  "content": "用户输入内容",
  "recentMessages": [
    {"content": "历史消息", "isFromAtri": true}
  ],
  "currentStage": 2,
  "userName": "用户昵称",
  "clientTimeIso": "2025-01-17T22:30:00+08:00",
  "attachments": [
    {"type": "image", "url": "图片URL"}
  ]
}
```

**智能处理流程**：
1. **混合记忆检索**：自动检索相关记忆片段（日记+对话）
2. **动态提示词构建**：根据时间、阶段、记忆构建个性化提示词
3. **时空感知适配**：根据客户端时间调整AI状态
4. **流式响应**：实时返回AI回复过程

**响应格式** (SSE 流)：
```
data: {"type":"reasoning","content":"思考过程内容"}
data: {"type":"text","content":"回复内容"}
```

### 智能日记系统接口

#### 自动日记生成接口

```http
POST /diary/generate
Content-Type: application/json

{
  "userId": "user_unique_identifier",
  "date": "2025-01-17",
  "conversation": "可选：自定义对话内容",
  "userName": "用户昵称",
  "persist": true
}
```

**智能生成流程**：
1. **对话分析**：智能分析当日对话内容和情感变化
2. **情绪检测**：自动识别开心、难过、期待等情感状态
3. **日记撰写**：以亚托莉的第一人称视角撰写个性化日记
4. **记忆巩固**：生成日记自动向量化，成为长期记忆

**响应格式**：
```json
{
  "diary": "生成的日记内容",
  "highlights": ["重点事件1", "重点事件2"],
  "mood": "情感状态",
  "saved": true
}
```

#### 日记生成接口

```http
POST /diary/generate
Content-Type: application/json

{
  "userId": "user_unique_identifier",
  "date": "2025-01-17"
}
```

**响应格式**：
```json
{
  "diary": "生成的日记内容",
  "highlights": ["重点事件1", "重点事件2"],
  "mood": "情感状态",
  "timestamp": "生成时间戳"
}
```

#### 文件上传接口

```http
POST /upload
Headers:
  X-File-Name: filename.ext
  X-File-Type: MIME类型
  X-File-Size: 文件大小
  X-User-Id: 用户ID

Body: 二进制文件数据
```

### 完整接口列表

| 方法 | 路径 | 功能描述 |
|------|------|----------|
| POST | `/chat` | 智能对话，支持 SSE 流式响应 |
| POST | `/conversation/log` | 记录对话日志 |
| GET | `/conversation/last` | 获取最近对话记录 |
| POST | `/diary/generate` | 生成日记内容 |
| GET | `/diary` | 获取指定日期日记 |
| GET | `/diary/list` | 获取日记列表 |
| POST | `/diary/index` | 将日记索引到向量数据库 |
| POST | `/upload` | 上传文件到 R2 存储 |
| GET | `/media/:key` | 获取已上传文件 |
| POST | `/admin/clear-user` | 清理用户数据（需管理员权限） |

---

## 💾 数据模型 - 混合记忆架构

### 结构化数据存储 (D1)

#### conversation_logs 表 - 对话日志
**创新点**：为短期工作记忆提供数据基础

| 字段名 | 类型 | 描述 | 技术作用 |
|--------|------|------|----------|
| id | TEXT | 主键，UUID 格式 | 唯一标识 |
| user_id | TEXT | 用户唯一标识 | 记忆隔离 |
| date | TEXT | 对话日期 (YYYY-MM-DD) | 时间线构建 |
| role | TEXT | 角色 (user/atri) | 对话结构 |
| content | TEXT | 对话内容 | 记忆内容 |
| attachments | TEXT | 附件信息 (JSON) | 多模态支持 |
| timestamp | INTEGER | 时间戳 | 工作记忆排序 |
| user_name | TEXT | 用户昵称 | 个性化 |
| time_zone | TEXT | 时区信息 | 时空感知 |

#### diary_entries 表 - 智能日记
**创新点**：长期记忆的核心载体，连接过去与现在

| 字段名 | 类型 | 描述 | 记忆功能 |
|--------|------|------|----------|
| id | TEXT | 主键，格式：diary:userId:date | 日记唯一性 |
| summary | TEXT | 日记摘要 | 快速检索 |
| content | TEXT | 日记完整内容 | 详细回忆 |
| mood | TEXT | 情感状态 | 情感记忆 |
| status | TEXT | 状态 (pending/ready/error) | 生成状态 |
| created_at | INTEGER | 创建时间 | 时间轴 |
| updated_at | INTEGER | 更新时间 | 版本控制 |

### 向量记忆索引 (Vectorize) - 混合检索核心

#### 向量元数据结构
**创新点**：支持多层记忆检索的智能索引系统

```json
{
  "u": "用户ID",
  "c": "分类 (diary/chat)",
  "d": "日期或标识符",
  "m": "情感状态",
  "imp": "重要性评分 (1-10)",
  "ts": "时间戳",
  "k": "关键词/标题",
  "t": "文本片段"
}
```

#### 记忆检索策略
**混合检索流程**：
1. **向量相似度检索**：基于语义相似度找到相关记忆
2. **分类过滤**：区分日记记忆和对话记忆
3. **时间权重**：近期记忆权重更高
4. **重要性排序**：根据重要性评分优化检索结果
5. **动态组合**：多种记忆类型智能组合

### 动态提示词构建 - AI人格核心

#### 提示词组成结构
```
┌─ 基础人格设定 (base)
├─ 核心记忆碎片 (coreMemories)
├─ 时空感知适配 (innerThoughts + clientTime)
├─ 对话上下文 (contextInfo)
├─ 关系阶段模型 (stages[1-5])
├─ 检索相关记忆 (relatedMemories)
├─ 长期回忆内容 (longTermContext)
└─ 工作记忆时间线 (workingMemoryTimeline)
```

#### 关系阶段模型
**五阶段情感发展**：
- **阶段1 - 初遇** (1-40条消息)：好奇试探，礼貌客气
- **阶段2 - 熟识** (41-200条消息)：轻松自然，主动分享
- **阶段3 - 亲近** (201-400条消息)：温暖依恋，关心细节
- **阶段4 - 心动** (401-700条消息)：紧张悸动，害羞表达
- **阶段5 - 挚爱** (700+条消息)：深情相依，珍惜当下

---

## 运维管理

### 监控与日志

```bash
# 实时查看 Worker 日志
wrangler tail --format pretty

# 查看 Cron 任务执行情况
wrangler triggers list

# 检查资源使用情况
wrangler r2 object list atri-media
```

### 数据备份与恢复

```bash
# 导出 D1 数据
wrangler d1 export atri_diary --output=backup.sql

# 导入 D1 数据
wrangler d1 execute atri_diary --file=backup.sql

# 批量下载 R2 文件
wrangler r2 object get atri-media backup.zip --recursive
```

### 性能优化

**Worker 优化**：
- 合理设置请求超时时间
- 使用缓存减少重复计算
- 优化向量检索参数

**Android 优化**：
- 使用 Room 数据库索引
- 实施图片压缩和缓存
- 优化网络请求批次处理

---

## 安全与隐私

### 数据安全措施

- **传输加密**：所有 API 通信使用 HTTPS
- **数据隔离**：用户数据严格隔离存储
- **访问控制**：细粒度的 API 权限管理
- **数据清理**：支持用户一键删除所有数据

### 隐私保护策略

- **最小化收集**：仅收集必要的交互数据
- **用户控制**：用户完全控制自己的数据
- **透明处理**：开源代码，数据处理流程透明
- **合规运营**：遵循主要地区隐私法规

### 安全配置建议

```bash
# 设置强密码策略的 API 密钥
wrangler secret put ADMIN_API_KEY

# 启用 Cloudflare Rate Limiting
# 在 Dashboard 中配置请求频率限制

# 配置 WAF 规则
# 启用 Web 应用防火墙保护
```

---

## 常见问题与解决方案

### 部署问题

**Q: Worker 部署失败**
```bash
# 检查认证状态
wrangler whoami

# 详细错误信息
wrangler deploy --verbose

# 验证资源绑定
wrangler d1 list && wrangler r2 bucket list
```

**Q: Android 构建失败**
```bash
# 清理项目缓存
./gradlew clean

# 检查依赖冲突
./gradlew dependencies

# 同步配置文件
python ../scripts/sync_shared.py
```

### 运行时问题

**Q: 对话响应异常**
1. 检查网络连接状态
2. 验证 Worker URL 正确性
3. 查看 Cloudflare 实时日志
4. 确认 API 密钥配置

**Q: 文件上传失败**
1. 检查 R2 存储权限
2. 验证文件大小限制
3. 确认正确的请求头格式

**Q: 日记生成异常**
1. 检查 D1 数据库连接
2. 验证 OpenAI API 配额
3. 查看详细错误日志

---

## 开发指南

### 开发环境设置

```bash
# Worker 开发环境
cd worker
npm install
npm run dev  # 本地开发服务器

# Android 开发环境
cd ATRI
./gradlew assembleDebug  # 构建调试版本
```

### 代码贡献

1. Fork 项目仓库
2. 创建功能分支
3. 提交代码更改
4. 创建 Pull Request

### 自定义 AI 人格

修改 `shared/prompts.json` 文件：

```json
{
  "chat": {
    "base": "AI 角色基础描述",
    "coreMemories": ["核心记忆条目"],
    "stages": {
      "1": "初遇阶段描述",
      "2": "熟悉阶段描述"
    }
  }
}
```

同步更新：
```bash
python scripts/sync_shared.py
```

---

## 🏆 项目信息与技术创新

### 开发团队

- **MIKUSCAT** - 核心开发者 & 产品设计
- **codex** - 技术架构师 & 系统实现

### 技术创新总结

ATRI 项目在以下领域实现了行业领先的技术突破：

🧠 **混合记忆检索系统**
- 业界首创多层记忆架构（日记+对话+工作记忆）
- 智能记忆关联与动态组合
- 真正实现AI的"回忆"能力

🎭 **动态人格构建**
- 实时动态提示词系统
- 时空感知的AI状态适配
- 五阶段情感关系模型

🌐 **边缘计算架构**
- Cloudflare Workers 全球部署
- 毫秒级响应时间
- 零运维成本

📔 **智能日记生成**
- 自动化情感分析
- 个性化日记撰写
- 记忆巩固机制

### 项目状态

- **当前版本**: v1.0.0
- **开发状态**: 活跃开发中
- **技术栈**: TypeScript + Kotlin + Cloudflare
- **许可证**: MIT License

### 开源贡献

我们相信技术创新应该开源共享，欢迎社区参与：

- **技术交流**: 讨论混合记忆检索、动态提示词等创新技术
- **功能贡献**: 欢迎提交新的情感交互模式
- **架构优化**: 边缘计算性能优化建议

### 联系方式

- **项目地址**: https://github.com/MIKUSCAT/ATRI
- **问题反馈**: https://github.com/MIKUSCAT/ATRI/issues
- **技术讨论**: https://github.com/MIKUSCAT/ATRI/discussions

---

<div align="center">

# 🚀 ATRI - 具有革命性记忆系统的AI情感伴侣

**重新定义AI与人类的交互边界**

基于混合记忆检索 + 动态人格构建 + 边缘计算

<div>

**"我想完成主人留给我的最后的命令。在此之前，我会成为你的腿！"**

*—— 亚托莉 (ATRI)*

</div>

</div>