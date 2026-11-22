import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { analyze, initResearch, research, setThreshold } from './research.mjs';

function post(id, day, extra) {
  return { id, handle: `source_${id}`, text: `材料 ${id}`, publishedAt: `2026-11-${day}T18:00:00+08:00`, ...extra };
}

function fakeModel(log, mode = {}) {
  return async ({ kind, input }) => {
    log.push({ kind, input });
    const ids = (input.posts ?? input.sources ?? []).map(({ id }) => id);
    if (kind === 'score') return {
      scores: input.posts.map(({ id }) => ({
        id,
        breakdown: id === 'low'
          ? { impact: 10, novelty: 10, verification: 12, followUp: 8 }
          : { impact: 33, novelty: 20, verification: 22, followUp: 10 },
        reason: '按四项独立评价', summary: '概述', strength: id === 'low' ? 'low' : 'high',
        topics: ['GPU'], companies: ['NVDA'], event: 'GPU租金报价更新',
      })).slice(0, mode.invalidScore ? Math.max(0, ids.length - 1) : ids.length),
    };
    if (kind === 'ideas') return {
      entries: [{
        id: input.known.find(({ title }) => title === 'GPU 订单')?.id,
        title: 'GPU 订单', summary: `记录 ${ids.join('、')}`,
        facts: '报价服务公开数据', authorView: '作者看好租金弹性', inference: '需核实利用率和实际签单价',
        evidence: mode.invalidIdea ? ['invented'] : ids,
      }],
    };
    if (kind === 'trend_batch') return {
      signals: [{
        title: 'GPU 观点', summary: '观点出现分歧',
        evidence: ids.filter((id) => id !== 'low'),
        counterEvidence: ids.filter((id) => id === 'low'),
      }],
    };
    if (kind === 'trends') return {
      entries: [{
        id: input.known.find(({ title }) => title === '租金价格')?.id,
        title: '租金价格', summary: '有反证待核验',
        evidence: ids.filter((id) => id === 'high' || id === 'new'),
        counterEvidence: ids.filter((id) => id === 'low'),
        stage: ids.includes('new') ? '分歧' : '初现',
      }, ...(ids.includes('other') ? [{
        id: input.known.find(({ title }) => title === '先进封装')?.id,
        title: '先进封装', summary: '独立研究线', evidence: ['other'],
      }] : [])],
    };
    if (kind === 'report') return {
      title: `${input.date} 日报`, summary: '研究摘要',
      sections: [{ title: '当日材料', summary: '证据', kind: 'digests', evidence: ids }],
    };
    throw new Error(`Unexpected model task ${kind}`);
  };
}

