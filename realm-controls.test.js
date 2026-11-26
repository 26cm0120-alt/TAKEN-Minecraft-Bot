import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {RealmControls,inputPacket,useItemData,emptyItem} from './realm-controls.js';
import {validatePlan,runActions,directPlan} from './action-agent.js';
import {attachAIChat} from './ai-chat.js';
const require=createRequire(import.meta.url);
const {createSerializer,createDeserializer}=require('./node_modules/bedrock-protocol/src/transforms/serializer.js');
const {Vec3}=require('vec3');
const serializer=createSerializer('1.26.60'),deserializer=createDeserializer('1.26.60');
function roundtrip(name,params){return deserializer.parsePacketBuffer(serializer.createPacketBuffer({name,params})).data.params;}
function mockClient(){const c=new EventEmitter();c.queue=()=>{};c.profile={name:'TAKE6866',xuid:'123'};return c;}
test('current protocol movement, breaking, placement and equipment encode correctly',()=>{
  const item=emptyItem(),position={x:1.5,y:65.62,z:2.5},ref={position:{x:2,y:64,z:2},runtimeId:2706};
  for(const options of [{forward:true},{blockActions:[{action:'start_break',position:ref.position,face:1}]},
    {transaction:{legacy:{legacy_request_id:0},actions:[],data:useItemData(position,ref,1,0,item)}}]){
    const p=roundtrip('player_auth_input',inputPacket(position,1n,options));
    assert.equal(p.tick,1n);assert.ok(Math.abs(p.position.y-position.y)<0.00001);assert.equal(p.position.x,position.x);
    if(options.forward){assert.equal(p.move_vector.z,1);assert.equal(p.analogue_move_vector.z,1);assert.equal(p.raw_move_vector.z,1);}
  }
  roundtrip('mob_equipment',{runtime_entity_id:1n,item,slot:0,selected_slot:0,window_id:'inventory'});
  const attack=roundtrip('inventory_transaction',{transaction:{legacy:{legacy_request_id:0},actions:[],transaction_type:'item_use_on_entity',transaction_data:{entity_runtime_id:32n,action_type:'attack',hotbar_slot:0,held_item:item,player_pos:position,click_pos:{x:0,y:0,z:0}}}});
  assert.equal(attack.transaction.transaction_data.action_type,'attack');
  roundtrip('subchunk_request',{dimension:0,origin:{x:0,y:4,z:0},requests:[{x:0,y:0,z:0}]});
});
test('hashed subchunks preserve asymmetric world coordinates and unknown chunks stay unknown',async()=>{
  const c=mockClient(),controls=new RealmControls(c);
  c.emit('start_game',{itemstates:controls.registry.writeItemStates(),block_network_ids_are_hashes:true,player_position:{x:1,y:65.62,z:1},runtime_entity_id:1n});
  const p=new Vec3(3,64,7);
  const Stream=require('prismarine-chunk/src/bedrock/common/Stream');const s=new Stream();
  for(const byte of [9,1,4,3])s.writeUInt8(byte);
  const index=(3<<8)|(7<<4);for(let word=0;word<128;word++)s.writeUInt32LE(word===Math.floor(index/32)?(1<<(index%32))>>>0:0);
  s.writeZigZagVarInt(2);
  const writeHash=id=>s.writeVarInt(((id<<1)^(id>>31))>>>0);
  writeHash(controls.runtimeForState(controls.registry.blocksByName.air.defaultState)|0);
  writeHash(controls.runtimeForState(controls.registry.blocksByName.stone.defaultState)|0);
  const payload=s.getBuffer();
  await controls.loadSubchunks({dimension:0,cache_enabled:false,origin:{x:0,y:4,z:0},entries:[{dx:0,dy:0,dz:0,result:'success',payload}]});
  assert.equal(controls.block(p)?.name,'stone');
  assert.equal(controls.block({x:1000,y:64,z:1000}),null);
  const b=controls.block(p);assert.equal(controls.registry.blocksByRuntimeId[b.runtimeId|0].name,'stone');
});
test('combat tracks nearby mobs and sends an encoded attack transaction',async()=>{
  const c=mockClient(),sent=[];c.queue=(name,params)=>sent.push({name,params});
  const controls=new RealmControls(c);controls.ready=true;controls.position={x:0.5,y:65.62,z:0.5};controls.health=20;
  c.emit('add_entity',{entity_type:'minecraft:zombie',runtime_id:32n,unique_id:42n,position:{x:2,y:64,z:0.5},attributes:[]});
  controls.wait=async()=>c.emit('remove_entity',{entity_id_self:42n});
  const result=await controls.combat('zombie',1,new AbortController().signal);
  assert.deepEqual(result,{target:'zombie',attacks:1,removed:true,seconds:1});
  const packet=roundtrip('inventory_transaction',sent[0].params);
  assert.equal(sent[0].name,'inventory_transaction');
  assert.equal(packet.transaction.transaction_data.entity_runtime_id,32n);
  assert.equal(packet.transaction.transaction_data.action_type,'attack');
});
test('eating uses safe hotbar food and stops after hunger rises',async()=>{
  const c=mockClient(),sent=[];c.queue=(name,params)=>sent.push({name,params});
  const controls=new RealmControls(c);controls.ready=true;controls.position={x:1.5,y:65.62,z:2.5};controls.food=10;controls.health=20;
  controls.items[0]={...emptyItem(),network_id:controls.registry.itemsByName.bread.id,count:3};
  controls.wait=async(ms)=>{if(ms===1600){const transaction=controls.pendingTransaction;controls.pendingTransaction=null;
    const packet=roundtrip('player_auth_input',inputPacket(controls.position,1n,{transaction}));
    assert.equal(packet.transaction.data.action_type,'click_air');controls.food=Math.min(20,controls.food+5);}};
  const result=await controls.eat(new AbortController().signal);
  assert.deepEqual(result,{eaten:2,food:20});
  const releases=sent.filter(p=>p.name==='inventory_transaction');assert.equal(releases.length,2);
  for(const release of releases){const packet=roundtrip(release.name,release.params);assert.equal(packet.transaction.transaction_type,'item_release');assert.equal(packet.transaction.transaction_data.action_type,'release');}
});
test('movement refuses unknown ground and lava, and stops when canceled',async()=>{
  const controls=new RealmControls(mockClient());controls.ready=true;controls.position={x:0.5,y:65.62,z:0.5};
  assert.equal(controls.walkable(1.5,64,0.5),false);
  controls.block=p=>({name:p.y<64?'lava':'air',boundingBox:p.y<64?'block':'empty'});
  assert.equal(controls.walkable(1.5,64,0.5),false);
  controls.walkTarget={x:5,z:0};controls.stop();assert.equal(controls.walkTarget,null);
  const controller=new AbortController();controller.abort();assert.throws(()=>controls.check(controller.signal));
});
test('plans reject large builds, command injection, invalid coordinates and counts',()=>{
  for(const action of [{type:'build',block:'dirt',x:0,y:64,z:0,width:8,height:8,depth:8},
    {type:'command',command:'/op stranger'},{type:'move',x:'0',y:64,z:0},{type:'mine',block:'dirt',count:100},
    {type:'mine',block:'dirt; /kill',count:1}])assert.throws(()=>validatePlan({reply:'',actions:[action]}));
  assert.equal(validatePlan({reply:'開始',actions:[{type:'mine',block:'dirt',count:1}]}).actions.length,1);
  assert.throws(()=>validatePlan({reply:'開始',actions:[{type:'combat',target:'Takken1212',seconds:20}]}));
});
test('common Japanese commands reliably map to the intended operation',()=>{
  assert.equal(directPlan('こっちに来て').actions[0].type,'come');
  assert.deepEqual(directPlan('私についてきて15秒').actions[0],{type:'follow',seconds:15});
  assert.deepEqual(directPlan('近くの土をひとつだけ採掘してください').actions[0],{type:'mine',block:'dirt',count:1});
  assert.deepEqual(directPlan('近くのゾンビを攻撃して。20秒').actions[0],{type:'combat',target:'zombie',seconds:20});
  assert.deepEqual(directPlan('近くの牛を狩って').actions[0],{type:'combat',target:'cow',seconds:20});
  assert.deepEqual(directPlan('持っている食料を食べて').actions[0],{type:'eat'});
  const expected={type:'build',x:12,y:64,z:22,block:'dirt',width:2,height:1,depth:2};
  assert.deepEqual(directPlan('座標12 64 22から土で幅2 高さ1 奥行き2の床を作って').actions[0],expected);
  assert.deepEqual(directPlan('土で座標12,64,22に幅2、高さ1、奥行き2の床を設置して').actions[0],expected);
});
test('all Realm users can instruct when owners is *, and stop aborts their action',async()=>{
  const c=mockClient();let stopped=0,started=0;
  const controls={status:()=>({}),stop:()=>stopped++,execute:async(a,sender,signal)=>{started++;assert.equal(sender,'hei550');
    await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
  const ai=attachAIChat(c,{owners:['*'],controls,fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({reply:'開始',actions:[{type:'come'}]})}})})});
  const pending=ai.handle({type:'chat',source_name:'hei550§r',message:'!TAKEN こっちに来て'});
  await new Promise(r=>setImmediate(r));assert.equal(started,1);
  await ai.handle({type:'chat',source_name:'another user',message:'!stop'});await pending;assert.ok(stopped>=1);
});
test('failed action ends plan without starting later destructive actions',async()=>{
  let calls=0;const sent=[];
  await runActions({instruction:'test',sender:'hei550',model:'test',signal:new AbortController().signal,say:s=>sent.push(s),
    controls:{status:()=>({}),execute:async()=>{calls++;throw Error('unknown terrain');}},
    fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({reply:'開始',actions:[{type:'come'},{type:'mine',block:'dirt',count:1}]})}})})});
  assert.equal(calls,1);assert.match(sent.at(-1),/unknown terrain/);
});
