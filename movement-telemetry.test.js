import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {PredictionHistory,compareLag,MovementTelemetry,terrainSnapshot} from './movement-telemetry.js';
import {RealmControls} from './realm-controls.js';
const Stream=createRequire(import.meta.url)('prismarine-chunk/src/bedrock/common/Stream');
const point=x=>({x,y:65.62,z:0.5});
function telemetry(options={}){
  let time=0;const events=[];
  const m=new MovementTelemetry({now:()=>time,log:(tag,text)=>{assert.equal(tag,'[移動計測]');events.push(JSON.parse(text));},...options});
  const input=(x,tick,walking=true)=>m.input({position:point(x),tick:BigInt(tick),input_data:walking?['up']:[]},{walking});
  return {m,events,input,setTime:t=>time=t};
}
function fixture(enabled,log=()=>{}){
  let t=0;const client=new EventEmitter(),sent=[];
  client.queue=(name,p)=>sent.push({name,params:structuredClone(p)});
  const c=new RealmControls(client,'1.26.60',{now:()=>t,telemetry:{enabled,now:()=>t,log}});
  c.entityId=42n;c.ready=true;c.health=20;c.food=20;c.position=point(.5);
  c.block=p=>Math.floor(p.y)<64?{name:'dirt',boundingBox:'block'}:{name:'air',boundingBox:'empty'};
  return {c,client,sent,advance:()=>t+=50};
}

test('telemetry ring retains only the latest 40 immutable sent positions and exact large ticks',()=>{
  const h=new PredictionHistory(),p=point(1),large=9007199254740993n;
  for(let n=0;n<45;n++)h.push({localTick:n,authInputTick:String(large+BigInt(n)),position:p,t:n*50,epoch:0});
  p.x=900;
  assert.equal(h.size,40);assert.equal(h.entries()[0].localTick,5);assert.equal(h.findTick(large+44n).position.x,1);
  assert.equal(h.findTick(large),null);h.clear();assert.equal(h.size,0);
});

test('lag search recovers a known three-tick delay without calling it current drift',()=>{
  const h=new PredictionHistory();for(let n=0;n<15;n++)h.push({localTick:n,authInputTick:String(n),position:point(n*.1),t:n*50,epoch:0});
  const r=compareLag(h,point(1.1),700);
  assert.equal(r.bestLagTicks,3);assert.ok(r.driftAtBestLag<1e-9);assert.ok(Math.abs(r.driftNow-.3)<1e-9);assert.equal(r.historyStale,false);
});

test('lag search uses tick distance instead of array offsets when history entries are missing',()=>{
  const h=new PredictionHistory();for(const n of [0,1,2,5,6])h.push({localTick:n,position:point(n),t:n*50,epoch:0});
  const r=compareLag(h,point(2),300);assert.equal(r.bestLagTicks,4);assert.equal(r.candidateCount,5);
});

test('empty, stale and ambiguous histories are explicitly marked instead of claiming a latency measurement',()=>{
  const h=new PredictionHistory();assert.equal(compareLag(h,point(0),0).bestLagTicks,null);
  for(let n=0;n<3;n++)h.push({localTick:n,position:point(1),t:n*50,epoch:0});
  const r=compareLag(h,point(1),400);assert.equal(r.historyStale,true);assert.equal(r.historyAgeMs,300);assert.equal(r.ambiguous,true);
  assert.equal(compareLag(h,point(1),400,{epoch:1}).candidateCount,0);
});

test('corrections compare against the packet tick, preserve before-position and mark absent history',()=>{
  const {m,input,events}=telemetry();input(1,100);input(2,101);
  m.authority('correct_player_move_prediction',point(1.25),{tick:100n,internalPosition:point(9),delta:{x:.1,y:0,z:0}});
  const e=events.at(-1);assert.equal(e.horizontalError,.25);assert.equal(e.predictionAtTick.x,1);assert.equal(e.internalPosition.x,9);assert.equal(e.suppressed,true);assert.deepEqual(e.flags,['up']);
  m.authority('correct_player_move_prediction',point(4),{tick:99n});assert.equal(events.at(-1).matched,false);assert.equal(events.at(-1).horizontalError,null);
});