test('四项评分、独立的 Idea / 多趋势、上午八点日报和历史追踪', async () => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const log = [];
  const complete = fakeModel(log);
  const high = post('high', '18', {
    text: '完整的观点。'.repeat(2_000),
    quoted: { id: 'quoted', text: '作者所引原文' },
    thread: [{ id: 'future-thread', text: '随后修订', publishedAt: '2026-11-20T09:00:00+08:00' }],
  });
  const rows = [high, post('low', '18'), post('other', '18'), post('new', '20')];
  const before = '2026-11-19T07:59:59+08:00';
  let result = await analyze(db, rows, { now: before, complete });
  assert.equal(result.threshold, 70);
  assert.equal(result.scores.high.score, 85);
  assert.equal(result.scores.low.score, 40);
  assert.equal(result.scores.new, undefined);
  assert.equal(result.reports.length, 0);
  assert.equal(result.trends.length, 2);
  assert.deepEqual(result.ideas[0].evidence, ['high', 'other']);
  assert.equal(result.ideas[0].inference, '需核实利用率和实际签单价');
  assert.equal(result.ideas[0].asOf, '2026-11-18T23:59:59.000Z');
  assert.equal(result.ideas[0].model, 'injected');
  assert.equal(result.ideaReceipts[0].threshold, 70);
  assert.equal(result.ideaReceipts[0].status, 'completed');
  assert.deepEqual(result.ideaReceipts[0].posts, [{ id: 'high', score: 85 }, { id: 'other', score: 85 }]);
  const ideaInput = log.find(({ kind }) => kind === 'ideas').input;
  assert.deepEqual(ideaInput.posts.map(({ id }) => id), ['high', 'other']);
  assert.equal(ideaInput.posts[0].text, high.text);
  assert.equal(ideaInput.posts[0].quoted.text, high.quoted.text);
  assert.deepEqual(ideaInput.posts[0].thread, []);
  const trendInput = log.find(({ kind }) => kind === 'trend_batch').input;
  assert.deepEqual(trendInput.posts.map(({ id }) => id), ['high', 'low', 'other']);
  const rental = result.trends.find(({ title }) => title === '租金价格');
  assert.deepEqual(rental.counterEvidence, ['low']);
  assert.ok(rental.relatedIds.includes(result.ideas[0].id));

  const eight = '2026-11-19T08:00:00+08:00';
  result = await analyze(db, rows, { now: eight, complete });
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].date, '2026-11-18');
  assert.equal(result.reports[0].updatedAt, '2026-11-19T00:00:00.000Z');
  assert.equal(result.reports[0].asOf, result.reports[0].updatedAt);
  assert.notEqual(result.reports[0].generatedAt, result.reports[0].asOf);
  assert.deepEqual(result.reports[0].evidence, ['high', 'low', 'other']);
  let callCount = log.length;
  assert.deepEqual(await analyze(db, rows, { now: eight, complete }), result);
  assert.equal(log.length, callCount);

  result = await analyze(db, rows, { now: '2026-11-21T08:00:00+08:00', complete });
  assert.equal(result.reports[0].date, '2026-11-20');
  assert.deepEqual(result.reports[0].evidence, ['new']);
  assert.equal(result.trends.find(({ id }) => id === rental.id).history.at(-1).stage, '分歧');
  const priorTrends = log.findLast(({ kind }) => kind === 'trends').input.known;
  const priorRental = priorTrends.find(({ id }) => id === rental.id);
  assert.equal(priorRental.status, 'active');
  assert.equal(priorRental.stage, '初现');
  assert.equal(priorRental.timeline[0].date, '2026-11-18');
  assert.ok(result.ideas[0].history.length > 1);
  const laterScore = log.findLast(({ kind }) => kind === 'score');
  assert.equal(laterScore.input.posts.find(({ id }) => id === 'high').thread[0].id, 'future-thread');

  assert.equal(setThreshold(db, 90).thresholdVersion, 2);
  assert.equal(setThreshold(db, 90).thresholdVersion, 2);
  callCount = log.length;
  result = await analyze(db, rows, { now: '2026-11-21T08:00:00+08:00', complete });
  assert.equal(result.ideas[0].status, 'archived');
  assert.ok(result.ideas[0].history.some(({ status }) => status === 'active'));
  assert.equal(log.length, callCount);
  result = await analyze(db, rows, { now: '2026-12-21T08:00:00+08:00', complete });
  assert.ok(result.trends.every(({ status }) => status === 'archived'));
  assert.deepEqual(result.reports[0].evidence, []);
  db.close();
});

test('无效评分不部分写入，失败任务重试且杜绝未知证据', async () => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const log = [];
  const mode = { invalidScore: true, invalidIdea: true };
  const complete = fakeModel(log, mode);
  const rows = [post('high', '18'), post('low', '18')];
  const now = '2026-11-19T09:00:00+08:00';
  let result = await analyze(db, rows, { now, complete });
  assert.deepEqual(result.scores, {});
  assert.equal(result.jobs.find(({ kind }) => kind === 'score').status, 'failed');
  assert.deepEqual(log.map(({ kind }) => kind), ['score']);

  mode.invalidScore = false;
  result = await analyze(db, rows, { now, complete });
  assert.equal(result.jobs.find(({ kind }) => kind === 'score').attempts, 2);
  assert.equal(result.jobs.find(({ kind }) => kind === 'ideas').status, 'failed');
  assert.equal(result.ideas.length, 0);
  assert.equal(result.trends.length, 1);
  assert.equal(result.reports.length, 1);

  mode.invalidIdea = false;
  const callCount = log.length;
  result = await analyze(db, rows, { now, complete });
  assert.equal(result.ideas.length, 1);
  assert.deepEqual(result.ideas[0].evidence, ['high']);
  assert.equal(result.jobs.find(({ kind }) => kind === 'ideas').attempts, 2);
  assert.deepEqual(log.slice(callCount).map(({ kind }) => kind), ['ideas']);
  assert.deepEqual(research(db), result);
  db.close();
});

