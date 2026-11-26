import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls} from '../src/realm-controls.js';
import {attachAIChat} from '../src/ai-chat.js';
import {formatStatus} from '../src/action-agent.js';
function fixture(){
  let now=0;const c=new EventEmitter(),sent=[];c.profile={name:'TAKE6866',xuid:'123'};c.queue=(name,params)=>sent.push({name,params});
  const controls=new RealmControls(c,'1.26.60',{now:()=>now});controls.entityId=42n;controls.ready=true;controls.position={x:91.5,y:65.62,z:542.5};
  const health=(value,id=42n)=>c.emit('update_attributes',{runtime_entity_id:id,attributes:[{name:'minecraft:health',current:value}]});
  return {c,sent,controls,health,advance:ms=>now+=ms};
}
test('only own confirmed health zero counts; login handshakes and other players do not',()=>{
  const {c,controls,health}=fixture();
  for(let i=0;i<2;i++){c.emit('respawn',{state:0,runtime_entity_id:0n,position:{x:91,y:64,z:542}});c.emit('respawn',{state:1,runtime_entity_id:0n,position:{x:91.5,y:65.62,z:542.5}});}
  c.emit('text',{type:'translation',message:'death.attack.mob'});health(0,99n);
  assert.equal(controls.status().recentDeaths,0);
  health(20);health(0);health(0);assert.equal(controls.status().recentDeaths,1);
  c.emit('respawn',{state:1,runtime_entity_id:0n,position:{x:91.5,y:65.62,z:542.5}});health(0);
  assert.equal(controls.status().recentDeaths,1,'stale zero after readiness is not a new life');
  health(20);health(0);assert.equal(controls.status().recentDeaths,2);
  assert.deepEqual(controls.status().lastRespawnPosition,{x:91.5,y:64,z:542.5});
});
test('repeated deaths notify chat without LLM calls and expire after two minutes',()=>{
  const {c,sent,controls,health,advance}=fixture();let calls=0;
  attachAIChat(c,{controls,fetchImpl:()=>{calls++;throw Error('must not call AI');}});
  for(let i=0;i<3;i++){health(20);health(0);advance(1000);}
  const warnings=()=>sent.filter(p=>p.name==='text' && p.params.message.includes('直近2分で'));
  assert.equal(warnings().length,1);assert.equal(calls,0);assert.equal(controls.status().deathLoop,true);
  assert.match(formatStatus(controls.status()),/直近2分の死亡: 3回/);
  health(20);health(0);assert.equal(warnings().length,1,'repeated warnings are throttled');
  advance(120000);assert.equal(controls.status().recentDeaths,0);assert.equal(controls.status().deathLoop,false);
});
test('death and respawn cancel an old plan even when health recovers before the pending step resolves',async()=>{
  for(const cause of ['health','respawn']){
    const {c,controls,health}=fixture();let resolve,calls=0,aborted=false;
    controls.execute=async(_action,_sender,signal)=>{calls++;await new Promise(r=>resolve=r);aborted=signal.aborted;return {attacks:1,target:'zombie',removed:false};};
    const ai=attachAIChat(c,{controls,fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({reply:'',actions:[{type:'combat',target:'zombie',seconds:1},{type:'combat',target:'zombie',seconds:1}]})}})})});
    const pending=ai.handle({type:'chat',source_name:'Takken1212',message:'!TAKEN 敵を2回攻撃して'});
    while(!resolve)await new Promise(r=>setImmediate(r));
    if(cause==='health'){health(20);health(0);}else c.emit('respawn',{state:0,runtime_entity_id:0n,position:{x:91,y:64,z:542}});
    c.emit('respawn',{state:1,runtime_entity_id:0n,position:{x:91.5,y:65.62,z:542.5}});health(20);
    resolve();await pending;assert.equal(aborted,true);assert.equal(calls,1,'next action must not run in the new life');
  }
});
test('old breaking actions never cross respawn and dead clients send no movement',()=>{
  const {c,controls,sent,health}=fixture();controls.digging={position:{x:92,y:64,z:542}};controls.pendingActions=[{action:'start_break',position:{x:92,y:64,z:542},face:1}];
  health(20);health(0);assert.throws(()=>controls.check(undefined,{allowLowHealth:true}),/リスポーン/);controls.step();assert.equal(sent.length,0);assert.deepEqual(controls.pendingActions,[]);
  c.emit('respawn',{state:0,runtime_entity_id:0n,position:{x:91,y:64,z:542}});assert.deepEqual(controls.pendingActions,[]);
  c.emit('respawn',{state:1,runtime_entity_id:0n,position:{x:91.5,y:65.62,z:542.5}});health(20);controls.step();
  assert.equal(sent.at(-1).params.block_action,undefined);
});
