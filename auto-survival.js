export const LOW_HEALTH_FOOD=12;
export const defenseTargets=new Set(['zombie','husk','drowned','skeleton','stray','bogged','wither_skeleton','spider','cave_spider','slime','magma_cube','silverfish','endermite','phantom','pillager','vindicator','witch']);
export class AutoSurvival {
 constructor(client,controls,{manualBusy=()=>false,interruptManual=()=>{},now=Date.now}={}){
  this.client=client;this.controls=controls;this.manualBusy=manualBusy;this.interruptManual=interruptManual;this.now=now;
  this.resumeGeneration=0;this.nextRetreatAttempt=0;this.retreatEnabled=true;this.safePoint=null;this.foodEnabled=true;this.defenseEnabled=true;this.paused=false;this.closed=false;this.job=null;this.controller=null;this.lastDamage=-Infinity;this.nextAttempt=0;this.lastNotice=-Infinity;this.errorNotices=new Map();this.mode='待機';
  client.on('spawn',()=>{clearInterval(this.timer);this.timer=setInterval(()=>{this.tick().catch(e=>console.error('自動行動:',e.message));},1000);this.timer.unref();});
  client.on('taken_damage',()=>{this.lastDamage=this.now();if(this.mode==='食事' && controls.health>LOW_HEALTH_FOOD && this.defenseEnabled && controls.nearbyEntities(3.1).some(e=>defenseTargets.has(e.name)))this.controller?.abort();this.tick().catch(e=>console.error('自動行動:',e.message));});
  client.on('change_dimension',()=>{this.controller?.abort();this.safePoint=null;});client.on('taken_death',()=>{this.controller?.abort();});client.on('taken_respawning',()=>{this.controller?.abort();});
  client.on('close',()=>{this.closed=true;clearInterval(this.timer);this.controller?.abort();});
 }
 status(){return {paused:this.paused,foodEnabled:this.foodEnabled,defenseEnabled:this.defenseEnabled,mode:this.mode,retreatEnabled:this.retreatEnabled,safePoint:this.safePoint};}
 notify(message){if(!this.closed && this.controls.ready && this.now()-this.lastNotice>=10000){this.lastNotice=this.now();this.client.emit('taken_notice',{message});}}
 async cancel(){this.controller?.abort();if(this.job)await this.job;}
 pause(){this.paused=true;this.controller?.abort();}
 resume(){this.resumeGeneration++;this.paused=false;this.nextAttempt=0;this.nextRetreatAttempt=0;}
 setSafePoint(){if(this.job||this.manualBusy())throw Error('作業を停止してから安全地点を登録してください。');const c=this.controls;c.check();const p=c.feet();if(!c.walkable(p.x,p.y,p.z)||c.nearbyEntities(8).some(e=>defenseTargets.has(e.name)||e.name==='creeper'))throw Error('安全な足場・周囲8ブロックに敵がいない場所で登録してください。');this.safePoint={...p,dimension:c.dimension};return this.safePoint;}
 async retreat(signal){const c=this.controls,p=this.safePoint;if(!p)throw Error('安全地点が未登録です。');if(p.dimension!==c.dimension)throw Error('安全地点とディメンションが異なります。');const f=c.feet();if(Math.hypot(f.x-p.x,f.y-p.y,f.z-p.z)>24)throw Error('安全地点は24ブロック以内が必要です。');if(!c.walkable(p.x,p.y,p.z))throw Error('安全地点の足場が未確認です。');if(c.nearbyEntities(32).some(e=>(defenseTargets.has(e.name)||e.name==='creeper')&&Math.hypot(e.position.x-p.x,e.position.y-p.y,e.position.z-p.z)<6))throw Error('安全地点の近くに敵がいます。');c.emergencySignals??=new WeakSet();c.emergencySignals.add(signal);try{return await c.goto(p,signal,.6);}finally{c.emergencySignals.delete(signal);}}
 async tick(){
  const c=this.controls,at=this.now();if(this.closed||this.paused||this.job||c.boat?.mounted||c.boat?.pending||c.sleeping||!c.ready||c.respawning||!Number.isFinite(c.health)||c.health<=0||!c.position||at<this.nextAttempt)return;
  const danger=this.defenseEnabled && at-this.lastDamage<4000?c.nearbyEntities(3.1).find(e=>defenseTargets.has(e.name)):null;
  const threats=this.retreatEnabled&&this.safePoint?c.nearbyEntities(6).filter(e=>defenseTargets.has(e.name)||e.name==='creeper'):[];
  const wantsRetreat=at>=this.nextRetreatAttempt&&this.retreatEnabled&&this.safePoint&&(c.health<=8||threats.some(e=>e.name==='creeper')||(threats.length&&at-this.lastDamage<4000))&&Math.hypot(c.feet().x-this.safePoint.x,c.feet().y-this.safePoint.y,c.feet().z-this.safePoint.z)>1;
  const foodSignature=JSON.stringify((c.items||[]).slice(0,36).map(i=>[i?.network_id,i?.count]));
  if(this.failedFoodSignature!==undefined&&this.failedFoodSignature!==foodSignature)this.failedFoodSignature=undefined;
  const wantsFood=this.failedFoodSignature!==foodSignature && this.foodEnabled && Number.isFinite(c.food) && c.food<20 && (c.food<=16||c.health<=LOW_HEALTH_FOOD);
  if(this.manualBusy()){
   if(wantsRetreat || (danger && c.health>8) || (wantsFood && (c.food<=6||c.health<=LOW_HEALTH_FOOD))){this.interruptManual();this.notify('緊急の自動行動のため、現在の作業を中止しました。終了後はもう一度指示してください。');}
   return;
  }
  const action=wantsRetreat?'退避':wantsFood&&c.health<=LOW_HEALTH_FOOD?'食事':danger && c.health>8?'防衛':wantsFood?'食事':null;if(!action)return;
  const controller=new AbortController();this.controller=controller;this.mode=action;const slot=c.slot,resumeGeneration=this.resumeGeneration;
  const timer=setTimeout(()=>controller.abort(),action==='退避'?30000:action==='食事'?30000:5000);timer.unref();
  this.job=(async()=>{
   try{
    if(action==='退避'){await this.retreat(controller.signal);this.notify('登録した安全地点への帰還を確認しました。前の作業は自動再開しません。');}
    else if(action==='防衛'){await c.defend(String(danger.runtimeId),controller.signal);this.notify('近くの敵に防衛攻撃しました。討伐は未確認です。');}
    else {const result=await c.eat(controller.signal);if(result.eaten)this.notify('自動食事: '+result.eaten+'個。満腹度: '+result.food+'。');}
   }catch(e){if(!controller.signal.aborted){if(action==='食事'&&/食料がありません/.test(e.message))this.failedFoodSignature=foodSignature;const message='自動'+action+'を停止: '+e.message;const last=this.errorNotices.get(message)??-Infinity;if(this.now()-last>=120000){this.errorNotices.set(message,this.now());this.notify(message);}}}
   finally{clearTimeout(timer);if(resumeGeneration===this.resumeGeneration&&action==='退避')this.nextRetreatAttempt=this.now()+30000;c.stop();if(!this.closed && c.ready && !c.respawning && c.health>0 && c.slot!==slot)c.select(slot);if(resumeGeneration===this.resumeGeneration)this.nextAttempt=this.now()+(controller.signal.aborted?0:action==='退避'?1000:action==='食事'?10000:650);}
  })();
  try{await this.job;}finally{this.job=null;this.controller=null;this.mode='待機';}
 }
}

