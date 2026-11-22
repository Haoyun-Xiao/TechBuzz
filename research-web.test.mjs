import assert from 'node:assert/strict';
import test from 'node:test';
import { readCompletion } from './research.mjs';
import { researchWebChat, searchWeb } from './research-web.mjs';

test('research sends tool replies to DeepSeek and keeps only sources read by this entry', async () => {
  const page = {url:'https://example.com/earnings',title:'Results',date:'2026-01-01',passage:'Revenue was 20.'};
  const partials = [
    {delta:{reasoning_content:'intermediate',tool_calls:[{index:0,id:'call-1',function:{name:'web_search',arguments:'{"que'}}]}},
    {delta:{tool_calls:[{index:0,function:{arguments:'ry":"earnings"}'}}]},finish_reason:'tool_calls'},
  ];
  const body = partials.map(choice=>'data: '+JSON.stringify({choices:[choice]})+'\n\n').join('');
  const first = await readCompletion(new Response(body,{headers:{'content-type':'text/event-stream'}}),true);
  let rounds=0;
  const result=await researchWebChat({kind:'ideas',system:'test',input:{},through:Date.parse('2026-02-01'),
    search:async q=>{assert.equal(q,'earnings');return [page];},
    request:async (messages,options)=>{
      if (++rounds===1) {assert.equal(options.tools[0].function.name,'web_search');return first;}
      const answer=messages.find(m=>m.role==='tool');
      assert.equal(answer.tool_call_id,'call-1');
      assert.equal(messages.find(m=>m.role==='assistant').reasoning_content,'intermediate');
      assert.equal(JSON.parse(answer.content).pages[0].passage,page.passage);
      return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({entries:[{webSources:[page.url,'https://fabricated.com']},{}]})}}]};
    }});
  assert.equal(rounds,2);
  assert.deepEqual(JSON.parse(result.choices[0].message.content).entries,[{webSources:[{url:page.url,title:page.title,date:page.date}]},{}]);
});

test('only dated passages that were public by the research cutoff leave the search tool', async t=>{
  const pages=['2026-01-01','2026-03-01','N/A'].map((date,i)=>'Title: Disclosure\nURL: https://example.com/'+i+'\nPublished: '+date+'\nHighlights:\nReport excerpt.');
  t.mock.method(globalThis,'fetch',async()=>Response.json({result:{content:pages.map(text=>({type:'text',text}))}}));
  assert.deepEqual((await searchWeb('query',Date.parse('2026-02-01'))).map(p=>p.url),['https://example.com/0']);
});
