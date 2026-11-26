import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {RealmControls,emptyItem} from './realm-controls.js';
import {allocateIngredients,buildCraftRequest} from './realm-crafting.js';
import {directPlan,validatePlan} from './action-agent.js';
const require=createRequire(import.meta.url);
const {createSerializer,createDeserializer}=require('./node_modules/bedrock-protocol/src/transforms/serializer.js');
const serializer=createSerializer('1.26.60'),deserializer=createDeserializer('1.26.60');
function rt(name,params){return deserializer.parsePacketBuffer(serializer.createPacketBuffer({name,params})).data.params;}
function setup(){
 const client=new EventEmitter();client.sent=[];client.queue=(name,p)=>client.sent.push({name,p});
 const controls=new RealmControls(client);controls.ready=true;controls.position={x:0.5,y:65.62,z:0.5};controls.entityId=5n;controls.health=20;controls.food=20;controls.crafting.timeout=100;
 controls.wait=async(ms,signal)=>{await new Promise(r=>setTimeout(r,1));controls.check(signal);};
 const item=(n,count=1,stack=123)=>({...emptyItem(),network_id:controls.registry.itemsByName[n].id,count,has_stack_id:true,stack_id:stack});
 const ingredient=(n,count=1)=>({type:'valid',descriptor_type:'name',name:'minecraft:'+n,metadata:0,count});
 const recipe=(output,input,width=1,height=1,count=1)=>({network_id:7,recipe_id:'test',block:'crafting_table',width,height,input,output:[item(output,count)],kind:'shaped'});
 function advertise(r){client.emit('crafting_data',{clear_recipes:true,shaped_recipes:[r]});}
 function server({reject=false,noSlots=false}={}){client.queue=(name,p)=>{
   client.sent.push({name,p});
   if(name==='interact')client.emit('container_open',{window_id:'inventory',window_type:'inventory'});
   if(name==='item_stack_request'){
     const pending=controls.crafting.pending;
     const containers=noSlots?[]:[{slot_type:{container_id:'hotbar_and_inventory'},slots:[...pending.expected].map(([slot,{after}])=>({slot,hotbar_slot:slot,count:after.count,item_stack_id:after.count?slot+1000:undefined,custom_name:'',filtered_custom_name:'',durability_correction:0}))}];
     client.emit('item_stack_response',rt('item_stack_response',{responses:[{status:reject?'error':'ok',request_id:p.requests[0].request_id,containers:reject?undefined:containers}]}));
   }
 };}
 return {client,controls,item,ingredient,recipe,advertise,server};
}
test('Japanese craft commands and aggregate limit bypass LLM and reject malformed plans',()=>{
 for(const [text,item,count] of [['オークの板材を8個作って','oak_planks',8],['棒を4個クラフトして','stick',4],['石のツルハシを1個作って','stone_pickaxe',1],['鉄の剣を一つ作って','iron_sword',1]])assert.deepEqual(directPlan(text).actions,[{type:'craft',item,count}]);
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'craft',item:'stick',count:64},{type:'craft',item:'stick',count:1}]}));
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'craft',item:'../x',count:1}]}));
 assert.equal(directPlan('石のツルハシの作り方を教えて'),null);
});
test('server recipe tags consume the entire inventory, reserve exact ingredients, and reject unknown tags',()=>{
 const {controls:c,item,ingredient,recipe}=setup();c.items[15]=item('oak_planks',2);c.items[16]=item('birch_planks',2);
 const tag={type:'valid',descriptor_type:'item_tag',tag:'minecraft:planks',metadata:0,count:2};
 const r=recipe('stick',[tag,ingredient('oak_planks',2)],2,2,4);
 const a=allocateIngredients(r,c.items,c.registry);assert.equal(a.used.get(15),2);assert.equal(a.used.get(16),2);
 assert.throws(()=>allocateIngredients({...r,input:[{...tag,tag:'minecraft:unknown'}]},c.items,c.registry),/未対応/);
 c.items[15].has_stack_id=false;assert.throws(()=>allocateIngredients(r,c.items,c.registry),/所持ID/);
});
test('crafting, opening and closing packets roundtrip with correct created-output slot and stack IDs',()=>{
 const {controls:c,item,ingredient,recipe}=setup();c.items[10]=item('oak_log',2,99);
 const r=recipe('oak_planks',[ingredient('oak_log')],1,1,4),p=buildCraftRequest(r,c.items,c.registry,-3);
 const decoded=rt('item_stack_request',{requests:[p.request]}).requests[0];
 assert.equal(decoded.actions[0].type_id,'craft_recipe_auto');assert.equal(decoded.actions[0].ingredients[0].name,'minecraft:oak_log');
 assert.equal(decoded.actions[1].source.stack_id,99);assert.equal(decoded.actions[2].source.slot_type.container_id,'creative_output');assert.equal(decoded.actions[2].source.slot,50);
 rt('interact',{action_id:'open_inventory',target_entity_id:5n,has_position:false});
 rt('container_close',{window_id:'inventory',window_type:'inventory',server:false});
});
test('current crafting-data wire schema registers and clears server recipe network IDs',()=>{
 const {controls:c,client,item,ingredient,recipe}=setup();
 c.items[10]=item('oak_log',1);
 const r={...recipe('oak_planks',[ingredient('oak_log')],1,1,4),uuid:'00000000-0000-0000-0000-000000000000',priority:0,assume_symmetry:false};
 const packet={shaped_recipes:[r],shapeless_recipes:[],multi_recipes:[],shulker_box_recipes:[],shapeless_chemistry_recipes:[],shaped_chemistry_recipes:[],smithing_transform_recipes:[],smithing_trim_recipes:[],potion_type_recipes:[],potion_container_recipes:[],material_reducers:[],clear_recipes:true};
 client.emit('crafting_data',rt('crafting_data',packet));assert.equal(c.crafting.recipes.size,1);assert.equal(c.crafting.select('oak_planks',1).network_id,7);
 client.emit('crafting_data',{...packet,shaped_recipes:[],clear_recipes:true});assert.equal(c.crafting.recipes.size,0);
});
test('two server-confirmed recipe batches consume logs and create eight planks',async()=>{
 const {controls:c,client,item,ingredient,recipe,advertise,server}=setup();c.items[10]=item('oak_log',2);advertise(recipe('oak_planks',[ingredient('oak_log')],1,1,4));server();
 const result=await c.execute({type:'craft',item:'oak_planks',count:8},'Takken1212',new AbortController().signal);
 assert.equal(result.crafted,8);assert.equal(result.verification,'server_inventory');assert.equal(c.items[10].count,0);assert.equal(c.items[0].count,8);
 assert.equal(client.sent.filter(p=>p.name==='item_stack_request').length,2);assert.ok(client.sent.some(p=>p.name==='container_close'));
});
test('recipe units may exceed requested count and insufficient materials send no requests',async()=>{
 const {controls:c,client,item,ingredient,recipe,advertise,server}=setup();c.items[12]=item('oak_log',1);advertise(recipe('oak_planks',[ingredient('oak_log')],1,1,4));server();
 await assert.rejects(()=>c.crafting.craft('oak_planks',8,new AbortController().signal),/材料不足/);assert.equal(client.sent.length,0);
 const r=await c.crafting.craft('oak_planks',3,new AbortController().signal);assert.equal(r.crafted,4);assert.equal(r.requested,3);
});
test('missing workbench prevents tool crafting; nearby table is opened and server confirms tool',async()=>{
 const {controls:c,client,item,ingredient,recipe,advertise,server}=setup();c.items[0]=item('cobblestone',3);c.items[11]=item('stick',2);const r=recipe('stone_pickaxe',[ingredient('cobblestone',3),ingredient('stick',2)],3,3);advertise(r);c.block=()=>null;
 await assert.rejects(()=>c.crafting.craft('stone_pickaxe',1,new AbortController().signal),/作業台/);
 const table={name:'crafting_table',position:{x:2,y:64,z:0},runtimeId:15};c.block=p=>p.x===2&&p.y===64&&p.z===0?table:null;c.goto=async()=>{};
 server();const originalWait=c.wait;c.wait=async(...args)=>{if(c.pendingTransaction){c.pendingTransaction=null;client.emit('container_open',{window_id:2,window_type:'workbench'});}await originalWait(...args);};
 const result=await c.crafting.craft('stone_pickaxe',1,new AbortController().signal);assert.equal(result.crafted,1);assert.equal(c.items[1].network_id,c.registry.itemsByName.stone_pickaxe.id);
});
test('rejection and unconfirmed response never change inventory or report success, no automatic retry',async()=>{
 for(const options of [{reject:true},{noSlots:true}]){
  const {controls:c,client,item,ingredient,recipe,advertise,server}=setup();c.items[10]=item('oak_log',1);advertise(recipe('oak_planks',[ingredient('oak_log')],1,1,4));server(options);
  await assert.rejects(()=>c.crafting.craft('oak_planks',4,new AbortController().signal),options.reject?/拒否/:/確認できません/);assert.equal(c.items[10].count,1);assert.equal(c.items[0],undefined);
  assert.equal(client.sent.filter(p=>p.name==='item_stack_request').length,1);
  if(options.noSlots)await assert.rejects(()=>c.crafting.craft('oak_planks',4,new AbortController().signal),/前のクラフト/);
 }
});
test('abort closes UI and blocks repeat crafting when outcome is unknown',async()=>{
 const {controls:c,client,item,ingredient,recipe,advertise}=setup();c.items[10]=item('oak_log',1);advertise(recipe('oak_planks',[ingredient('oak_log')],1,1,4));const abort=new AbortController();
 client.queue=(name,p)=>{client.sent.push({name,p});if(name==='interact')client.emit('container_open',{window_id:'inventory',window_type:'inventory'});if(name==='item_stack_request')abort.abort();};
 await assert.rejects(()=>c.crafting.craft('oak_planks',4,abort.signal));assert.equal(c.crafting.pending,null);assert.equal(c.crafting.uncertain,true);assert.ok(client.sent.some(p=>p.name==='container_close'));assert.equal(c.items[10].count,1);
});
