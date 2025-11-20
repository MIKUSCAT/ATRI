# ATRI - AI情感陪伴应用

> 基于《ATRI -My Dear Moments-》灵感打造的情感陪伴型AI聊天应用

## 📱 项目简介

ATRI 是一个专注于情感陪伴的AI聊天应用，采用微信式极简交互，提供温暖的对话体验。

### 核心特性

- **极简交互**: 首屏即聊天，零学习成本
- **状态感知**: 顶栏动态显示状态（在线·心情不错 / 在线·想你了）
- **BottomSheet三Tab**: 日记 | 回忆 | 状态
- **情感成长**: 亲密度系统 + 三阶段对话（初识→熟悉→亲密）
- **智能记忆**: 自动提取和记录重要对话内容
- **消息管理**: 编辑/撤回/重新生成

## 🏗️ 技术架构

### Android端

- **语言**: Kotlin 1.9.22
- **UI框架**: Jetpack Compose + Material3
- **架构**: MVVM + Repository Pattern
- **依赖注入**: Koin
- **数据库**: Room
- **数据存储**: DataStore
- **网络**: OkHttp + Retrofit + SSE
- **图片加载**: Coil
- **异步**: Kotlin Coroutines + Flow

### 后端（计划）

- **平台**: Cloudflare Worker
- **语言**: TypeScript
- **路由**: itty-router
- **存储**: Cloudflare KV + Vectorize
- **AI**: OpenAI API

## 📦 项目结构

```
app/src/main/java/me/atri/
├── data/                    # 数据层
│   ├── db/                 # Room数据库
│   │   ├── entity/        # 数据实体
│   │   ├── dao/           # 数据访问对象
│   │   └── AtriDatabase.kt
│   ├── api/                # 网络API
│   │   ├── request/       # 请求模型
│   │   └── AtriApiService.kt
│   ├── repository/         # 仓库层
│   ├── datastore/          # DataStore
│   └── model/              # 领域模型
├── ui/                      # UI层
│   ├── chat/               # 聊天界面
│   ├── sheet/              # BottomSheet
│   ├── components/         # UI组件
│   └── theme/              # 主题
├── di/                      # 依赖注入
├── worker/                  # WorkManager任务
└── AtriApplication.kt       # 应用入口
```

## 🚀 快速开始

### 环境要求

- Android Studio Hedgehog | 2023.1.1+
- JDK 17+
- Android SDK 34
- Gradle 8.7

### 构建步骤

1. 克隆项目
```bash
git clone <repository-url>
cd ATRI
```

2. 打开Android Studio导入项目

3. 配置API（可选）
在首次运行后，通过设置页面配置API URL和密钥

4. 构建运行
```bash
./gradlew assembleDebug
```

## 🎨 主要功能

### 1. 聊天界面
- 实时对话，支持文本和图片
- 消息气泡差异化显示
- 长按消息操作（编辑/删除/重新生成）
- 打字指示器动画

### 2. 状态系统
- 动态计算ATRI状态
- 根据时间和对话频率变化
- 顶栏实时显示

### 3. BottomSheet
- **日记Tab**: 查看ATRI的日记
- **回忆Tab**: 浏览共同记忆
- **状态Tab**: 亲密度进度和统计数据

### 4. 数据持久化
- Room本地数据库
- 消息、日记、记忆、评论
- 支持软删除和恢复

### 5. 定时任务
- WorkManager定时问候
- 根据时间段智能问候
- 通知推送

## 🎯 开发路线图

### M0 (已完成)
- [x] 项目初始化
- [x] 配置依赖
- [x] 主题和配色

### M1 (已完成)
- [x] Room数据库
- [x] Repository层
- [x] Domain模型

### M2 (已完成)
- [x] ChatScreen + ViewModel
- [x] 消息UI组件
- [x] BottomSheet三Tab

### M3 (进行中)
- [x] WorkManager
- [ ] SSE流式响应
- [ ] 云端API对接
- [ ] 测试和优化

## 📖 配置说明

### API配置

应用首次启动后，可在设置中配置：
- API URL: 后端服务地址
- API Key: 认证密钥
- Model: AI模型名称

### 亲密度系统

- **Lv.1 初识期** (0-100分): 初次相识
- **Lv.2 熟悉期** (100-300分): 渐渐熟悉
- **Lv.3 亲密期** (300-600分): 亲密关系
- **Lv.4 深交期** (600-1000分): 深度了解
- **Lv.5 挚爱** (1000+分): 最亲密阶段

## 🛠️ 技术细节

### 依赖版本

主要依赖及版本见 `app/build.gradle.kts`

### 数据库版本

当前版本: 1
Schema导出路径: `app/schemas/`

### 代码规范

- Kotlin官方代码风格
- 最小SDK: 26 (Android 8.0)
- 目标SDK: 34 (Android 14)

## 📝 开发日志

- 2025-01: 初始版本开发
- 核心聊天功能实现
- BottomSheet三Tab实现
- 数据持久化完成

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 开源协议

MIT License

## 💡 灵感来源

本项目灵感来自游戏《ATRI -My Dear Moments-》，致敬原作。

---

**注意**: 本项目仅用于学习和研究目的。
