import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
const {Vec3}=createRequire(import.meta.url)('vec3');
const copy=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)?{x:p.x,y:p.y,z:p.z}:null;
const horizontal=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

// 送信済みの位置だけを保存。制御側のオブジェクトを保持しない。
export class PredictionHistory {
  constructor(capacity=40){this.capacity=capacity;this.buffer=new Array(capacity);this.cursor=0;this.size=0;}
  clear(){this.buffer.fill(undefined);this.cursor=0;this.size=0;}
  push(sample){this.buffer[this.cursor]={...sample,position:copy(sample.position)};this.cursor=(this.cursor+1)%this.capacity;this.size=Math.min(this.size+1,this.capacity);}
  entries(){return Array.from({length:this.size},(_,i)=>this.buffer[(this.cursor-this.size+i+this.capacity)%this.capacity]);}
  findTick(tick){if(tick===undefined||tick===null)return null;return this.entries().findLast(p=>p.authInputTick===String(tick))??null;}
}

// 最小距離を与えるラグは推定値。停止中・同距離の場合は一意に決まらない。
export function compareLag(history,position,t,{epoch=0,staleMs=200}={}){
  const entries=history.entries().filter(p=>p.epoch===epoch),latest=entries.at(-1);
  if(!latest||!copy(position))return {driftNow:null,bestLagTicks:null,driftAtBestLag:null,historyAgeMs:null,historyStale:true,candidateCount:0,ambiguous:false};
  let best=null,ties=0,candidates=0;
  for(let k=0;k<=10;k++){
    const p=entries.findLast(s=>s.localTick===latest.localTick-k);
    if(!p)continue;
    candidates++;const drift=horizontal(p.position,position);
    if(!best||drift<best.drift-1e-9){best={lag:k,drift};ties=1;}
    else if(Math.abs(drift-best.drift)<1e-9)ties++;
  }
  return {driftNow:horizontal(latest.position,position),bestLagTicks:best.lag,driftAtBestLag:best.drift,
    historyAgeMs:t-latest.t,historyStale:t-latest.t>staleMs,candidateCount:candidates,ambiguous:ties>1};
}

// block() の runtimeIds 初期化や地形要求を起こさず、既存キャッシュのみ参照する。
export function terrainSnapshot(c,position){
  if(!copy(position))return null;
  const read=(offset)=>{
    const p={x:Math.floor(position.x),y:Math.floor(position.y-1.62+offset),z:Math.floor(position.z)};
    try{
      const id=c.updates.get(`${p.x},${p.y},${p.z}`);
      let b;
      if(id!==undefined)b=c.registry.blocksByRuntimeId[id]||c.registry.blocksByRuntimeId[id|0];
      else{
        const cx=Math.floor(p.x/16),cy=Math.floor(p.y/16),cz=Math.floor(p.z/16);
        if(!c.loaded.has(`${cx},${cy},${cz}`))return {position:p,name:null,stateId:null,unknown:true};
        const chunk=c.chunks.get(`${cx},${cz}`);
        if(chunk){const block=chunk.getBlock(new Vec3(p.x&15,p.y,p.z&15));b=c.registry.blockStates[block.stateId]??block; b={name:b.name,stateId:block.stateId};}
      }
      return {position:p,name:b?.name??null,stateId:b?.stateId??null,unknown:!b};
    }catch{return {position:p,name:null,stateId:null,unknown:true,readError:true};}
  };
  return {feet:read(-0.05),body:read(0.9),head:read(1.78)};
}

