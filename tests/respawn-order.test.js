import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls} from '../src/realm-controls.js';

test('two deaths in one session use client-ready then server-ready then respawn-action',()=>{
 const client=new EventEmitter(),sent=[];
 client.queue=(name,params)=>sent.push({name,params});
 const c=new RealmControls(client,'1.26.60',{now:()=>0});
 c.ready=true;c.entityId=4525n;c.position={x:93,y:65.62,z:538};
 const health=value=>client.emit('update_attributes',{runtime_entity_id:4525n,attributes:[{name:'minecraft:health',current:value}]});
 health(20);
 for(let cycle=0;cycle<2;cycle++){
  const start=sent.length;
  // The real log delivers state zero before the zero-health attribute.
  client.emit('respawn',{state:0,runtime_entity_id:0n,position:{x:93+cycle,y:65.62,z:538}});
  health(0);
  const request=sent[start];assert.equal(request.name,'respawn');assert.equal(request.params.state,2);
  assert.equal(request.params.runtime_entity_id,4525n);assert.equal(request.params.position.x,93+cycle);
  assert.throws(()=>c.check(),/リスポーン/);
  client.emit('respawn',{state:0,runtime_entity_id:0n,position:{x:91,y:64,z:542}});
  assert.equal(sent.length,start+1,'server search update does not initiate a second request');
  client.emit('respawn',{state:1,runtime_entity_id:0n,position:{x:91.5,y:65.62,z:542.5}});
  assert.equal(sent[start+1].name,'player_action');assert.equal(sent[start+1].params.action,'respawn');
  assert.equal(c.status().respawning,true);
  health(20);assert.equal(c.status().respawning,false);assert.doesNotThrow(()=>c.check());
 }
 client.emit('close');
});