test('首次回填可覆盖多日低分反证；失败保留已生成趋势和日报', async () => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const rows = [post('high', '18'), post('low', '19'), post('new', '20')];
  const base = fakeModel([]);
  let fail = false;
  const complete = async (request) => {
    const result = await base(request);
    if (request.kind === 'trends') {
      result.entries[0].timeline = [
        { date: '2026-11-18', summary: '首次出现', evidence: ['high'] },
        { date: fail ? '2026-11-18' : '2026-11-19', summary: '租金成交反证', counterEvidence: ['low'] },
        { date: '2026-11-20', summary: '新增观察', evidence: ['new'] },
      ];
    }
    return result;
  };
  let result = await analyze(db, rows, { now: '2026-11-21T08:00:00+08:00', complete });
  assert.deepEqual(result.trends[0].timeline.map(({ date }) => date), ['2026-11-18', '2026-11-19', '2026-11-20']);
  assert.deepEqual(result.trends[0].timeline[1].counterEvidence, ['low']);
  const priorTrend = result.trends[0];
  fail = true;
  result = await analyze(db, [...rows, post('other', '21')], { now: '2026-11-22T08:00:00+08:00', complete });
  assert.equal(result.jobs.find(({ kind }) => kind === 'trends').status, 'failed');
  assert.deepEqual(result.trends[0], priorTrend);
  assert.ok(result.ideas[0].evidence.includes('other'));
  assert.equal(result.reports[0].date, '2026-11-21');
  assert.deepEqual(result.reports[0].evidence, ['other']);
  db.close();
});

test('较大趋势输入先分批，再压缩后送给总览模型', async () => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const rows = Array.from({ length: 40 }, (_, index) => post(`post-${index}`, '19'));
  const modeled = [];
  const base = fakeModel([]);
  const complete = async (request) => {
    modeled.push(request);
    switch (request.kind) {
      case 'trend_batch':
        return { signals: request.input.posts.map(({ id }) => ({ title: id, summary: '信号', evidence: [id] })) };
      case 'trend_reduce':
        return { signals: request.input.signals.slice(0, 7) };
      case 'trends':
        return { entries: request.input.analysis.slice(0, 1).map(({ title, summary, evidence }) => ({ title, summary, evidence })) };
      default:
        return base(request);
    }
  };
  const result = await analyze(db, rows, { now: '2026-11-20T07:00:00+08:00', complete });
  const batches = modeled.filter(({ kind }) => kind === 'trend_batch');
  assert.equal(batches.length, 4);
  assert.equal(batches.flatMap(({ input }) => input.posts).length, 40);
  assert.ok(modeled.some(({ kind }) => kind === 'trend_reduce'));
  const trend = modeled.find(({ kind }) => kind === 'trends').input;
  assert.ok(trend.sources.length < 20);
  assert.ok(trend.sources.every(({ id, date, summary }) => id && date && summary === undefined));
  assert.equal(result.trends.length, 1);
  db.close();
});

test('定向回放后沿用同输入的旧趋势结果，新材料到达后继续合成', async () => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const log = [];
  const complete = fakeModel(log);
  const now = '2026-11-19T07:00:00+08:00';
  const rows = [post('high', '18')];
  await analyze(db, rows, { now, complete });
  const score = db.prepare("SELECT input_hash FROM research_scores WHERE post_id = 'high'").get().input_hash;
  const oldInput = [2, ['injected', process.env.TECHBUZZ_LLM_REASONING_EFFORT || 'max'], '2026-10-21', '2026-11-19', [score]];
  const oldFingerprint = createHash('sha256').update(JSON.stringify(oldInput)).digest('hex');
  db.prepare("UPDATE research_jobs SET input_hash = ? WHERE kind = 'trends' AND scope = 'current'").run(oldFingerprint);
  db.prepare("INSERT INTO research_success VALUES ('trends', 'replay:trend-existing', NULL, ?)").run(now);
  log.length = 0;
  await analyze(db, rows, { now, complete });
  assert.equal(log.some(({ kind }) => kind === 'trends'), false);
  await analyze(db, [...rows, post('low', '18')], { now, complete });
  assert.equal(log.filter(({ kind }) => kind === 'trends').length, 1);
  db.close();
});