export class MovementTelemetry {
  constructor({enabled=process.env.TAKEN_TELEMETRY!=='0',now=()=>performance.now(),log=console.log}={}){
    this.enabled=enabled;this.now=now;this.log=log;this.history=new PredictionHistory();
    this.localTick=0;this.epoch=0;this.suppressUntil=0;this.lastPost=null;this.latestAuthority=null;
    this.lastFlags=[];this.correctionTimes=[];this.lastPostLogTick=-Infinity;this.active=null;this.nextId=0;
    this.counters={unknownBlockIdExceptions:0,subchunkDecodeFailures:0,updateSubchunkBlocks:0};
  }
  // 計測や出力の失敗をゲーム処理へ伝播させない。
  safely(fn){if(!this.enabled)return;try{return fn();}catch{return undefined;}}
  emit(event,data){try{this.log('[移動計測]',JSON.stringify({event,...data}));}catch{/* ログ障害で計測スコープもゲーム処理も止めない。 */}}
  age(t){return {ageMs:this.lastPost===null?null:t-this.lastPost,stale:this.lastPost===null||t-this.lastPost>200};}
  suppressed(){return this.localTick<this.suppressUntil;}
  input(packet,{packetType='player_auth_input',walking=false,target=null,sprinting=false,terrain}={}){
    return this.safely(()=>{
      const t=this.now();this.localTick++;
      this.history.push({localTick:this.localTick,authInputTick:packetType==='player_auth_input'?String(packet.tick):null,t,position:packet.position,epoch:this.epoch});
      this.lastFlags=[...(packet.input_data??[])];
      if(this.active){this.active.inputs++;if(this.lastFlags.includes('up'))this.active.steps++;}
      if(walking&&this.localTick%5===0)this.emit('sample',{t,localTick:this.localTick,authInputTick:packetType==='player_auth_input'?String(packet.tick):null,
        packetType,position:copy(packet.position),target:copy(target),sprinting,flags:this.lastFlags,
        ...this.age(t),suppressed:this.suppressed(),authority:this.latestAuthority,terrain:terrain?.(),terrainCounters:{...this.counters}});
    });
  }
  authority(source,position,{tick,internalPosition,delta,teleport=false,state,walking=false,terrain}={}){
    return this.safely(()=>{
      const t=this.now(),p=copy(position),before=copy(internalPosition),reset=['start_game','respawn','change_dimension'].includes(source);
      const correction=source==='correct_player_move_prediction';
      const matched=correction?this.history.findTick(tick):null;
      if(reset){this.history.clear();this.lastPost=null;this.epoch++;}
      if(reset||correction||teleport)this.suppressUntil=this.localTick+20;
      const age=this.age(t);
      this.latestAuthority={t,source,position:p,authInputTick:tick===undefined?null:String(tick)};
      const event={...this.latestAuthority,localTick:this.localTick,internalPosition:before,...age,suppressed:this.suppressed()};
      if(source==='server_post_move'){
        const lag=compareLag(this.history,p,t,{epoch:this.epoch});
        this.lastPost=t;Object.assign(event,lag,{previousPostAgeMs:age.ageMs,ageMs:0,stale:false});
        this.latestPostComparison={...event};
        if(this.active){
          this.active.postMoves++;
          if(!event.suppressed&&!lag.historyStale&&lag.driftAtBestLag!==null){
            this.active.samples++;this.active.driftSum+=lag.driftAtBestLag;this.active.driftMax=Math.max(this.active.driftMax,lag.driftAtBestLag);
            this.active.lags[lag.bestLagTicks]++;if(lag.ambiguous)this.active.ambiguousSamples++;
          }else this.active.excludedSamples++;
        }
        // 全受信を集計し、ログだけ5tickに1回に抑制する。
        if(!walking||this.localTick-this.lastPostLogTick<5)return;
        this.lastPostLogTick=this.localTick;
      }
      if(correction){
        this.correctionTimes=this.correctionTimes.filter(at=>t-at<=5000);this.correctionTimes.push(t);this.correctionTimes=this.correctionTimes.slice(-256);
        if(this.active)this.active.corrections++;
        Object.assign(event,{matched:!!matched,predictionAtTick:matched?.position??null,predictionAgeMs:matched?t-matched.t:null,
          horizontalError:matched&&p?horizontal(matched.position,p):null,verticalError:matched&&p?p.y-matched.position.y:null,
          delta:copy(delta),flags:[...this.lastFlags],recentCorrections:this.correctionTimes.length,terrain:terrain?.(),terrainCounters:{...this.counters}});
        // 補正以前の軌跡を次のpost_moveのラグ探索へ混ぜない。tick照合用の履歴は残す。
        this.epoch++;
      }
      if(state!==undefined)event.state=state;
      if(source==='move_player')event.teleport=teleport;
      this.emit('authority',event);
    });
  }
  terrainError(error){return this.safely(()=>{
    this.counters.subchunkDecodeFailures++;
    if(/未知のブロックID|unknown.*(?:block|runtime).*id/i.test(error.message)||(/stateId/.test(error.message)&&/loadRuntimePalette/.test(error.stack??'')))this.counters.unknownBlockIdExceptions++;
    this.emit('terrain_error',{t:this.now(),...this.counters});
  });}
  beginMove(target){return this.safely(()=>{
    if(this.active)return null;
    const id=++this.nextId;this.active={id,t:this.now(),target:copy(target),inputs:0,steps:0,corrections:0,postMoves:0,samples:0,excludedSamples:0,ambiguousSamples:0,driftSum:0,driftMax:0,lags:Array(11).fill(0)};
    this.emit('move_start',{id,t:this.active.t,target:this.active.target});return id;
  });}
  endMove(id,outcome){return this.safely(()=>{
    if(id==null||this.active?.id!==id)return;
    const a=this.active;this.active=null;
    const medianIndex=(a.samples-1)/2;let count=0,lo=null,hi=null;
    for(let k=0;k<a.lags.length;k++){count+=a.lags[k];if(lo===null&&count>Math.floor(medianIndex))lo=k;if(hi===null&&count>Math.ceil(medianIndex))hi=k;}
    this.emit('move_summary',{id,t:this.now(),elapsedMs:this.now()-a.t,target:a.target,outcome,inputs:a.inputs,steps:a.steps,corrections:a.corrections,
      postMoves:a.postMoves,samples:a.samples,excludedSamples:a.excludedSamples,ambiguousSamples:a.ambiguousSamples,
      driftAtBestLagMean:a.samples?a.driftSum/a.samples:null,driftAtBestLagMax:a.samples?a.driftMax:null,bestLagTicksMedian:a.samples?(lo+hi)/2:null,
      ...this.age(this.now()),terrainCounters:{...this.counters}});
  });}
}

