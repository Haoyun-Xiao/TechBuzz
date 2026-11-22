export function createModel(env=process.env) {
  const base=env.TECHBUZZ_LLM_BASE_URL,key=env.TECHBUZZ_LLM_API_KEY,model=env.TECHBUZZ_LLM_MODEL;
  return async ({messages,tools,session,signal,onText=()=>{}}) => {
    if(!base||!key||!model)throw new Error('研究助手缺少模型配置');
    const endpoint=base.replace(/\/+$/,'').replace(/(?:\/chat\/completions)?$/,'/chat/completions');
    const headers={'Content-Type':'application/json',Authorization:`Bearer ${key}`};
    if(new URL(endpoint).hostname==='opencode.ai')headers['x-opencode-session']='ses_techbuzz-assistant-'+session;
    const response=await fetch(endpoint,{method:'POST',headers,signal:AbortSignal.any([signal,AbortSignal.timeout(240000)]),body:JSON.stringify({model,stream:true,max_tokens:32768,reasoning_effort:env.TECHBUZZ_LLM_REASONING_EFFORT||'max',messages,...(tools?.length?{tools,tool_choice:'auto'}:{})})});
    if(!response.ok){await response.body?.cancel();throw new Error(`模型连接失败 (${response.status})`);}
    let content='',reasoning='',buffer='',finish=null,usage=null,actualModel=model;
    const calls=[];const decoder=new TextDecoder();
    function consume(line){
      if(!line.startsWith('data:'))return; const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;
      const data=JSON.parse(raw);if(data.error)throw new Error('模型返回错误');
      usage=data.usage??usage;actualModel=data.model??actualModel;
      const choice=data.choices?.[0];if(!choice)return;finish=choice.finish_reason??finish;
      const delta=choice.delta??{};
      if(delta.content){content+=delta.content;onText(delta.content);}
      if(delta.reasoning_content)reasoning+=delta.reasoning_content;
      for(const part of delta.tool_calls??[]){const i=part.index??0;calls[i]??={id:'',type:'function',function:{name:'',arguments:''}};if(part.id)calls[i].id=part.id;if(part.function?.name)calls[i].function.name+=part.function.name;if(part.function?.arguments)calls[i].function.arguments+=part.function.arguments;}
    }
    for await(const chunk of response.body){signal.throwIfAborted();buffer+=decoder.decode(chunk,{stream:true});let at;while((at=buffer.indexOf('\n'))!==-1){consume(buffer.slice(0,at).trimEnd());buffer=buffer.slice(at+1);}}
    buffer+=decoder.decode();if(buffer.trim())consume(buffer.trimEnd());
    if(finish==='length')throw new Error('模型输出达到长度限制，请缩小问题范围后重试');
    if(!finish)throw new Error('模型连接中断，回答未完成');
    return {message:{role:'assistant',content,...(calls.length?{tool_calls:calls.filter(Boolean)}:{}),...(reasoning?{reasoning_content:reasoning}:{})},usage,model:actualModel};
  };
}
