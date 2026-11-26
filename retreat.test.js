import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AutoSurvival} from './auto-survival.js';
import {RealmControls} from './realm-controls.js';
function fixture(){let moves=0;const client=new EventEmitter(),c={ready:true,health:20,food:20,position:{x:0,y:65.62,z:0},dimension:0,feet:()=>({x:c.position.x,y:64,z:0}),walkable:()=>true,check(){},nearbyEntities:()=>[],stop(){},slot:0,goto:async(p,s)=>{assert.ok(c.emergencySignals.has(s));moves++;return {verification:'server_position_changed'};}};const a=new AutoSurvival(client,c);a.setSafePoint();return {a,c,client,moves:()=>moves};}
test('low health retreats with scoped permission and cleans it afterward',async()=>{const f=fixture();f.c.health=5;f.c.position.x=5;await f.a.tick();assert.equal(f.moves(),1);f.client.emit('close');});
test('unknown floor, changed dimension and unsafe destination reject retreat',async()=>{for(const kind of ['floor','dimension','enemy']){const f=fixture();f.c.position.x=5;if(kind==='floor')f.c.walkable=()=>false;if(kind==='dimension')f.c.dimension=1;if(kind==='enemy')f.c.nearbyEntities=()=>[{name:'zombie',position:{x:0,y:65.62,z:0}}];await assert.rejects(f.a.retreat(new AbortController().signal));assert.equal(f.moves(),0);f.client.emit('close');}});
test('low health remains blocked for ordinary actions',()=>{const c=Object.create(RealmControls.prototype);Object.assign(c,{ready:true,health:5,emergencySignals:new WeakSet()});const s=new AbortController().signal;assert.throws(()=>c.check(s),/体力/);c.emergencySignals.add(s);c.check(s);c.emergencySignals.delete(s);assert.throws(()=>c.check(s),/体力/);});
