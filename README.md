# ATRI · 微信里的对话与日记

ATRI 是一个以《ATRI -My Dear Moments-》为灵感的陪伴对话服务。通过微信聊天，用原始对话、有来源的记忆和第一人称日记保持相处的连续性。人设、语气和情绪表达由提示词结合实际经历生成。

2.0 是完整重构：一个 Node.js 服务、一个 SQLite 数据库，通过 Docker Compose 部署。旧 Android 客户端、Cloudflare Worker、情绪数值、好感度和独立自我模型已移除。新版本从空数据库开始，旧代码仍可在 Git 历史中查看。

## 可以做什么

- 微信扫码接入、私聊文字、按顺序发送多个气泡和表情图片。
- 读取近期原话，按需查询历史、长期记忆和日记；支持纠正、删除和查看依据。
- 长对话整理话题笔记；有新经历时按日写日记，供后续回忆。
- 通过 Tavily 搜索实时信息，读取公开网页并保留来源。
- 使用支持视觉的模型理解图片，保存有明确标识的画面描述。
- 简单管理页：连接、联系人、试聊、日记、记忆、人设、素材、设置和备份。
- 在网页“调试与设置”直接调整模型窗口、输入预算、输出上限、温度与超时，查看最近调用用量；保存后生效。
- 可选主动联系，默认关闭；遵守安静时段，每天最多一次尝试，也可以跳过。

语音只使用微信接口提供的文字转写。表情按图片发送；原生表情、语音合成、群聊和独立安卓端不在本版中。

## 启动

服务器需要 Docker Engine 和 Docker Compose v2。在仓库根目录运行：

```sh
cp .env.example .env
docker compose up -d --build
```

可以先在 .env 设置模型及 Tavily 密钥，也可以启动后到管理页填写。ADMIN_PASSWORD 留空时，服务会生成管理密码：

```sh
docker compose exec atri cat /data/admin-secret.txt
```

打开 http://127.0.0.1:3000。远程服务器默认只绑定本机，可用 SSH 隧道访问：

```sh
ssh -L 3000:127.0.0.1:3000 user@server
```

登录管理页后：

1. 在“调试与设置”中填入模型接口、模型名、密钥和 Tavily 密钥；所选模型需要支持工具调用。
2. 按提供商说明填写上下文窗口，分配输入和输出预算，再用“对话试聊”检查回复。试聊记录独立保存。
3. 在“连接与运行”中获取微信二维码并完成扫码。
4. 让同学发来第一条消息，然后在联系人列表点击“允许使用”。
5. 按需要调整人物设定、表情和日记时间。

默认使用 DeepSeek 的 OpenAI 兼容接口配置，尚未填写密钥。也支持 Anthropic 和 Gemini 原生接口。视觉默认关闭，需要使用兼容的视觉模型后再启用。

人物设定可以在网页用普通文字编辑，无需固定模板。日记与记忆也可以直接阅读、核对来源和更正。页面适配桌面与手机；所有模型参数直接显示在调试页，无需展开高级选项。

[完整部署、配置与备份恢复说明](docs/deployment.md) · [实际架构与记忆规则](docs/design.md) · [验证记录与试用场景](docs/validation.md)

## 本地开发

需要 Node.js 24 或更新版本。运行时使用 Node 内置的 SQLite，无需另外部署数据库。

```sh
npm ci
npm run dev
```

```sh
npm run check
node scripts/smoke.mjs
```

check 包括严格类型检查、自动化测试和构建；smoke 启动编译后的服务器与本地模型替身，通过实际 HTTP 请求验证登录、对话持久化、去重、记忆、日记和备份。

本机启动时默认监听 127.0.0.1:3000；运行数据保存在 data/，管理密码在 data/admin-secret.txt。npm run build 后可用 npm start 运行编译产物。

## 代码结构

```text
apps/api/          管理 API、静态管理页、微信调度与配置
packages/core/     对话循环、上下文、工具、日记与主动联系
packages/ilink/    微信登录、协议、媒体与收发
packages/llm/      模型接口适配
packages/db/       SQLite、检索、持久任务、投递与备份
shared/prompts/    人物、聊天、日记和话题笔记提示词
assets/stickers/   表情图片与含义目录
tests/            新系统行为测试
```

采用单实例运行。消息、任务和每个气泡的发送状态先保存再处理；发送状态不明时暂停该联系人的队列，在管理页核对后继续。旧的待发送消息从备份恢复后也会暂停，避免批量重发。

记忆检索使用 SQLite FTS5 与中文子串匹配。这里借鉴了上下文整理和按需读取的思路，没有实现模型训练、向量数据库或 DeepSeek Engram 模型结构。记忆是否被恰当地使用、人物是否自然，仍需要结合所选模型做真实对话试用。

## 来源与许可

微信协议模块和原测试复用自 [SMNETSTUDIO/WeChat-AI](https://github.com/SMNETSTUDIO/WeChat-AI/tree/cf8fbec)，模块划分也参考了该项目。该部分保留其 Apache 2.0 + Commons Clause 许可，其余 ATRI 代码沿用本仓库的 PolyForm Noncommercial 许可。

详见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。内置的五张基础表情为本项目新绘制的素材。
