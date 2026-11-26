import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directPlan,validatePlan} from '../src/action-agent.js';
import {RealmControls,emptyItem} from '../src/realm-controls.js';
import {AutoSurvival} from '../src/auto-survival.js';
import {EventEmitter} from 'node:events';
test('holding a tool is equipment and short copper mining is parsed without LLM',()=>{
 for(const text of ['石のツルハシを持って','インベントリから石のツルハシに持ち替えて'])assert.deepEqual(directPlan(text).actions,[{type:'equip',item:'stone_pickaxe'}]);
 assert.deepEqual(directPlan('銅鉱石掘って').actions,[{type:'mine',block:'copper_ore',count:1}]);
 const plan=directPlan('石のツルハシで銅の原石2つ掘って');assert.deepEqual(plan.actions,[{type:'mine',tool:'stone_pickaxe',block:'copper_ore',count:2}]);validatePlan(plan);
});
test('equipment reads real inventory, moves a non-hotbar tool and refuses absent items',async()=>{
 const client=new EventEmitter(),sent=[];client.queue=(name,p)=>sent.push({name,p});const c=new RealmControls(client);c.ready=true;c.health=20;
 c.items[12]={...emptyItem(),count:1,network_id:c.registry.itemsByName.stone_pickaxe.id};
 c.crafting.equipInventorySlot=async slot=>{assert.equal(slot,12);c.items[0]=c.items[12];return 0;};
 const result=await c.equipItem('stone_pickaxe');assert.equal(result.slot,0);assert.equal(sent.at(-1).name,'mob_equipment');
 await assert.rejects(()=>c.equipItem('diamond_pickaxe'),/受信済み/);
 await assert.rejects(()=>c.prepareMiningTool('diamond_ore',undefined,'stone_pickaxe'),/鉄以上/);
});
test('identical missing-food messages are suppressed for two minutes while attempts continue',async()=>{
 const client=new EventEmitter(),notices=[];client.on('taken_notice',n=>notices.push(n));let at=0,attempts=0;
 const c={ready:true,health:20,food:10,position:{x:0,y:64,z:0},slot:0,nearbyEntities:()=>[],stop:()=>{},eat:async()=>{attempts++;throw Error('no food');}};
 const auto=new AutoSurvival(client,c,{now:()=>at});
 await auto.tick();at=10000;await auto.tick();at=20000;await auto.tick();assert.equal(attempts,3);assert.equal(notices.length,1);
 at=120000;await auto.tick();assert.equal(notices.length,2);
});
