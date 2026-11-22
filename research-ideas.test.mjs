import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { analyze, initResearch } from './research.mjs';

test('低分反证只用于相关的既有 Idea，并保留历史支持和直接引用', async () => {
  const db = new DatabaseSync(':memory:');
  initResearch(db);
  const calls = [];
  const complete = async ({ kind, input }) => {
    if (kind === 'score') return {
      scores: input.posts.map(({ id }) => {
        const unrelated = id === 'unrelated' || id === 'same-company';
        return {
          id,
          breakdown: { impact: id === 'seed' ? 30 : 10, novelty: 18, verification: 20, followUp: 10 },
          summary: '来源摘要', reason: '研究评分理由', strength: 'medium',
          companies: id === 'statement' ? [] : [id === 'seed' ? '$ORCL' : id === 'same-company' ? 'Oracle (ORCL)' : 'AMD'],
          topics: [unrelated ? '芯片交付' : '供应商融资'],
        };
      }),
    };
    if (kind === 'ideas') {
      calls.push(input);
      if (!input.known.length) return { entries: [{
        title: '甲骨文算力项目的供应商融资', summary: '还有资金安排待核实', thesis: '交付依赖未落实的融资',
        companies: ['甲骨文'], topics: ['供应商融资'], evidence: ['seed'], watchNext: '融资条款',
        maturity: '待研究线索',
      }] };
      const prior = input.known[0];
      return { entries: [{
        id: prior.id, title: prior.title, summary: '公司称融资完成', maturity: '跟踪中判断',
        counterEvidence: ['statement'], revision: {
          previousJudgment: prior.judgment, newEvidence: '公司公布融资已落实',
          change: '融资缺口担忧缓解', remaining: '是否有回购条款', evidence: ['statement'],
        },
      }] };
    }
    if (kind === 'trend_batch' || kind === 'trend_reduce') return { signals: [] };
    return { entries: [] };
  };
  const post = (id, date) => ({ id, text: id, handle: 'source', publishedAt: date });
  const origin = post('seed', '2026-11-18T00:00:00Z');
  const now = '2026-11-18T03:00:00Z';
  const before = await analyze(db, [origin], { now, complete });
  const posts = [
    origin,
    { ...post('statement', '2026-11-18T02:00:00Z'), collectedAt: '2026-11-18T04:00:00Z', nativeCompanies: ['Oracle'] },
    post('unrelated', '2026-11-18T04:30:00Z'),
    post('same-company', '2026-11-18T04:45:00Z'),
  ];
  const after = await analyze(db, posts, { now: '2026-11-18T05:00:00Z', complete });
  assert.equal(after.ideas.length, 1);
  assert.deepEqual(calls[1].posts.filter(p=>p.role==='trigger').map(({ id, allowNewIdea }) => [id, allowNewIdea]), [['statement', false]]);
  assert.equal(calls[1].known[0].judgment, '交付依赖未落实的融资');
  assert.equal(calls[1].known[0].priorEvidence[0].author, 'source');
  assert.equal(after.ideas[0].id, before.ideas[0].id);
  assert.deepEqual(after.ideas[0].history[0], before.ideas[0].history[0]);
  assert.deepEqual(after.ideas[0].evidence, ['seed']);
  assert.deepEqual(after.ideas[0].counterEvidence, ['statement']);
  assert.deepEqual(after.ideas[0].changeEvidence, ['statement']);
  assert.equal(after.ideas[0].change, '融资缺口担忧缓解');
  await analyze(db, posts, { now: '2026-11-18T05:00:00Z', complete });
  assert.equal(calls.length, 2);
  db.close();
});
