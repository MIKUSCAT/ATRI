# Zeabur 部署（让你点域名直接进控制台）

这份文档只讲 `server` 这个后端（它自带网页管理后台 `/admin`）。`ATRI - VPS` 那个目录更像是安卓客户端，不是 Zeabur 上要跑的东西。

## 你会得到什么

- Zeabur 自动生成一个公网域名（`https://xxxx.zeabur.app`）
- 直接打开这个域名会跳转到 `/admin`，登录后进入控制台
- 数据库和媒体目录都做持久化（重启不丢数据）

## 0）准备：先把镜像推到 GHCR（用于“一键部署模板”）

本分支已提供 GitHub Actions，会自动把后端构建成镜像并推到 GHCR。

你需要做的事只有两步：

1. 把 `vps-server` 分支 push 到 GitHub
2. 等 Actions 跑完（Build & Push ATRI Server），就会得到镜像：
   - `ghcr.io/mikuscat/atri-server:latest`

首次生成镜像后，请去 GitHub 仓库的 **Packages**，把 `atri-server` 这个包设为 **Public**（不然 Zeabur 拉不到镜像）。

> 不想用镜像也行：你也可以在 Zeabur 里直接用 Git + Dockerfile 构建（不走模板）。

## 1）在 Zeabur 创建项目 + 数据库（pgvector）

1. Zeabur 新建 Project
2. 添加一个服务（Docker Image / Prebuilt）
3. Image 填：`pgvector/pgvector:pg16`
4. 配环境变量：
   - `POSTGRES_USER=atri`
   - `POSTGRES_PASSWORD=（自己生成一个强密码）`
   - `POSTGRES_DB=atri`
5. 配 Volume（持久化）：
   - 挂载到：`/var/lib/postgresql/data`
6. Ports（让同项目服务能连到它）：
   - 端口：`5432`
   - 类型：`TCP`

说明：本项目用到了 `vector` 类型，所以不要用“纯 Postgres”，最好就是这个 `pgvector/pgvector` 镜像。

## 2）在 Zeabur 创建 API 服务（跑本项目）

1. 添加一个服务（Docker Image / Prebuilt）
2. Image 填：`ghcr.io/mikuscat/atri-server:latest`
3. 端口（HTTP）：
   - 端口：`3111`
   - 类型：`HTTP`
4. 配 Volume（持久化媒体/导入）：
   - 挂载到：`/data`

## 3）API 服务必须配的环境变量（最关键）

### 3.1 数据库连接

假设你数据库服务的名字叫 `db`，推荐你这样配（强密码带特殊字符也不怕）：

```env
POSTGRES_HOST=db.zeabur.internal
POSTGRES_PORT=5432
POSTGRES_USER=atri
POSTGRES_PASSWORD=<POSTGRES_PASSWORD>
POSTGRES_DB=atri
```

如果你数据库服务不叫 `db`，把 `POSTGRES_HOST` 改成你的服务名，例如 `postgres.zeabur.internal`。

> 你也可以继续用 `DATABASE_URL`，但如果密码里有 `@ : / # ?` 这类字符，需要先做 URL 编码；不想折腾就用上面的 `POSTGRES_*`。

### 3.2 后台可公网访问 + 登录

```env
ADMIN_PUBLIC=1
ADMIN_API_KEY=（后台登录密码，自己生成一个强密码）
ADMIN_CONFIG_ENCRYPTION_KEY=（用于加密保存上游 Key，强烈建议；推荐用 openssl rand -base64 32 生成）
```

### 3.3 你的业务鉴权（API 调用用）

```env
APP_TOKEN=（给客户端调用后端用的 token，自己生成一个强密码）
```

### 3.4 公开 URL（建议配置）

等 Zeabur 给你生成域名后，把它填进去：

```env
PUBLIC_BASE_URL=https://xxxx.zeabur.app
ADMIN_ALLOWED_ORIGINS=https://xxxx.zeabur.app
```

说明：后台在公网模式会校验 `Origin`，这是为了防跨站请求；配了这两个最省心。

### 3.5 上游 LLM / Embeddings（可以先不填）

你可以部署后进后台再填（运行时配置存 DB，保存即生效）。

如果你想部署时就先填一部分：

```env
OPENAI_API_URL=https://api.openai.com
OPENAI_API_KEY=...
EMBEDDINGS_API_URL=https://api.siliconflow.cn/v1
EMBEDDINGS_API_KEY=...
EMBEDDINGS_MODEL=BAAI/bge-m3
```

注意：`OPENAI_API_URL` 只填到 `/v1` 之前，后台会自动补版本路径（OpenAI/Anthropic → `/v1`，Gemini → `/v1beta`）。

## 4）生成域名并访问后台

1. 在 API 服务的 Domains 里点 Generate Domain，拿到 `https://xxxx.zeabur.app`
2. 直接打开这个域名，会跳转到 `/admin`
3. 输入 `ADMIN_API_KEY` 登录

如果你进不去后台：
- 先看“概览”页里显示的 `allowedOrigins`
- 再确认 `ADMIN_PUBLIC=1`、`PUBLIC_BASE_URL`、`ADMIN_ALLOWED_ORIGINS` 是否正确

## 5）常见坑（按优先级）

1. **访问 404**：没设置 `ADMIN_API_KEY` 或没开 `ADMIN_PUBLIC=1`
2. **登录提示 bad_origin**：`ADMIN_ALLOWED_ORIGINS` / `PUBLIC_BASE_URL` 没配对（要带 `https://`）
3. **服务能跑但 API 500**：上游 Key 没配；进 `/admin → 运行时配置` 填完保存
4. **数据库连不上**：`DATABASE_URL` 里的 host 写错；按你的 db 服务名改成 `xxx.zeabur.internal`
5. **重启后数据丢失**：没配 Volume（DB 的 `/var/lib/postgresql/data`、API 的 `/data`）

## 6）做成“真正的一键链接”（Deploy on Zeabur 按钮）

如果你想要那种“点一下链接就开始部署”的效果，需要把模板发布到 Zeabur：

1. 先确认 GHCR 镜像已经存在并且是 Public（见第 0 步）
2. 确认 `server/` 目录里有 `zeabur.yaml`（本项目已提供）
3. 本地跑（需要你自己在有网络的环境执行）：

```bash
npx zeabur@latest template deploy -f zeabur.yaml
```

4. 按提示登录/选择项目，会输出一个模板链接（形如 `https://zeabur.com/templates/XXXXXX`）
5. 把这个链接放到你的 README 里，就能得到“一键部署按钮”
