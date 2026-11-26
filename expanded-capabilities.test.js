import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls,emptyItem} from './realm-controls.js';
import {attachAIChat} from './ai-chat.js';
import {validatePlan,directPlan} from './action-agent.js';
import {LIMITS,canonicalBlock} from './capabilities.js';
function client(){const c=new EventEmitter();c.profile={name:'TAKE6866',xuid:'123'};c.sent=[];c.queue=(name,p)=>c.sent.push({name,p});return c;}
const build=(w,h,d)=>({type:'build',block:'dirt',x:10,y:64,z:20,width:w,height:h,depth:d});
test('expanded budgets allow 64 mined or 256 placed blocks and reject aggregate overrun',()=>{
 assert.doesNotThrow(()=>validatePlan({reply:'',actions:[{type:'mine',block:'dirt',count:64},build(16,1,16)]}));
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'mine',block:'dirt',count:64},{type:'mine',block:'dirt',count:1}]}));
 assert.throws(()=>validatePlan({reply:'',actions:[build(16,1,16),build(1,1,1)]}));
 for(const action of [build(17,1,1),build(16,2,16),{type:'mine',block:'dirt',count:65},{type:'follow',seconds:121},{type:'combat',target:'zombie',seconds:61}])assert.throws(()=>validatePlan({reply:'',actions:[action]}));
 assert.doesNotThrow(()=>validatePlan({reply:'',actions:[{type:'follow',seconds:120},{type:'combat',target:'zombie',seconds:60}]}));
});
test('Japanese materials and common coordinate floor instructions map without LLM',()=>{
 assert.equal(directPlan('トウヒの原木を64個掘って').actions[0].block,'spruce_log');
 assert.equal(directPlan('深層岩の鉄鉱石を16個掘って').actions[0].block,'deepslate_iron_ore');
 assert.equal(canonicalBlock('古代の残骸'),'ancient_debris');
 assert.deepEqual(directPlan('x=10 y=64 z=20を角にして、オークの板材で16×16の床を作って').actions[0],{...build(16,1,16),block:'oak_planks'});
 assert.deepEqual(directPlan('座標10 64 20から土で8×4の壁を作って').actions[0],build(8,4,1));
 assert.deepEqual(directPlan('x=-104 y=72 z=309へ移動して').actions[0],{type:'move',x:-104,y:72,z:309});
});
test('executor rejects invalid counts even without planner validation',async()=>{
 const controls=new RealmControls(client());
 await assert.rejects(()=>controls.mine('dirt',65),/採掘/);
 await assert.rejects(()=>controls.build(build(16,2,16)),/256/);
 await assert.rejects(()=>controls.build(build(-1,1,1)),/寸法/);
});
test('ore tool selection skips inadequate picks and requires diamond for ancient debris',()=>{
 const controls=new RealmControls(client());
 for(const [slot,name] of [[0,'wooden_pickaxe'],[1,'iron_pickaxe']])controls.items[slot]={...emptyItem(),network_id:controls.registry.itemsByName[name].id,count:1};
 assert.equal(controls.pickaxeSlot('deepslate_iron_ore'),1);assert.equal(controls.pickaxeSlot('deepslate_diamond_ore'),1);
 assert.throws(()=>controls.pickaxeSlot('ancient_debris'),/ダイヤモンド/);
 controls.items[2]={...emptyItem(),network_id:controls.registry.itemsByName.diamond_pickaxe.id,count:1};assert.equal(controls.pickaxeSlot('ancient_debris'),2);
});
test('capability, inventory and recipe queries are deterministic and never invoke LLM',async()=>{
 const c=client(),controls=new RealmControls(c);controls.ready=true;controls.health=20;
 controls.items[0]={...emptyItem(),network_id:controls.registry.itemsByName.dirt.id,count:64};
 const ai=attachAIChat(c,{controls,fetchImpl:()=>{throw Error('must not call LLM');}});
 for(const instruction of ['対応範囲','持ち物','石のツルハシに必要な材料を教えて'])await ai.handle({type:'chat',source_name:'Takken1212',message:'!TAKEN '+instruction});
 const text=c.sent.filter(p=>p.name==='text').map(p=>p.p.message).join('');assert.match(text,/256/);assert.match(text,/土×64/);assert.match(text,/cobblestone×3/);assert.match(text,/stick×2/);assert.match(text,/通常クラフトに対応/);assert.equal(controls.status().limits,LIMITS);
});
