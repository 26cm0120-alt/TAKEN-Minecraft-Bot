import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AutoSurvival} from './auto-survival.js';
function setup(){
 const client=new EventEmitter(),events=[];let now=0,busy=false;
 const c={ready:true,health:12,food:19,slot:0,position:{x:5,y:65.62,z:0},feet:()=>({x:5,y:64,z:0}),nearbyEntities:()=>[],stop(){},eat:async()=>{events.push('eat');c.food=20;return {eaten:1,food:20};},defend:async()=>events.push('defend')};
 const a=new AutoSurvival(client,c,{now:()=>now,manualBusy:()=>busy,interruptManual:()=>events.push('interrupt')});
 return {client,c,a,events,advance:n=>now+=n,busy:v=>busy=v};
}
test('six hearts triggers eating even with nearly full hunger',async()=>{
 const f=setup();try{await f.a.tick();assert.deepEqual(f.events,['eat']);await f.a.tick();assert.deepEqual(f.events,['eat']);}finally{f.client.emit('close');}
});
test('low health interrupts work before eating without concurrent controls',async()=>{
 const f=setup();try{f.busy(true);await f.a.tick();assert.deepEqual(f.events,['interrupt']);f.busy(false);await f.a.tick();assert.deepEqual(f.events,['interrupt','eat']);}finally{f.client.emit('close');}
});
test('low health food takes priority over defense attacks',async()=>{
 const f=setup();try{f.c.health=10;f.a.lastDamage=0;f.c.nearbyEntities=()=>[{name:'zombie',runtimeId:3n}];await f.a.tick();assert.deepEqual(f.events,['eat']);}finally{f.client.emit('close');}
});
test('damage does not cancel urgent food to attack instead',async()=>{
 const f=setup();let release,foodSignal;
 try{f.c.nearbyEntities=()=>[{name:'zombie',runtimeId:3n}];f.c.eat=async s=>{foodSignal=s;await new Promise(r=>release=r);return {eaten:1,food:20};};const job=f.a.tick();f.client.emit('taken_damage');assert.equal(foodSignal.aborted,false);release();await job;}finally{f.client.emit('close');}
});
test('full hunger, higher health, disabled food, pause and death do not trigger low-health food',async()=>{
 for(const change of [f=>f.c.food=20,f=>f.c.health=13,f=>f.a.foodEnabled=false,f=>f.a.pause(),f=>f.c.health=0]){
  const f=setup();try{change(f);await f.a.tick();assert.deepEqual(f.events,[]);}finally{f.client.emit('close');}
 }
});
test('missing food is not retried until inventory changes',async()=>{
 const f=setup();let attempts=0;try{f.c.items=[];f.c.eat=async()=>{attempts++;throw Error('受信済みの持ち物に安全に食べられる指定の食料がありません。');};await f.a.tick();f.advance(20000);await f.a.tick();assert.equal(attempts,1);f.c.items=[{network_id:1,count:1}];await f.a.tick();assert.equal(attempts,2);}finally{f.client.emit('close');}
});
test('retreat still has priority when a registered safe point is needed',async()=>{
 const f=setup();try{f.c.health=5;f.a.safePoint={x:0,y:64,z:0};f.a.retreat=async()=>f.events.push('retreat');await f.a.tick();assert.deepEqual(f.events,['retreat']);f.advance(1000);await f.a.tick();assert.deepEqual(f.events,['retreat','eat']);}finally{f.client.emit('close');}
});
