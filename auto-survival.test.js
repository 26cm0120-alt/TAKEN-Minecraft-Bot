import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AutoSurvival} from './auto-survival.js';
import {RealmControls} from './realm-controls.js';
import {attachAIChat} from './ai-chat.js';
function fixture(){let now=0,eaten=0,attacks=0,busy=false,interrupted=0;const c=new EventEmitter();c.queue=()=>{};
 const controls={ready:true,health:20,food:16,position:{x:0,y:65.62,z:0},slot:0,nearbyEntities:()=>[],stop:()=>{},select:slot=>controls.slot=slot,eat:async()=>{eaten++;controls.food=20;return {eaten:1,food:20};},defend:async()=>attacks++};
 const auto=new AutoSurvival(c,controls,{now:()=>now,manualBusy:()=>busy,interruptManual:()=>interrupted++});
 return {c,controls,auto,advance:ms=>now+=ms,counts:()=>({eaten,attacks,interrupted}),busy:v=>busy=v};
}
test('auto eating uses hunger threshold, serializes work and pauses on stop',async()=>{
 const f=fixture();await f.auto.tick();assert.equal(f.counts().eaten,1);await f.auto.tick();assert.equal(f.counts().eaten,1);
 f.controls.food=16;f.advance(10000);f.auto.pause();await f.auto.tick();assert.equal(f.counts().eaten,1);f.auto.resume();await f.auto.tick();assert.equal(f.counts().eaten,2);
});
test('defense requires recent own damage and a whitelisted enemy in reach, never follows',async()=>{
 const f=fixture();f.controls.food=20;f.controls.nearbyEntities=()=>[{name:'zombie',runtimeId:3n}];await f.auto.tick();assert.equal(f.counts().attacks,0);
 f.auto.lastDamage=0;await f.auto.tick();assert.equal(f.counts().attacks,1);f.advance(5000);await f.auto.tick();assert.equal(f.counts().attacks,1);
 for(const name of ['player','wolf','cat','cow','villager','enderman','creeper']){f.auto.lastDamage=5000;f.controls.nearbyEntities=()=>[{name,runtimeId:3n}];await f.auto.tick();}assert.equal(f.counts().attacks,1);
});
test('low health and death suppress attacks; food is permitted when alive at low health',async()=>{
 const f=fixture();f.controls.health=5;f.controls.nearbyEntities=()=>[{name:'zombie',runtimeId:3n}];f.auto.lastDamage=0;await f.auto.tick();assert.equal(f.counts().attacks,0);assert.equal(f.counts().eaten,1);
 f.advance(10000);f.controls.food=10;f.controls.health=0;await f.auto.tick();f.controls.health=20;f.controls.respawning=true;await f.auto.tick();assert.equal(f.counts().eaten,1);
});
test('routine hunger waits during a manual job, urgent hunger interrupts it',async()=>{
 const f=fixture();f.busy(true);await f.auto.tick();assert.equal(f.counts().eaten,0);assert.equal(f.counts().interrupted,0);
 f.controls.food=6;await f.auto.tick();assert.equal(f.counts().interrupted,1);assert.equal(f.counts().eaten,0);f.busy(false);await f.auto.tick();assert.equal(f.counts().eaten,1);
});
test('manual cancellation waits for auto cleanup and close prevents any new actions',async()=>{
 const f=fixture();let release,aborted=false;f.controls.eat=async signal=>{await new Promise(r=>release=r);aborted=signal.aborted;return {eaten:0,food:16};};
 const running=f.auto.tick();assert.ok(f.auto.job);let canceled=false;const cancellation=f.auto.cancel().then(()=>canceled=true);await Promise.resolve();assert.equal(canceled,false);
 release();await running;await cancellation;assert.equal(aborted,true);assert.equal(canceled,true);f.c.emit('close');await f.auto.tick();assert.equal(f.auto.closed,true);
});
test('automatic mode commands honor owner permissions and stop persists until resumed',async()=>{
 const c=new EventEmitter(),sent=[];c.profile={name:'TAKE6866',xuid:'1'};c.queue=(name,p)=>sent.push({name,p});const controls=new RealmControls(c);
 const ai=attachAIChat(c,{controls,fetchImpl:()=>{throw Error('commands must not call AI');}});
 const command=(message,sender='Takken1212')=>ai.handle({type:'chat',source_name:sender,message:'!TAKEN '+message});
 await command('自動行動オフ','stranger');assert.equal(controls.autoSurvival.paused,false);await command('自動行動オフ');assert.equal(controls.autoSurvival.paused,true);
 await command('自動食事オフ');assert.equal(controls.autoSurvival.foodEnabled,false);await command('自動行動オン');assert.equal(controls.autoSurvival.paused,false);
 await ai.handle({type:'chat',source_name:'Takken1212',message:'!stop'});assert.equal(controls.autoSurvival.paused,true);await command('状態');assert.equal(controls.autoSurvival.paused,true);c.emit('close');
});
test('actual defend checks line of sight, refuses pets, and sends exactly one nearby attack',async()=>{
 const c=new EventEmitter(),sent=[];c.queue=(name,params)=>sent.push({name,params});const controls=new RealmControls(c);controls.ready=true;controls.health=20;controls.position={x:0.5,y:65.62,z:0.5};controls.wait=async()=>{};controls.block=()=>({name:'air',boundingBox:'empty'});
 controls.entities.set('3',{name:'zombie',runtimeId:3n,position:{x:2,y:64,z:0.5}});await controls.defend('3',new AbortController().signal);assert.equal(sent.filter(p=>p.name==='inventory_transaction').length,1);
 controls.block=()=>({name:'stone',boundingBox:'block'});await assert.rejects(()=>controls.defend('3'),/見通し/);
 controls.entities.set('4',{name:'wolf',runtimeId:4n,position:{x:2,y:64,z:0.5}});await assert.rejects(()=>controls.defend('4'),/防衛対象/);
 controls.entities.get('3').position.x=10;await assert.rejects(()=>controls.defend('3'),/防衛対象/);assert.equal(sent.filter(p=>p.name==='inventory_transaction').length,1);
});
