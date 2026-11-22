import test from 'node:test';
import assert from 'node:assert/strict';
import {expiredTrends,mergeTrendUpdates} from './research-lifecycle.mjs';

test('rewriting old evidence cannot extend the thirty-day active window',()=>{
 const old={id:'old',status:'active',timeline:[{date:'2026-10-20'}],firstSeen:'2026-10-20',updatedAt:'2026-11-22'};
 const fresh={...old,id:'fresh',lastSignalAt:'2026-11-20'};
 assert.deepEqual(expiredTrends([old,fresh],Date.parse('2026-11-22')).map(e=>e.id),['old']);
});

test('merging preserves source histories and nodes, redirects old IDs and rejects conflicting merges',()=>{
 const old={id:'old',status:'active',evidence:['p1'],counterEvidence:[],relatedIds:['idea-1'],timeline:[{date:'2026-11-01',summary:'A',evidence:['p1']}],history:[{summary:'previous'}]};
 const main={id:'main',status:'active',evidence:['p2'],counterEvidence:[],relatedIds:[],timeline:[{date:'2026-11-20',summary:'B',evidence:['p2']}],history:[{summary:'merged'}]};
 const updates=mergeTrendUpdates(new Map([['main',structuredClone(main)]]),[old], [{target:'main',ids:['old']}],Date.parse('2026-11-22'));
 assert.deepEqual(updates.get('main').evidence,['p2','p1']);
 assert.equal(updates.get('main').timeline.length,2);
 assert.equal(updates.get('old').mergedInto,'main');
 assert.deepEqual(updates.get('old').history,old.history);
 assert.deepEqual(expiredTrends([...updates.values()],Date.parse('2026-11-22')),[]);
 assert.throws(()=>mergeTrendUpdates(updates,[old],[{target:'main',ids:['old']}],Date.now()),/冲突/);
});

test('linked ideas resolve merged trends in both directions while historical detail stays available',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {initResearch,research}=await import('./research.mjs');
 const db=new DatabaseSync(':memory:');initResearch(db);
 const entry={title:'test',updatedAt:'2026-11-22',evidence:[],counterEvidence:[],history:[],relatedIds:[],status:'active'};
 db.prepare('insert into research_ideas values (?,?)').run('idea-a',JSON.stringify({...entry,id:'idea-a',relatedIds:['trend-old']}));
 for(const value of [{...entry,id:'trend-old',status:'archived',mergedInto:'trend-main'},{...entry,id:'trend-main'}])
  db.prepare('insert into research_trends values (?,?)').run(value.id,JSON.stringify(value));
 const result=research(db);
 assert.deepEqual(result.ideas[0].relatedIds,['trend-main']);
 assert.deepEqual(result.trends[0].relatedIds,['idea-a']);
 assert.equal(result.archivedTrends[0].mergedInto,'trend-main');
 db.close();
});