test('OpenAI 兼容适配器保留精确 ID、重试坏引用与截断并持久化模型', async (t) => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const priorId = 'trend-existing';
  const priorTrend = {
    id: priorId, title: '既有趋势', summary: '上轮研究判断', status: 'active', relatedIds: [],
    evidence: [], counterEvidence: [], history: [], timeline: [],
  };
  db.prepare('INSERT INTO research_trends VALUES (?, ?)').run(priorId, JSON.stringify(priorTrend));
  const env = {
    TECHBUZZ_LLM_BASE_URL: 'https://opencode.ai/inference/go/openai/v1',
    TECHBUZZ_LLM_API_KEY: 'test',
    TECHBUZZ_LLM_REASONING_EFFORT: 'max',
  };
  const prior = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    db.close();
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const session = options.headers['x-opencode-session'];
    const kind = session.split('-').at(-1);
    const request = JSON.parse(options.body);
    const [system, user] = request.messages.map(({ content }) => content);
    const input = JSON.parse(user);
    const previous = requests.filter((record) => record.kind === kind);
    requests.push({ url: String(url), kind, session, request, system, input });
    let result;
    let finish = 'stop';
    if (kind === 'score') {
      finish = previous.length ? 'stop' : 'length';
      result = { scores: [{ id: 'P1', breakdown: { impact: 30, novelty: 22, verification: 20, followUp: 12 }, reason: '理由', summary: '摘要', strength: 'high' }] };
    } else if (kind === 'ideas') {
      result = { entries: [{ title: 'Idea', summary: '研究假设', evidence: [previous.length ? 'P1' : '1234567891234567890'] }] };
    } else if (kind === 'trends' && input.posts) {
      result = { signals: [{ title: 'Trend', summary: '信号', evidence: ['P1'] }] };
    } else if (kind === 'trends') {
      assert.deepEqual(input.observations[0].dates, ['2026-11-18']);
      const update = {
        title: 'Trend', summary: '趋势', prior: 1, observations: [1], changeObservations: [1],
        previousJudgment: '原先偏谨慎', newEvidence: '现有一手报告', change: '判断增强', remaining: '交付待查',
        next: '核对交付', timeline: [{ date: '2026-11-18', summary: '新增交付资料', observations: [1] }],
      };
      result = { lines: [update, { ...update, title: '单日候选', prior: 0 }] };
    } else {
      result = { title: 'Report', summary: '日报', sections: [{ title: '摘要', summary: '材料', evidence: ['P1'] }] };
    }
    return Response.json({ model: 'deepseek-v4.1-flash', choices: [{ finish_reason: finish, message: { content: JSON.stringify(result) } }] });
  });

  const id = '1234567891234567890';
  const result = await analyze(db, [post(id, '18')], { now: '2026-11-19T08:00:00+08:00', model: 'deepseek-v4.1-flash' });
  assert.equal(result.scores[id].score, 84);
  assert.deepEqual(result.ideas[0].evidence, [id]);
  assert.equal(result.trends.length, 1);
  assert.equal(result.trends[0].id, priorId);
  assert.equal(result.trends[0].change, '判断增强');
  assert.deepEqual(result.trends[0].changeEvidence, [id]);
  assert.deepEqual(result.trends[0].timeline[0].evidence, [id]);
  assert.deepEqual(result.reports[0].evidence, [id]);
  assert.ok(requests.every(({ request, url }) => request.reasoning_effort === 'max' && url.endsWith('/v1/chat/completions')));
  assert.ok(requests.every(({ input }) => (input.posts ?? input.sources ?? []).every(({ id }) => id === 'P1')));
  assert.deepEqual(requests.filter(({ kind }) => kind === 'score').map(({ request }) => request.max_tokens), [16384, 32768]);
  assert.ok(requests.filter(({ kind }) => kind === 'ideas')[1].system.includes('上次响应'));
  assert.equal(new Set(requests.filter(({ kind }) => kind === 'trends').map(({ session }) => session)).size, 1);
  assert.ok(result.modelCalls.some(({ model, reasoningEffort, outcome }) => model === 'deepseek-v4.1-flash' && reasoningEffort === 'max' && outcome === 'truncated'));
});

