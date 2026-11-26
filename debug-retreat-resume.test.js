import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AutoSurvival} from './auto-survival.js';

for (const resumeBeforeCleanup of [false,true]) {
 test(`explicit resume allows retreat again (before cleanup: ${resumeBeforeCleanup})`,async()=>{
  let now=0,calls=0,release;
  const client=new EventEmitter();
  const c={ready:true,health:5,food:20,slot:0,position:{x:5,y:65.62,z:0},feet:()=>({x:5,y:64,z:0}),nearbyEntities:()=>[],stop(){}};
  const a=new AutoSurvival(client,c,{now:()=>now});
  a.safePoint={x:0,y:64,z:0};
  a.retreat=async signal=>{calls++;await new Promise(resolve=>{release=resolve;});signal.throwIfAborted();};
  try {
   const running=a.tick();
   assert.equal(calls,1);
   a.pause();
   if(resumeBeforeCleanup)a.resume();
   release();await running;
   if(!resumeBeforeCleanup)a.resume();
   assert.equal(a.nextRetreatAttempt,0);
   assert.equal(a.nextAttempt,0);
   now=1000;
   a.retreat=async()=>{calls++;};
   await a.tick();
   assert.equal(calls,2,'low health must trigger retreat without a 30 second delay');
   assert.equal(a.nextRetreatAttempt,31000,'normal cooldown remains after a new retreat');
  } finally {client.emit('close');}
 });
}
