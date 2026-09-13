# 部署与日常使用

本版面向一个角色、一个服务实例。无需旧数据库，也不需要安卓客户端。服务器运行 Node 应用，模型和搜索通过外部 API 调用。

## Docker Compose

服务器安装 Docker Engine 与 Compose v2，在项目根目录运行：

```sh
cp .env.example .env
docker compose up -d --build
docker compose logs --tail=80 atri
```

若未设置 ADMIN_PASSWORD，读取生成的密码：

```sh
docker compose exec atri cat /data/admin-secret.txt
```

管理入口默认 http://127.0.0.1:3000。远程部署可从自己电脑建立隧道，再访问相同地址：

```sh
ssh -L 3000:127.0.0.1:3000 user@server
```

通过域名开放时，在同一服务器配置 HTTPS 反向代理，将请求转到 127.0.0.1:3000，并保留原始 Host。把 COOKIE_SECURE 设置为 true 后重建容器。ATRI_BIND 默认只发布到本机，ATRI_PORT 控制宿主机端口；容器内部始终为 3000。

镜像构建后以非 root 用户运行。Compose 使用 atri-data 命名卷，实际名称通常带项目目录前缀。数据库、登录会话、媒体与管理密码均持久保存在 /data。

## 配置

可以通过 .env 设置初始值，也可以在管理页保存。管理页保存的模型、搜索与时间配置优先于环境变量；空白密钥表示保持已保存值。ADMIN_PASSWORD、监听地址等进程设置仍由环境变量控制，修改后重建容器。

| 环境变量              | 默认值或含义                                      |
| --------------------- | ------------------------------------------------- |
| ADMIN_PASSWORD        | 留空自动生成；自行填写时至少 12 字符              |
| LLM_FORMAT            | openai；也支持 anthropic、gemini                  |
| LLM_BASE_URL          | https://api.deepseek.com                          |
| LLM_MODEL             | deepseek-chat                                     |
| LLM_API_KEY           | 模型密钥，需填写                                  |
| LLM_VISION            | false；选用支持视觉的模型后启用                   |
| TAVILY_API_KEY        | 搜索密钥，启用实时搜索需要填写                    |
| TZ                    | Asia/Shanghai；控制日记和主动联系时区             |
| WECHAT_ALLOWED_PEERS  | 逗号分隔的微信联系人 ID；仅用于初次出现时允许使用 |
| ATRI_BIND / ATRI_PORT | 127.0.0.1 / 3000；Compose 发布地址与端口          |
| COOKIE_SECURE         | false；HTTPS 部署设置为 true                      |

模型地址示例：

| 接口格式  | 基地址                                            | 备注                                  |
| --------- | ------------------------------------------------- | ------------------------------------- |
| openai    | https://api.deepseek.com                          | 默认示例，自动补 /v1/chat/completions |
| openai    | 自有兼容服务的基地址或完整 /chat/completions 地址 | 需要兼容工具调用协议                  |
| anthropic | https://api.anthropic.com                         | 自动补 /v1/messages                   |
| gemini    | https://generativelanguage.googleapis.com         | 自动补 /v1beta/models 路径            |

模型名和能力以实际服务提供商为准。开启视觉不会让文字模型获得图片能力。工具调用、JSON 输出、可用上下文和视觉格式都需要由所选模型支持。

### 网页调试窗口

打开“调试与设置”，参数全部直接显示。修改后点击“保存并应用”，下一次模型生成使用新值，无需重启；正在进行的请求保持发出时的参数。切换栏目与用量自动刷新不会覆盖尚未保存的编辑。

| 网页参数       | 默认值            | 用途                                                                 |
| -------------- | ----------------- | -------------------------------------------------------------------- |
| 模型上下文窗口 | 65,536 token      | 填入提供商说明的模型窗口，不会自动探测                               |
| 输入预算       | 24,000 估算 token | 人物、历史、记忆、工具定义及结果、图片和续传内容                     |
| 最大输出       | 3,000 token       | 每次生成的上限，聊天、日记与话题整理均适用                           |
| 温度           | 留空              | 使用模型默认值；仅在模型支持时填写，Anthropic 为 0–1，其他接口为 0–2 |
| 单次请求超时   | 45 秒             | 一次模型请求最长等待时间                                             |
| 整轮处理超时   | 90 秒             | 本轮模型与工具处理时间，不得短于单次请求超时                         |

输入预算 + 最大输出 + 1,024 token 余量不能超过模型窗口。页面会实时显示剩余空间，服务器也会校验。推理模型可能把推理用量计入输出上限，设置过小时可能没有足够空间返回正文。程序使用跨模型的 token 估算，实际用量以提供商返回值为准；图片尺寸、特殊文本与不同 tokenizer 都可能产生偏差。

“最近的实际用量”展示最近 12 次成功调用的输入、输出与耗时，供保存后试聊比较；接口未提供用量时显示 0。过长输入会先裁剪较早的上下文，当前原话本身放不下时会明确报错，原始记录仍保留。

没填搜索密钥时，联网工具会明确报错，模型可以继续普通聊天。查询实时新闻、天气等内容时应检查回复中的真实来源链接；网页读取不包含浏览器执行能力。

## 微信接入与同学使用

