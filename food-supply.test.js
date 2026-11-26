import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {supplyFood} from './food-supply.js';
function fixture(){
 const inventory={coal:1},events=[];
 const c={client:new EventEmitter(),check:s=>s?.throwIfAborted(),feet:()=>({x:0,y:64,z:0}),block:()=>({name:'furnace'}),nearbyEntities:()=>[{name:'cow'}],stop(){},
  combat:async()=>{events.push('hunt');},goto:async()=>{events.push('home');},
  eat:async(s,{item,count})=>{events.push('eat');inventory[item]-=count;return {eaten:count,food:20};},
  pickup:{inventoryReady:true,snapshot:()=>new Map(),collect:async()=>{events.push('collect');inventory.beef=2;return {total:2};}},
  furnace:{count:n=>inventory[n]||0,smelt:async(raw,count)=>{events.push('cook');inventory[raw]-=count;inventory.cooked_beef=(inventory.cooked_beef||0)+count;return {produced:count};}}};
 return {c,inventory,events};
}
test('food supply hunts, verifies collection, returns, cooks and eats partial yield',async()=>{
 const {c,events}=fixture();const r=await supplyFood(c,{count:3},new AbortController().signal);
 assert.deepEqual(events,['hunt','collect','home','cook','eat']);assert.equal(r.produced,2);assert.equal(r.eaten,2);assert.equal(r.requested,3);
});
test('food supply refuses absent fuel before hunting',async()=>{
 const {c,inventory,events}=fixture();inventory.coal=0;await assert.rejects(supplyFood(c),/燃料/);assert.deepEqual(events,[]);
});
test('food supply refuses absent furnace before hunting',async()=>{
 const {c,events}=fixture();c.block=()=>null;await assert.rejects(supplyFood(c),/かまど/);assert.deepEqual(events,[]);
});
test('food supply does not cook when pickup reports gains but inventory does not',async()=>{
 const {c,events}=fixture();c.pickup.collect=async()=>({total:2});await assert.rejects(supplyFood(c),/生肉の所持/);assert.deepEqual(events,['hunt']);
});
test('food supply skips hunt with raw meat and leaves cooked food when full',async()=>{
 const {c,inventory,events}=fixture();inventory.beef=3;c.eat=async()=>({eaten:0,food:20});const r=await supplyFood(c);
 assert.deepEqual(events,['home','cook']);assert.equal(r.eaten,0);assert.equal(inventory.cooked_beef,3);
});
test('food supply cancellation after hunt stops all later stages',async()=>{
 const {c,events}=fixture(),a=new AbortController();c.combat=async()=>{events.push('hunt');a.abort();};await assert.rejects(supplyFood(c,{},a.signal));assert.deepEqual(events,['hunt']);
});
test('food supply checks actual cooked inventory before eating',async()=>{
 const {c,inventory,events}=fixture();inventory.beef=3;c.furnace.smelt=async()=>({produced:3});await assert.rejects(supplyFood(c),/持ち物増加/);assert.deepEqual(events,['home']);
});
