import { MCP_TOOL_NAMES } from "@techbuzz/contracts/mcp";
import { SITE } from "@techbuzz/site";
import { siteUrl } from "./links.ts";
import { RESEARCH_CATEGORY_INPUTS, RESEARCH_CATEGORY_KEYS, RESEARCH_KINDS, RESEARCH_WINDOWS } from "./research.ts";

export function researchDiscovery() {
  return [
    `# ${SITE.name}`, "", "八个 X 科技股账号的动态、精选、研究观点与证据。", "",
    `- [Agent 使用说明](${siteUrl("/api/v1/agent")})`,
    `- [MCP Server](${siteUrl("/api/mcp")}) · ${Object.values(MCP_TOOL_NAMES).join("、")}`,
    `- [OpenAPI](${siteUrl("/openapi-v1.json")})`,
    `- [全部动态](${siteUrl("/api/v1/items?mode=all")}) · [精选](${siteUrl("/api/v1/items")}) · [48 小时热点](${siteUrl("/api/v1/hot-topics")}) · [主题](${siteUrl("/api/v1/topics")})`,
    `- [当前研究日报](${siteUrl("/api/v1/dailies/latest")}) · [往期日报](${siteUrl("/api/v1/dailies")})，按日路径为 /api/v1/dailies/{YYYY-MM-DD}。`,
    `- RSS · [精选](${siteUrl("/feed.xml")}) · [全部动态](${siteUrl("/feed/all.xml")}) · [48 小时热点](${siteUrl("/feed/hot.xml")}) · [研究日报](${siteUrl("/feed/daily.xml")})`,
    `- 分类 RSS · ${RESEARCH_CATEGORY_KEYS.map((key) => `[${key}](${siteUrl(`/feed/category/${key}.xml`)})`).join(" · ")}`, "",
    `组合查询示例 · ${siteUrl("/api/v1/items?mode=all&window=7d&category=supply-chain&kind=original,quote&account=SemiAnalysis_&onlyFeatured=true")}`, "",
    "活动时间区分原帖发布时间、已知活动时间、首次观察和未知。重要信息请回 X 原帖核对。", "",
  ].join("\n");
}

type Schema = Record<string, unknown>;
type Parameter = { name?: string; in?: string; $ref?: string; schema?: Schema; description?: string };
type Operation = { summary: string; description?: string; parameters?: Parameter[]; responses: Record<string, { description?: string; content?: Record<string, { schema: Schema }> }> };
type ResearchSpec = { info: { description: string }; paths: Record<string, { get: Operation }>; components: { schemas: Record<string, Schema> } };

const string = { type: "string" };
const number = { type: "integer" };
const nullableText = { type: ["string", "null"] };
const dateTime = { ...string, format: "date-time" };
const timestamp = { ...nullableText, format: "date-time" };
const bool = { type: "boolean" };
const obj = (properties: Record<string, Schema>) => ({ type: "object", properties, required: Object.keys(properties) });
const array = (items: Schema) => ({ type: "array", items });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const asEnum = (values: readonly string[]) => ({ ...string, enum: values });
const responseBody = (schema: Schema) => ({ "application/json": { schema } });
const param = (name: string, schema: Schema, description?: string): Parameter => ({ name, in: "query", schema, description });
const score = { type: ["integer", "null"], minimum: 0, maximum: 100 };
const version = { ...number, const: 1 };

function listParams(defaultWindow: string, max: number, fallback: number) {
  const kinds = { ...string, example: "original,quote" };
  return [param("mode", { ...asEnum(["selected", "all"]), default: "selected" }, "精选每个原帖一条；全部按发布、回复、引用和转发活动逐条列出。"),
    param("window", { ...asEnum(RESEARCH_WINDOWS), default: defaultWindow }),
    param("category", asEnum(RESEARCH_CATEGORY_INPUTS)),
    param("by", { ...asEnum(["timeline", "published"]), default: "timeline" }, "活动时间或原帖发布时间。时间未知的活动只进入全时间窗口。"),
    param("kind", kinds, "可用值 original、reply、quote、repost、unknown，支持逗号或重复参数。"),
    param("type", kinds, "kind 的别名。"), param("hide", kinds, "隐藏指定活动类型。"),
    param("account", { ...string, example: "SemiAnalysis_" }), param("source", string, "account 的别名。"),
    param("onlyFeatured", asEnum(["true", "false", "1", "0"])), param("q", { ...string, maxLength: 200 }),
    param("date", { ...string, format: "date" }, "以北京时间筛选活动日期。"),
    param("period", asEnum(["24"]), "window=24h 的网页别名。"),
    param("company", string), param("topic", string), param("tag", string, "topic 的别名。"),
    param("sort", asEnum(["new", "old", "score", "time"]), "精选默认按研究评分，全部动态默认按活动时间倒序。"),
    param("limit", { ...number, minimum: 1, maximum: max, default: fallback }),
    param("cursor", string, "上页的 page.nextCursor，筛选条件保持不变。"),
  ];
}

