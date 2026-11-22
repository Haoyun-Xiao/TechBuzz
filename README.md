# TechBuzz

科技股投研台跟踪八个 X 账号。首页、全部动态、热点、主题和 Agent 接入使用原版 React 界面。首页按活动时间倒序展示达到研究评分门槛的精选原帖。全部动态按活动时间展示原创、回复、引用和转发，支持组合筛选。Idea、趋势、日报和收藏各有独立入口。

## 快速开始

- [打开演示看板](https://haoyun-xiao.github.io/TechBuzz/)：无需密钥，可浏览当前研究快照、筛选动态、阅读 Idea、趋势和日报，沿引用回查来源。
- [下载离线 HTML](https://github.com/Haoyun-Xiao/TechBuzz/releases/latest)：下载 `TechBuzz.html` 后双击打开。
- 实时采集、自动生成和多轮对话使用下方 Docker 版本，需要你自己的模型 API 配置。公开演示展示帖子节选，完整原文可沿 X 链接阅读。

演示中的 Idea、趋势与日报来自真实运行结果，页面注明快照时间。研究内容用于提出和检验假设，来源引用可回查。

## Docker 运行

需要 Docker Compose。已有本机配置时直接运行以下命令。

```sh
docker compose up --build -d
```

新环境先克隆仓库，或下载并解压源码，再进入项目根目录，将 `.env.example` 复制为 `.env`。为 PostgreSQL 密码、会话签名、图片签名、引擎后台密码和研究后台令牌各生成一个独立随机值（例如分别执行 `openssl rand -hex 32`）。配置 `TECHBUZZ_LLM_BASE_URL`、`TECHBUZZ_LLM_API_KEY`、`TECHBUZZ_LLM_MODEL` 和推理强度。默认配置使用 OpenCode Go 的 DeepSeek v4.1 Flash；需要具有该模型权限的有效 Go 密钥。模型接口未配置时，采集与网页仍可启动，自动研究和对话需配置后运行。默认以 `TECHBUZZ_X_PROVIDER=free` 从公开时间线采集，无需浏览器或采集密钥。如需切回原付费接口，设置 `TECHBUZZ_X_PROVIDER=socialdata` 和 `TECHBUZZ_SOCIALDATA_API_KEY`，再运行 `docker compose up -d`。密钥只放在本机。

Idea、趋势最终合成和日报默认向模型提供 `web_search`。DeepSeek 通过 OpenCode Go 提出查询，研究 worker 用 Exa 的公开 MCP 检索带发布日期的网页片段。只有本次实际检索到且被条目引用的网页才列入「联网核验来源」。检索无结果时模型可沿用原帖并注明待核。设置 `TECHBUZZ_WEB_SEARCH=false` 并运行 `docker compose up -d --no-deps research-worker` 可关闭。

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

## 研究详情与历史回放

Idea 详情展示核心下注、依据与预期差、兑现与失效、优先尽调及跟踪变量。达到门槛的材料可形成新假设，直接相关的低分信息也可修订旧判断。趋势沿用分批观察缓存，在最终合成时为每个时间线节点附上当日原帖。研究详情中的来源标题打开已收录的帖子，旁边的 X 链接打开发布页或被引原文。

历史回放使用独立的 SQLite 副本、已有评分和本机模型配置。指定日期生成的日报从当时可见的材料归并串帖，已发布版本保留在 `history`。日期之后补录的材料会标注覆盖口径。以下命令由项目根目录执行。

```sh
node --env-file=.env replay-ideas.mjs --db /path/to/review.sqlite
node --env-file=.env replay-reports.mjs /path/to/review.sqlite 2026-11-20 2026-11-21
node --env-file=.env replay-trend.mjs /path/to/review.sqlite <trend-id> <as-of-ISO> <new-post-ids> <earlier-post-ids>
```

历史日报可通过 `--focus <原帖ID>` 为单期指定需要核验的串帖。定时任务自行选题。趋势定向回放只更新指定趋势，两个帖子参数使用逗号分隔的原帖 ID。部署时可用 `TECHBUZZ_RESEARCH_VOLUME`、`TECHBUZZ_WEB_IMAGE`、`TECHBUZZ_RESEARCH_IMAGE` 和 `TECHBUZZ_RESEARCH_WORKER_IMAGE` 选择同一版研究库与镜像。

## 研究提示词与生命周期

三套生成提示词集中在 `research-prompts.mjs`，Idea 采用 V3 的核心下注、依据与预期差、兑现与失效、优先尽调四块正文，保存 `pitch/variantView/catalystAndKillSwitch/nextDD`，并记录方向、对象、兑现窗口和跟踪变量。趋势与日报沿用已验收的 Gemini V2 结构。Idea 可以围绕行业或产业链的同一个投资问题更新；趋势保存 `trendOverview/timeline/evidenceAndHypotheses`。旧记录仍可阅读。

趋势依据最近新增信息日期执行 30 天清理，移出当前列表并保留历史链接。模型可用 `mergePriors` 把相近趋势并入指定 `prior`，合并证据及时间线，旧 ID 指向保留的主条目。旧内容重新生成不会延长活跃期。读者打开页面只读取结果。

## 本地快照

运行本机看板后，可导出一个无需服务器、双击即可阅读的 HTML。先在 `engine/` 运行 `npm ci`，并在 Python 环境安装 `beautifulsoup4`。从项目根目录运行：

```sh
python3 engine/scripts/offline/export.py ~/Downloads/TechBuzz.html
```

单文件包含导出时的动态、串帖、研究卡片、日报和主题。原帖链接需要联网，在线采集与 Agent 服务仍通过 Docker 运行。

`demo/index.html` 是当前公开演示。导出公开节选版可执行 `python3 engine/scripts/offline/export.py --public demo/index.html`。

`demo/snapshot.json` 仅作为冷启动时核验和导入帖子的样本目录，包含较早的研发样例，不用于当前 Pages 展示。正式启动不会导入其中的旧研究结论。

复用代码和字体的声明见 [第三方说明](THIRD_PARTY_NOTICES.md)。


## Idea 趋势跟踪

趋势页分为常规趋势与 Idea 趋势跟踪。后者读取已有 Idea 的假设、验证条件和滚动窗口观察，保存原始判断，并通过稳定的 `sourceIdeaId` 关联原 Idea。两组独立记录任务状态，共用已缓存的分批观察。Idea 跟踪更新单独的趋势记录。

`TECHBUZZ_IDEAS_ENABLED=true` 启用 Idea 自动生成。设为 `false` 可暂停 Idea 生成，评分、翻译、日报与两组趋势继续运行。

### 本地研究助手

主站侧栏“研究助手”位于 `/assistant`，复用八账号材料和当前模型配置，支持多轮追问、完整原文读取、按需联网及引用回查。
助手独立运行在 Compose 的 `assistant` 服务，聊天记录保存在 `assistant-data`，不写入 Idea、趋势、日报或采集数据库。
已有的 `/agent`、MCP 和只读 API 保留。配置与接口见 [助手说明](assistant/README.md)，本次合并与回退见 [本地合并记录](docs/ASSISTANT_LOCAL_MERGE.md)。

Idea V3 按新增信号的具体议题和经营变量组包，补入最近30天相关上下文与低分材料。背景单元不具备新建资格，输出必须引用本轮触发帖；历史材料不会因此被标成新处理。对话研究助手的详情接口可读取完整 V3 字段，Idea 趋势跟踪同步获得假设与验证变量。

## 发布验收

本版已从 Git 的干净副本，在独立端口和全新数据卷中完成 Docker 构建与启动；八个账号各完成一次采集，配置模型密钥后的真实问答及引用回查通过。首次回填和研究生成需要时间，空库不会自动获得开发机的研究结果；审阅现成成果请使用公开快照。

后台先完成 Idea，再运行趋势。独立评分、提取和同层压缩可并发，默认上限12；相关 Idea 顺序更新。常规趋势简版保留两条重点，Idea 跟踪独立展示实际更新与待验证基线。
