# TechBuzz 研究助手

独立 Node 服务，读取 TechBuzz HTTP 数据，复用现有 OpenCode Go / DeepSeek 配置。
基线：`4403324d83e76d559b7f24d73c123bd4e10d0e53`；开发分支 `codex/techbuzz-assistant`，交付前已对齐主对话提交 `2f1961c`。

## 启动预览

主 TechBuzz 必须已运行。本配置不启动采集、业务数据库或研究 worker。
从本工作树根目录运行（环境文件只由 Compose 本机读取，不进入镜像）：

```sh
docker compose --env-file ../x-research-demo/.env -f compose.assistant.yaml up -d --build
```

打开 `http://127.0.0.1:19283/assistant`。独立 Compose 项目 `techbuzz-assistant-preview`。
web 使用独立镜像 `techbuzz-assistant-web:local`；assistant 复用现有 `techbuzz-engine:local` 的 Node 运行环境，不重建或替换该镜像。
助手数据位于专属卷 `techbuzz-assistant-preview_assistant-data`；业务材料经 `techbuzz_default` 网络只读 GET。

```sh
docker compose --env-file ../x-research-demo/.env -f compose.assistant.yaml down
```

停预览不会停止 `techbuzz` 主站，也不删除聊天卷。恢复只需重新 up；无需回滚业务数据库。
请不要将预览 Compose 改为主项目名或共用业务卷。该预览只监听本机，不提供公网聊天账户系统。

## 能力和接口

`GET/POST /api/assistant/sessions`：列出 / 新建会话。
`GET /api/assistant/sessions/:id`：读取消息、状态、引用。
`POST /api/assistant/sessions/:id/messages`：提交 `{message,context?:{type,id}}`，返回 SSE。
`context.type` 为 `post / ideas / trends / reports`。上下文由后端重新读取，浏览器不提交原文。
`POST /api/assistant/sessions/:id/stop`：停止该会话当前生成。
`GET /api/assistant/health`：助手健康状态。
SSE 包含 start、status、tool、draft、answer、done / failure。draft 是公开回答草稿，可能被模型工具调用或最终引用校验替换，不含内部推理。answer 是经过本轮引用 ID 校验的最终文本及来源。

工具：search_posts、read_posts、read_research、web_search。
站内来源为研究服务 `/api/dashboard` 的同一份现有材料，按回合读取一次快照，无第二套采集和持久知识库。
search_posts 的 preview 是明确标记的目录摘要；read_posts 返回原帖、译文、上文、引用和长文全部存储正文，按整帖分页，不裁剪。
每条原文保留 `contextStatus`；“已读取全部存储正文”不等于上游付费内容已经采全。
检索支持日期、公司、主题、作者、OR关键词和分页；目录附整个匹配范围的日期、议题分布，避免只看最新首页。
read_research 列表是研究目录，按 id 可读完整历史判断和时间线。研究不是独立事实，需要回看原帖。
web_search 复用 Exa 公共 MCP 的检索方式；来源标为外部检索片段，不冒充整页读取。外部接口不可用时助手说明核验未完成。

模型使用 TECHBUZZ_LLM_BASE_URL / TECHBUZZ_LLM_API_KEY / TECHBUZZ_LLM_MODEL / TECHBUZZ_LLM_REASONING_EFFORT（默认 max）。
每会话独立 OpenCode session；最多六轮工具调用，再做一次收尾回答。单次输出预算32768 token（含推理），单次模型请求最多240秒；最多两条会话同时生成，同会话禁止并发。
每轮不超过700,000字符的材料预算；超限拒绝该整份工具结果并说明未读，不截原帖。保留最近16条成功会话消息，旧原文工具结果不反复塞入，按需重新读取。追问会重新载入上一份有来源的回答所引用的原帖（首批最多12条，串帖仍可续读）与带读取时间的历史网页片段；后者不冒充本轮联网核验。未读取的引用会触发一次补读纠正，仍失败则明确标记。
调用回执写入助手自身 SQLite 的 receipts，记录模型、用量、工具参数、读取ID、耗时与错误，不记录密钥或内部推理。
引用校验验证“来源是否存在于本轮实际读取材料”，不是自动证明模型的每个推断正确。

## 本地检查

```sh
node --test assistant/assistant.test.mjs
cd engine
npm ci --no-audit --no-fund
npm run typecheck
npm run build -w @techbuzz/web
npm run test:web
```

真实模型验收材料保存在忽略的 `.runtime/assistant/`，不提交会话数据库、密钥或原始帖子。

## 主对话集成边界

新增文件主要位于 assistant/ 与前端 features/assistant/。共享文件只涉及路由、导航、代理和详情入口。
主工作区目前有研究生成和详情页面的未提交修改；不得覆盖或整体替换这些文件。后续集成时把 AskAssistant 链接与路由接线移入最新版组件，重新验收。
部署前把 preview 专属网络地址改为同 Compose 的研究服务名；原有 MCP、公开API和生成任务不变。
本分支只交付本机预览，不自动切换19282，不推送GitHub。
