import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DragonPlanner,dragonCommand} from '../src/dragon-planner.js';
import {resourceSpec} from '../src/resource-search.js';
import {EventEmitter} from 'node:events';
import {attachAIChat} from '../src/ai-chat.js';
import {createProgressStore} from '../src/dragon-progress.js';
import {mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('progress survives a fresh store instance with atomic disk writes',()=>{
 const folder=mkdtempSync(join(tmpdir(),'taken-dragon-test-')),file=join(folder,'progress.json');
 try{const store=createProgressStore(file),p=store.load();p.status='paused';p.reason='死亡';p.base={x:1,y:64,z:2};store.save(p);assert.deepEqual(createProgressStore(file).load(),p);}finally{unlinkSync(file);rmdirSync(folder);}
});
function fixture(){
 const names=['birch_log','birch_planks','stick','crafting_table','wooden_pickaxe','cobblestone','stone_pickaxe','stone_axe','stone_sword','stone_shovel','stone_hoe'],counts={},calls=[],blocks=new Map(),saved=[];let data={version:1,status:'ready',events:[],base:null,reason:'',steps:0};
 const store={load:()=>structuredClone(data),save:p=>{data=structuredClone(p);saved.push(data);}};
 const c={ready:true,health:20,position:{x:.5,y:65.62,z:.5},items:[],registry:{items:Object.fromEntries(names.map((n,id)=>[id,{name:n}]))},pickup:{inventoryReady:true},feet(){return {x:this.position.x,y:this.position.y-1.62,z:this.position.z};},check(s){s.throwIfAborted();if(this.health===0)throw Error('死亡');},stop(){},walkable(){return true;},block(p){return blocks.get(`${p.x},${p.y},${p.z}`)||{name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty'};},status(){return {health:this.health};}};
 const sync=()=>{c.items=names.flatMap((n,id)=>counts[n]>0?[{network_id:id,count:counts[n]}]:[]);};
 const use=(n,k)=>{assert.ok((counts[n]||0)>=k,'material '+n);counts[n]-=k;};
 c.execute=async(a,sender,signal)=>{
  signal.throwIfAborted();calls.push(a);
  if(a.type==='gather'){const name=a.block==='wood'?'birch_log':a.block;counts[name]=(counts[name]||0)+a.count;}
  if(a.type==='build'){use(a.block,1);blocks.set(`${a.x},${a.y},${a.z}`,{name:a.block,boundingBox:'block'});}
  if(a.type==='move')c.position={x:a.x,y:a.y+1.62,z:a.z};
  if(a.type==='craft'){
   let amount=a.count;
   if(a.item==='birch_planks'){const n=Math.ceil(amount/4);use('birch_log',n);amount=n*4;}
   else if(a.item==='stick'){const n=Math.ceil(amount/4);use('birch_planks',n*2);amount=n*4;}
   else if(a.item==='crafting_table')use('birch_planks',4);
   else if(a.item==='wooden_pickaxe'){use('birch_planks',3);use('stick',2);}
   else {const cost={stone_pickaxe:[3,2],stone_axe:[3,2],stone_sword:[2,1],stone_shovel:[1,2],stone_hoe:[2,2]}[a.item];use('cobblestone',cost[0]);use('stick',cost[1]);}
   counts[a.item]=(counts[a.item]||0)+amount;
  }
  sync();return {};
 };
 return {c,store,counts,calls,saved,sync,get data(){return data;}};
}
const run=(p)=>p.run({sender:'owner',signal:new AbortController().signal,say:()=>{}});
test('roadmap commands and stone resource lookup match supported progression',()=>{assert.equal(dragonCommand('自律 エンドラ討伐の準備'),'run');assert.equal(dragonCommand('自律 石の道具一式をそろえて'),'run');assert.equal(dragonCommand('討伐進捗'),'status');assert.equal(dragonCommand('討伐計画'),'plan');assert.deepEqual(resourceSpec('cobblestone'),{blocks:['stone','cobblestone'],items:['cobblestone']});});
test('empty inventory gathers birch wood, verifies table placement and crafts all stone tools using actual materials',async()=>{
 const f=fixture(),p=new DragonPlanner(f.c,{store:f.store});await run(p);assert.equal(f.data.status,'stone_tools_ready');for(const t of ['stone_pickaxe','stone_axe','stone_sword','stone_shovel','stone_hoe'])assert.equal(f.counts[t],1);assert.ok(f.calls.find(a=>a.type==='build'&&a.block==='crafting_table'));assert.ok(f.calls.find(a=>a.type==='craft'&&a.item==='birch_planks'));assert.ok(f.calls.length<=32);
 const before=f.calls.length;await run(new DragonPlanner(f.c,{store:f.store}));assert.equal(f.calls.length,before,'completed tools are not recreated');
});
test('existing tools skip collection; failed collection pauses and resume rechecks current inventory',async()=>{
 const f=fixture();f.counts.stone_pickaxe=1;f.sync();const execute=f.c.execute;f.c.execute=async(...args)=>{if(args[0].type==='gather')throw Error('回収0');return execute(...args);};const p=new DragonPlanner(f.c,{store:f.store});await assert.rejects(()=>run(p),/回収0/);assert.equal(f.data.status,'paused');assert.ok(!f.calls.some(a=>a.item==='wooden_pickaxe'));
 f.c.execute=execute;await run(new DragonPlanner(f.c,{store:f.store}));assert.equal(f.counts.stone_pickaxe,1);assert.equal(f.data.status,'stone_tools_ready');
});
test('a claimed craft without a server inventory increase never marks completion',async()=>{
 const f=fixture();f.c.execute=async(a)=>{f.calls.push(a);if(a.type==='gather'){f.counts.birch_log=4;f.sync();}return {crafted:64};};await assert.rejects(()=>run(new DragonPlanner(f.c,{store:f.store})),/板材の実増加/);assert.equal(f.data.status,'paused');assert.notEqual(f.data.status,'stone_tools_ready');
});
test('stop persists progress and resuming rechecks materials instead of repeating confirmed crafts',async()=>{
 const f=fixture(),abort=new AbortController(),execute=f.c.execute;
 f.c.execute=async(...args)=>{const r=await execute(...args);if(args[0].item==='crafting_table'&&args[0].type==='craft')abort.abort(new Error('停止'));return r;};
 await assert.rejects(()=>new DragonPlanner(f.c,{store:f.store}).run({sender:'owner',signal:abort.signal,say:()=>{}}),/停止/);assert.equal(f.data.status,'paused');assert.equal(f.counts.crafting_table,1);
 f.c.execute=execute;await run(new DragonPlanner(f.c,{store:f.store}));assert.equal(f.calls.filter(a=>a.type==='craft'&&a.item==='crafting_table').length,1);assert.equal(f.data.status,'stone_tools_ready');
});
test('death persists pause and authorized roadmap execution never calls the LLM',async()=>{
 const f=fixture(),execute=f.c.execute;f.c.execute=async(...args)=>{await execute(...args);f.c.health=0;throw Error('死亡');};await assert.rejects(()=>run(new DragonPlanner(f.c,{store:f.store})),/死亡/);assert.equal(f.data.status,'paused');
 const g=fixture(),client=new EventEmitter();client.profile={name:'bot'};client.queue=()=>{};let aiCalls=0;const ai=attachAIChat(client,{owners:['owner'],controls:g.c,dragonStore:g.store,fetchImpl:async()=>{aiCalls++;throw Error('LLM');}});await ai.handle({type:'chat',source_name:'owner',message:'!TAKEN 自律 エンドラ討伐の準備'});assert.equal(aiCalls,0);assert.equal(g.data.status,'stone_tools_ready');client.emit('close');
});
