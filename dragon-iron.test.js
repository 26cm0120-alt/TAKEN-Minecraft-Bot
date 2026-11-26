import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DragonPlanner,dragonCommand} from './dragon-planner.js';
import {ironCosts} from './dragon-iron.js';
function fixture(){
 const names=[...Object.keys(ironCosts),'iron_ingot','raw_iron','coal','stone_pickaxe','stick','birch_planks','furnace'];const counts={iron_ingot:33,stone_pickaxe:1,stick:3,birch_planks:6};let state={version:1,status:'ready',events:[]};const calls=[];
 const c={items:[],armorItems:[],offhandItems:[],registry:{items:Object.fromEntries(names.map((name,i)=>[i,{name}]))},pickup:{inventoryReady:true},feet:()=>({x:0,y:64,z:0}),check:s=>s.throwIfAborted(),stop(){},block:p=>({name:p.x===0&&p.z===0?'crafting_table':p.x===1&&p.z===1?'furnace':'air'})};
 const sync=()=>{c.items=names.flatMap((n,i)=>counts[n]>0?[{network_id:i,count:counts[n]}]:[]);};const item=n=>({network_id:names.indexOf(n),count:1});sync();
 c.execute=async a=>{calls.push(a);if(a.type==='gather')counts[a.block]=(counts[a.block]||0)+a.count;if(a.type==='smelt'){counts.raw_iron-=a.count;counts.coal-=Math.ceil(a.count/8);counts.iron_ingot=(counts.iron_ingot||0)+a.count;}if(a.type==='craft'){assert.ok(counts.iron_ingot>=ironCosts[a.item]);counts.iron_ingot-=ironCosts[a.item];if(a.item==='shield')counts.birch_planks-=6;counts[a.item]=1;}if(a.type==='wear'){counts[a.item]--;c.armorItems[['iron_helmet','iron_chestplate','iron_leggings','iron_boots'].indexOf(a.item)]=item(a.item);}if(a.type==='offhand'){counts.shield--;c.offhandItems[0]=item('shield');}sync();};
 const p=new DragonPlanner(c,{store:{load:()=>structuredClone(state),save:s=>state=structuredClone(s)}});return {p,c,counts,calls,sync,state:()=>state};
}
const options=()=>({sender:'tester',signal:new AbortController().signal,say(){}});
test('iron stage commands and exact iron requirement',()=>{assert.equal(dragonCommand('自律 討伐段階2'),'iron');assert.equal(Object.values(ironCosts).reduce((a,b)=>a+b),33);});
test('crafts missing equipment and verifies armor and shield; rerun crafts nothing',async()=>{const f=fixture();await f.p.runIron(options());assert.equal(f.state().status,'iron_ready');assert.equal(f.calls.filter(a=>a.type==='craft').length,8);assert.equal(f.counts.iron_ingot,0);const before=f.calls.length;await f.p.runIron(options());assert.equal(f.calls.length,before);});
test('raw iron processed in bounded 16,16,1 batches',async()=>{const f=fixture();f.counts.iron_ingot=0;f.sync();await f.p.runIron(options());assert.deepEqual(f.calls.filter(a=>a.type==='smelt').map(a=>a.count),[16,16,1]);assert.equal(f.state().status,'iron_ready');});
test('unconfirmed equipment update pauses progress',async()=>{const f=fixture(),execute=f.c.execute;f.c.execute=a=>a.type==='wear'?undefined:execute(a);await assert.rejects(f.p.runIron(options()),/装着/);assert.equal(f.state().status,'paused');assert.equal(f.state().stage,2);});
test('stop before a step persists phase for manual resume',async()=>{const f=fixture(),ac=new AbortController(),execute=f.c.execute;f.c.execute=async a=>{await execute(a);ac.abort();};await assert.rejects(f.p.runIron({...options(),signal:ac.signal}));assert.equal(f.state().status,'paused');assert.equal(f.state().stage,2);await f.p.runIron(options());assert.equal(f.state().status,'iron_ready');});