test('同作者串共享根评分，缓存可复用且跨日发布独立保留依据', async () => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const root = { ...post('high', '18'), publishedAt: '2026-10-01T12:00:00+08:00', handle: 'author' };
  const first = post('reply1', '19', { handle: 'author', threadRootId: 'high', text: '第一次跟帖，属于昨日' });
  const next = post('reply2', '20', { handle: 'author', threadRootId: 'high', text: '追加跟帖，属于今日', publishedAt: '2026-11-20T07:30:00+08:00' });
  root.thread = [first, next];
  const logged = [];
  const base = fakeModel([]);
  const complete = async (request) => {
    const { kind, input } = request;
    logged.push(request);
    if (kind === 'trends') {
      return {
        entries: [{
          id: input.known.find(({ title }) => title === '作者续帖')?.id,
          title: '作者续帖', summary: '持续跟踪串内内容',
          evidence: input.sources.map(({ id }) => id),
        }],
      };
    }
    return base(request);
  };

  // A previously scored root already contained the collector-provided child.
  let result = await analyze(db, [root], { now: '2026-11-19T23:59:59+08:00', complete });
  assert.deepEqual(logged[0].input.posts[0].thread.map(({ id }) => id), ['reply1']);
  assert.equal(result.ideas.length, 1);
  logged.length = 0;
  result = await analyze(db, [root, first, next], { now: '2026-11-19T23:59:59+08:00', complete });
  assert.equal(logged.some(({ kind }) => kind === 'score' || kind === 'ideas'), false);
  assert.equal(result.scores.reply1.scoredAs, 'high');
  assert.equal(result.scores.reply1.score, result.scores.high.score);
  assert.equal(result.scores.reply2, undefined);
  assert.deepEqual(result.trends[0].evidence, ['reply1']);
  assert.deepEqual(result.trends[0].timeline.map(({ date }) => date), ['2026-11-19']);

  logged.length = 0;
  result = await analyze(db, [root, first, next], { now: '2026-11-20T08:00:00+08:00', complete });
  const scores = logged.find(({ kind }) => kind === 'score').input.posts;
  assert.deepEqual(scores.map(({ id }) => id), ['high']);
  assert.deepEqual(scores[0].thread.map(({ id }) => id), ['reply1', 'reply2']);
  const ideas = logged.find(({ kind }) => kind === 'ideas').input.posts;
  assert.deepEqual(ideas.map(({ id }) => id), ['high']);
  assert.deepEqual(result.ideaReceipts[0].posts, [{ id: 'high', score: 85 }]);
  assert.equal(result.scores.reply2.scoredAs, 'high');
  const earlierTrendPost = logged.find(({ kind, input }) => kind === 'trend_batch' && input.date === '2026-11-19').input.posts[0];
  assert.deepEqual(earlierTrendPost.assessment, { score: 85, scoredAs: 'high' });
  assert.deepEqual(result.trends[0].evidence, ['reply1', 'reply2']);
  assert.deepEqual(result.trends[0].timeline.map(({ date }) => date), ['2026-11-19', '2026-11-20']);
  const reportPosts = logged.find(({ kind }) => kind === 'report').input.posts;
  assert.deepEqual(reportPosts.map(({ id }) => id), ['reply1']);
  assert.equal(reportPosts[0].text, first.text);
  assert.equal(reportPosts[0].assessment, null);
  assert.deepEqual(result.reports[0].evidence, ['reply1']);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM research_scores').get().total, 1);
  db.close();
});

test('旧 Idea 的串内引用只合并当前证据，保留历史原帖 ID', async () => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const root = post('high', '18', { handle: 'root-author' });
  const child = post('child', '18', { handle: 'root-author', publishedAt: '2026-11-18T19:00:00+08:00' });
  const logged = [];
  const complete = fakeModel(logged);
  let result = await analyze(db, [root, child], { now: '2026-11-18T20:00:00+08:00', complete });
  const originalIdea = result.ideas[0];
  assert.deepEqual(originalIdea.evidence, ['high', 'child']);

  logged.length = 0;
  result = await analyze(db, [root, { ...child, threadRootId: 'high' }], { now: '2026-11-18T21:00:00+08:00', complete });
  assert.deepEqual(logged.find(({ kind }) => kind === 'score').input.posts.map(({ id }) => id), ['high']);
  assert.deepEqual(result.ideas[0].history[0].evidence, ['high', 'child']);
  assert.deepEqual(result.ideas[0].evidence, ['high']);
  assert.equal(result.ideas[0].id, originalIdea.id);
  assert.equal(result.scores.child.scoredAs, 'high');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM research_scores').get().total, 2);
  db.close();
});

test('streamed completions retain final text across chunks and reject interrupted results', async () => {
  const {readCompletion} = await import('./research.mjs');
  const stream = (...rows) => new Response(rows.map(row => 'data: '+JSON.stringify(row)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
  const partial = {choices:[{delta:{content:'{"ok":'}}]};
  const done = {choices:[{delta:{content:'true}'},finish_reason:'stop'}]};
  const data = await readCompletion(stream({choices:[{delta:{reasoning_content:'analysis'}}]},partial,done));
  assert.equal(data.choices[0].message.content,'{"ok":true}');
  await assert.rejects(readCompletion(stream(partial)),/响应中断/);
});
