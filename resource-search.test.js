import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls,emptyItem} from './realm-controls.js';
import {resourceSpec} from './resource-search.js';
import {directPlan,validatePlan} from './action-agent.js';
function setup(){const client=new EventEmitter();client.queue=()=>{};const c=new RealmControls(client);c.ready=true;c.health=20;c.position={x:0.5,y:65.62,z:0.5};client.emit('inventory_content',{window_id:'inventory',input:[]});c.wait=async(ms,s)=>{c.check(s);};c.requestNearby=()=>{};c.goto=async(p)=>{c.position={...p,y:p.y+1.62};};c.walkable=()=>true;c.block=()=>null;
 const item=(name,n)=>({...emptyItem(),network_id:c.registry.itemsByName[name].id,count:n});return {client,c,item};}
test('Japanese resource search selects gather and shares the total mining budget',()=>{
 assert.deepEqual(directPlan('遠くのオークの原木を16個探して集めて').actions,[{type:'gather',block:'oak_log',count:16}]);assert.equal(directPlan('原鉄を3個探して回収して').actions[0].block,'raw_iron');assert.equal(directPlan('木を8個探して集めて').actions[0].block,'wood');
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'gather',block:'wood',count:64},{type:'mine',block:'dirt',count:1}]}));
 assert.deepEqual(resourceSpec('raw_iron'),{blocks:['iron_ore','deepslate_iron_ore'],items:['raw_iron']});assert.ok(resourceSpec('wood').blocks.includes('birch_log'));
});
test('exploration moves to a safe next point, mines only the selected block, and confirms inventory growth',async()=>{
 const {c,item}=setup(),search=c.resourceSearch;let mined=false;const ore={name:'iron_ore',position:{x:13,y:64,z:0}};c.pickaxeSlot=()=>0;
 search.nearby=()=>c.feet().x>10&&!mined?[ore]:[];search.next=()=>({target:{x:12.5,y:64,z:0.5},path:Array.from({length:13},()=>({x:1,y:64,z:0}))});search.approach=()=>({target:{x:12.5,y:64,z:0.5},path:[{}]});
 c.mine=async(name,count,s,options)=>{assert.equal(name,'iron_ore');assert.equal(count,1);assert.deepEqual(options.targetPosition,ore.position);mined=true;c.items[0]=item('raw_iron',1);return {broken:1};};
 const result=await search.gather('raw_iron',1,new AbortController().signal);assert.equal(result.explorationStops,1);assert.equal(result.broken,1);assert.equal(result.total,1);assert.equal(result.collected[0].item,'raw_iron');
});
test('no safe frontier fails without mining; buried ore is excluded',async()=>{
 const {c}=setup(),search=c.resourceSearch;search.nearby=()=>[];search.next=()=>null;c.mine=()=>{throw Error('must not mine');};await assert.rejects(()=>search.gather('oak_log',1),/見つかりません/);
 c.block=()=>({name:'stone',boundingBox:'block'});assert.equal(search.exposed({position:{x:0,y:64,z:0}}),false);
 c.block=p=>p.x===1?{name:'air',boundingBox:'empty'}:{name:'stone',boundingBox:'block'};assert.equal(search.exposed({position:{x:0,y:64,z:0}}),true);
});
test('confirmed block break without loot never claims requested items; insufficient pickaxe prevents exploration',async()=>{
 const {c}=setup(),search=c.resourceSearch;search.nearby=()=>[{name:'oak_log',position:{x:2,y:64,z:0}}];search.approach=()=>({target:{x:2.5,y:64,z:0.5},path:[{}]});c.mine=async()=>({broken:1});
 const r=await search.gather('oak_log',1);assert.equal(r.broken,1);assert.equal(r.total,0);assert.deepEqual(r.collected,[]);
 c.pickaxeSlot=()=>{throw Error('石以上のツルハシ');};await assert.rejects(()=>search.gather('raw_iron',1),/ツルハシ/);
});
test('exploration is bounded by forty-eight stops, cancellation prevents mining, and resource bounds exclude distant blocks',async()=>{
 const {c}=setup(),search=c.resourceSearch;search.nearby=()=>[];search.next=()=>({target:{x:1,y:64,z:0.5},path:[{},{}]});let moves=0;c.goto=async()=>{moves++;};await assert.rejects(()=>search.gather('oak_log',1),/探索地点/);assert.equal(moves,48);
 const abort=new AbortController();c.wait=async()=>{abort.abort();abort.signal.throwIfAborted();};moves=0;await assert.rejects(()=>search.gather('oak_log',1,abort.signal));assert.equal(moves,0);
});
test('mining selected exploration target never substitutes a nearer block of the same material',async()=>{
 const {c}=setup();const blocks=[{name:'dirt',position:{x:2,y:64,z:0},runtimeId:1},{name:'dirt',position:{x:3,y:64,z:0},runtimeId:1}];c.block=p=>blocks.find(b=>b.position.x===Math.floor(p.x)&&b.position.y===Math.floor(p.y)&&b.position.z===Math.floor(p.z)) || null;c.confirmBlock=async p=>assert.equal(p.x,3);c.pickup.collect=async()=>({total:0,collected:[]});
 const r=await c.mine('dirt',1,new AbortController().signal,{targetPosition:{x:3,y:64,z:0}});assert.equal(r.broken,1);
});
