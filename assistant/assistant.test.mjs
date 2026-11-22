import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTools} from './tools.mjs';
import {openStore} from './store.mjs';
import {runTurn} from './runtime.mjs';
import {createAssistantServer} from './server.mjs';
const at='2026-11-22T12:00:00Z';
const post=(id,text,extra={})=>({id,text,handle:'analyst',publishedAt:'2026-11-20T10:00:00Z',url:'https://x.com/analyst/status/'+id,...extra});
const snapshot={generatedAt:at,posts:[post('1','Oracle financing',{threadRootId:'1',thread:['2'],quoted:{text:'quoted full text'}}),post('2','negative evidence',{threadRootId:'1'}),post('3','CPO '+('完整原文'.repeat(18000)),{textZh:'完整译文',replyTo:{text:'parent body'}}),post('4','old',{publishedAt:'2026-08-01T00:00:00Z'})],scores:{'1':{score:80},'2':{score:20}},ideas:[{id:'idea-oracle',title:'Oracle',evidence:['1']}],trends:[],reports:[],topics:[],activities:[]};
const signal=()=>new AbortController().signal;
test('directory paginates low score materials; full read preserves long bodies and thread continuation',async()=>{
 const t=makeTools(snapshot,{signal:signal(),now:Date.parse(at)});
 const a=await t.call('search_posts',{limit:2});assert.equal(a.total,3);assert.equal(a.nextOffset,2);assert(a.items.some(p=>p.id==='2'));
 const b=await t.call('search_posts',{limit:2,offset:a.nextOffset});assert.equal(b.nextOffset,null);assert.equal(new Set([...a.items,...b.items].map(p=>p.id)).size,3);
 const thread=await t.call('read_posts',{ids:['1'],limit:1});assert.equal(thread.total,2);assert.equal(thread.nextOffset,1);assert.deepEqual(thread.items[0].quoted,snapshot.posts[0].quoted);
 const continuation=await t.call('read_posts',{ids:['1'],offset:1});assert.equal(continuation.items[0].id,'2');
 const long=await t.call('read_posts',{ids:['3']});assert.equal(long.items[0].text,snapshot.posts[2].text);assert.deepEqual(long.items[0].replyTo,snapshot.posts[2].replyTo);
});
test('date filters, repost deduplication and missing bodies are explicit',async()=>{
 const s={...snapshot,posts:[...snapshot.posts,post('5','Oracle financing',{originId:'1'}),post('6','',{contextStatus:'partial'})]};
 const t=makeTools(s,{signal:signal(),now:Date.parse(at)});
 assert.equal((await t.call('search_posts',{q:'oracle'})).total,1);
 assert.equal((await t.call('search_posts',{dateFrom:'2026-08-01',dateTo:'2026-08-02'})).total,1);
 const r=await t.call('read_posts',{ids:['6','missing']});assert.equal(r.items[0].visibility,'partial');assert.deepEqual(r.missing,['missing']);
});
test('runtime retains previous conversation; verifies citations; handles web failure',async()=>{
 const store=openStore(':memory:');const session=store.create().id;store.add(session,'user','Oracle');store.add(session,'assistant','previous judgment');store.add(session,'user','有哪些反证');const id=store.add(session,'assistant','','running');let count=0;const events=[];
 await runTurn({store,session,messageId:id,question:'有哪些反证',signal:signal(),snapshot,sourceUrl:'',emit:(t,d)=>events.push([t,d]),search:async()=>{throw new Error('unavailable');},model:async({messages})=>{
  assert(messages.some(m=>m.content==='previous judgment'));
  if(count++===0)return {message:{role:'assistant',content:'',tool_calls:[{id:'a',type:'function',function:{name:'read_posts',arguments:'{"ids":["1"]}'}},{id:'b',type:'function',function:{name:'web_search',arguments:'{"query":"Oracle IR"}'}}]}};
  assert(messages.some(m=>m.role==='tool'&&m.content.includes('negative evidence')));assert(messages.some(m=>m.role==='tool'&&m.content.includes('unavailable')));
  return {message:{role:'assistant',content:'存在反证 [P-2]，尚未外部核实。无效 [P-999]'}};
 }});
 const answer=store.get(session).messages.at(-1);assert.equal(answer.status,'complete');assert.equal(answer.sources.length,1);assert.equal(answer.sources[0].id,'2');assert.match(answer.text,/引用未核验/);assert.equal(events.at(-1)[0],'done');store.db.close();
});
test('stop prevents further model calls and keeps last success',async()=>{
 const store=openStore(':memory:');const s=store.create().id;store.add(s,'assistant','last success');store.add(s,'user','next');const id=store.add(s,'assistant','','running');const control=new AbortController();let calls=0;
 await runTurn({store,session:s,messageId:id,question:'next',signal:control.signal,snapshot,emit:()=>{},model:async()=>{calls++;control.abort();return {message:{content:'late answer'}};}});
 assert.equal(calls,1);assert.equal(store.get(s).messages.at(-1).status,'stopped');assert.equal(store.get(s).messages[0].text,'last success');store.db.close();
});
test('HTTP session recovery, failed turn and same-origin protection',async()=>{
 const store=openStore(':memory:');const server=createAssistantServer({store,snapshot,model:async()=>{throw new Error('model timeout');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const s=await (await fetch(base+'/api/assistant/sessions',{method:'POST'})).json();
  const r=await fetch(base+`/api/assistant/sessions/${s.id}/messages`,{method:'POST',body:JSON.stringify({message:'test'})});const stream=await r.text();assert.match(stream,/model timeout/);
  const recovered=await(await fetch(base+'/api/assistant/sessions/'+s.id)).json();assert.equal(recovered.messages.at(-1).status,'failed');
  assert.equal((await fetch(base+'/api/assistant/sessions',{method:'POST',headers:{Origin:'https://example.com'}})).status,403);
 }finally{await new Promise(r=>server.close(r));store.db.close();}
});

test('model SSE handles split UTF-8 frames and tool-call reasoning without showing reasoning',async()=>{
 const {createModel}=await import('./model.mjs');const http=await import('node:http');let captured;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;captured=JSON.parse(raw);res.writeHead(200,{'content-type':'text/event-stream'});const body='data: '+JSON.stringify({choices:[{delta:{reasoning_content:'private reasoning'}}]})+'\n\n'+'data: '+JSON.stringify({choices:[{delta:{content:'你好'}}]})+'\n\n'+'data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'tool1',function:{name:'read_posts',arguments:'{"ids":["1"]}'}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n';const bytes=Buffer.from(body);for(let i=0;i<bytes.length;i+=7)res.write(bytes.subarray(i,i+7));res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{let visible='';const model=createModel({TECHBUZZ_LLM_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,TECHBUZZ_LLM_API_KEY:'test',TECHBUZZ_LLM_MODEL:'fake'});const result=await model({messages:[],session:'test',signal:signal(),onText:t=>visible+=t});assert.equal(visible,'你好');assert.equal(result.message.reasoning_content,'private reasoning');assert.equal(result.message.tool_calls[0].function.name,'read_posts');assert.equal(captured.reasoning_effort,'max');assert.equal(captured.max_tokens,32768);}finally{await new Promise(r=>server.close(r));}
});

test('follow-up reloads cited post bodies and dated historical web excerpts instead of trusting answer text',async()=>{
 const store=openStore(':memory:');const s=store.create().id;store.add(s,'user','Oracle');const prev=store.add(s,'assistant','prior [P-1] [W-test]');store.update(prev,'prior [P-1] [W-test]','complete',[{key:'P-1',kind:'post',id:'1'},{key:'W-test',kind:'web',url:'https://example.com/filing',title:'filing',passage:'the original source passage',retrievedAt:'2026-11-20T12:00:00Z'}]);store.add(s,'user','Which part is weakest?');const id=store.add(s,'assistant','','running');
 await runTurn({store,session:s,messageId:id,question:'Which part is weakest?',snapshot,signal:signal(),emit:()=>{},model:async({messages})=>{assert(messages.some(m=>m.content?.includes('Oracle financing')));assert(messages.some(m=>m.content?.includes('the original source passage')&&m.content.includes('revalidatedThisTurn')));return {message:{role:'assistant',content:'重新读取原帖 [P-1]，并参考此前网页片段 [W-test]。'}};}});
 const a=store.get(s).messages.at(-1);assert.equal(a.status,'complete');assert.equal(a.sources.length,2);assert(!a.text.includes('未核验'));assert.equal(a.sources.find(s=>s.kind==='web').cached,true);store.db.close();
});