export function attachMovementTelemetry(c,options){
  const m=new MovementTelemetry(options);
  if(!m.enabled)return m;
  const observe=(source,p,position,extra={})=>m.authority(source,position,{tick:p.tick,internalPosition:c.position,walking:!!c.walkTarget,
    delta:p.delta,terrain:()=>({before:terrainSnapshot(c,c.position),corrected:terrainSnapshot(c,position)}),...extra});
  // 既存ハンドラの座標上書きより前に、読み取りのみ行う。
  c.client.prependListener('start_game',p=>{
    observe('start_game',p,p.player_position);
    m.safely(()=>m.log('[移動方式]',JSON.stringify({authority:c.movementAuthority,source:'start_game',authorityPacketReceived:c.movementAuthority!==null})));
  });
  c.client.prependListener('server_post_move',p=>{if(p?.position)observe('server_post_move',p,p.position);});
  c.client.prependListener('correct_player_move_prediction',p=>{if(p.prediction_type==='player')observe('correct_player_move_prediction',p,p.position);});
  c.client.prependListener('move_player',p=>{if(String(p.runtime_id)===String(c.entityId))observe('move_player',p,p.position,{teleport:p.mode==='teleport'});});
  c.client.prependListener('respawn',p=>{if(p.runtime_entity_id===undefined||String(p.runtime_entity_id)==='0'||String(p.runtime_entity_id)===String(c.entityId))observe('respawn',p,p.position,{state:p.state});});
  c.client.prependListener('change_dimension',p=>observe('change_dimension',p,p.position));
  c.client.on('update_subchunk_blocks',()=>m.safely(()=>{m.counters.updateSubchunkBlocks++;}));
  c.client.on('close',()=>m.safely(()=>m.emit('session_end',{t:m.now(),terrainCounters:{...m.counters}})));
  return m;
}