test('respawn and dimension changes invalidate history; suppression lasts twenty subsequent inputs',()=>{
  const {m,input}=telemetry();input(1,1);m.authority('respawn',point(30),{state:1});
  assert.equal(m.history.size,0);assert.equal(m.suppressed(),true);
  for(let i=0;i<19;i++)input(i,i+2);assert.equal(m.suppressed(),true);
  input(20,21);assert.equal(m.suppressed(),false);
  m.authority('change_dimension',point(80));assert.equal(m.history.size,0);assert.equal(m.lastPost,null);
});

test('walking sample records absent or aged post-move data without reusing it as fresh',()=>{
  const {m,input,setTime,events}=telemetry();
  for(let n=1;n<=5;n++)input(n,n);assert.equal(events.at(-1).stale,true);assert.equal(events.at(-1).ageMs,null);
  m.authority('server_post_move',point(5),{walking:true});setTime(250);
  for(let n=6;n<=10;n++)input(n,n);assert.equal(events.at(-1).stale,true);assert.equal(events.at(-1).ageMs,250);
});

test('per-move summaries count all samples while excluding suppression and stale prediction history',()=>{
  const {m,input,setTime,events}=telemetry();const id=m.beginMove(point(30));
  for(let n=1;n<=3;n++){setTime(n*50);input(n,n);m.authority('server_post_move',point(n+.25),{walking:true});}
  setTime(500);m.authority('server_post_move',point(4),{walking:true});
  m.authority('correct_player_move_prediction',point(4),{tick:3n});input(4,4);m.authority('server_post_move',point(4),{walking:true});
  m.endMove(id,'completed');const s=events.at(-1);
  assert.equal(s.event,'move_summary');assert.equal(s.samples,3);assert.equal(s.excludedSamples,2);assert.equal(s.driftAtBestLagMean,.25);
  assert.equal(s.driftAtBestLagMax,.25);assert.equal(s.bestLagTicksMedian,0);assert.equal(s.steps,4);assert.equal(s.corrections,1);
});

test('sample and post-move logs are throttled to five ticks, corrections are not',()=>{
  const {m,input,events}=telemetry();
  for(let n=1;n<=20;n++){input(n,n);m.authority('server_post_move',point(n),{walking:true});}
  for(let n=0;n<3;n++)m.authority('correct_player_move_prediction',point(10),{tick:10n});
  assert.equal(events.filter(e=>e.event==='sample').length,4);
  assert.equal(events.filter(e=>e.source==='server_post_move').length,4);
  assert.equal(events.filter(e=>e.source==='correct_player_move_prediction').length,3);
});

test('TAKEN_TELEMETRY=0 disables history, output and telemetry event listeners',()=>{
  const prev=process.env.TAKEN_TELEMETRY;process.env.TAKEN_TELEMETRY='0';
  try{
    const {m,input,events}=telemetry();input(1,1);m.authority('respawn',point(1));m.terrainError(Error('未知のブロックID 9'));m.endMove(m.beginMove(point(9)),'failed');
    assert.equal(m.enabled,false);assert.equal(m.history.size,0);assert.equal(events.length,0);
    const client=new EventEmitter();client.queue=()=>{};new RealmControls(client);
    assert.equal(client.listenerCount('update_subchunk_blocks'),0);
  }finally{if(prev===undefined)delete process.env.TAKEN_TELEMETRY;else process.env.TAKEN_TELEMETRY=prev;}
});

test('terrain snapshots do not invoke block() or initialize runtime maps or change caches',()=>{
  const {c}=fixture(true);c.runtimeIds=null;c.block=()=>{throw Error('must not call mutable block reader');};
  const def=c.registry.blocksByName.stone;c.registry.blocksByRuntimeId={42:{name:'stone',stateId:def.defaultState}};
  c.updates.set('0,63,0',42);const before=[...c.updates];
  const s=terrainSnapshot(c,point(.5));assert.equal(s.feet.name,'stone');assert.equal(s.feet.stateId,def.defaultState);assert.equal(s.body.unknown,true);
  assert.equal(c.runtimeIds,null);assert.equal(c.chunks.size,0);assert.deepEqual([...c.updates],before);
});

