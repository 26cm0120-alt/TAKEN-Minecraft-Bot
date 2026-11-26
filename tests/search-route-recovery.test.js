import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ResourceSearch} from '../src/resource-search.js';
function fixture(){
 let collected=0;const c={client:new EventEmitter(),ready:true,health:20,position:{x:.5,y:65.62,z:.5},lastAuthoritativePosition:{x:1.5,y:65.62,z:.5},registry:{blocksByName:{oak_log:{diggable:true}}},check:s=>s?.throwIfAborted(),stop(){},requestNearby(){},wait:async()=>{},feet(){return {...this.position,y:this.position.y-1.62};},walkable:()=>true,pickup:{inventoryReady:true,snapshot:()=>new Map(),gains:()=>collected?[{item:'oak_log',count:collected}]:[]},mine:async()=>{collected++;return {broken:1};}};
 const search=new ResourceSearch(c);search.nearby=()=>[];
 search.next=(o,v,b)=>({target:{x:b.length?-.5:12.5,y:64,z:.5},path:[{},{}]});
 return {c,search};
}
test('exploration excludes blocked target and collects via another candidate',async()=>{
 const {c,search}=fixture();let moves=0,blockedSeen=false;
 search.next=(o,v,b)=>{blockedSeen ||= b.length===1&&b[0].x===12.5;return {target:{x:b.length?-.5:12.5,y:64,z:.5},path:[{},{}]};};
 c.goto=async p=>{moves++;if(moves===1)throw Error('前方の足場を確認できないため停止しました。');c.position={...p,y:p.y+1.62};};
 search.nearby=()=>moves>=2?[{name:'oak_log',position:{x:-2,y:64,z:0}}]:[];
 search.approach=()=>({target:{x:-.5,y:64,z:.5},path:[{}]});
 const result=await search.gather('oak_log',1);assert.equal(result.total,1);assert.equal(result.routeFailures,1);assert.equal(blockedSeen,true);
});
test('unverified movement and cancellation never cause alternate movement attempts',async()=>{
 for(const message of ['サーバー上で目的地への到着を確認できません。','移動がサーバーに受け入れられないため停止しました。']){
  const {c,search}=fixture();let moves=0;c.goto=async()=>{moves++;throw Error(message);};await assert.rejects(search.gather('oak_log',1),e=>e.message===message);assert.equal(moves,1);
 }
 const {c,search}=fixture(),a=new AbortController();let moves=0;c.goto=async()=>{moves++;a.abort();throw Error('前方の足場を確認できないため停止しました。');};await assert.rejects(search.gather('oak_log',1,a.signal));assert.equal(moves,1);
});
test('route recovery stops after three failures',async()=>{
 const {c,search}=fixture();let moves=0;c.goto=async()=>{moves++;throw Error('前方の足場を確認できないため停止しました。');};await assert.rejects(search.gather('oak_log',1),/3つの経路/);assert.equal(moves,3);
});
test('route recovery requires a known safe authoritative position',async()=>{
 const {c,search}=fixture();let moves=0;c.walkable=()=>false;c.goto=async()=>{moves++;throw Error('前方の足場を確認できないため停止しました。');};await assert.rejects(search.gather('oak_log',1),/現在のサーバー位置/);assert.equal(moves,1);
});
