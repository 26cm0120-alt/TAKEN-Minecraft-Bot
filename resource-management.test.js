import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {manageResources} from './resource-management.js';
import {toolCondition} from './tool-condition.js';
import {miningToolSlot} from './mining-tools.js';
function fixture(){
 const names=['stone_pickaxe','stone_axe','stone_shovel','wooden_pickaxe','iron_pickaxe','oak_log','oak_planks','stick','cobblestone','raw_iron','iron_ingot','coal'];
 const registry={items:Object.fromEntries(names.map((name,id)=>[id+1,{name,maxDurability:/_(pickaxe|axe|shovel)$/.test(name)?100:undefined}])),blocksByName:{stone:{material:'mineable/pickaxe'}},supportFeature:()=> 'Damage'};
 const items=[],events=[];
 const add=(name,count=1,damage=0)=>{items.push({network_id:names.indexOf(name)+1,count,metadata:0,extra:{nbt:{nbt:{type:'compound',value:{Damage:{type:'int',value:damage}}}}}});};
 const count=name=>items.reduce((n,i)=>n+(registry.items[i.network_id]?.name===name?i.count:0),0);
 const take=(name,n)=>{assert.ok(count(name)>=n,'missing '+name);for(const i of items)if(registry.items[i.network_id]?.name===name){const used=Math.min(n,i.count);i.count-=used;n-=used;}};
 const c={items,registry,client:new EventEmitter(),pickup:{inventoryReady:true},check:s=>s?.throwIfAborted(),feet:()=>({x:0,y:64,z:0}),block:()=>({name:'crafting_table'}),stop(){},select:slot=>events.push(['select',slot]),goto:async()=>events.push(['return']),
  resourceSearch:{gather:async(name,n)=>{events.push(['gather',name,n]);add(name==='wood'?'oak_log':name,n);}},
  furnace:{smelt:async(name,n)=>{events.push(['smelt',name,n]);take('raw_iron',n);take('coal',1);add('iron_ingot',n);}},
  crafting:{equipInventorySlot:async slot=>slot,craft:async(name,n)=>{
   events.push(['craft',name,n]);
   if(name==='oak_planks'){take('oak_log',Math.ceil(n/4));add(name,Math.ceil(n/4)*4);}
   else if(name==='stick'){take('oak_planks',Math.ceil(n/4)*2);add(name,Math.ceil(n/4)*4);}
   else {const [material,kind]=name.split('_');take('stick',2);take(material==='wooden'?'oak_planks':material==='stone'?'cobblestone':'iron_ingot',kind==='shovel'?1:3);add(name);}
  }}};
 return {c,add,count,events};
}
test('resource management replaces worn tool, gathers deficit and keeps old tool',async()=>{
 const {c,add,count,events}=fixture();add('stone_pickaxe',1,90);add('stick',2);add('cobblestone',3);
 const r=await manageResources(c,{item:'stone_pickaxe'});
 assert.deepEqual(r.made,['stone_pickaxe']);assert.equal(count('stone_pickaxe'),2);
 assert.equal(toolCondition(c.items[0],c.registry).remaining,10);
 assert.equal(events.find(e=>e[0]==='select')[1],3);
 assert.equal(miningToolSlot(c.items,c.registry,'stone'),3);
});
test('resource management bootstraps pickaxe and collects missing stone',async()=>{
 const {c,events}=fixture();const r=await manageResources(c,{item:'stone_pickaxe'});
 assert.ok(r.made.includes('wooden_pickaxe'));assert.ok(r.made.includes('stone_pickaxe'));
 assert.ok(events.some(e=>e[0]==='gather'&&e[1]==='wood'));
 assert.ok(events.some(e=>e[0]==='gather'&&e[1]==='cobblestone'));
});
test('resource management keeps healthy tool without gathering',async()=>{
 const {c,add,events}=fixture();add('stone_pickaxe',1,30);const r=await manageResources(c,{item:'stone_pickaxe'});
 assert.deepEqual(r.kept,['stone_pickaxe']);assert.deepEqual(events,[]);
});
test('resource management refuses unconfirmed collected materials',async()=>{
 const {c}=fixture();c.resourceSearch.gather=async()=>({total:8});await assert.rejects(manageResources(c,{item:'stone_pickaxe'}),/原木の回収/);
});
test('resource management smelts missing iron and verifies replacement',async()=>{
 const {c,add,events}=fixture();add('stone_pickaxe');add('iron_pickaxe',1,90);add('stick',2);
 const r=await manageResources(c,{item:'iron_pickaxe'});assert.deepEqual(r.made,['iron_pickaxe']);
 assert.ok(events.some(e=>e[0]==='gather'&&e[1]==='raw_iron'));assert.ok(events.some(e=>e[0]==='smelt'));
});
test('resource management abort restores exploration origin and does not craft',async()=>{
 const {c,events}=fixture(),a=new AbortController();const previous={x:1,y:2,z:3};c.autonomousOrigin=previous;
 c.resourceSearch.gather=async()=>a.abort();await assert.rejects(manageResources(c,{item:'stone_pickaxe'},a.signal));
 assert.equal(c.autonomousOrigin,previous);assert.ok(!events.some(e=>e[0]==='craft'));
});
test('unknown durability does not silently replace tool',async()=>{
 const {c,add}=fixture();add('stone_pickaxe');c.items[0].extra={has_nbt:true};const r=await manageResources(c,{item:'stone_pickaxe'});
 assert.equal(r.made.length,0);assert.match(r.notes[0],/耐久値未確認/);
});
test('tool condition reads wrapped Bedrock Damage and rejects invalid damage',()=>{
 const {c,add}=fixture();add('stone_pickaxe',1,80);assert.equal(toolCondition(c.items[0],c.registry).ratio,.2);
 c.items[0].extra.nbt.nbt.value.Damage.value=-1;assert.equal(toolCondition(c.items[0],c.registry),null);
});