function playSequence(f){
  const {c,client,advance}=f;c.walkTarget={x:4,y:64,z:.5};
  for(let n=0;n<14;n++){advance();c.step();if(n===6)client.emit('server_post_move',{position:point(1.4)});}
  client.emit('correct_player_move_prediction',{prediction_type:'player',position:point(1.8),delta:{x:0,y:0,z:0},tick:10n});
  client.emit('move_player',{runtime_id:42n,mode:'teleport',position:point(2)});
  client.emit('move_player',{runtime_id:99n,mode:'teleport',position:point(200)});
  client.emit('update_subchunk_blocks',{blocks:[{position:0,block_runtime_id:1}]});
  c.movementAuthority='client';advance();c.step();
  client.emit('respawn',{state:0,runtime_entity_id:0n,position:point(3)});
  client.emit('respawn',{state:1,runtime_entity_id:0n,position:point(3)});advance();c.step();
  client.emit('change_dimension',{dimension:1,position:point(4)});advance();c.step();
  return {sent:f.sent,position:c.position,serverPosition:c.serverPosition,lastAuthoritativePosition:c.lastAuthoritativePosition,tick:c.tick,
    target:c.walkTarget,updates:[...c.updates],loaded:[...c.loaded],requested:[...c.requested],velocity:c.verticalVelocity,health:c.health};
}
test('telemetry on/off produces identical packets and movement/respawn/dimension state',()=>{
  assert.deepEqual(playSequence(fixture(true)),playSequence(fixture(false)));
});

test('telemetry logger failures cannot interrupt packets or alter game state',()=>{
  assert.deepEqual(playSequence(fixture(true,()=>{throw Error('logging unavailable');})),playSequence(fixture(false)));
});

test('bulk block updates are counted but not applied; decode errors retain their original failure',()=>{
  const {c,client}=fixture(true);client.emit('update_subchunk_blocks',{blocks:[{position:0,block_runtime_id:1}]});
  assert.equal(c.telemetry.counters.updateSubchunkBlocks,1);assert.equal(c.updates.size,0);
  assert.throws(()=>c.decodeSection(new Stream(Buffer.from([255]))));assert.equal(c.telemetry.counters.subchunkDecodeFailures,1);
  c.telemetry.terrainError(Error('未知のブロックID 999'));assert.equal(c.telemetry.counters.unknownBlockIdExceptions,1);
});

test('goto logs one final summary for arrival, failure and cancellation without altering results',async()=>{
  const events=[],{c}=fixture(true,(_,s)=>events.push(JSON.parse(s)));
  c.requestNearby=()=>{};c.wait=async()=>{};c.lastAuthoritativePosition={...c.position};
  const result=await c.goto({x:.5,y:64,z:.5});assert.equal(result.verification,'server_position_already_in_range');
  assert.equal(events.at(-1).outcome,'completed');
  await assert.rejects(c.goto({x:.5,y:73,z:.5}),/高低差/);assert.equal(events.at(-1).outcome,'failed');
  await assert.rejects(c.goto({x:.5,y:64,z:.5},AbortSignal.abort()));assert.equal(events.at(-1).outcome,'aborted');
  assert.equal(events.filter(e=>e.event==='move_summary').length,3);assert.equal(c.telemetry.active,null);
});

test('nested move measurements retain one outer scope and unavailable drift is null, not zero',()=>{
  const {m,events}=telemetry();const outer=m.beginMove(point(10)),inner=m.beginMove(point(2));
  assert.equal(inner,null);m.endMove(inner,'completed');assert.equal(m.active.id,outer);m.endMove(outer,'failed');
  assert.equal(events.at(-1).driftAtBestLagMean,null);assert.equal(events.at(-1).bestLagTicksMedian,null);
});
