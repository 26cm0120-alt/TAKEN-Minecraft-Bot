export async function requestLocalAI(fetchImpl,body,signal,{timeoutMs=60000}={}){
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const timer=setTimeout(()=>controller.abort(new Error('ローカルAIの生成が60秒を超えました。指示を短くして試してください。')),timeoutMs);
 const at=Date.now();
 try{
  combined.throwIfAborted();
  const gamePriority=process.env.AI_GAME_PRIORITY!=='0';
  const response=await fetchImpl('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:combined,body:JSON.stringify({...body,think:false,keep_alive:gamePriority?0:'5m',options:{...body.options,...(gamePriority?{num_thread:4,num_ctx:4096}:{})}})});
  combined.throwIfAborted();if(!response.ok)throw Error(`ローカルAIの応答エラー (${response.status})`);
  const result=await response.json();combined.throwIfAborted();
  console.log('[AI応答時間]',JSON.stringify({milliseconds:Date.now()-at,loadMilliseconds:Number(result.load_duration||0)/1e6,promptMilliseconds:Number(result.prompt_eval_duration||0)/1e6,generationMilliseconds:Number(result.eval_duration||0)/1e6,tokens:result.eval_count}));
  return result;
 }catch(e){if(controller.signal.aborted&&!signal?.aborted)throw controller.signal.reason;throw e;}finally{clearTimeout(timer);}
}
