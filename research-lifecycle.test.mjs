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

test('Idea tracking keeps a stable separate identity and a frozen original thesis',async()=>{
 const {ideaTrackingPrior}=await import('./research.mjs');
 const idea={id:'idea-example',title:'激光器供给',coreIdea:'高功率供给偏紧',evidence:['p1'],status:'active'};
 const first=ideaTrackingPrior(idea,[]);
 assert.equal(first.sourceIdeaId,idea.id);
 assert(first.id.startsWith('trend-'));
 const again=ideaTrackingPrior({...idea,coreIdea:'供给有望改善'},[first]);
 assert.equal(again.id,first.id);
 assert.equal(again.originalIdea.judgment,'高功率供给偏紧');
 assert.equal(again.currentIdea.judgment,'供给有望改善');
 assert.equal(idea.coreIdea,'高功率供给偏紧');
});

test('pausing Idea generation still scores new material',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const {initResearch,runResearchModule}=await import('./research.mjs');
 const db=new DatabaseSync(':memory:');initResearch(db);
 const env={TECHBUZZ_IDEAS_ENABLED:'false',TECHBUZZ_LLM_BASE_URL:'https://model.example/v1',TECHBUZZ_LLM_MODEL:'test-model',TECHBUZZ_LLM_API_KEY:'test'};
 const previous={};for(const [k,v] of Object.entries(env)){previous[k]=process.env[k];process.env[k]=v}
 t.after(()=>{for(const k of Object.keys(env)){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k]}db.close()});
 let calls=0;
 t.mock.method(globalThis,'fetch',async(_url,request)=>{
  calls++;const body=JSON.parse(request.body);const input=JSON.parse(body.messages[1].content);assert.equal(input.posts.length,1);
  return Response.json({model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify({scores:[{id:'P1',breakdown:{impact:30,novelty:20,verification:20,followUp:12},reason:'公司披露',summary:'新订单',strength:'high',topics:['半导体'],companies:['Example'],event:'签约'}]})}}]});
 });
 await runResearchModule(db,[{id:'new',handle:'source',publishedAt:new Date().toISOString(),text:'New contract',url:'https://x.com/source/status/new'}],'ideas');
 assert.equal(calls,1);
 assert.equal(db.prepare('select count(*) n from research_scores').get().n,1);
 assert.equal(db.prepare('select count(*) n from research_ideas').get().n,0);
});

test('V3 ideas immediately get one explicit pending tracking baseline without fabricated updates',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {initResearch,ensureIdeaTracking,research}=await import('./research.mjs');
 const db=new DatabaseSync(':memory:');initResearch(db);
 const idea={id:'idea-v3-new',title:'投资假设',pitch:'检验现金回报',status:'active',researchFormat:3,
  updatedAt:'2026-11-23T00:00:00Z',asOf:'2026-11-22T00:00:00Z',evidence:['p1'],counterEvidence:[],relatedIds:[],watchVariables:[{name:'交付',supportIf:'按期',invalidateIf:'延期'}]};
 db.prepare('insert into research_ideas values (?,?)').run(idea.id,JSON.stringify(idea));
 ensureIdeaTracking(db,idea,Date.parse('2026-11-23'));
 ensureIdeaTracking(db,idea,Date.parse('2026-11-24'));
 const result=research(db);
 assert.equal(result.trends.length,1);
 const t=result.trends[0];
 assert.equal(t.sourceIdeaId,idea.id);assert.equal(t.trackingStatus,'awaiting-evidence');
 assert.deepEqual(t.timeline,[]);assert.deepEqual(t.evidence,[]);assert.equal(t.model,null);
 assert.equal(t.originalIdea.judgment,idea.pitch);assert.equal(t.watchVariables.length,1);
 assert(result.ideas[0].relatedIds.includes(t.id));
 db.close();
});
