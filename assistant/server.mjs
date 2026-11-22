import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { runTurn } from './runtime.mjs';
export function createAssistantServer({store,sourceUrl,model,snapshot,search}={}) {
  store??=openStore(process.env.TECHBUZZ_ASSISTANT_DB||'/data/assistant.sqlite');
  sourceUrl??=process.env.TECHBUZZ_RESEARCH_URL||'http://techbuzz-research-1:3000';
  const active=new Map();
  const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
  async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>64000)throw new Error('消息过长');}return JSON.parse(text||'{}');}
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://local');const path=url.pathname;
      // Chat spends model quota: reject cross-site browser POSTs; only a loopback-bound preview is published.
      if(req.method!=='GET' && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'请从本站发送消息'});
      if(path==='/api/assistant/health')return json(res,200,{ok:true,name:'TechBuzz 研究助手',active:active.size});
      if(path==='/api/assistant/sessions'&&req.method==='GET')return json(res,200,store.list());
      if(path==='/api/assistant/sessions'&&req.method==='POST')return json(res,201,store.create());
      const match=/^\/api\/assistant\/sessions\/([a-f0-9-]+)(?:\/(messages|stop))?$/.exec(path);
      if(!match)return json(res,404,{error:'未找到接口'});
      const [,id,action]=match;const session=store.get(id);if(!session)return json(res,404,{error:'会话不存在'});
      if(!action&&req.method==='GET')return json(res,200,{...session,running:active.has(id)});
      if(action==='stop'&&req.method==='POST'){active.get(id)?.abort();return json(res,200,{stopped:true});}
      if(action!=='messages'||req.method!=='POST')return json(res,405,{error:'方法不支持'});
      if(active.has(id)||active.size>=2)return json(res,409,{error:'已有研究正在进行，请稍后或停止当前生成'});
      const input=await body(req);const question=input.message?.trim();
      if(typeof question!=='string'||!question||question.length>12000)return json(res,400,{error:'请输入1—12000字的问题'});
      const context=input.context;
      if(context&&(!['post','ideas','trends','reports'].includes(context.type)||typeof context.id!=='string'||!/^[a-zA-Z0-9_-]{1,180}$/.test(context.id)))return json(res,400,{error:'材料引用无效'});
      store.add(id,'user',question);const messageId=store.add(id,'assistant','','running');const abort=new AbortController();active.set(id,abort);
      res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no','connection':'keep-alive'});
      const emit=(type,data)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
      emit('start',{messageId});const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},15000);
      res.on('close',()=>abort.abort());
      try {await runTurn({store,session:id,messageId,question,context,signal:abort.signal,emit,sourceUrl,model,snapshot,search});}
      finally {clearInterval(heartbeat);active.delete(id);res.end();}
    }catch(e){if(!res.headersSent)json(res,400,{error:e.message});else res.end();}
  });
  return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))createAssistantServer().listen(Number(process.env.PORT||3002),'0.0.0.0');