/** The deployed research endpoints keep the same addresses and publish their actual response schemas. */
export function researchOpenApi(spec: ResearchSpec) {
  spec.info.description = "TechBuzz 匿名只读接口。精选、全部动态、48 小时热点、研究日报与网页同源。给 Agent 的 Markdown 入口为 /api/v1/agent。精选增量客户端先读取 /api/v1/selected/snapshot，再用其游标读取 /api/v1/selected/changes。";
  const path = (suffix: string) => spec.paths[`/api/v1${suffix}`]!.get;
  const body = (suffix: string, label: string, description: string, schema: Schema) => {
    const op = path(suffix);
    op.summary = label;
    op.description = description;
    op.responses["200"] = { description: label, content: responseBody(schema) };
  };
  path("/items").parameters = listParams("all", 100, 50);
  body("/items", "精选与全部动态", "从同一 X 原帖集合读取，以游标继续筛选结果。", ref("ResearchItems"));
  body("/hot-topics", "过去 48 小时热点", "hot 是多源热点，singleHot 是单源高分。每栏独立排序。", ref("ResearchHot"));
  body("/stories/{publicId}", "热点原帖证据", "使用热点榜返回的事件 ID。", obj({ schemaVersion: version, story: { allOf: [ref("ResearchEvent"), obj({ publicId: string, reports: array(ref("ResearchActivity")) })] } }));
  body("/dailies", "研究日报归档", "按北京时间日期降序返回已生成的研究日报。", obj({ schemaVersion: version, items: array(ref("ResearchReport")), generation: ref("ResearchGeneration") }));
  const daily = obj({ schemaVersion: version, report: ref("ResearchReport"), generation: ref("ResearchGeneration") });
  body("/dailies/latest", "当前研究日报", "返回当前应出日期的研究日报。当前日期尚无报告时返回 404。", daily);
  body("/dailies/{date}", "指定日期研究日报", "date 是 YYYY-MM-DD 的北京时间自然日。", daily);
  spec.paths["/api/v1/topics"] = { get: { summary: "公司与议题", responses: { "200": { description: "公司及议题的原帖与传播数",
    content: responseBody(obj({ schemaVersion: version, items: array(obj({ name: string, group: asEnum(["company", "issue"]), postIds: array(string), count: number, propagationCount: number })) })) } } } };
  const fields = asEnum(["default", "minimal"]);
  const itemProjection = { anyOf: [ref("ResearchActivity"), obj({ id: string, postId: string, title: string, links: obj({ techbuzz: string }) })] };
  body("/selected/snapshot", "当前精选快照", "通过 nextPage 读取下一页，最后用 cursor 开始读取增量。旧系统的游标需重新初始化。",
    obj({ schemaVersion: version, asOf: dateTime, fields, cursor: string, count: number, hasMore: bool, nextPage: nullableText, items: array(itemProjection) }));
  body("/selected/changes", "精选增量", "依次应用 upsert/remove。游标失效返回 409 snapshot_required，重新获取快照。",
    obj({ schemaVersion: version, fields, cursor: string, count: number, hasMore: bool, changes: array({ oneOf: [
      obj({ op: { const: "upsert" }, changedAt: dateTime, item: itemProjection }), obj({ op: { const: "remove" }, changedAt: dateTime, id: string }),
    ] }) }));
  path("/agent/latest").parameters = listParams("24h", 30, 10);
  path("/agent/latest").description = "过去 24 小时精选或全部活动的 Markdown。";
  path("/agent/search").parameters = listParams("7d", 30, 10).map((p) => p.name === "q" ? { ...p, required: true, schema: { ...p.schema, minLength: 2 } } : p);
  path("/agent/search").description = "搜索原帖、译文、摘要、公司和主题；显式传 mode=all 搜索全部动态。";
  path("/agent/hot").description = "分别返回多源热点与单源高分的 Markdown。";
  path("/agent/daily").description = "当前应出日期的研究日报。";
  path("/agent/daily/{date}").description = "按北京时间日期读取的研究日报。";
  Object.assign(spec.components.schemas, {
    ResearchActivity: obj({ id: string, postId: string, kind: asEnum(RESEARCH_KINDS), handle: string, originalAuthor: nullableText, url: nullableText,
      activityAt: timestamp, firstSeenAt: timestamp, timeBasis: asEnum(["published", "exact", "observed", "unknown"]), post: { type: "object" }, score, featured: bool,
      distributors: array(string), category: nullableText, categoryKey: nullableText, title: string, summary: nullableText, publishedAt: timestamp,
      links: obj({ techbuzz: string, original: nullableText }) }),
    ResearchItems: obj({ schemaVersion: version, query: { type: "object" }, items: array(ref("ResearchActivity")), page: ref("Page") }),
    ResearchEvent: obj({ id: string, title: string, rank: number, column: asEnum(["multi", "single"]), sourceCount: number, independentCount: number,
      postCount: number, evidence: array(string), authors: array(string), score, updatedAt: dateTime, links: obj({ story: string, api: string }) }),
    ResearchHot: obj({ schemaVersion: version, window: { const: "48h" }, count: number, items: array(ref("ResearchEvent")),
      hot: array(ref("ResearchEvent")), singleHot: array(ref("ResearchEvent")) }),
    ResearchReport: obj({ id: string, date: { ...string, format: "date" }, title: string, summary: string, updatedAt: dateTime,
      sections: array(obj({ title: string, summary: string, evidence: array(string) })), evidence: array(string), links: obj({ techbuzz: string }) }),
    ResearchGeneration: obj({ status: string, date: { ...string, format: "date" }, evidenceThrough: timestamp, lastSuccessAt: timestamp, updatedAt: timestamp, error: nullableText }),
  });
  return spec;
}
