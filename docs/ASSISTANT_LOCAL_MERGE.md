# 研究助手合入本地主站 · 2026-11-23

主站基线 `4d926f0`（已有 Idea 独立趋势跟踪），助手分支末端 `f0a294d`。通过 Git 三方合并保留双方修改，合并提交 `5c0ee9c`。
本次只更新本机，未推送 GitHub。

## 当前入口与运行

- 主站：`http://127.0.0.1:19282/assistant`。
- 主站增加 `techbuzz-assistant-1`；网页使用独立新镜像 `techbuzz-web:assistant-local-20261123`。
- 复用现有 TECHBUZZ_LLM_* 配置，研究数据通过 `http://research:3000` 只读获取。
- 预览聊天库在线备份后复制到主站专属 `techbuzz_assistant-data`，两站不共用聊天库；已迁入的3份会话及后续追问保留。
- 旧19283预览保留，但以后使用19282继续聊天，两边新增会话不自动同步。
- 部署仅运行 `docker compose up -d --no-deps assistant web`，未执行seed、迁移、重新采集或批量研究生成。

## 保留主对话的最新内容

对比合并前SHA-256，research.mjs、research-prompts.mjs、research-lifecycle.mjs、worker.mjs、dashboard.mjs，以及 ResearchViews、ResearchDaily、data、load.server 核心文件逐字不变。
研究/日报路由只增加 AskAssistant 导入与入口，保留原有 loader、归档/合并跳转、Idea 跟踪分组和日报渲染。
上线前后对57条Idea、24条趋势、4份日报逐项序列化哈希比对一致。
research、research-worker、worker、api、db 的容器ID和启动时间均未变化。

## 检查

助手9项测试、原前端68项测试、全项目类型检查、网页构建通过。主站健康检查、助手健康检查、迁入会话读取和主站smoke通过。
运行日志与本次问答自检位于忽略的 `.runtime/assistant-merge-20261123/`，不提交数据库或密钥。

## 本机回退点

- 代码标签：`codex/pre-assistant-local-20261123`，指向 `4d926f0`。
- 原网页镜像：`techbuzz-web:idea-tracking`，保留未覆盖。
- `.runtime/assistant-merge-20261123/` 保存原Compose、私有环境文件、运行镜像/容器清单、研究库和聊天库在线备份；两份SQLite备份均通过完整性检查。

仅撤回网页上线时，将本机 `.env` 的 `TECHBUZZ_WEB_IMAGE` 改回 `techbuzz-web:idea-tracking`，再执行：

```sh
docker compose up -d --no-deps web
docker compose stop assistant
```

业务数据库和研究worker无需回滚。聊天卷保留供恢复。代码回退应撤销本次助手合并及部署接线提交，保留之后可能产生的新研究改动，不使用强制重置覆盖后续工作。

主站实际模型问答自检成功：从帖子详情携带ID进入，DS返回带原帖引用的回答，用时约8.5秒。自检会话已归档，不占用用户会话列表；三份原会话逐条消息、状态、引用与备份比对一致。
浏览器确认主站助手入口和两类趋势分组保留，日报有“问研究助手”入口。