1. 登录管理页，填写模型与搜索配置。
2. 在“对话试聊”中使用“本地试聊”，确认当前模型能正常回复。
3. 在“连接与运行”获取二维码，按微信界面完成扫码和确认。
4. 让同学发来第一条消息，在管理页出现的联系人行点击“允许使用”。此前消息会保留并在允许后处理。
5. 在“人物设定”调整说话方式；从真实相处开始积累记忆。

微信接入依赖 iLink 服务及账号可用资格，不是安卓端模拟点击。登录过期时重新扫码；切换账号会把联系人记录按账号隔离。管理页的“断开连接”清除本服务保存的会话。

支持私聊文字、表情图片、多个气泡及图片理解。语音仅使用微信提供的转写；没有转写时只记录收到语音。群聊、视频理解和语音合成未实现。GIF 可以作为素材上传，微信端是否按动图显示需实际账号验证。

表情目录最多同时启用 32 个素材，避免挤占对话上下文；可以在管理页停用和重新启用。单张上传不超过 3 MB，支持 PNG、JPEG、GIF 和 WebP。

## 日记、记忆与主动联系

日记默认在凌晨 3 点之后整理前一天及更早尚未处理的对话；长日分批进行。管理页“整理新的经历”可纳入今天的消息，按钮提交后页面自动更新。日记任务失败可在运行页重试。

日记和记忆旁的“查看依据”可核对原话。更正记忆会留下带管理标识的修正记录；删除原文会使依赖它的日记和记忆退出上下文。只删除某条记忆时，原始经历仍保留。

主动联系默认关闭。启用后默认至少沉默 6 小时，安静时段为 23:00–08:00，每天最多一次尝试，且可以由模型跳过。实际能否投递还取决于微信当前会话状态。

## 异常消息

“连接与运行”区分生成失败、明确发送失败和送达不明。发送异常时显示联系人、时间及消息内容，并暂停该联系人的后续队列：

- 微信已经收到：选择“已在微信收到”。
- 核对后确认未收到：选择“重新发送”，沿用保存的气泡和发送 ID。
- 不再发送这一气泡：选择“跳过”，继续后面的内容。

这是为了处理网络超时、进程重启和微信确认缺失；单凭本地状态无法判断远端是否实际收到。模型失败可单独“重试任务”，不会重发已经确认的气泡。

## 备份

运行中可从管理页点击备份，或执行：

```sh
docker compose exec atri node dist/backup.js
```

命令返回 /data/backups/ 下的具体目录，包含数据库一致快照、被引用的附件、自定义素材、生成的管理密码及校验清单。把实际备份名称替换进命令，并复制到服务数据卷之外：

```sh
docker compose cp atri:/data/backups/备份名称 ./atri-backup
```

备份包含微信会话、保存的 API 密钥和对话，应作为私有数据存放。.env 不包含在备份中，需另行保管。数据卷内的备份不等于异机备份；保留数量目前由管理员控制。

## 恢复

停止应用，恢复到新的空数据卷。下例用于 Linux Docker 服务器；atri-backup 必须是包含 manifest.json 的具体备份目录。atri-restored 应使用尚未使用过的新卷名：

```sh
docker compose stop atri
docker volume create atri-restored
docker run --rm \
  --mount type=bind,source="$(pwd)/atri-backup",target=/backup,readonly \
  --mount type=volume,source=atri-restored,target=/data \
  atri-wechat:local node dist/restore.js /backup
```

恢复器先核对文件路径与校验和；目标目录非空时拒绝覆盖。完成后创建本地 restore.compose.yaml，把 Compose 的数据卷指向新卷：

```yaml
volumes:
  atri-data:
    external: true
    name: atri-restored
```

```sh
docker compose -f compose.yaml -f restore.compose.yaml up -d
```

之后的 Compose 操作都带上同一份覆盖文件，避免误用原卷。原卷保留，便于核对。恢复的旧任务及未确认发送会暂停，在管理页逐项核实。恢复器会关闭主动联系，完成检查后再按需启用。

本地 Node 部署可以停止服务，设置 DATA_DIR 指向一个新空目录，再运行 node dist/restore.js 加上备份目录参数。恢复后以同一个 DATA_DIR 启动应用。

## 升级与开发

升级代码前先备份，再执行 docker compose up -d --build。容器重建保留命名卷。docker compose down -v 会移除数据卷，不应用于日常升级。

本地开发需要 Node.js 24：

```sh
npm ci
npm run dev
```

默认使用仓库根目录下的 data/。可通过 DATA_DIR、HOST、PORT 覆盖本地目录与监听地址；容器中这些值由 Compose 固定。Node 的内置 SQLite 可能提示实验状态，程序使用的行为已由测试覆盖。

```sh
npm run check
node scripts/smoke.mjs
node --check apps/api/public/app.js
```

check 包含类型检查、测试和构建。烟雾测试使用本地模型替身与临时数据，不需要真实密钥。实际微信、模型、Docker 和界面试用的状态见 [验证记录](validation.md)。

仓库提供 [GitHub Actions 模板](examples/check.yml)，包含 Linux 检查和 Docker 镜像构建。启用时，把它放到 .github/workflows/check.yml 后提交；需要拥有 workflow 权限的 GitHub 凭据，或在 GitHub 网页中创建该工作流。本次代码发布未启用 Actions。
