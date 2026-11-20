import test from 'node:test';
import assert from 'node:assert/strict';
import {rankEvents} from './dashboard.mjs';

test('24h event ranking distinguishes distribution from independent sources', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const post = (id, handle, evidenceKey, publishedAt, quoted) => ({id, handle, evidenceKey, publishedAt, quoted});
  const current = '2026-11-20T10:00:00Z';
  const rows = [
    post('1','A','origin',current),post('2','B','origin',current,{handle:'A'}),
    post('3','C','new',current),post('4','D','old','2026-11-19T11:59:59Z'),
    post('5','E','other', current)
  ];
  const scores = Object.fromEntries(rows.map(p => [p.id,{event:p.id === '5' ? '单来源事件' : '公司公布订单'}]));
  const [event,...others] = rankEvents(rows,scores,now);
  assert.equal(event.sourceCount,3);
  assert.equal(event.independentCount,2);
  assert.deepEqual(event.evidence,['1','2','3']);
  assert.equal(others.length,0);
});
