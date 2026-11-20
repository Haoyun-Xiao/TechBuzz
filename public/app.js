const TYPES = {
  reports: { title: "研究日报", item: "日报" },
  ideas: { title: "投资 Idea", item: "Idea" },
  trends: { title: "趋势跟踪", item: "趋势" },
  hot: { title: "24 小时热点", item: "热点" },
};

const main = document.querySelector("main");
const dataMode = document.querySelector("#data-mode");
const refresh = document.querySelector("#refresh");
const notice = document.querySelector("#notice");
const TZ = "Asia/Shanghai";
const dateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});
const HOUR = 60 * 60 * 1000;
const STORAGE_KEY = `techbuzz-saved:${new URL(".", location.href).pathname}`;
const saved = readSaved();
let payload;
let posts = new Map();
let live = false;
let busy = false;
let failure = false;
let stale = false;
let noticeTimer;

function readSaved() {
  try {
    return new Set(list(JSON.parse(localStorage.getItem(STORAGE_KEY))));
  } catch {
    return new Set();
  }
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function esc(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function httpURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function urlLink(url, label, className = "") {
  const href = httpURL(url);
  if (!href) return "";
  return `<a class="${className}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

function time(value) {
  return Date.parse(value);
}

function dateLabel(value, fallback = "时间未知") {
  return Number.isFinite(time(value)) ? dateTime.format(time(value)) : fallback;
}

function day(value) {
  if (!Number.isFinite(time(value))) return "";
  const fields = Object.fromEntries(dayFormat.formatToParts(time(value)).map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function stamp(value, fallback = "时间未知") {
  return Number.isFinite(time(value)) && !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `<time datetime="${esc(value)}" title="${esc(value)}">${dateLabel(value)}</time>`
    : esc(value || fallback);
}

function handle(value) {
  return String(value ?? "").replace(/^@/, "").trim();
}

function byNewest(items, field = "updatedAt") {
  return [...items].sort((a, b) => (time(b[field] || b.date) || 0) - (time(a[field] || a.date) || 0));
}

function routeLink(page, id = "", query = {}) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
  return `#${page}${id ? `/${encodeURIComponent(id)}` : ""}${params.size ? `?${params}` : ""}`;
}

function getRoute() {
  const [path, search] = location.hash.slice(1).split("?");
  const [page, id] = path.split("/");
  try {
    return { page: page || "home", id: decodeURIComponent(id || ""), query: new URLSearchParams(search) };
  } catch {
    return { page: "missing", id: "", query: new URLSearchParams() };
  }
}

function internal(label, page, id = "", query = {}, className = "inline-link") {
  return `<a class="${className}" href="${esc(routeLink(page, id, query))}">${esc(label)}</a>`;
}

function notify(message) {
  clearTimeout(noticeTimer);
  notice.hidden = false;
  notice.textContent = message;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
}

function score(post) {
  return payload.scores?.[post.id] || {};
}

function getEvidence(ids) {
  const unique = new Set();
  return list(ids).flatMap((item) => {
    const id = String(item?.id ?? item?.postId ?? item);
    if (unique.has(id)) return [];
    unique.add(id);
    return [posts.get(id) || { id, unavailable: true }];
  });
}

function postAuthor(post) {
  const author = handle(post.handle);
  return author ? `@${author}` : "未知账号";
}

function evidenceLinks(ids) {
  const items = getEvidence(ids);
  if (!items.length) return "";
  return `<ul class="evidence-links">${items.map(post => `<li>${
    post.unavailable
      ? `<span class="muted">证据 ${esc(post.id)} 未收录</span>`
      : internal(postAuthor(post), "post", post.id) + (post.url ? ` ${urlLink(post.url, "原帖")}` : "")
  }</li>`).join("")}</ul>`;
}

function saveButton(type, id) {
  const key = `${type}/${id}`;
  const isSaved = saved.has(key);
  return `<button class="button save" type="button" data-save="${esc(key)}" aria-pressed="${isSaved}">${isSaved ? "已收藏" : "收藏"}</button>`;
}

function displayMode() {
  const mode = failure ? "failed" : stale ? "failed" : live ? "live" : payload ? "snapshot" : "";
  const label = failure ? "数据不可用" : stale ? "上次读取" : live ? "实时接口" : payload ? "静态快照" : "加载中";
  dataMode.className = `data-mode ${mode}`;
  dataMode.innerHTML = `<i></i>${label}`;
  dataMode.title = payload?.generatedAt ? `数据生成于 ${dateLabel(payload.generatedAt)}（北京时间）` : label;
  document.querySelector("#saved-count").textContent = saved.size ? ` ${saved.size}` : "";
}

async function readJSON(path, options) {
  const response = await fetch(path, { cache: "no-store", ...options });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function validate(data) {
  if (!data || !Array.isArray(data.posts)) throw new Error("数据格式无效");
  return data;
}

async function loadData(manual = false) {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  try {
    try {
      payload = validate(await readJSON("./api/dashboard", { signal: AbortSignal.timeout(9000) }));
      live = payload.mode !== "snapshot";
    } catch {
      payload = validate(await readJSON("./snapshot.json", { signal: AbortSignal.timeout(9000) }));
      live = false;
    }
    posts = new Map(payload.posts.filter(item => item?.id).map(item => [String(item.id), item]));
    failure = false;
    stale = false;
    if (manual) notify(live ? "已重新读取实时数据" : "已重新读取静态快照");
  } catch {
    stale = Boolean(payload);
    failure = !payload;
    live = false;
    if (manual) notify(stale ? "读取失败，继续显示上次数据" : "读取失败，请检查网络后重试");
  } finally {
    busy = false;
    refresh.disabled = false;
    render();
  }
}

function heading(title, description = "", trailing = "") {
  return `<header class="page-heading"><div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ""}</div>${trailing}</header>`;
}

function sectionHeading(title, link = "") {
  return `<div class="section-heading"><h2>${esc(title)}</h2>${link}</div>`;
}

function empty(message, link = "") {
  return `<div class="empty">${esc(message)} ${link}</div>`;
}

function section(title, content) {
  return content ? `<section class="detail-section"><h2>${esc(title)}</h2>${content}</section>` : "";
}

function itemRow(type, item, withKind = false, change = "") {
  const itemTitle = item.title || TYPES[type].item;
  const summary = item.summary || "";
  return `<article class="list-row">
    <header class="list-row-title"><h3>${withKind ? `<span class="item-kind">${TYPES[type].item}</span>` : ""}${internal(itemTitle, type, item.id, {}, "")}</h3></header>
    ${summary ? `<p class="clip">${esc(summary)}</p>` : ""}
    <div class="meta"><span>${stamp(item.date || item.asOf || item.updatedAt)}</span><span>${list(item.evidence).length} 条证据</span>${change ? `<span class="source-ok">${esc(change)}</span>` : ""}${item.status === "archived" ? "<span>已归档</span>" : ""}</div>
  </article>`;
}

function hotRow(item, index) {
  return `<article class="list-row">
    <h3 class="hot-title"><span class="hot-no">${String(index + 1).padStart(2, "0")}</span>${internal(item.title, "hot", item.id, {}, "")}</h3>
    <div class="meta"><span>${esc(item.independentCount ?? list(item.evidence).length)} 个独立出处</span><span>${esc(item.postCount ?? list(item.evidence).length)} 条讨论</span><span>${stamp(item.updatedAt)}</span></div>
  </article>`;
}

function statusOf(source) {
  const states = {
    unconfigured: ["待配置", "source-warn"],
    backfilling: ["回补中", "source-warn"],
    "catching-up": ["补读中", "source-warn"],
    empty: ["已查无新增", "source-ok"],
    ok: ["读取成功", "source-ok"],
    error: ["读取失败", "source-error"],
  };
  if (Object.hasOwn(states, source.status)) return states[source.status];
  if (source.error || ["failed", "failure"].includes(source.status)) return ["读取失败", "source-error"];
  if (source.lastSuccess || source.lastSuccessAt) return ["已核对", "source-ok"];
  return ["待核对", "source-warn"];
}

function activityPanel() {
  const end = time(payload.generatedAt);
  const buckets = Array(24).fill(0);
  for (const post of posts.values()) {
    const bucket = Math.floor((time(post.publishedAt) - (end - 24 * HOUR)) / HOUR);
    if (bucket >= 0 && bucket <= 24 && time(post.publishedAt) <= end) {
      buckets[Math.min(bucket, 23)] += 1;
    }
  }
  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((sum, bucket) => sum + bucket, 0);
  const events = list(payload.hot).length;
  return `<section class="panel signal-panel">
    <h2>24 小时监测</h2>
    <div class="signal-figures">
      <a href="#feed?period=24"><span class="signal-figure">${total}</span><span class="meta">收录帖子</span></a>
      <a href="#hot"><span class="signal-figure">${events}</span><span class="meta">归集事件</span></a>
    </div>
    <div class="signal-chart" role="img" aria-label="过去 24 小时的每小时发帖数，从早到晚分别为 ${buckets.join("、")}">
      ${buckets.map((bucket, index) => `<div class="signal-bar ${bucket ? "" : "zero"}" style="height: ${Math.round(bucket / max * 100)}%" title="${dateLabel(new Date(Number.isFinite(end) ? end - (24 - index) * HOUR : 0).toISOString())}，${bucket} 条"></div>`).join("")}
    </div>
    <div class="chart-label"><span>24 小时前</span><span>截至本次更新</span></div>
  </section>`;
}

function sourcesPanel() {
  const sources = list(payload.sources);
  const success = sources.filter(source => statusOf(source)[1] === "source-ok").length;
  const backfilled = sources.filter(source => source.backfillComplete).length;
  const sampleDates = byNewest([...posts.values()].filter(post => post.sample), "publishedAt");
  const sampleStart = sampleDates.at(-1)?.publishedAt;
  const sampleEnd = sampleDates[0]?.publishedAt;
  return `<section class="panel">
    ${sectionHeading("关注来源", internal("采集状态", "admin"))}
    <div class="panel-body meta"><span>${success}/${sources.length} 个账号最近读取成功</span><span>${backfilled}/${sources.length} 个账号完成历史回填</span></div>
    ${sampleDates.length ? `<div class="panel-body meta coverage-sample"><span>${sampleDates.length} 条演示样本</span><span>${esc(day(sampleStart))}${day(sampleStart) !== day(sampleEnd) ? ` 至 ${esc(day(sampleEnd))}` : ""}</span></div>` : ""}
    <ul class="source-list">${sources.map(source => {
      const [label, cls] = statusOf(source);
      const name = handle(source.handle);
      return `<li><a href="${esc(routeLink("feed", "", { source: name }))}"><span>@${esc(name)}</span><span class="meta ${cls}">${label}</span></a></li>`;
    }).join("")}</ul>
  </section>`;
}

function home() {
  const reports = byNewest(list(payload.reports), "date");
  const latest = reports[0];
  const today = day(payload.generatedAt);
  const latestReportDay = latest?.date || day(latest?.asOf || latest?.updatedAt);
  const research = [
    ...list(payload.ideas).map(item => ({ type: "ideas", item })),
    ...list(payload.trends).map(item => ({ type: "trends", item })),
  ];
  const revisionDay = item => day(item.asOf || item.updatedAt);
  const researchDay = research.some(({ item }) => revisionDay(item) === today) ? today : latestReportDay || today;
  const recent = research.filter(({ item }) => researchDay && revisionDay(item) === researchDay)
    .sort((a, b) => (time(b.item.updatedAt) || 0) - (time(a.item.updatedAt) || 0));
  const changes = list(latest?.sections).filter(section => section.kind === "digests");
  const hot = list(payload.hot);
  return `${heading("科技股研究总览", "围绕关注账号的新信息，追踪投资假设和产业变化。", `<span class="page-date">看板生成于 ${stamp(payload.generatedAt, "待更新")}</span>`)}
    <div class="home-grid">
      <div class="home-main">
        <section class="lead" aria-labelledby="lead-title">
          <div class="kind">最新研究日报 ${latest?.date ? `<span> / ${esc(latest.date)}</span>` : ""}</div>
          <h2 id="lead-title">${latest ? internal(latest.title || "研究日报", "reports", latest.id, {}, "") : "等待首期研究日报"}</h2>
          <p class="clip">${esc(latest?.summary || "日报将在研究任务产出后出现在这里。")}</p>
          <div class="lead-foot">
            ${latest ? internal("阅读本期日报", "reports", latest.id, {}, "button primary") : ""}
            ${internal("日报目录", "reports")}
          </div>
        </section>
        ${changes.length ? `<section>${sectionHeading("重要变化", internal("查看日报", "reports", latest.id))}
          <div class="panel">${changes.slice(0, 3).map(item => `<article class="list-row"><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p>${evidenceLinks(item.evidence)}</article>`).join("")}</div>
        </section>` : ""}
        <section>
          ${sectionHeading(researchDay === today ? "今日研究变化" : "最新研究日变化", researchDay && researchDay !== today ? `<span class="meta">${esc(researchDay)}</span>` : "")}
          ${recent.length
            ? `<div class="panel">${recent.slice(0, 6).map(({ type, item }) => itemRow(type, item, true, item.firstSeen === researchDay ? "新增" : "修订")).join("")}</div>`
            : empty("该研究日暂无新增或修订的 Idea 和趋势。")}
        </section>
        <section>
          ${sectionHeading("24 小时热点", internal("完整热点", "hot"))}
          ${hot.length ? `<div class="panel">${hot.slice(0, 5).map(hotRow).join("")}</div>` : empty("本次更新暂无可归集的热点。", internal("查看信息流", "feed"))}
        </section>
      </div>
      <aside class="home-side" aria-label="数据监测与重点入口">
        ${activityPanel()}
        ${sourcesPanel()}
        <section class="panel"><article class="list-row"><h3>${internal("查看精选帖子", "picks", "", {}, "")}</h3><p>按当前评分阈值收录，逐条查阅评分依据。</p></article><article class="list-row"><h3>${internal("按产业或公司追踪", "topics", "", {}, "")}</h3><p>从主题回到原帖、Idea 和趋势。</p></article></section>
      </aside>
    </div>`;
}

function tagList(values, key) {
  return list(values).length ? `<ul class="tags">${values.map(value => `<li>${internal(value, "topics", "", { [key]: value }, "tag")}</li>`).join("")}</ul>` : "";
}

function contextBlock(post, property, label) {
  const item = post[property];
  if (!item) return "";
  const context = typeof item === "string" ? { id: item, url: item } : item;
  const known = posts.get(String(context.id ?? context.postId));
  const text = context.text ?? context.excerpt ?? known?.text;
  const url = context.url ?? context.permalink ?? known?.url;
  return `<details class="post-context">
    <summary>${esc(label)}${context.handle || known?.handle ? ` ${esc(postAuthor(context.handle ? context : known))}` : ""}</summary>
    ${text ? `<p>${esc(text)}</p>` : "<p>上下文原文未收录。</p>"}
    ${urlLink(url, "查看上下文原帖")}
  </details>`;
}

function mediaLinks(post) {
  const links = list(post.media).map((item, index) => {
    const url = typeof item === "string" ? item : item.url || item.previewUrl || item.preview_image_url;
    return urlLink(url, `附件 ${index + 1}`, "inline-link");
  }).filter(Boolean);
  return links.length ? `<div class="post-media">${links.join("")}</div>` : "";
}

function threadLinks(post) {
  if (list(post.thread).length) {
    return `<details class="post-context"><summary>串帖续文（${post.thread.length} 条）</summary>${evidenceLinks(post.thread)}</details>`;
  }
  if (post.threadRootId && String(post.threadRootId) !== String(post.id) && posts.has(String(post.threadRootId))) {
    return `<p class="score-note">${internal("查看串帖首条", "post", post.threadRootId)}</p>`;
  }
  return "";
}

function scoringDetails(rating) {
  const dimensions = [
    ["影响", rating.breakdown?.impact, 35], ["增量", rating.breakdown?.novelty, 25],
    ["可核验性", rating.breakdown?.verification, 25], ["后续验证", rating.breakdown?.followUp, 15],
  ];
  const scores = dimensions.filter(([, value]) => Number.isFinite(value));
  return scores.length ? `<div class="meta">${scores.map(([label, value, max]) => `<span>${label} ${value}/${max}</span>`).join("")}</div>` : "";
}

function postCard(post, { detail = false, evidence = false, grouped = false } = {}) {
  if (post.unavailable) return `<article class="post"><p class="muted">证据 ${esc(post.id)} 未收录于本次数据。</p></article>`;
  const rating = score(post);
  const summary = rating.summary || post.summary;
  const original = post.excerpt || post.text;
  const types = { original: "原发", quote: "引用", quoted: "引用", reply: "回复", repost: "转发", retweet: "转发" };
  const postType = types[post.kind || post.type] || (post.quoted ? "引用" : post.replyTo ? "回复" : "");
  const strength = { high: "强", medium: "中", low: "弱" }[rating.strength];
  const breakdown = scoringDetails(rating);
  return `<article class="post">
    <header class="post-header">
      <div><h3>${internal(postAuthor(post), "feed", "", { source: handle(post.handle) }, "")}</h3>
      <div class="meta"><span>${stamp(post.publishedAt)}</span>${postType ? `<span>${postType}</span>` : ""}${post.sample ? "<span>演示样本</span>" : ""}${evidence && rating.event ? `<span>${esc(rating.event)}</span>` : ""}${["missing", "unavailable"].includes(post.contextStatus) ? '<span class="source-warn">上下文不足</span>' : ""}</div></div>
      ${Number.isFinite(rating.score) ? `<span class="post-score" title="研究相关性评分 ${rating.score} 分">${rating.score}</span>` : ""}
    </header>
    ${summary ? `<p class="post-summary">${esc(summary)}</p>` : ""}
    ${original && (detail || !summary) ? `<p class="post-original${detail ? "" : " clip"}">${esc(original)}</p>` : ""}
    ${rating.reason || strength || breakdown ? `<details class="score-note"${detail ? " open" : ""}><summary>评分依据${strength ? `（证据${strength}）` : ""}</summary>${rating.reason ? `<p>${esc(rating.reason)}</p>` : ""}${breakdown}</details>` : ""}
    ${rating.scoredAs ? `<p class="score-note">评分基于${internal("整串内容", "post", rating.scoredAs)}。</p>` : ""}
    ${tagList(rating.topics, "topic")}
    ${tagList(rating.companies, "company")}
    ${contextBlock(post, "quoted", "被引用内容")}
    ${contextBlock(post, "replyTo", "回复上文")}
    ${contextBlock(post, "repostOf", "被转发内容")}
    ${post.article?.url ? urlLink(post.article.url, "查看原文附带文章", "inline-link") : ""}
    ${grouped ? "" : threadLinks(post)}
    ${detail ? mediaLinks(post) : ""}
    <div class="post-actions">
      ${detail ? "" : internal("查看摘录", "post", post.id, {}, "button")}
      ${urlLink(post.url, "打开 X 原帖", "button")}
      ${saveButton("post", post.id)}
    </div>
  </article>`;
}

function postGroups(items) {
  const groups = new Map();
  for (const post of items) {
    const root = String(post.threadRootId || post.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(post);
  }
  return [...groups.entries()].map(([root, members]) => {
    if (members.length === 1) return postCard(members[0]);
    const lead = members.find(post => String(post.id) === root) || members[0];
    const children = byNewest(members.filter(post => post !== lead), "publishedAt").reverse();
    return `<div class="thread-group">
      ${postCard(lead, { grouped: true })}
      <details class="thread-expand"><summary>展开串帖其余 ${children.length} 条</summary>
        ${children.map(post => postCard(post, { grouped: true })).join("")}
      </details>
    </div>`;
  }).join("");
}

function distinct(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function taxonomies() {
  const ratings = [...posts.values()].map(score);
  return {
    sources: distinct([...list(payload.sources).map(source => handle(source.handle)), ...[...posts.values()].map(post => handle(post.handle))]),
    topics: distinct(ratings.flatMap(rating => list(rating.topics))),
    companies: distinct(ratings.flatMap(rating => list(rating.companies))),
    dates: distinct([...posts.values()].map(post => day(post.publishedAt))).reverse(),
  };
}

function select(name, label, values, current, anyLabel = "全部") {
  const options = values.map(value => typeof value === "string" ? [value, value] : value);
  if (current && !options.some(([value]) => value === current)) options.push([current, current]);
  return `<label>${label}<select name="${name}"><option value="">${anyLabel}</option>${options.map(([value, text]) =>
    `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(text)}</option>`
  ).join("")}</select></label>`;
}

function filterPosts(query, items) {
  const from24h = time(payload.generatedAt) - 24 * HOUR;
  const source = query.get("source")?.toLowerCase();
  const topic = query.get("topic");
  const company = query.get("company");
  const date = query.get("date");
  const needle = query.get("q")?.trim().toLowerCase();
  return items.filter(post => {
    const rating = score(post);
    const keywords = [post.handle, post.text, post.excerpt, post.summary, rating.summary, rating.event,
      ...list(rating.topics), ...list(rating.companies)];
    return (!source || handle(post.handle).toLowerCase() === source)
      && (!topic || list(rating.topics).includes(topic))
      && (!company || list(rating.companies).includes(company))
      && (!date || day(post.publishedAt) === date)
      && (query.get("period") !== "24" || (time(post.publishedAt) >= from24h && time(post.publishedAt) <= time(payload.generatedAt)))
      && (!needle || keywords.some(value => String(value ?? "").toLowerCase().includes(needle)));
  });
}

function filterForm(page, query, taxonomy) {
  return `<form class="filters" data-filters="${page}">
    <label class="search-field">关键词<input name="q" type="search" value="${esc(query.get("q"))}" placeholder="摘要、公司、原文"></label>
    ${select("source", "账号", taxonomy.sources.map(name => [name, `@${name}`]), query.get("source"))}
    ${select("topic", "行业 / 主题", taxonomy.topics, query.get("topic"))}
    ${select("company", "公司", taxonomy.companies, query.get("company"))}
    ${select("date", "日期", taxonomy.dates, query.get("date"))}
    ${select("period", "时间范围", [["24", "最近 24 小时"]], query.get("period"))}
    <button class="button primary" type="submit">筛选</button>
    ${query.size ? internal("清除", page, "", {}, "button") : ""}
  </form>`;
}

function feed(page, query) {
  const curated = page === "picks";
  const topicPage = page === "topics";
  const threshold = Number.isFinite(payload.threshold) ? payload.threshold : 70;
  const taxonomy = taxonomies();
  const matches = filterPosts(query, byNewest([...posts.values()], "publishedAt"))
    .filter(post => !curated || (Number.isFinite(score(post).score) && score(post).score >= threshold));
  if (curated) matches.sort((a, b) => score(b).score - score(a).score);
  const selectedTopics = query.get("topic") || query.get("company");
  const results = `<p class="filter-count">${matches.length} 条帖子</p>${matches.length
    ? `<div class="panel">${curated ? matches.map(post => postCard(post)).join("") : postGroups(matches)}</div>`
    : empty("没有符合当前条件的帖子。", query.size ? internal("清除筛选", page) : "")}`;
  const related = ["ideas", "trends"].map(type => ({
    type,
    items: list(payload[type]).filter(item =>
      (query.get("topic") && list(item.topics).includes(query.get("topic")))
      || getEvidence(item.evidence).some(post => matches.includes(post))),
  }));
  const topics = `<div class="topic-grid">
      <section class="panel panel-body"><h2>行业与研究主题</h2>${taxonomy.topics.length ? tagList(taxonomy.topics, "topic") : '<p class="hint">尚无主题标签。</p>'}</section>
      <section class="panel panel-body"><h2>公司</h2>${taxonomy.companies.length ? tagList(taxonomy.companies, "company") : '<p class="hint">尚无公司标签。</p>'}</section>
    </div>`;
  return `${heading(curated ? "精选帖子" : topicPage ? "行业与公司主题" : "X 信息流", curated
    ? `当前精选阈值为 ${threshold} 分。按研究相关性评分从高到低排列。`
    : topicPage ? "按行业、主题或公司查阅原帖及相关研究。" : "来自关注账号的帖子，按发布时间排列，可展开同一串帖。")}
    ${filterForm(page, query, taxonomy)}
    ${topicPage ? topics : ""}
    ${topicPage && selectedTopics ? related.map(({ type, items }) => section(TYPES[type].title, items.length
      ? `<div class="panel">${items.map(item => itemRow(type, item)).join("")}</div>` : empty("当前主题下暂无相关研究。"))).join("") : ""}
    ${topicPage ? section("相关帖子", results) : results}`;
}

function library(type) {
  const items = type === "hot" ? list(payload.hot) : byNewest(list(payload[type]), type === "reports" ? "date" : "updatedAt");
  const descriptions = {
    reports: "按北京时间归档，汇总重要变化、Idea 与趋势。",
    ideas: "可验证的投资假设及其证据、风险和后续观察。",
    trends: "跟踪重复出现的产业变化与证据演进。",
    hot: "以数据更新时间向前滚动 24 小时，按独立出处归集讨论。相同上游来源合并计算。",
  };
  return `<div class="narrow">${heading(TYPES[type].title, descriptions[type])}
    ${items.length ? `<div class="panel">${items.map((item, index) => type === "hot" ? hotRow(item, index) : itemRow(type, item)).join("")}</div>` : empty("当前没有可查看的条目。", internal("返回研究总览", "home"))}</div>`;
}

function evidenceCards(ids) {
  const items = getEvidence(ids);
  return items.length ? `<div class="panel">${items.map(post => postCard(post, { evidence: true })).join("")}</div>` : "";
}

function hotEvidence(ids) {
  const unique = new Map();
  const repeats = [];
  for (const post of getEvidence(ids)) {
    const key = post.evidenceKey || post.originId || post.id;
    const prior = unique.get(key);
    const isOriginal = (post.kind || post.type) === "original";
    const priorIsOriginal = (prior?.kind || prior?.type) === "original";
    if (!prior || (isOriginal && !priorIsOriginal)) {
      if (prior) repeats.push(prior.id);
      unique.set(key, post);
    } else {
      repeats.push(post.id);
    }
  }
  const primary = evidenceCards([...unique.values()].map(post => post.id));
  const references = repeats.length ? `<details class="panel panel-body repeated-evidence">
    <summary>同一上游出处的其他讨论（${repeats.length} 条）</summary>${evidenceLinks(repeats)}
  </details>` : "";
  return primary + references;
}

function researchFields(item) {
  return [
    ["投资假设", item.thesis],
    ["已知事实", item.facts],
    ["作者观点", item.authorView],
    ["研究推断", item.inference],
    ["趋势阶段", item.stage],
    ["催化剂", item.catalyst],
    ["风险", item.risk],
    ["失效条件", item.invalidation],
    ["下一步核对", item.watchNext],
  ].filter(([, value]) => Array.isArray(value) ? value.length : typeof value === "string" && value.trim())
    .map(([label, value]) => [label, Array.isArray(value) ? value.join("、") : value]);
}

function topicFacts(item) {
  const fields = researchFields(item);
  return fields.length ? `<dl class="panel fact-list">${fields.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`
  ).join("")}</dl>` : "";
}

function relatedResearch(item) {
  const related = new Set(list(item.relatedIds).map(String));
  return ["ideas", "trends"].flatMap(type => list(payload[type])
    .filter(entry => related.has(String(entry.id)))
    .map(entry => itemRow(type, entry, true))).join("");
}

function timeline(entries) {
  if (!entries.length) return "";
  return `<ol class="panel timeline">${entries.map(entry => `<li>
    <div class="meta">${stamp(entry.date || entry.asOf || entry.generatedAt || entry.updatedAt)}${entry.status === "archived" ? "<span>已归档</span>" : ""}${entry.model ? `<span>${esc(entry.model)}${entry.reasoningEffort ? ` / ${esc(entry.reasoningEffort)}` : ""}</span>` : ""}</div>
    <p>${esc(entry.summary)}</p>
    ${evidenceLinks(entry.evidence)}
    ${list(entry.counterEvidence).length ? `<p class="meta">反证</p>${evidenceLinks(entry.counterEvidence)}` : ""}
  </li>`).join("")}</ol>`;
}

function detail(type, id) {
  const item = list(payload[type]).find(entry => String(entry.id) === id);
  if (!item) return missing();
  const history = byNewest([...list(item.history)].reverse(), "generatedAt");
  const evolution = byNewest(list(item.timeline), "date");
  const sections = list(item.sections);
  const facts = topicFacts(item);
  const related = relatedResearch(item);
  const pageSuffix = type === "hot" ? `<span>${esc(item.independentCount ?? list(item.evidence).length)} 个独立出处</span><span>${esc(item.sourceCount ?? list(item.evidence).length)} 个讨论账号</span><span>${esc(item.postCount ?? list(item.evidence).length)} 条讨论</span>` : "";
  return `<div class="narrow">
    ${internal(`‹ ${TYPES[type].title}`, type, "", {}, "breadcrumb")}
    <header class="detail-head">
      <span class="kind">${TYPES[type].item}</span>
      <h1>${esc(item.title)}</h1>
      <div class="meta">
        <span>${stamp(item.date || item.updatedAt)}</span>
        ${item.firstSeen ? `<span>首次记录 ${stamp(item.firstSeen)}</span>` : ""}
        ${item.windowStart && item.windowEnd ? `<span>观察窗口 ${stamp(item.windowStart)} 至 ${stamp(item.windowEnd)}</span>` : ""}
        ${item.asOf ? `<span>证据截至 ${stamp(item.asOf)}</span>` : ""}
        ${item.status === "archived" ? "<span>已归档</span>" : ""}
        ${pageSuffix}
      </div>
      ${item.summary ? `<p>${esc(item.summary)}</p>` : ""}
      ${tagList(item.topics, "topic")}
      ${tagList(item.companies, "company")}
      <div class="actions">${saveButton(type, item.id)}${["trends", "ideas", "reports"].includes(type) ? internal("交给 Agent", "agent", "", { type, item: item.id }, "button") : ""}</div>
      ${item.model || item.generatedAt ? `<details class="score-note"><summary>生成信息</summary><div class="meta">${item.generatedAt ? `<span>生成于 ${stamp(item.generatedAt)}</span>` : ""}${item.model ? `<span>${esc(item.model)}</span>` : ""}${item.reasoningEffort ? `<span>推理强度 ${esc(item.reasoningEffort)}</span>` : ""}</div></details>` : ""}
    </header>
    ${section("研究要点", facts)}
    ${sections.map(entry => section(entry.title || "研究摘要", `<article class="panel panel-body"><p>${esc(entry.summary)}</p>${evidenceLinks(entry.evidence)}</article>`)).join("")}
    ${section("趋势演进", timeline(evolution))}
    ${section(type === "hot" ? "代表性证据" : "支持证据", (type === "hot" ? hotEvidence(item.evidence) : evidenceCards(item.evidence)) || empty("本条目暂无关联的原帖。"))}
    ${section("反证", evidenceCards(item.counterEvidence))}
    ${section("研究修订", timeline(history))}
    ${section("相关研究", related ? `<div class="panel">${related}</div>` : "")}
  </div>`;
}

function postDetail(id) {
  const post = posts.get(id);
  if (!post) return missing();
  const related = ["ideas", "trends", "reports", "hot"].flatMap(type => list(payload[type])
    .filter(item => getEvidence([...list(item.evidence), ...list(item.counterEvidence)]).some(evidence => String(evidence.id) === String(post.id)))
    .map(item => itemRow(type, item, true))).join("");
  return `<div class="narrow">${internal("‹ 信息流", "feed", "", {}, "breadcrumb")}
    ${heading("帖子与来源")}
    <div class="panel">${postCard(post, { detail: true })}</div>
    ${section("引用这条帖子的研究", related ? `<div class="panel">${related}</div>` : "")}
  </div>`;
}

function bookmarks() {
  const items = [...saved].reverse().map(key => {
    const separator = key.indexOf("/");
    const type = key.slice(0, separator);
    const id = key.slice(separator + 1);
    const item = type === "post" ? posts.get(id) : list(payload[type]).find(entry => String(entry.id) === id);
    if (item && type === "post") return postCard(item);
    return `<div class="saved-row">${item ? itemRow(type, item, true) : '<article class="list-row"><p>此条目未收录于当前数据。</p></article>'}${saveButton(type, id)}</div>`;
  });
  return `<div class="narrow">${heading("收藏", "收藏保存在当前浏览器。")}
    ${items.length ? `<div class="panel">${items.join("")}</div>` : empty("你还没有收藏帖子或研究。", internal("浏览精选帖子", "picks"))}</div>`;
}

function agentPacket(type, item) {
  const report = [
    "# " + (item?.title || TYPES[type].title),
    "生成时间（北京时间） " + dateLabel(payload.generatedAt),
    "数据模式 " + (live ? "实时接口" : "静态快照"),
  ];
  const entries = item ? [item] : byNewest(list(payload[type])).slice(0, 10);
  for (const entry of entries) {
    report.push("", "## " + entry.title, entry.summary || "");
    if (entry.asOf) report.push("证据截至 " + entry.asOf);
    const url = new URL(routeLink(type, entry.id), location.href);
    report.push("看板详情 " + url);
    for (const [label, value] of researchFields(entry)) report.push(`- **${label}** ${value}`);
    for (const entrySection of list(entry.sections)) report.push("", "### " + entrySection.title, entrySection.summary);
    for (const group of [
      ["支持证据", entry.evidence],
      ["反证", entry.counterEvidence],
    ]) {
      for (const post of getEvidence(group[1])) {
        if (post.unavailable) {
          report.push("- " + group[0] + "（当前快照未收录） " + post.id);
        } else {
          report.push(`- ${group[0]} ${postAuthor(post)} | ${dateLabel(post.publishedAt)} | ${httpURL(post.url) || "链接未收录"}`);
          const summary = score(post).summary || post.summary;
          if (summary) report.push("  " + summary);
        }
      }
    }
  }
  return report.join("\n");
}

function agent(query) {
  const types = ["reports", "ideas", "trends"];
  const type = types.includes(query.get("type")) ? query.get("type") : "reports";
  const items = byNewest(list(payload[type]));
  const item = items.find(entry => String(entry.id) === query.get("item"));
  const paths = live ? ["api/dashboard", "api/posts", "api/sources", "api/reports", "api/ideas", "api/trends"] : ["snapshot.json"];
  return `<div class="narrow">${heading("Agent 接入", "将研究摘要、证据链接和待核对问题交给你的 Agent。")}
    <section class="panel panel-body">
      <h2>研究上下文</h2>
      <form class="form-grid" id="agent-form">
        ${select("type", "类别", types.map(key => [key, TYPES[key].title]), type, "研究日报")}
        ${select("item", "研究条目", items.map(entry => [String(entry.id), entry.title]), item ? String(item.id) : "", "最近 10 条")}
      </form>
      <textarea class="agent-output" id="agent-packet" aria-label="研究上下文" readonly>${esc(agentPacket(type, item))}</textarea>
      <div class="actions"><button class="button primary" type="button" data-action="copy">复制上下文</button><button class="button" type="button" data-action="download">下载 Markdown</button></div>
    </section>
    ${section("机器可读数据", `<div class="panel panel-body"><p>${live ? "以下 JSON 接口无需管理令牌，可供 Agent 读取。" : "当前页面使用公开快照。Agent 可读取以下 JSON 文件。"}</p>
      <ul class="endpoint-list">${paths.map(path => `<li><a href="./${path}"><code>/${path}</code></a></li>`).join("")}</ul></div>`)}
  </div>`;
}

function sourceDetails(source) {
  const [label, className] = statusOf(source);
  const name = handle(source.handle);
  return `<tr>
    <td>${internal(`@${name}`, "feed", "", { source: name })}</td>
    <td class="${className}">${label}</td>
    <td>${stamp(source.lastSuccess || source.lastSuccessAt, "尚无成功记录")}</td>
    <td>${stamp(source.lastAttempt || source.lastChecked || source.checkedAt, "未知")}</td>
    <td>${source.coverageStart && source.coverageEnd ? `${stamp(source.coverageStart)} 至 ${stamp(source.coverageEnd)}` : "待确认"}</td>
    <td>${Number(source.postCount || 0)} 条采集${source.sampleCount ? ` / ${Number(source.sampleCount)} 条样本` : ""}</td>
    <td>${esc(source.error?.message || source.error || source.message || "—")}</td>
  </tr>`;
}

function admin() {
  const jobs = byNewest(list(payload.jobs)).slice(0, 10);
  const calls = list(payload.modelCalls).slice(0, 8);
  const sources = list(payload.sources);
  const threshold = Number.isFinite(payload.threshold) ? payload.threshold : 70;
  const jobStatuses = {
    success: "成功", succeeded: "成功", done: "已完成", completed: "已完成",
    error: "失败", failed: "失败", running: "运行中", queued: "待处理", skipped: "已跳过",
  };
  const jobTypes = { score: "帖子评分", ideas: "Idea 研究", trends: "趋势研究", trend_batch: "趋势证据分批归纳", report: "日报生成" };
  const runtime = `<dl class="panel fact-list">
    <div><dt>读取模式</dt><dd>${stale ? "上次成功读取" : live ? "实时接口" : "静态快照"}</dd></div>
    <div><dt>数据生成时间</dt><dd>${stamp(payload.generatedAt)}</dd></div>
    <div><dt>当前评分阈值</dt><dd>${threshold} 分${payload.thresholdVersion ? `（版本 ${esc(payload.thresholdVersion)}）` : ""}</dd></div>
  </dl>`;
  const thresholdForm = live ? `<div class="panel panel-body">
    <p>阈值用于筛选精选帖子。填写服务端配置的管理令牌后保存。</p>
    <form class="form-grid" id="threshold-form">
      <label>评分阈值（0–100）<input type="number" name="threshold" min="0" max="100" step="1" required value="${threshold}"></label>
      <label>管理令牌<input type="password" name="token" autocomplete="off" required></label>
      <div class="actions"><button class="button primary" type="submit">保存阈值</button><span id="threshold-message" role="status"></span></div>
    </form>
  </div>` : empty("当前使用只读数据。在实时服务中可以调整阈值。");
  return `${heading("后台状态", "核对数据更新时间、来源覆盖和研究任务。")}
    ${section("运行状态", runtime)}
    ${section("精选设置", thresholdForm)}
    ${section("来源采集", sources.length
      ? `<div class="panel table-wrap" tabindex="0" aria-label="来源采集状态"><table class="source-table"><thead><tr><th scope="col">账号</th><th scope="col">状态</th><th scope="col">最近成功读取</th><th scope="col">最近尝试</th><th scope="col">已核对范围</th><th scope="col">收录</th><th scope="col">备注</th></tr></thead>
      <tbody>${sources.map(sourceDetails).join("")}</tbody></table></div>` : empty("当前没有来源状态。"))}
    ${section("最近研究任务", jobs.length
      ? `<div class="panel">${jobs.map(job => `<article class="list-row">
        <h3>${esc(job.title || jobTypes[job.kind] || job.kind || "研究任务")}</h3>
        <div class="meta"><span>${esc(jobStatuses[job.status] || job.status || "状态未知")}</span><span>${stamp(job.finishedAt || job.updatedAt || job.startedAt || job.createdAt || job.date)}</span>${job.scope && job.scope !== "current" ? `<span>${esc(job.scope)}</span>` : ""}${job.attempts ? `<span>尝试 ${Number(job.attempts)} 次</span>` : ""}</div>
        ${job.error || job.message ? `<p>${esc(job.error?.message || job.error || job.message)}</p>` : ""}
      </article>`).join("")}</div>` : empty("当前数据没有研究任务记录。"))}
    ${section("最近模型调用", calls.length
      ? `<div class="panel">${calls.map(call => `<article class="list-row">
        <h3>${esc(jobTypes[call.kind] || call.kind || "模型调用")}</h3>
        <div class="meta"><span>${esc(call.model)}</span><span>推理强度 ${esc(call.reasoningEffort)}</span><span>${esc(jobStatuses[call.outcome] || call.outcome)}</span><span>${stamp(call.calledAt)}</span></div>
      </article>`).join("")}</div>` : "")}`;
}

function about() {
  return `<div class="narrow">${heading("关于 TechBuzz", "面向科技股投资研究的 X 信息监测台。")}
    <article class="panel panel-body prose">
      <section><h2>研究路径</h2><p>从关注账号获取公开信息，提取中文摘要、公司和主题。按研究相关性筛选帖子，再将可复核的证据串成投资 Idea、趋势和日报。</p></section>
      <section><h2>证据口径</h2><p>原发、引用和回复分别保留链接和已知上下文。24 小时热点对相同上游出处去重。Idea 和趋势详情保留支持证据、反证及可用的修订记录。</p></section>
      <section><h2>数据时效</h2><p>实时接口展示服务最近一次写入的结果，静态快照展示发布时的数据。页面统一按北京时间显示，逐账号更新时间与失败记录可在后台查看。</p><p>${internal("查看后台状态", "admin")}</p></section>
    </article></div>`;
}

function missing() {
  return `${heading("页面未找到")}${empty("该链接在当前数据中没有对应条目。", internal("返回研究总览", "home"))}`;
}

function render() {
  displayMode();
  const { page, id, query } = getRoute();
  for (const link of document.querySelectorAll("[data-page]")) {
    const parent = page === "post" ? "feed" : page;
    if (link.dataset.page === parent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (!payload) {
    main.innerHTML = failure
      ? `${heading("研究数据暂不可用")}${empty("实时接口和公开快照均未能读取。", '<button class="button" type="button" data-action="refresh">重新读取</button>')}`
      : '<div class="loading" role="status">正在加载研究数据…</div>';
    return;
  }
  if (Object.hasOwn(TYPES, page)) {
    main.innerHTML = id ? detail(page, id) : library(page);
  } else {
    const pages = {
      home, feed: () => feed("feed", query), picks: () => feed("picks", query),
      topics: () => feed("topics", query), saved: bookmarks, post: () => postDetail(id),
      agent: () => agent(query), admin, about,
    };
    main.innerHTML = Object.hasOwn(pages, page) ? pages[page]() : missing();
  }
  const title = main.querySelector("h1");
  document.title = title?.textContent ? `${title.textContent} · TechBuzz` : "TechBuzz · 科技股投研台";
}

async function saveThreshold(form) {
  if (!live) return;
  const button = form.querySelector("button");
  const message = form.querySelector("#threshold-message");
  const values = new FormData(form);
  const threshold = Number(values.get("threshold"));
  const token = String(values.get("token") || "").trim();
  button.disabled = true;
  message.textContent = "正在保存…";
  try {
    const response = await fetch("./api/admin/threshold", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ threshold }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 || response.status === 403) throw new Error("管理令牌不正确或该操作未启用。");
    if (!response.ok) throw new Error(`保存失败（HTTP ${response.status}）。`);
    form.elements.token.value = "";
    await loadData();
    notify("已保存精选阈值");
  } catch (error) {
    message.textContent = error.name === "TimeoutError" ? "请求超时。请刷新后核对实际阈值。" : error.message;
  } finally {
    button.disabled = false;
  }
}

function setBookmark(button) {
  const key = button.dataset.save;
  const existed = saved.has(key);
  if (existed) saved.delete(key);
  else saved.add(key);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved]));
  } catch {
    notify("浏览器存储不可用，收藏仅保留在当前页面。");
  }
  if (getRoute().page === "saved") {
    render();
  } else {
    for (const match of main.querySelectorAll("[data-save]")) {
      if (match.dataset.save !== key) continue;
      match.textContent = existed ? "收藏" : "已收藏";
      match.setAttribute("aria-pressed", String(!existed));
    }
    displayMode();
  }
}

main.addEventListener("submit", event => {
  const form = event.target;
  if (form.dataset.filters) {
    event.preventDefault();
    location.hash = routeLink(form.dataset.filters, "", Object.fromEntries(new FormData(form)));
  } else if (form.id === "threshold-form") {
    event.preventDefault();
    saveThreshold(form);
  }
});

main.addEventListener("change", event => {
  if (event.target.form?.id !== "agent-form") return;
  const data = new FormData(event.target.form);
  location.hash = routeLink("agent", "", { type: data.get("type"), item: event.target.name === "type" ? "" : data.get("item") });
});

main.addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.save) setBookmark(button);
  const action = button.dataset.action;
  if (action === "refresh") loadData(true);
  if (action === "copy") {
    const packet = main.querySelector("#agent-packet");
    try {
      await navigator.clipboard.writeText(packet.value);
      notify("已复制研究上下文");
    } catch {
      packet.focus();
      packet.select();
      notify("已选中研究上下文，可手动复制。");
    }
  }
  if (action === "download") {
    const packet = main.querySelector("#agent-packet");
    const url = URL.createObjectURL(new Blob([packet.value], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `techbuzz-research-${day(payload.generatedAt) || "snapshot"}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});

refresh.addEventListener("click", () => loadData(true));
document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  main.focus();
});
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});

render();
loadData();
