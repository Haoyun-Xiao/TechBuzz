import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import './assistant.css';
type Source={key:string;kind:string;title:string;href?:string;url?:string;date?:string;cached?:boolean;retrievedAt?:string};
type Message={id:string;role:string;text:string;status:string;sources:Source[]};
type Session={id:string;title:string;messages:Message[];running?:boolean};
async function api(path:string,init?:RequestInit){const r=await fetch('/api/assistant'+path,init);const value=await r.json();if(!r.ok)throw new Error(value.error??'连接失败');return value;}
function Inline({text,sources}:{text:string;sources:Source[]}){
  const parts=text.split(/(\[(?:P|R|W)-[^\]\s]+\]|\*\*[^*]+\*\*)/g);
  return <>{parts.map((p,i)=>{const source=sources.find(s=>'['+s.key+']'===p);if(source){const url=source.href||source.url;return <a key={i} className="assistant-cite" href={url} target="_blank" rel="noopener noreferrer" title={source.title}>{source.kind==='web'?'外部':'来源'} {sources.indexOf(source)+1}</a>;}if(p.startsWith('**')&&p.endsWith('**'))return <strong key={i}>{p.slice(2,-2)}</strong>;return p;})}</>;
}
function Answer({text,sources}:{text:string;sources:Source[]}){
  return <div className="assistant-answer">{text.split('\n').map((line,i)=>{let node:ReactNode=<Inline text={line.replace(/^#{1,6}\s+/,'')} sources={sources}/>;return /^#{1,6}\s/.test(line)?<h3 key={i}>{node}</h3>:<p key={i}>{node||'\u00a0'}</p>;})}</div>;
}
export function Assistant(){
  const [params,setParams]=useSearchParams();const [sessions,setSessions]=useState<Session[]>([]);const [current,setCurrent]=useState<Session|null>(null);
  const [input,setInput]=useState('');const [busy,setBusy]=useState(false);const [stage,setStage]=useState('');const [draft,setDraft]=useState('');const [error,setError]=useState('');
  const abort=useRef<AbortController|null>(null);const end=useRef<HTMLDivElement>(null);const id=params.get('session');
  const context=params.get('type')&&params.get('id')?{type:params.get('type')!,id:params.get('id')!}:undefined;
  const refreshList=()=>api('/sessions').then(setSessions).catch(e=>setError(e.message));
  useEffect(()=>{void refreshList();return ()=>abort.current?.abort();},[]);
  useEffect(()=>{if(!id){setCurrent(null);return;}let keep=true;api('/sessions/'+id).then(s=>{if(keep)setCurrent(s);}).catch(e=>setError(e.message));return ()=>{keep=false;};},[id]);
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[stage,busy]);
  useEffect(()=>{if(!current?.running||busy)return;const sessionId=current.id;const timer=setInterval(()=>{api('/sessions/'+sessionId).then(setCurrent).catch(()=>{});},2000);return ()=>clearInterval(timer);},[current?.id,current?.running,busy]);
  async function send(question=input){
    if(!question.trim()||busy||current?.running)return;setBusy(true);setError('');setDraft('');setStage('连接研究助手');setInput('');
    let session=current;const controller=new AbortController();abort.current=controller;
    try{
      if(!session){session=await api('/sessions',{method:'POST'});setCurrent(session);const next=new URLSearchParams(params);next.set('session',session!.id);setParams(next,{replace:true});}
      const sessionId=session!.id;
      setCurrent(s=>s?{...s,messages:[...s.messages,{id:'pending',role:'user',text:question,status:'complete',sources:[]}]}:s);
      const response=await fetch(`/api/assistant/sessions/${sessionId}/messages`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({message:question,...(context?{context}:{})})});
      if(!response.ok){const e=await response.json();throw new Error(e.error||'请求失败');}
      const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
      while(true){const result=await reader.read();if(result.done)break;buffer+=decoder.decode(result.value,{stream:true});let at;while((at=buffer.indexOf('\n\n'))!==-1){const event=buffer.slice(0,at);buffer=buffer.slice(at+2);const kind=/^event: (.+)$/m.exec(event)?.[1];const raw=/^data: (.+)$/m.exec(event)?.[1];if(!raw)continue;const data=JSON.parse(raw);
        if(kind==='status')setStage(data.stage);
        if(kind==='tool')setStage(`${data.stage}：${data.count} 条${data.total?` / 匹配 ${data.total} 条`:''}${data.nextOffset!=null?'，还有未读材料':''}`);
        if(kind==='draft'){setDraft(data.text);if(data.text)setStage('正在撰写回答');}
        if(kind==='failure')setError(data.message);
        if(kind==='answer')setDraft(data.text);
      }}
      setCurrent(await api('/sessions/'+sessionId));
    }catch(e){if(!controller.signal.aborted)setError((e as Error).message);else setError('已停止生成');if(session)try{setCurrent(await api('/sessions/'+session.id));}catch{}}
    finally{abort.current=null;setBusy(false);setDraft('');setStage('');void refreshList();}
  }
  async function stop(){abort.current?.abort();if(current){await api('/sessions/'+current.id+'/stop',{method:'POST'}).catch(()=>{});setTimeout(()=>{api('/sessions/'+current.id).then(setCurrent).catch(()=>{});},300);}}
  const examples=['过去 30 天有哪些值得研究的科技股方向？请先扫描材料，再挑选三个方向深入读取。','Oracle 融资的担忧发生了什么变化？哪些已经核实？','CPO 光源有哪些潜在投资方向？区分技术验证与商业兑现。'];
  return <section className="assistant-page"><header><span className="assistant-eyebrow">TECHBUZZ · RESEARCH</span><h1>研究助手</h1><p>从原帖找到线索，沿证据深入研究。</p></header>
    <div className="assistant-layout"><aside className="assistant-history"><button disabled={busy} className="assistant-new" onClick={()=>{setParams({});setCurrent(null);setError('');setDraft('');}}>＋ 新研究</button><p>最近会话</p>{sessions.map(s=><button disabled={busy} className={s.id===id?'active':''} key={s.id} onClick={()=>{setParams({session:s.id});setError('');}}>{s.title}</button>)}</aside>
    <div className="assistant-conversation">
      {context&&<div className="assistant-context">已关联当前材料 · 助手将从原文开始读取</div>}
      {!current?.messages.length&&!busy&&<div className="assistant-empty"><h2>你想验证哪个投资判断？</h2><p>覆盖原帖、串帖、Idea、趋势与日报。需要时联网核验，回答附可回查来源。</p>{examples.map(q=><button key={q} onClick={()=>void send(q)}>{q} ↗</button>)}</div>}
      {current?.messages.map((m,index)=><article key={m.id} className={'assistant-message '+m.role}><div className="assistant-role">{m.role==='user'?'你':'研究助手'}{m.status!=='complete'&&<span> · {m.status==='running'?'进行中':m.status==='stopped'?'已停止':'未完成'}</span>}</div><Answer text={m.text} sources={m.sources}/>{m.role==='assistant' && ['failed','stopped','interrupted'].includes(m.status) && <button className="text-accent" disabled={busy||current.running} onClick={()=>{const q=current.messages.slice(0,index).filter(v=>v.role==='user').at(-1)?.text;if(q)void send(q);}}>重试这一问</button>}{m.sources.length>0&&<details><summary>{m.sources.length} 项引用依据</summary>{m.sources.map(s=><div key={s.key} className="assistant-source"><a href={s.href||s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>{s.href&&s.url&&<a href={s.url} target="_blank" rel="noopener noreferrer">原帖 ↗</a>}<small>{s.kind==='web'?(s.cached?'此前检索片段':'本轮外部检索片段'):'站内材料'} · {s.date||'发布日期未提供'}{s.kind==='web'&&s.retrievedAt&&<> · 读取 {s.retrievedAt}</>}</small></div>)}</details>}</article>)}
      {busy&&<article className="assistant-message"><div role="status" aria-live="polite" className="assistant-progress">{stage}</div>{draft&&<Answer text={draft} sources={[]}/>}</article>}
      {error&&<div role="alert" className="assistant-error">{error} {!busy&&<button onClick={()=>{const q=current?.messages.filter(m=>m.role==='user').at(-1)?.text;if(q)void send(q);}}>重试上一问</button>}</div>}
      {!busy&&current?.running&&<div className="assistant-error">上一轮仍在处理。<button onClick={()=>void stop()}>停止上一轮</button></div>}
      <div ref={end}/><form className="assistant-composer" onSubmit={e=>{e.preventDefault();void send();}}><label htmlFor="research-question">继续追问或提出新的研究问题</label><textarea id="research-question" value={input} maxLength={12000} onChange={e=>setInput(e.target.value)} placeholder="例如：这个判断最薄弱的依据是什么？有哪些反证？" onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();void send();}}}/><div><small>先查站内 · 按需联网 · 原文可追溯</small>{busy?<button type="button" onClick={()=>void stop()}>停止生成</button>:<button type="submit" disabled={!input.trim()||current?.running}>发送 ↑</button>}</div></form>
    </div></div></section>;
}
