# TechBuzz

科技股研究看板，跟踪八个 X 账号，把原帖、每日变化、基金投资研究假设和趋势证据放在同一页面。

## 阅读演示

打开仓库 About 中的演示主页。首页呈现最新研究与日报；从 **Idea** 查看相关公司、作者观点、模型推断及证伪条件，从 **趋势** 按日期回看判断，再从证据链接到原帖。信息流支持账号和主题筛选。收藏保存在当前设备的浏览器。

GitHub Pages 使用从本地数据库导出的静态快照。页面标示导出时间，公开帖子只提供短摘和来源链接。快照中的评分、Idea、趋势和日报由同一研究引擎运行生成。演示用的原链样本标记为样本，不用于证明整段时间内的采集完整性。

## 本机运行

需要 Docker Compose。将配置示例复制为本机配置，填写服务密钥后启动。

```sh
cp .env.example .env
docker compose up --build -d
```

访问 <http://127.0.0.1:19282>。Compose 项目名为 `techbuzz`，服务为 `web` 和 `worker`，SQLite WAL 数据位于专属卷 `techbuzz_research-data`。可用 `docker compose down` 停止服务并保留数据。服务端仅绑定本机回环地址。

| 配置项 | 用途 |
| --- | --- |
| `TECHBUZZ_SOCIALDATA_API_KEY` | 八账号自动发现新帖及首次 30 天分页回填，按 SocialData 账户计费 |
| `TECHBUZZ_LLM_BASE_URL`、`TECHBUZZ_LLM_MODEL`、`TECHBUZZ_LLM_API_KEY` | OpenAI 兼容模型。示例配置为 OpenCode Go 的 `deepseek-v4.1-flash` |
| `TECHBUZZ_LLM_REASONING_EFFORT` | 推理强度，默认 `max` |
| `TECHBUZZ_ADMIN_TOKEN` | 在后台更改 Idea 入选阈值的本机令牌，请自行生成随机值 |
| `TECHBUZZ_PORT` | 本机网页端口，默认 19282 |

更改配置后执行 `docker compose up -d`。从后台查看每个账号的回填范围、检查状态以及最近一次研究更新。无 SocialData 密钥时仍可按已知公开原链导入样本；只有设好密钥后才能通过搜索自动发现新帖。

## 采集与研究

- 账号范围固定为 @aleabitoreddit、@SemiAnalysis_、@Omercheema、@OrnnExchange、@HedgeyeTech、@RYANHINGSHING、@FredaDuan、@TMTLongShort。引用和回复的第三方作者仅作为上下文。
- 每五分钟检查增量，首次按账号回填最近 30 天，以帖子 ID 去重。源状态区分采集错误、正在回填和检查成功无新增。
- 模型按影响范围 35、信息增量 25、可验证性 25、跟踪价值 15 打分。Idea 任务只接收通过阈值的新增研究材料，初始阈值为 70。
- 趋势任务单独审阅滚动 30 天证据，包括低分反证。按日分批归纳再合并，同一时间可以维护多条线索；每次实质变化保留时间和引用。
- 北京时间 08:00 后生成上一自然日的研究日报。后台任务使用任务指纹复用成功结果；失败原因和时间保存在本地。
- `/api/dashboard` 为整页数据；`/api/posts`、`/api/sources`、`/api/ideas`、`/api/trends`、`/api/reports` 提供只读集合。集合下的 ID 路径返回单项。帖子及引用 ID 均使用字符串。后台阈值通过 `POST /api/admin/threshold` 设置，需要本机管理员 Bearer 令牌。

## 重现演示与验证

下列命令在**单独的演示数据库**导入示例原链，并依照帖子发布时间回放研究。回放与实时 worker 可使用不同数据库。首次运行回放需要真实模型密钥，会消耗模型额度。

```sh
docker compose run --rm -e TECHBUZZ_DB=/data/replay.sqlite worker node bootstrap.mjs
docker compose run --rm -e TECHBUZZ_DB=/data/replay.sqlite worker node replay.mjs
docker compose run --rm -e TECHBUZZ_DB=/data/replay.sqlite -v "$PWD/.runtime/site:/output" worker node export.mjs /output
docker compose run --rm worker npm test
```

`bootstrap.mjs` 也接受本项目八个账号的 X 帖子链接。样本和研究被导入真实库后即可从动态网页查看。公开静态站使用同一套前端与导出的 `snapshot.json`，无需配置密钥。仓库中的 `demo/snapshot.json` 保存本次发布的演示数据。

## 实现与许可

从本机上游提交 `4c6e9e1` 提取 X 采集逻辑，按八账号边界实现独立的 Node 服务、采集与研究 worker、前端及静态导出。研究评分、Idea/趋势双流程、证据链、回放和演示页面均位于本仓。复用部分的版权与许可见 [NOTICE](NOTICE) 和 [LICENSE](LICENSE)。

回填范围表示搜索接口已遍历的时间窗口，公开搜索可能漏收帖子，原生转发的可检索期限也受服务端限制。参见 [SocialData 搜索说明](https://docs.socialdata.tools/reference/get-search-results/)。
