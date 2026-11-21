# TechBuzz

科技股投研台跟踪八个 X 账号。首页、全部动态、热点、主题和 Agent 接入使用原版 React 界面。首页按研究分展示精选原帖。全部动态按活动时间展示原创、回复、引用和转发，支持组合筛选。Idea、趋势、日报和收藏各有独立入口。

## 本机运行

需要 Docker Compose。已有本机配置时直接运行以下命令。

```sh
docker compose up --build -d
```

新环境先将 `.env.example` 复制为 `.env`。为 PostgreSQL 密码、会话签名、图片签名、引擎后台密码和研究后台令牌各生成一个独立随机值（例如分别执行 `openssl rand -hex 32`）。配置 `TECHBUZZ_LLM_BASE_URL`、`TECHBUZZ_LLM_API_KEY`、`TECHBUZZ_LLM_MODEL` 和推理强度。默认以 `TECHBUZZ_X_PROVIDER=free` 从公开时间线采集，无需浏览器或采集密钥。如需切回原付费接口，设置 `TECHBUZZ_X_PROVIDER=socialdata` 和 `TECHBUZZ_SOCIALDATA_API_KEY`，再运行 `docker compose up -d`。密钥只放在本机。

打开 [首页](http://127.0.0.1:19282/)、[全部动态](http://127.0.0.1:19282/all)、[引擎管理](http://127.0.0.1:19282/admin) 或 [Agent 接入](http://127.0.0.1:19282/agent)。仅 web 在本机回环地址发布端口。运行 `docker compose down` 可停止此部署并保留数据卷。

## 数据来源与研究流程

- 固定账号为 @aleabitoreddit、@SemiAnalysis_、@Omercheema、@OrnnExchange、@HedgeyeTech、@RYANHINGSHING、@FredaDuan、@TMTLongShort。引用作者保留在上下文中。
- `engine/` 基于本地 4c6e9e1 完整代码树。保留 PostgreSQL、pg-boss 队列、采集、内容处理、事件归组、出版、后台、RSS、OpenAPI、Agent Markdown 和 MCP。反馈和更新日志已移除。
- 引擎 worker 按五分钟间隔检查八个账号。免费模式读取公开时间线和 RSS，再用 FxTwitter 补公开正文、长文和同作者串帖。首次运行分批向前翻页。采集成功时间与已观察到的原帖日期分别记录。镜像有缓存、限流和可见性差异，检查周期不代表发帖到发现的延迟。滚动增量对照上次读到的本人原帖确认分页衔接；历史翻页连续两页本人原帖都越过 30 天后收尾，正常结束后每 48 小时通过备用镜像复查。来源页分别显示回填、待补正文、明确不可读和本轮部分失败。
- 同一原帖的发表与转发分别记录，多人转发保留各自的传播记录。已知转发时间或可验证的增量首次观察时间会标明依据。旧回填转发单列为日期未知，不能用原帖时间或回填时间进入热点。订阅专享正文不在免费采集覆盖范围内。
- 研究 worker 从同一 PostgreSQL 读取帖子、来源状态和采集覆盖，投影到独立 SQLite 卷。已核验样本通过引擎原入库与处理队列导入。样本独立计数，不证明整段时间采集完整。
- 精选与 Idea 共用一套研究评分，投资影响 35、信息增量 25、可验证性 25、持续跟踪价值 15。默认门槛为 70 分，可在后台设置里调整。趋势分析单独使用滚动 30 天证据，可保留低分反证。北京时间 08:00 后生成上一自然日研究日报。热点按滚动 48 小时展示多账号关注事件与单源高分信号。
- 原生翻译任务在后台处理符合条件的公开外文帖子。研究动态仅展示与当前原帖版本对应的完整译文，研究摘要单独标注。Agent 接入页提供原版 MCP、RSS、REST API 三种接入方式。
- 研究页提供原帖及证据链接。只读接口包括 `/api/dashboard`、`/api/sources`、`/api/posts`、`/api/ideas`、`/api/trends`、`/api/reports`。原版公开接口位于 `/api/v1`、`/feed.xml`、`/openapi-v1.json` 和 `/api/mcp`。MCP 工具 `techbuzz_get_research` 支持 Idea、趋势和研究日报。
- Compose 项目名为 `techbuzz`。卷 `engine-db` 存储引擎数据库，`engine-data` 存储引擎文件，`research-data` 存储研究数据库。旧原版和 A 股部署各自使用独立网络、端口和卷。
- 模型和采集均在后台运行。研究页显示采集错误，模型分析进行期间仍会同步新采集的内容。

## 本地快照

`demo/snapshot.json` 是已导出的研究快照。可用 `docker compose run --rm -v "$PWD/.runtime/site:/output" research node export.mjs /output` 从当前研究数据库重新导出，再在该目录启动静态文件服务。

复用代码和字体的声明见 [第三方说明](THIRD_PARTY_NOTICES.md)。
