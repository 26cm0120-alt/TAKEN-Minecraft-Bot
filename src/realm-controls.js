import {attachMovementTelemetry,terrainSnapshot} from './movement-telemetry.js';
import {manageResources} from './resource-management.js';
import {supplyFood} from './food-supply.js';
import {displayItemName} from './item-dictionary.js';
import {miningTicks} from './mining-speed.js';
import {branchMine} from './branch-mining.js';
import {RealmBoat} from './realm-boat.js';
import {RealmFurnace} from './realm-furnace.js';
import {shouldAutoSprint} from './auto-sprint.js';
import {inWater,surfaceWalkable,advanceSurface} from './surface-swimming.js';
import {miningToolSlot} from './mining-tools.js';
import {travelFar} from './long-travel.js';
import {BedControl} from './bed-control.js';
import {ResourceSearch} from './resource-search.js';
import {RealmPickup} from './realm-pickup.js';
import {RealmCrafting} from './realm-crafting.js';
import {defenseTargets} from './auto-survival.js';
import {planStepPath,advanceStep,smoothStepPath,bodyClear,touchesClimbable} from './step-movement.js';
import {LIMITS,capabilitySummary} from './capabilities.js';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require = createRequire(import.meta.url);
const {Vec3} = require('vec3');
const registryFactory = require('prismarine-registry');
// 26.51 still uses v9 subchunks. The public loader has no 1.26 dispatch entry.
const chunkFactory = require('prismarine-chunk/src/bedrock/1.18/chunk');
const SubChunk = require('prismarine-chunk/src/bedrock/1.18/SubChunk');
const Stream = require('prismarine-chunk/src/bedrock/common/Stream');
const PalettedStorage = require('prismarine-chunk/src/bedrock/common/PalettedStorage');
const {StorageType} = require('prismarine-chunk/src/bedrock/common/constants');
class RuntimeSubChunk extends SubChunk {
  loadPalettedBlocks(layer,stream,bits,format) {
    if(format===StorageType.Runtime && bits===0) {
      const runtimeId=stream.readZigZagVarInt(),block=this.registry.blocksByRuntimeId[runtimeId];
      if(!block)throw Error(`未知のブロックID ${runtimeId}`);
      this.palette[layer]=[{...block,count:4096}];this.blocks[layer]=new PalettedStorage(1);return;
    }
    return super.loadPalettedBlocks(layer,stream,bits,format);
  }
}
const cleanName = name => String(name || '').replace(/§./g, '').replace(/^minecraft:/, '').trim();
const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const airNames = new Set(['air','cave_air','void_air']);
const hazardous = /lava|water|fire|cactus|magma|campfire|berry|powder_snow/;
const safeFood = new Set(['apple','baked_potato','beetroot','beetroot_soup','bread','carrot','cooked_beef','cooked_chicken','cooked_cod','cooked_mutton','cooked_porkchop','cooked_rabbit','cooked_salmon','cookie','dried_kelp','glow_berries','melon_slice','mushroom_stew','potato','pumpkin_pie','rabbit_stew','sweet_berries']);
export const emptyItem = () => ({network_id:0,count:0,metadata:0,has_stack_id:false,block_runtime_id:0,extra:{has_nbt:'false',can_place_on:[],can_destroy:[]}});
export function inputPacket(position, tick, {yaw=0,pitch=0,forward=false,grounded=false,jumpStarted=false,jumping=false,horizontalCollision=false,sprinting=false,startSprinting=false,stopSprinting=false,startSwimming=false,stopSwimming=false,ascending=false,delta={x:0,y:0,z:0},blockActions,transaction,teleport=false,receivedServerData=false}={}) {
  // Bedrock's Vec2f wire shape is {x,z}, not {x,y}. Passing y silently
  // serialized the forward component as an undefined/NaN second coordinate.
  return {pitch,yaw,position:{...position},head_yaw:yaw,move_vector:{x:0,z:forward?1:0},
    input_data:[...(sprinting?['sprinting','sprint_down']:[]),...(startSprinting?['start_sprinting']:[]),...(stopSprinting?['stop_sprinting']:[]),...(startSwimming?['start_swimming']:[]),...(stopSwimming?['stop_swimming']:[]),...(ascending?['ascend','want_up']:[]),...(receivedServerData?['received_server_data']:[]),...(forward?['up']:[]),...(grounded?['vertical_collision']:[]),...(jumpStarted?['start_jumping','jump_down','jump_pressed_raw']:[]),...(jumping?['jumping','want_up']:[]),...(horizontalCollision?['horizontal_collision']:[]),...(blockActions?['block_action']:[]),...(transaction?['item_interact']:[]),...(teleport?['handled_teleport']:[])],
    input_mode:'mouse',play_mode:'normal',interaction_model:'crosshair',interact_rotation:{x:pitch,z:yaw},tick,
    delta,transaction,block_action:blockActions,analogue_move_vector:{x:0,z:forward?1:0},raw_move_vector:{x:0,z:forward?1:0},
    camera_orientation:{x:-Math.sin(yaw*Math.PI/180)*Math.cos(pitch*Math.PI/180),y:-Math.sin(pitch*Math.PI/180),z:Math.cos(yaw*Math.PI/180)*Math.cos(pitch*Math.PI/180)}};
}
export function useItemData(position, reference, face, slot, item, action='click_block') {
  return {action_type:action,trigger_type:'player_input',block_position:{...reference.position},face,hotbar_slot:slot,
    hand:'main_hand',held_item:item || emptyItem(),player_pos:{...position},click_pos:{x:0.5,y:face===1?1:0.5,z:0.5},
    block_runtime_id:reference.runtimeId,client_prediction:'success',client_cooldown_state:'off'};
}
export class RealmControls {
  constructor(client, version='1.26.60', {now=Date.now,telemetry}={}) {
    this.client=client; this.registry=registryFactory(`bedrock_${version}`);
    this.Chunk=chunkFactory(this.registry); this.chunks=new Map(); this.loaded=new Set(); this.updates=new Map();
    this.players=new Map(); this.entities=new Map(); this.items=[]; this.slot=0; this.position=null; this.tick=0n; this.health=null; this.food=null;
    this.dimension=0; this.ready=false; this.walkTarget=null; this.pendingActions=[]; this.pendingTransaction=null;this.respawnRequested=false;
    this.now=now;this.deathHistory=[];this.deathRecorded=false;this.lastDeath=null;this.lastDeathWarningAt=null;this.lastRespawnPosition=null;
    this.respawnAttempts=0;this.respawnLastSent=null;this.respawnTimeoutNotified=false;
    this.respawnAwaitingHealth=false;this.respawnReadyAt=null;this.respawnHealthWarning=false;
    this.yaw=0;this.pitch=0;this.verticalVelocity=0;this.handledTeleport=false;this.corrections=0;this.requested=new Set();
    this.navigationMode='walk';this.wasSprinting=false;this.wasSwimming=false;this.autoSprintActive=false;
    this.movementInputs=0;this.serverMoves=0;this.serverPostMoves=0;this.serverPosition=null;this.lastAuthoritativePosition=null;this.lastAuthoritativeSource='';this.serverDataAckPending=true;this.loggedMoveSamples=0;this.loggedServerPostSamples=0;this.movementAuthority=null;
    client.on('start_game', p=>{
      this.registry.handleStartGame({...p,itemstates:p.itemstates || this.registry.writeItemStates()});
      this.runtimeIds=null;
      // PlayerInputTick is a per-client simulation clock, not the world's current_tick.
      this.position={...p.player_position};this.serverPosition={...p.player_position};this.lastAuthoritativePosition={...p.player_position};this.lastAuthoritativeSource='start_game';this.entityId=p.runtime_entity_id;this.tick=0n;
      this.dimension=typeof p.dimension==='number'?p.dimension:({'overworld':0,'nether':1,'the_nether':1,'the_end':2}[p.dimension]??0);
      this.authoritativeBreak=p.server_authoritative_block_breaking;this.yaw=p.rotation?.y ?? p.rotation?.z ?? 0;
      console.log('[操作診断:初期状態]',JSON.stringify({gamemode:p.player_gamemode,worldGamemode:p.world_gamemode,interactionsDisabled:p.disable_player_interactions,permission:p.permission_level,position:p.player_position,rewindHistorySize:p.rewind_history_size,authoritativeBreak:this.authoritativeBreak}));
    });
    client.on('set_movement_authority',p=>{
      this.movementAuthority=p.movement_authority;
      console.log('[移動方式]',JSON.stringify({authority:this.movementAuthority}));
    });
    client.on('item_registry',p=>{
      // Item registry updates must not change the block network ID mode.
      const existing=this.registry.blocksByRuntimeId;
      this.registry.handleStartGame({itemstates:p.itemstates,block_network_ids_are_hashes:false});
      this.registry.blocksByRuntimeId=existing;
    });
    client.on('level_chunk',p=>this.loadChunk(p));
    client.on('subchunk',p=>{this.loadSubchunks(p).catch(e=>console.error('地形読取:',e.message));});
    client.on('update_block',p=>{if(!p.layer) this.updates.set(key(p.position),p.block_runtime_id);});
    client.on('update_block_synced',p=>{if(!p.layer) this.updates.set(key(p.position),p.block_runtime_id);});
    this.boat=new RealmBoat(this,emptyItem);
    this.offhandItems=[];this.offhandKnown=false;
    client.on('start_game',()=>{this.offhandItems=[];this.offhandKnown=false;});
    client.on('inventory_content',p=>{if(p.window_id===119 || p.window_id==='offhand'){this.offhandItems=p.input;this.offhandKnown=p.input.length>0;}});
    client.on('inventory_slot',p=>{if((p.window_id===119 || p.window_id==='offhand') && p.slot===0){this.offhandItems[0]=p.item;this.offhandKnown=true;}});
    this.armorItems=[];this.armorKnown=new Set();
    client.on('start_game',()=>{this.armorItems=[];this.armorKnown.clear();});
    client.on('inventory_content',p=>{if(p.window_id===120 || p.window_id==='armor'){this.armorItems=p.input;this.armorKnown=new Set(p.input.slice(0,4).map((_,i)=>i));}});
    client.on('inventory_slot',p=>{if((p.window_id===120 || p.window_id==='armor') && p.slot<4){this.armorItems[p.slot]=p.item;this.armorKnown.add(p.slot);}});
    client.on('inventory_content',p=>{if(p.window_id===0 || p.window_id==='inventory') this.items=p.input;});
    client.on('inventory_slot',p=>{if(p.window_id===0 || p.window_id==='inventory') this.items[p.slot]=p.item;});
    client.on('add_player',p=>this.players.set(String(p.runtime_id),{name:cleanName(p.username),uniqueId:String(p.unique_id),position:{...p.position}}));
    client.on('add_entity',p=>{
      const name=cleanName(p.entity_type),info=this.registry.entitiesByName[name];
      this.entities.set(String(p.runtime_id),{runtimeId:p.runtime_id,uniqueId:String(p.unique_id),name,category:info?.type || 'unknown',position:{...p.position},health:p.attributes?.find(a=>a.name==='minecraft:health')?.current ?? null});
    });
    client.on('move_entity',p=>{const e=this.entities.get(String(p.runtime_entity_id));if(e&&p.position)e.position={...p.position};});
    client.on('move_entity_delta',p=>{const e=this.entities.get(String(p.runtime_entity_id));if(e)for(const k of ['x','y','z'])if(Number.isFinite(p[k]))e.position[k]=p[k];});
    client.on('move_player',p=>{
      if(String(p.runtime_id)===String(this.entityId)) {this.serverMoves++;this.position={...p.position};this.lastAuthoritativePosition={...p.position};this.lastAuthoritativeSource='move_player';this.handledTeleport=p.mode==='teleport';}
      else if(this.players.has(String(p.runtime_id))) this.players.get(String(p.runtime_id)).position={...p.position};
      else {const e=this.entities.get(String(p.runtime_id));if(e)e.position={...p.position};}
    });
    // In server-authoritative movement mode, the Realm reports its simulated
    // player position with ServerPlayerPostMovePosition instead of echoing a
    // MovePlayer packet for every input tick.
    client.on('server_post_move',p=>{
      if(!p?.position)return;
      this.serverPosition={...p.position};this.lastAuthoritativePosition={...p.position};this.lastAuthoritativeSource='server_post_move';this.serverPostMoves++;
      if(this.walkTarget && this.loggedServerPostSamples<3){
        this.loggedServerPostSamples++;
        console.log('[サーバー移動位置サンプル]',JSON.stringify({position:this.serverPosition,target:this.walkTarget,tick:String(this.tick)}));
      }
    });
    client.on('remove_entity',p=>{
      for(const [id,player] of this.players)if(player.uniqueId===String(p.entity_id_self))this.players.delete(id);
      for(const [id,e] of this.entities)if(e.uniqueId===String(p.entity_id_self))this.entities.delete(id);
    });
    client.on('correct_player_move_prediction',p=>{if(p.prediction_type==='player'){this.position={...p.position};this.lastAuthoritativePosition={...p.position};this.lastAuthoritativeSource='correct_player_move_prediction';if(Number.isFinite(p.delta?.y))this.verticalVelocity=p.delta.y;this.corrections++;
      const f=this.feet();
      if(this.walkTarget && touchesClimbable(q=>this.block(q),f.x,f.y,f.z)){
        this.stop();this.verticalVelocity=0;
        console.log('[移動診断:登攀停止]',JSON.stringify({position:f,reason:'ツタなどへの接触を検知したため前進停止'}));
      }
      if(this.corrections<=3)console.log('[操作診断:座標補正]',JSON.stringify({position:p.position,tick:String(p.tick)}));}});
    client.on('respawn',p=>{
      console.log('[操作診断:リスポーン]',JSON.stringify({state:p.state,position:p.position,runtimeId:String(p.runtime_entity_id),botRuntimeId:String(this.entityId)}));
      // A zero runtime ID does not identify a different actor. Keep the known
      // start_game ID in our response instead of dropping this handshake.
      if(p.runtime_entity_id!==undefined && String(p.runtime_entity_id)!=='0' && String(p.runtime_entity_id)!==String(this.entityId)){
        console.log('[操作診断:リスポーン除外] BotのIDと異なる非ゼロIDです。');return;
      }
      if(p.state===0){
        if(!this.respawning)client.emit('taken_respawning');
        this.stop();this.pendingActions=[];this.verticalVelocity=0;this.respawning=true;
        // SearchingForSpawn must be answered with ClientReadyToSpawn first.
        this.respawnRequestPosition={...p.position};
        if(!this.respawnRequested)this.sendRespawnRequest();
        return;
      }
      if(p.state!==1)return;
      // After server ReadyToSpawn, complete the handshake with PlayerAction.
      this.stop();this.pendingActions=[];this.position={...p.position};this.serverPosition={...p.position};this.lastAuthoritativePosition={...p.position};this.lastAuthoritativeSource='respawn';this.handledTeleport=true;
      this.lastRespawnPosition=this.feet();this.verticalVelocity=0;
      client.queue('player_action',{runtime_entity_id:this.entityId,action:'respawn',position:{x:0,y:0,z:0},result_position:{x:0,y:0,z:0},face:0});
      // A readiness packet supplies a location, not proof that the dead actor
      // has become alive. Keep receiving stationary input/ack packets while
      // refusing new jobs until the server reports positive health.
      this.respawnAwaitingHealth=this.health===0 || this.deathRecorded;
      if(!(this.health>0))this.health=null;
      this.respawnReadyAt=this.respawnAwaitingHealth?this.now():null;this.respawnHealthWarning=false;
      this.respawning=false;this.respawnRequested=false;
      this.respawnAttempts=0;this.respawnLastSent=null;this.respawnTimeoutNotified=false;
      console.log('[参加同期] 復活確定要求(player_action:respawn)を送信しました。');
    });
    client.on('update_attributes',p=>{if(String(p.runtime_entity_id)===String(this.entityId)) for(const a of p.attributes) {
      if(a.name==='minecraft:health')this.observeHealth(a.current);
      if(a.name==='minecraft:player.hunger')this.food=a.current;
    }});
    client.on('change_dimension',p=>{this.stop();this.verticalVelocity=0;this.dimension=p.dimension;this.position={...p.position};this.serverPosition=null;this.lastAuthoritativePosition=null;this.lastAuthoritativeSource='';this.players.clear();this.entities.clear();this.chunks.clear();this.loaded.clear();this.updates.clear();this.requested.clear();this.terrainRequestTimes?.clear();});
    client.on('spawn',()=>{this.ready=true;clearInterval(this.interval);
      // Completing resource packs / local player initialization does not close the loading screen.
      // Current optional-ID wire format: Unknown=0, Start=1, End=2.
      // No ID is supplied for the initial world entry.
      client.queue('serverbound_loading_screen',{type:2});
      this.handledTeleport=true;
      console.log('[参加同期] 読込完了(type=2)を送信。入力データ受信確認を毎 tick 送信します。');
      this.interval=setInterval(()=>{
      try{this.step();}catch(e){this.stop();console.error('Bot操作:',e.message);}
    },50);this.interval.unref();});
    client.on('close',()=>{this.ready=false;clearInterval(this.interval);this.stop();});
    this.crafting=new RealmCrafting(this);this.furnace=new RealmFurnace(this);this.pickup=new RealmPickup(this);this.resourceSearch=new ResourceSearch(this);this.bed=new BedControl(this);
    this.telemetry=attachMovementTelemetry(this,telemetry);
  }
  sendRespawnRequest() {
    if(this.entityId===undefined || this.entityId===null)return;
    const position=this.respawnRequestPosition || this.position;
    if(!position)return;
    this.client.queue('respawn',{position:{...position},state:2,runtime_entity_id:this.entityId});
    this.respawnRequested=true;this.respawnAttempts++;this.respawnLastSent=this.now();
    console.log('[参加同期] リスポーン要求を送信しました。',JSON.stringify({attempt:this.respawnAttempts,packet:'respawn',state:2}));
  }
  serviceRespawn() {
    // A confirmed own death may arrive without a following state-0 packet.
    // Let the final death packets settle, then initiate the same bounded
    // respawn handshake instead of remaining invisible indefinitely.
    if(this.ready && this.health===0 && this.deathRecorded && this.lastDeath && !this.respawnRequested && !this.respawnAwaitingHealth && this.now()-this.lastDeath.at>=1000){
      this.respawning=true;this.stop();this.sendRespawnRequest();
    }
    if(this.ready && this.respawnAwaitingHealth && this.respawnReadyAt!==null && this.now()-this.respawnReadyAt>=15000 && !this.respawnHealthWarning){
      this.respawnHealthWarning=true;
      console.log('[リスポーン診断:体力未確認]',JSON.stringify({health:this.health,position:this.lastRespawnPosition}));
      this.client.emit('taken_notice',{message:'復活準備への返答は送信しましたが、体力の回復を確認できていません。Botを再接続してください。起動画面の[リスポーン診断:体力未確認]を確認できます。'});
      this.client.emit('taken_reconnect_required','respawn_health_timeout');
    }
    if(!this.ready || !this.respawning || !this.respawnRequested || this.respawnLastSent===null)return;
    if(this.now()-this.respawnLastSent<5000)return;
    if(this.respawnAttempts<3){this.sendRespawnRequest();return;}
    if(!this.respawnTimeoutNotified){
      this.respawnTimeoutNotified=true;
      console.log('[リスポーン診断:待機超過]',JSON.stringify({attempts:this.respawnAttempts,health:this.health}));
      this.client.emit('taken_notice',{message:'リスポーン要求を3回送信しましたが、Realmから復活準備の返答がありません。Botを終了してRealmsAI起動.batで再接続してください。復活地点に頭上2ブロックの空間があるかも確認してください。'});
      this.client.emit('taken_reconnect_required','respawn_readiness_timeout');
    }
  }
  observeHealth(value) {
    if(!Number.isFinite(value) || value<0)return;
    const previous=this.health;this.health=value;
    if(value>0 && Number.isFinite(previous) && value<previous)this.client.emit('taken_damage',{before:previous,health:value});
    if(value>0){
      this.deathRecorded=false;
      if(this.respawnAwaitingHealth){
        this.respawnAwaitingHealth=false;this.respawnReadyAt=null;this.respawnHealthWarning=false;
        const p=this.lastRespawnPosition;
        console.log('[リスポーン診断:復活確認]',JSON.stringify({health:value,position:p}));
        this.client.emit('taken_notice',{message:'サーバーから体力'+value+'を受信し、復活を確認しました。'+(p?'復活地点: '+p.x.toFixed(1)+', '+p.y.toFixed(1)+', '+p.z.toFixed(1)+'。':'')+'姿が見えない場合は、この地点と !TAKEN 状態 の座標を確認してください。'});
      }
      return;
    }
    // Only a health=0 update addressed to this Bot confirms a death. Login
    // respawn packets and translated death chat may concern another player.
    if(this.deathRecorded)return;
    this.deathRecorded=true;this.respawnAwaitingHealth=false;this.respawnReadyAt=null;this.stop();this.pendingActions=[];this.verticalVelocity=0;
    const at=this.now(),death={at,position:this.feet(),nearby:this.nearbyEntities(24).slice(0,5).map(e=>({name:e.name,distance:Number(e.distance.toFixed(1))}))};
    this.deathHistory=this.deathHistory.filter(d=>at-d.at<120000);this.deathHistory.push(death);this.lastDeath=death;
    const count=this.deathHistory.length;
    console.log('[生存診断:死亡]',JSON.stringify({...death,recentDeaths:count}));
    this.client.emit('taken_death',death);
    if(count>=3){
      if(this.lastDeathWarningAt===null || at-this.lastDeathWarningAt>=120000){
        this.lastDeathWarningAt=at;
        this.client.emit('taken_notice',{message:'Bot自身の体力0を直近2分で'+count+'回確認しました。復活地点を壁や屋根で保護し、周囲を確認してください。近接防衛だけでは防げない危険があります。'});
      }
    }else this.client.emit('taken_notice',{message:'Botの体力0を確認しました。作業を中止して復活処理を待ちます。!TAKEN 状態 で確認できます。'});
  }
  survivalStatus() {
    const at=this.now();this.deathHistory=this.deathHistory.filter(d=>at-d.at<120000);
    return {recentDeaths:this.deathHistory.length,deathLoop:this.deathHistory.length>=3,
      lastDeathPosition:this.lastDeath?.position?{...this.lastDeath.position}:null,
      lastRespawnPosition:this.lastRespawnPosition?{...this.lastRespawnPosition}:null};
  }
  column(x,z) {const k=`${x},${z}`;if(!this.chunks.has(k))this.chunks.set(k,new this.Chunk({x,z}));return this.chunks.get(k);}
  clearTerrainUpdates(x,z,y){
    for(const k of this.updates.keys()){const [bx,by,bz]=k.split(',').map(Number);if(Math.floor(bx/16)===x&&Math.floor(bz/16)===z&&(y===undefined||Math.floor(by/16)===y))this.updates.delete(k);}
  }
  loadChunk(p) {
    if(p.dimension!==this.dimension)return;
    const n=p.sub_chunk_count>>>0;
    if(n<256 && !p.cache_enabled) {
      try {const c=this.column(p.x,p.z),stream=new Stream(p.payload);
        for(let i=0;i<n;i++) {const section=this.decodeSection(stream);c.setSection(section.y,section);this.clearTerrainUpdates(p.x,p.z,section.y);this.loaded.add(`${p.x},${section.y},${p.z}`);}
      }catch(e){console.error('チャンク読取:',e.message);}
    }
    if(this.position)this.requestNearby();
  }
  async loadSubchunks(p) {
    if(p.dimension!==this.dimension || p.cache_enabled)return;
    for(const e of p.entries){const x=p.origin.x+e.dx,y=p.origin.y+e.dy,z=p.origin.z+e.dz;
      if(e.result==='success_all_air') {this.column(x,z).newSection(y);this.clearTerrainUpdates(x,z,y);this.loaded.add(`${x},${y},${z}`);}
      else if(e.result==='success' && e.payload) {
        const section=this.decodeSection(new Stream(e.payload));
        if(section.y!==y){const error=Error('サブチャンクの高さが一致しません。');this.telemetry?.terrainError(error);throw error;}
        this.column(x,z).setSection(y,section);this.clearTerrainUpdates(x,z,y);this.loaded.add(`${x},${y},${z}`);
      }
    }
  }
  decodeSection(stream) {
    try {
    const section=new RuntimeSubChunk(this.registry,require('prismarine-block')(this.registry),{y:0,subChunkVersion:9});
    section.decode(StorageType.Runtime,stream);if(section.y>=128)section.y-=256;return section;
    }catch(error){this.telemetry?.terrainError(error);throw error;}
  }
  requestNearby() {
    if(!this.position)return;
    const origin={x:Math.floor(this.position.x/16),y:Math.floor(this.position.y/16),z:Math.floor(this.position.z/16)};
    const requests=[],now=Date.now();this.terrainRequestTimes??=new Map();
    for(let x=-2;x<=2;x++)for(let y=-1;y<=1;y++)for(let z=-2;z<=2;z++) {
      const k=`${origin.x+x},${origin.y+y},${origin.z+z}`;
      if(!this.loaded.has(k)&&(!this.terrainRequestTimes.has(k)||now-this.terrainRequestTimes.get(k)>=10000)){requests.push({x,y,z});this.requested.add(k);this.terrainRequestTimes.set(k,now);}
    }
    if(requests.length)this.client.queue('subchunk_request',{dimension:this.dimension,origin,requests});
    // Keep world memory local to the Bot.
    if(this.chunks.size>100)for(const [k,c] of this.chunks)if(Math.abs(c.x-origin.x)>5 || Math.abs(c.z-origin.z)>5){
      this.chunks.delete(k);this.clearTerrainUpdates(c.x,c.z);for(const s of this.requested)if(s.startsWith(`${c.x},`)&&s.endsWith(`,${c.z}`)){this.requested.delete(s);this.terrainRequestTimes.delete(s);}for(const s of this.loaded)if(s.startsWith(`${c.x},`)&&s.endsWith(`,${c.z}`))this.loaded.delete(s);
    }
  }
  block(p) {
    p={x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)};
    const runtimeId=this.updates.get(key(p));
    if(runtimeId!==undefined) {const info=this.registry.blocksByRuntimeId[runtimeId] || this.registry.blocksByRuntimeId[runtimeId|0];return info?{...info,position:p,runtimeId}:null;}
    const cx=Math.floor(p.x/16),cy=Math.floor(p.y/16),cz=Math.floor(p.z/16);
    if(!this.loaded.has(`${cx},${cy},${cz}`))return null;
    const c=this.chunks.get(`${cx},${cz}`);if(!c)return null;
    const b=c.getBlock(new Vec3(p.x&15,p.y,p.z&15));
    // Read-only chunks expose local state IDs; convert to the server runtime mapping.
    const state=this.registry.blockStates[b.stateId];
    const rid=this.registry.supportFeature('blockHashes') && this.registry.blocksByRuntimeId
      ? this.runtimeForState(b.stateId) : b.stateId;
    if(rid===undefined)return null;
    return {...b,name:state?.name || b.name,position:p,runtimeId:rid};
  }
  runtimeForState(stateId) {
    if(!this.runtimeIds){this.runtimeIds=new Map();for(const [id,b] of Object.entries(this.registry.blocksByRuntimeId))this.runtimeIds.set(b.stateId,Number(id)>>>0);}
    return this.runtimeIds.get(stateId);
  }
  feet() {return this.position?{x:this.position.x,y:this.position.y-1.62,z:this.position.z}:null;}
  walkable(x,y,z) {
    if(!bodyClear(p=>this.block(p),x,y,z))return false;
    for(const ox of [-0.29,0.29])for(const oz of [-0.29,0.29]) {
      const floor=this.block({x:x+ox,y:y-0.05,z:z+oz});
      if(!floor || floor.boundingBox!=='block' || hazardous.test(floor.name))return false;
    }
    return true;
  }
  step() {
    this.serviceRespawn();
    if(!this.ready || !this.position || this.respawning || (this.health===0 && !this.respawnAwaitingHealth))return;
    // ReadyToSpawn can be followed by a stale zero-health packet. Continue
    // stationary acknowledgements, but never execute work before health returns.
    if(this.respawnAwaitingHealth){this.stop();this.pendingActions=[];this.verticalVelocity=0;}
    const old={...this.position};let forward=false,jumpStarted=false,jumping=false,horizontalCollision=false,swimming=false,ascending=false;
    const wet=inWater(p=>this.block(p),this.feet());
    const autoSprint=shouldAutoSprint(this);
    if(autoSprint!==this.autoSprintActive)console.log('[移動切替]',JSON.stringify({mode:autoSprint?'ダッシュ':'歩行',food:this.food,target:this.walkTarget}));
    this.autoSprintActive=autoSprint;
    const sprintAllowed=(this.navigationMode==='sprint' || autoSprint) && this.food!==null && this.food>6;
    if(!this.boat?.mounted && !this.respawnAwaitingHealth && (this.walkTarget || this.verticalVelocity!==0 || wet)){
      const t=this.walkTarget;
      if(t && Math.hypot(t.x-this.position.x,t.z-this.position.z)>0.08)this.yaw=Math.atan2(-(t.x-this.position.x),t.z-this.position.z)*180/Math.PI;
      const d=t?Math.hypot(t.x-this.position.x,t.z-this.position.z):0;
      const next=d?{x:this.position.x+(t.x-this.position.x)/d*0.13,y:this.feet().y,z:this.position.z+(t.z-this.position.z)/d*0.13}:this.feet();
      const useWater=wet || (this.navigationMode==='swim' && t && (Math.abs(t.y-this.feet().y)<0.15 || inWater(p=>this.block(p),t)||inWater(p=>this.block(p),next)));
      const motion=useWater?advanceSurface(this,this.feet(),t):advanceStep(p=>this.block(p),this.feet(),t,this.verticalVelocity,{sprint:sprintAllowed});
      swimming=Boolean(motion.swimming);ascending=Boolean(motion.ascending);
      this.position={x:motion.feet.x,y:motion.feet.y+1.62,z:motion.feet.z};this.verticalVelocity=motion.velocity;
      forward=motion.forward;jumpStarted=motion.jumpStarted;jumping=motion.jumping;horizontalCollision=motion.blocked;
      if(motion.blocked && !motion.jumping && !motion.forward)this.walkTarget=null;
    }
    const blockActions=this.pendingActions.length?this.pendingActions.splice(0):undefined;
    const transaction=this.pendingTransaction;this.pendingTransaction=null;
    const feet=this.feet();
    const grounded=Boolean(feet && this.walkable(feet.x,feet.y,feet.z));
    const tick=++this.tick;
    const sprinting=sprintAllowed && forward && !swimming;
    const packet=inputPacket(this.position,tick,{yaw:this.yaw,pitch:this.pitch,forward,grounded,jumpStarted,jumping,horizontalCollision,
      sprinting,startSprinting:sprinting&&!this.wasSprinting,stopSprinting:!sprinting&&this.wasSprinting,startSwimming:swimming&&!this.wasSwimming,stopSwimming:!swimming&&this.wasSwimming,ascending,
      delta:{x:this.position.x-old.x,y:this.position.y-old.y,z:this.position.z-old.z},blockActions,transaction,teleport:this.handledTeleport,
      receivedServerData:this.serverDataAckPending});
    const packetType=this.movementAuthority==='client'?'move_player':'player_auth_input';
    if(packetType==='move_player') this.client.queue('move_player',{runtime_id:this.entityId,position:{...this.position},pitch:this.pitch,yaw:this.yaw,head_yaw:this.yaw,mode:'normal',on_ground:grounded,ridden_runtime_id:0,tick});
    else this.client.queue('player_auth_input',packet);
    this.telemetry?.input(packet,{packetType,walking:!!this.walkTarget||forward,target:this.walkTarget,sprinting,terrain:()=>terrainSnapshot(this,this.position)});
    this.wasSprinting=sprinting;this.wasSwimming=swimming;
    if(forward && this.loggedMoveSamples<3){this.loggedMoveSamples++;console.log('[歩行入力サンプル]',JSON.stringify({packetType,authority:this.movementAuthority,position:packet.position,yaw:packet.yaw,move:packet.move_vector,analog:packet.analogue_move_vector,grounded,flags:packet.input_data,delta:packet.delta,tick:String(packet.tick)}));}
    this.serverDataAckPending=false;
    this.handledTeleport=false;
    if(forward)this.movementInputs++;
    if(this.tick%40n===0n)this.requestNearby();
  }
  stop() {this.walkTarget=null;this.pendingTransaction=null;this.navigationMode='walk';this.autoSprintActive=false;
    if(this.digging)this.pendingActions.push({action:'abort_break',position:this.digging.position,face:1});this.digging=null;}
  check(signal,{allowLowHealth=false,allowSleeping=false}={}) {signal?.throwIfAborted();if(this.sleeping&&!allowSleeping)throw Error('ベッドで睡眠中です。!TAKEN 起きて で起床してください。');if(!this.ready)throw Error('Realmに接続していません。');if(this.respawning || this.health===0 || this.respawnAwaitingHealth)throw Error('死亡・リスポーン準備中です。少し待ってください。');if(!allowLowHealth&&!this.emergencySignals?.has(signal)&&this.health!==null && this.health<=8)throw Error('体力が少ないため操作を停止しました。');}
  async wait(ms,signal,options){await delay(ms,undefined,{signal});this.check(signal,options);}
  status(){const f=this.feet();return {position:f,health:this.health,food:this.food,respawning:this.respawning || this.health===0 || this.respawnAwaitingHealth,respawnAwaitingHealth:this.respawnAwaitingHealth,lastRespawnPosition:this.lastRespawnPosition,...this.survivalStatus(),terrainSections:this.loaded.size,
    hotbar:this.items.slice(0,9).map((i,slot)=>({slot,name:this.registry.items[i?.network_id]?.name || 'air',count:i?.count || 0})),
    players:[...this.players.values()].map(p=>({name:p.name,position:p.position})),nearbyEntities:this.nearbyEntities(24).length,
    sleeping:Boolean(this.sleeping),automatic:this.autoSurvival?.status(),limits:LIMITS,capabilities:capabilitySummary()};}
  nearbyEntities(maxDistance=24){const f=this.feet();if(!f)return[];return [...this.entities.values()].map(e=>({...e,distance:distance(f,e.position)})).filter(e=>e.distance<=maxDistance).sort((a,b)=>a.distance-b.distance);}
  recipeSummary(name){
    const recipes=Object.values(this.registry.recipes || {}).filter(r=>/craft/.test(r.type || '') && r.output?.some(o=>o.name===name || (name==='oak_planks' && o.name==='planks' && (o.metadata??0)===0))).slice(0,3);
    if(!recipes.length)return name+'の登録レシピが見つかりません。通常クラフトに対応。3×3レシピには近くの作業台が必要です。';
    return '登録レシピ例: '+recipes.map(r=>r.ingredients.map(i=>i.name+'×'+i.count).join(' + ')+' → '+r.output.map(o=>o.name+'×'+o.count).join(' + ')).join(' / ')+'。これは材料の案内です。通常クラフトに対応。3×3レシピには近くの作業台が必要です。';
  }
  inventorySummary({english=false}={}){
    const entries=this.items.slice(0,36).map((i,slot)=>({slot,name:english?(this.registry.items[i?.network_id]?.name || 'unknown'):displayItemName(this.registry.items[i?.network_id]?.name || 'unknown'),count:i?.count || 0})).filter(i=>i.count>0);
    return entries.length?'持ち物: '+entries.map(i=>(i.slot<9?'ホットバー':'所持枠')+(i.slot+1)+' '+i.name+'×'+i.count).join('、'):'持ち物は空、または未受信です。';
  }
  nearbySummary() {
    const f=this.feet();if(!f)return '位置がまだ取得できていません。';
    const name=p=>this.block(p)?.name || '未取得';
    const floor=name({x:f.x,y:f.y-0.05,z:f.z});
    const body=name({x:f.x,y:f.y+0.05,z:f.z});
    const directions=[[1,0,'東'],[-1,0,'西'],[0,1,'南'],[0,-1,'北']].map(([x,z,label])=>{
      const p={x:Math.floor(f.x)+x+0.5,y:f.y,z:Math.floor(f.z)+z+0.5};
      return `${label}: 足場${name({...p,y:p.y-0.05})} / 体${name({...p,y:p.y+0.05})} / ${this.walkable(p.x,p.y,p.z)?'歩行可':'歩行不可'}`;
    });
    const mobs=this.nearbyEntities(24).slice(0,8).map(e=>`${e.name} ${e.distance.toFixed(1)}m`).join('、') || 'なし';
    return `足元: ${floor} / 体の位置: ${body}。${directions.join('。')}。近くのモブ: ${mobs}`;
  }
  mineMatches(requested,block) {return block && (block.name===requested || (requested==='dirt' && ['grass_block','grass'].includes(block.name)));}
  supportsPlayer(p) {
    const f=this.feet();return p.y===Math.floor(f.y-0.05) &&
      p.x>=Math.floor(f.x-0.29)&&p.x<=Math.floor(f.x+0.29)&&p.z>=Math.floor(f.z-0.29)&&p.z<=Math.floor(f.z+0.29);
  }
  player(name) {const p=[...this.players.values()].find(p=>p.name.toLowerCase()===cleanName(name).toLowerCase());if(!p)throw Error('そのプレイヤーの位置が見えていません。Botの近くへ来てください。');return p;}
  async goto(target,signal,radius=0.6,replan=0) {
    const measurement=this.telemetry?.beginMove(target);let outcome='failed';
    try {
      const result=await RealmControls.prototype.gotoUnmeasured.call(this,target,signal,radius,replan);outcome='completed';return result;
    }finally{this.telemetry?.endMove(measurement,signal?.aborted?'aborted':outcome);}
  }
  async gotoUnmeasured(target,signal,radius=0.6,replan=0) {
    this.check(signal);this.requestNearby();await this.wait(400,signal);
    const f=this.feet();if(distance(f,target)>24)return travelFar(this,target,signal,radius);
    if(Math.abs(target.y-f.y)>8)throw Error('移動先との高低差は8ブロック以内です。1段ずつの安全な経路が必要です。');
    const initialAuthoritativePosition=this.lastAuthoritativePosition?{...this.lastAuthoritativePosition}:null;
    // Mining/building/combat request a reach radius, not movement for its own
    // sake. If the server already places us in range, no coordinate change is
    // expected. Never accept a locally predicted position on its own.
    if(initialAuthoritativePosition){
      const authoritativeFeet={...initialAuthoritativePosition,y:initialAuthoritativePosition.y-1.62};
      if(Math.hypot(f.x-target.x,f.z-target.z)<=radius+0.3 &&
        Math.hypot(authoritativeFeet.x-target.x,authoritativeFeet.z-target.z)<=radius+0.3 &&
        Math.abs(authoritativeFeet.y-target.y)<=0.2){
        return {position:authoritativeFeet,authoritativePosition:initialAuthoritativePosition,verification:'server_position_already_in_range',moved:false};
      }
    }
    const initialServerMoves=this.serverMoves,initialServerPostMoves=this.serverPostMoves,initialCorrections=this.corrections;
    const planner=this.navigationMode==='swim'?{feet:()=>this.feet(),walkable:(x,y,z)=>surfaceWalkable(this,x,y,z),block:p=>{const b=this.block(p);return b&&/^(flowing_)?water$/.test(b.name)?{...b,name:'air',boundingBox:'empty'}:b;}}:this;
    const path=planStepPath(planner,target,radius);
    if(!path){console.log('[足場診断]',this.nearbySummary());throw Error('安全な経路がありません。1ブロックずつの段差、頭上の空間、読み取れた足場が必要です。');}
    const deadline=Date.now()+30000,corrections=this.corrections;
    try{for(const p of smoothStepPath(path)){this.walkTarget={x:p.x+0.5,y:p.y,z:p.z+0.5};
      while(Math.hypot(this.position.x-this.walkTarget.x,this.position.z-this.walkTarget.z)>0.15 || Math.abs(this.feet().y-p.y)>0.12 || this.verticalVelocity!==0){
        if(Date.now()>deadline || this.corrections-corrections>15)throw Error('移動がサーバーに受け入れられないため停止しました。');
        await this.wait(50,signal);if(!this.walkTarget)throw Error('前方の足場を確認できないため停止しました。');
      }
    }}catch(e){
      if(!signal?.aborted && replan<2 && e.message==='前方の足場を確認できないため停止しました。'){
        this.walkTarget=null;this.requestNearby();await this.wait(400,signal);
        console.log('[移動診断:再計画]',JSON.stringify({attempt:replan+1,target}));
        return this.goto(target,signal,radius,replan+1);
      }
      throw e;
    }finally{this.walkTarget=null;}
    if(Math.hypot(this.position.x-target.x,this.position.z-target.z)>radius+0.3)throw Error('目的地への到着を確認できません。');
    // Do not report locally predicted movement as a completed server move.
    // Realms may publish the authoritative position through either packet.
    const verifyUntil=Date.now()+2000;
    while(Date.now()<verifyUntil){
      const a=this.lastAuthoritativePosition || this.serverPosition;
      const received=this.serverPostMoves!==initialServerPostMoves || this.serverMoves!==initialServerMoves || this.corrections!==initialCorrections;
      if(received && a && Math.hypot(a.x-target.x,a.z-target.z)<=radius+0.3 && Math.abs(a.y-1.62-target.y)<=0.3)break;
      await this.wait(50,signal);
    }
    const authoritativePosition=this.lastAuthoritativePosition || this.serverPosition;
    const serverMoved=initialAuthoritativePosition&&authoritativePosition &&
      Math.hypot(authoritativePosition.x-initialAuthoritativePosition.x,authoritativePosition.z-initialAuthoritativePosition.z)>0.25;
    const diagnostics={predictedPosition:this.feet(),authoritativePosition,authoritativeSource:this.lastAuthoritativeSource,
      serverMoves:this.serverMoves-initialServerMoves,serverPostMoves:this.serverPostMoves-initialServerPostMoves,
      corrections:this.corrections-initialCorrections,serverMoved:Boolean(serverMoved)};
    console.log('[移動診断:結果]',JSON.stringify(diagnostics));
    if(!serverMoved && this.corrections===initialCorrections && this.serverMoves===initialServerMoves && this.serverPostMoves===initialServerPostMoves)throw Error('移動入力は送信しましたが、Realm側の座標変化を確認できません。起動ウィンドウの[移動診断:結果]を確認してください。');
    if(Math.hypot(authoritativePosition.x-target.x,authoritativePosition.z-target.z)>radius+0.3 || Math.abs(authoritativePosition.y-1.62-target.y)>0.3){
      if(replan<2){
        this.check(signal);this.position={...authoritativePosition};
        const feet=this.feet();if(this.walkable(feet.x,feet.y,feet.z))this.verticalVelocity=0;
        console.log('[移動診断:到着再計画]',JSON.stringify({attempt:replan+1,target,authoritativePosition}));
        return this.goto(target,signal,radius,replan+1);
      }
      throw Error('サーバー上で目的地への到着を確認できません。補正後も2回再計画しました。');
    }
    return {position:{...authoritativePosition,y:authoritativePosition.y-1.62},authoritativePosition,verification:'server_position_changed'};
  }
  async follow(name,seconds,signal){const deadline=Date.now()+Math.min(seconds,LIMITS.followSeconds)*1000;
    const startInputs=this.movementInputs,startMoves=this.serverMoves,startPostMoves=this.serverPostMoves,startCorrections=this.corrections,startAuthoritativePosition=this.lastAuthoritativePosition?{...this.lastAuthoritativePosition}:null;
    console.log('[追従診断:開始]',JSON.stringify({bot:this.feet(),target:this.player(name).position,tick:String(this.tick)}));
    const duration=AbortSignal.timeout(Math.min(seconds,LIMITS.followSeconds)*1000),followSignal=signal?AbortSignal.any([signal,duration]):duration;
    try{while(Date.now()<deadline){const p=this.player(name);await this.goto({...p.position,y:p.position.y-1.62},followSignal,2.5);await this.wait(500,followSignal);}}catch(e){if(!duration.aborted || signal?.aborted)throw e;}finally{this.stop();}
    const diagnostic={movementInputs:this.movementInputs-startInputs,serverMoves:this.serverMoves-startMoves,serverPostMoves:this.serverPostMoves-startPostMoves,
      authoritativePosition:this.lastAuthoritativePosition,authoritativeSource:this.lastAuthoritativeSource,
      authoritativePositionDelta:startAuthoritativePosition&&this.lastAuthoritativePosition?{x:this.lastAuthoritativePosition.x-startAuthoritativePosition.x,y:this.lastAuthoritativePosition.y-startAuthoritativePosition.y,z:this.lastAuthoritativePosition.z-startAuthoritativePosition.z}:null,
      corrections:this.corrections-startCorrections,tick:String(this.tick)};
    console.log('[追従診断:終了]',JSON.stringify(diagnostic));
    return {followed:name,seconds,verification:this.corrections>startCorrections?'server_correction_received':'server_position_update_received',...diagnostic};}
  look(p){const dx=p.x-this.position.x,dy=p.y-this.position.y,dz=p.z-this.position.z;
    this.yaw=Math.atan2(-dx,dz)*180/Math.PI;this.pitch=-Math.atan2(dy,Math.hypot(dx,dz))*180/Math.PI;}
  select(slot){const item=this.items[slot] || emptyItem();this.slot=slot;
    this.client.queue('mob_equipment',{runtime_entity_id:this.entityId,item,slot,selected_slot:slot,window_id:'inventory'});}
  pickaxeSlot(blockName){return miningToolSlot(this.items,this.registry,blockName,{required:true});}
  async equipOffhand(name,signal){
    this.check(signal);
    if(!['shield','totem_of_undying'].includes(name))throw Error('オフハンドは盾・不死のトーテムに対応します。');
    if(!this.offhandKnown)throw Error('オフハンド所持枠が未受信です。Botを接続し直してください。');
    if(this.offhandItems[0]?.count && this.registry.items[this.offhandItems[0].network_id]?.name===name)return {item:name,alreadyEquipped:true};
    const source=this.items.slice(0,36).findIndex(i=>i?.count>0 && this.registry.items[i.network_id]?.name===name);
    if(source<0)throw Error(name+'を受信済みの持ち物に確認できません。');
    await this.crafting.equipInventorySlot(source,signal,0,'offhand');return {item:name,verification:'server_inventory'};
  }
  async wearArmor(name,signal){
    this.check(signal);
    const suffix=['helmet','chestplate','leggings','boots'].find(t=>name.endsWith('_'+t));
    const armorSlot=['helmet','chestplate','leggings','boots'].indexOf(suffix);
    if(armorSlot<0 || !this.registry.itemsByName[name])throw Error('通常の防具名を指定してください。');
    if(this.armorKnown.has(armorSlot) && this.armorItems[armorSlot]?.count && this.registry.items[this.armorItems[armorSlot].network_id]?.name===name)return {item:name,armorSlot,alreadyEquipped:true};
    const source=this.items.slice(0,36).findIndex(i=>i?.count>0 && this.registry.items[i.network_id]?.name===name);
    if(source<0)throw Error(name+'を受信済みの持ち物に確認できません。');
    if(!this.armorKnown.has(armorSlot))throw Error('防具スロットが未受信です。Botを接続し直してください。');
    await this.crafting.equipInventorySlot(source,signal,armorSlot);
    return {item:name,armorSlot,verification:'server_inventory'};
  }
  armorSummary(){return ['頭','胴','脚','足'].map((label,i)=>label+': '+(!this.armorKnown.has(i)?'未受信':this.armorItems[i]?.count?this.registry.items[this.armorItems[i].network_id]?.name || 'unknown':'なし')).join(' / ');}
  async giveItem(item,count,sender,signal){
    this.check(signal);if(!/^[a-z0-9_]{1,64}$/.test(item||'')||!Number.isInteger(count)||count<1||count>64)throw Error('渡すアイテム名と1〜64個を指定してください。');
    if(!this.pickup.inventoryReady)throw Error('持ち物全体が未受信です。');
    const total=()=>this.items.slice(0,36).reduce((n,i)=>n+(i?.count&&this.registry.items[i.network_id]?.name===item?i.count:0),0);
    if(total()<count)throw Error(item+'が不足しています。所持: '+total()+'個。');
    let recipient=this.player(sender);if(distance(this.position,recipient.position)>8)throw Error('受け取る人はBotから8ブロック以内へ来てください。');
    let dropped=0;
    try{
      if(distance(this.position,recipient.position)>3)await this.goto({...recipient.position,y:recipient.position.y-1.62},signal,2);
      while(dropped<count){
        this.check(signal);recipient=this.player(sender);if(distance(this.position,recipient.position)>3.5)throw Error('受け取る人が離れたため停止しました。');
        this.look(recipient.position);
        const slot=this.items.slice(0,36).findIndex(i=>i?.count&&this.registry.items[i.network_id]?.name===item);
        if(slot<0)throw Error('渡している途中で持ち物が不足しました。');
        const amount=Math.min(count-dropped,this.items[slot].count),before=total();
        await this.crafting.dropInventorySlot(slot,amount,signal);
        if(before-total()!==amount)throw Error('指定アイテムの所持数減少を確認できません。');
        dropped+=amount;
      }
      const actors=[...(this.pickup.drops?.values()||[])].filter(d=>this.registry.items[d.item.network_id]?.name===item).map(d=>({id:d.id,count:d.item.count,position:d.position}));
      console.log('[受け渡し診断]',JSON.stringify({item,dropped,recipient:sender,recipientPosition:this.player(sender).position,botPosition:this.position,itemActors:actors,receiptConfirmed:false}));
      return {item,dropped,recipient:sender,verification:'server_inventory_decrease',receiptConfirmed:false};
    }catch(e){e.message+=' 地面へ渡した確認済み個数: '+dropped+'個。';throw e;}finally{this.stop();}
  }
  async equipItem(name,signal){
    this.check(signal);
    const slot=this.items.slice(0,36).findIndex(i=>i?.count>0 && this.registry.items[i.network_id]?.name===name);
    if(slot<0)throw Error(name+'を受信済みの持ち物に確認できません。!TAKEN 持ち物 で確認してください。');
    const hotbar=slot>=9?await this.crafting.equipInventorySlot(slot,signal):slot;
    this.select(hotbar);return {item:name,slot:hotbar,verification:'equipment_input_sent'};
  }
  async prepareMiningTool(blockName,signal,requested){
    if(requested){
      const slot=this.items.slice(0,36).findIndex(i=>i?.count>0 && this.registry.items[i.network_id]?.name===requested);
      if(slot<0)throw Error(requested+'を受信済みの持ち物に確認できません。');
      if(this.registry.blocksByName[blockName]?.material?.includes('pickaxe') || /_ore$|ancient_debris|^deepslate$/.test(blockName))miningToolSlot([this.items[slot]],this.registry,blockName,{required:true});
      return (await this.equipItem(requested,signal)).slot;
    }
    let slot=miningToolSlot(this.items,this.registry,blockName);
    if(slot>=9)slot=await this.crafting.equipInventorySlot(slot,signal);
    // Bare hands for soil/wood: do not keep an unrelated previously selected tool.
    if(slot<0)slot=this.items.slice(0,9).findIndex(i=>!i?.count);
    if(slot>=0)this.select(slot);
    return slot;
  }
  safeBelow(target){
    const f=this.feet(),expected={x:Math.floor(f.x),y:Math.floor(f.y-0.05),z:Math.floor(f.z)};
    if(key(target)!==key(expected) || Math.abs(f.y-(target.y+1))>0.15)throw Error('真下の1マスを確認できません。ブロックの中央に立ってください。');
    const b=this.block(target);if(!b || b.boundingBox!=='block')throw Error('足元の固体ブロックが未確認です。');
    for(const dx of [-.29,.29])for(const dz of [-.29,.29]){const floor=this.block({x:f.x+dx,y:target.y-.05,z:f.z+dz});if(!floor || floor.boundingBox!=='block' || /lava|water|fire|cactus|magma|campfire|berry|powder_snow/.test(floor.name))throw Error('1マス下の安全な着地点がありません。穴・水・溶岩・未知の地形へは掘りません。');}
    const read=p=>key(p)===key(target)?{name:'air',boundingBox:'empty'}:this.block(p);
    if(!bodyClear(read,f.x,target.y,f.z))throw Error('掘った後に立つ空間がありません。ブロックの中央に立ってください。');
    return b;
  }
  belowPositionConfirmed(){
    const a=this.lastAuthoritativePosition,f=this.feet();
    return a&&[a.x,a.y,a.z].every(Number.isFinite)&&Math.hypot(a.x-f.x,a.z-f.z)<=.35&&Math.abs(a.y-1.62-f.y)<=.2&&Math.abs(f.y-Math.round(f.y))<=.15;
  }
  requireBelowPosition(){
    if(!this.belowPositionConfirmed()){
      console.log('[足元採掘診断:位置未同期]',JSON.stringify({predictedFeet:this.feet(),authoritativePosition:this.lastAuthoritativePosition}));
      throw Error('現在位置がサーバーと同期していないか、落下・ジャンプ中です。着地してから足元採掘を再実行してください。');
    }
  }
  async digBelow(signal){
    this.check(signal);this.stop();
    const until=Date.now()+2000;
    while(!this.belowPositionConfirmed()&&Date.now()<until)await this.wait(100,signal);
    this.requireBelowPosition();
    const f=this.feet(),target={x:Math.floor(f.x),y:Math.floor(f.y-.05),z:Math.floor(f.z)},b=this.safeBelow(target);
    return this.mine(b.name,1,signal,{targetPosition:target,allowBelow:true});
  }
  async mine(name,count,signal,{targetPosition,tool,allowBelow=false}={}){name=cleanName(name);let broken=0;
    if(!Number.isInteger(count)||count<1||count>LIMITS.mine)throw Error('採掘は1回1〜'+LIMITS.mine+'ブロックです。');
    if(allowBelow&&(!targetPosition||count!==1))throw Error('足元採掘は真下1マスだけです。');
    const minedKeys=new Set();
    const pickupBaseline=this.pickup.inventoryReady?this.pickup.snapshot():null,minedPositions=[];
    const info=this.registry.blocksByName[name];if(!info || !info.diggable || info.hardness<0)throw Error('採掘できる通常ブロック名を指定してください。');
    if(/chest|barrel|shulker|furnace|bed|spawner/.test(name))throw Error('収納や設備は採掘対象にできません。');
    for(let n=0;n<count;n++){
      this.check(signal);const f=this.feet(),candidates=[];
      for(let x=-8;x<=8;x++)for(let y=-3;y<=5;y++)for(let z=-8;z<=8;z++){
        const b=this.block({x:f.x+x,y:f.y+y,z:f.z+z});if(this.mineMatches(name,b) && !minedKeys.has(key(b.position)) && (!targetPosition || key(b.position)===key(targetPosition)) && b.position.y>=Math.floor(f.y)-3 && (!this.supportsPlayer(b.position) || (allowBelow && targetPosition && key(b.position)===key(targetPosition))))candidates.push(b);
      }
      candidates.sort((a,b)=>distance(a.position,f)-distance(b.position,f));
      const b=candidates[0];if(!b){console.log('[採掘診断]',this.nearbySummary());throw Error(`近くに採掘できる${name}が見つかりません。確認済み採掘数: ${broken}。!TAKEN 周囲 で地形を確認してください。`);}
      if(allowBelow){this.requireBelowPosition();this.safeBelow(b.position);}else await this.goto({...b.position,y:f.y},signal,3);
      if(distance(this.position,{x:b.position.x+0.5,y:b.position.y+0.5,z:b.position.z+0.5})>4.5)throw Error('採掘対象に手が届きません。');
      if(this.supportsPlayer(b.position)){if(!allowBelow)throw Error('Botの足元は掘りません。');this.safeBelow(b.position);}
      const needsPick=info.material?.includes('pickaxe') || /(?:_ore|ancient_debris)$/.test(b.name) || b.name==='deepslate';
      await this.prepareMiningTool(b.name,signal,tool);
      console.log('[採掘診断:開始]',JSON.stringify({block:b.name,position:b.position,slot:this.slot,tool:this.registry.items[this.items[this.slot]?.network_id]?.name || 'bare_hand',authoritativeBreak:this.authoritativeBreak}));
      this.look({x:b.position.x+0.5,y:b.position.y+0.5,z:b.position.z+0.5});this.digging=b;
      this.pendingActions.push({action:'start_break',position:b.position,face:1});
      try{
        const toolName=this.registry.items[this.items[this.slot]?.network_id]?.name || 'bare_hand',feet=this.feet();
        const ticks=miningTicks({...info,...this.registry.blocksByName[b.name],name:b.name},toolName,{submerged:/^(flowing_)?water$/.test(this.block(this.position)?.name||''),grounded:this.walkable(feet.x,feet.y,feet.z)});
        console.log('[採掘時間]',JSON.stringify({block:b.name,tool:toolName,estimatedMilliseconds:ticks*50}));
        let serverBroken=false;
        for(let t=0;t<ticks;t++){
          await this.wait(50,signal);const current=this.block(b.position);
          if(current&&airNames.has(current.name)){serverBroken=true;break;}
          this.pendingActions.push({action:'continue_break',position:b.position,face:1});
        }
        if(!serverBroken){
          if(allowBelow){this.requireBelowPosition();this.safeBelow(b.position);}
          this.pendingActions.push({action:'predict_break',position:b.position,face:1});
          if(!this.authoritativeBreak)this.pendingTransaction={legacy:{legacy_request_id:0},actions:[],data:useItemData(this.position,b,1,this.slot,this.items[this.slot],'break_block')};
        }
        try{await this.confirmBlock(b.position,current=>current!==null && airNames.has(current.name),signal);}catch(e){e.message+=' 対象: '+b.name+' / 道具: '+(this.registry.items[this.items[this.slot]?.network_id]?.name || 'bare_hand')+' / 確認済み採掘数: '+broken;throw e;}
        if(allowBelow)this.verticalVelocity=-0.08;
        broken++;minedKeys.add(key(b.position));minedPositions.push({...b.position});if(broken%8===0)this.client.emit('taken_notice',{message:'採掘中: '+broken+'/'+count+'ブロック。!stopで停止できます。'});
      }finally{this.stop();}
    }
    await this.wait(100,signal);
    const pickup=await this.pickup.collect({positions:minedPositions,baseline:pickupBaseline,optional:true},signal);
    return {broken,count,block:name,pickup,note:'ブロック変更と持ち物の実増加を別々に確認しました。'};
  }
  async defend(runtimeId,signal){
    this.check(signal);const e=this.entities.get(String(runtimeId));
    if(!e || !defenseTargets.has(e.name) || distance(this.feet(),e.position)>3.1)throw Error('安全な近接防衛対象が見つかりません。');
    const aim={x:e.position.x,y:e.position.y+Math.min(1.2,(this.registry.entitiesByName[e.name]?.height || 1)*0.6),z:e.position.z};
    const length=distance(this.position,aim);for(let d=0.2;d<length;d+=0.2){const k=d/length,b=this.block({x:this.position.x+(aim.x-this.position.x)*k,y:this.position.y+(aim.y-this.position.y)*k,z:this.position.z+(aim.z-this.position.z)*k});if(!b || b.boundingBox!=='empty')throw Error('敵までの見通しを確認できません。');}
    const weapons=this.items.slice(0,9).map((i,slot)=>({slot,item:i,name:this.registry.items[i?.network_id]?.name || ''})).filter(i=>i.item?.count>0 && /_(sword|axe)$/.test(i.name));
    const tier=name=>({netherite:5,diamond:4,iron:3,stone:2,copper:2,golden:1,wooden:1}[name.split('_')[0]] || 0)+(name.endsWith('_sword')?0.5:0);
    weapons.sort((a,b)=>tier(b.name)-tier(a.name));if(weapons.length)this.select(weapons[0].slot);
    this.look(aim);signal?.throwIfAborted();
    this.client.queue('inventory_transaction',{transaction:{legacy:{legacy_request_id:0},actions:[],transaction_type:'item_use_on_entity',transaction_data:{entity_runtime_id:e.runtimeId,action_type:'attack',hotbar_slot:this.slot,held_item:this.items[this.slot] || emptyItem(),player_pos:{...this.position},click_pos:{x:0,y:0,z:0}}}});
    await this.wait(650,signal);return {attacks:1,target:e.name};
  }
  async combat(target,seconds,signal){
    const allowedAnimals=new Set(['cow','pig','sheep','chicken','rabbit']);
    const matches=e=>target==='hostile'?e.category==='hostile':e.name===target;
    if(target!=='hostile'&&!allowedAnimals.has(target)&&!['zombie','skeleton','creeper','spider','enderman','drowned','husk','stray','bogged'].includes(target))throw Error('攻撃対象を指定し直してください。');
    const deadline=Date.now()+Math.min(seconds,LIMITS.combatSeconds)*1000;let attacks=0,selectedId=null,removed=false;
    while(Date.now()<deadline){this.check(signal);
      let entity=selectedId?this.entities.get(selectedId):null;
      if(!entity||!matches(entity))entity=this.nearbyEntities(24).find(matches);
      if(!entity){if(attacks===0)throw Error('24ブロック以内に対象モブが見つかりません。!TAKEN 周囲 で確認してください。');break;}
      selectedId=String(entity.runtimeId);
      let d=distance(this.feet(),entity.position);
      if(d>3.1){const feet=this.feet();await this.goto({x:entity.position.x,y:feet.y,z:entity.position.z},signal,2.5);entity=this.entities.get(selectedId);if(!entity){removed=true;break;}d=distance(this.feet(),entity.position);}
      if(d>3.8)throw Error('対象に近づけませんでした。平坦な場所で再試行してください。');
      const height=this.registry.entitiesByName[entity.name]?.height || 1;
      this.look({x:entity.position.x,y:entity.position.y+height*0.6,z:entity.position.z});
      this.client.queue('inventory_transaction',{transaction:{legacy:{legacy_request_id:0},actions:[],transaction_type:'item_use_on_entity',transaction_data:{
        entity_runtime_id:entity.runtimeId,action_type:'attack',hotbar_slot:this.slot,held_item:this.items[this.slot] || emptyItem(),
        player_pos:{...this.position},click_pos:{x:0,y:0,z:0}
      }}});
      attacks++;
      await this.wait(650,signal);
      if(!this.entities.has(selectedId)){removed=true;break;}
      if(this.entities.get(selectedId)?.health===0){removed=true;break;}
    }
    return {target,attacks,removed,seconds};
  }
  async eat(signal,options={}){
    signal??=new AbortController().signal;
    this.emergencySignals??=new WeakSet();const existing=this.emergencySignals.has(signal);
    this.emergencySignals.add(signal);
    try{return await this.consumeFood(signal,options);}finally{if(!existing)this.emergencySignals.delete(signal);}
  }
  async consumeFood(signal,{item,count=8}={}){
    this.check(signal,{allowLowHealth:true});
    if(!Number.isInteger(count)||count<1||count>8)throw Error('食事は1〜8個です。');
    if(item&&!safeFood.has(item))throw Error('安全に食べられる食料を指定してください。');
    if(!Number.isFinite(this.food))throw Error('満腹度をまだ取得できません。少し待ってから再試行してください。');
    if(this.food>=20)return {eaten:0,food:this.food};
    let eaten=0;
    while(this.food<20 && eaten<count){
      this.check(signal,{allowLowHealth:true});
      let slot=this.items.slice(0,36).findIndex(i=>i?.count>0 && safeFood.has(cleanName(this.registry.items[i.network_id]?.name)) && (!item||cleanName(this.registry.items[i.network_id]?.name)===item));
      if(slot<0){if(eaten===0)throw Error('受信済みの持ち物に安全に食べられる指定の食料がありません。');break;}
      if(slot>=9)slot=await this.crafting.equipInventorySlot(slot,signal);
      this.select(slot);
      const held=this.items[slot], before=this.food;
      this.pendingTransaction={legacy:{legacy_request_id:0},actions:[],data:{action_type:'click_air',trigger_type:'player_input',block_position:{x:0,y:0,z:0},face:0,hotbar_slot:slot,hand:'main_hand',held_item:held,player_pos:{...this.position},click_pos:{x:0,y:0,z:0},block_runtime_id:0,client_prediction:'success',client_cooldown_state:'off'}};
      try{await this.wait(1600,signal,{allowLowHealth:true});}finally{
        if(this.ready && !this.respawning && this.health!==0)this.client.queue('inventory_transaction',{transaction:{legacy:{legacy_request_id:0},actions:[],transaction_type:'item_release',transaction_data:{action_type:'release',hotbar_slot:slot,held_item:held,head_pos:{x:this.position.x,y:this.position.y+1.62,z:this.position.z}}}});
      }
      await this.wait(450,signal,{allowLowHealth:true});
      if(this.food<=before)throw Error('食事による満腹度の増加を確認できません。');
      eaten++;
    }
    return {eaten,food:this.food};
  }
  async confirmBlock(p,predicate,signal) {const end=Date.now()+5000;while(Date.now()<end){if(predicate(this.block(p)))return;await this.wait(100,signal);}throw Error('サーバー上のブロック変更を確認できません。');}
  async build({block,x,y,z,width=1,height=1,depth=1},signal){block=cleanName(block);
    const info=this.registry.blocksByName[block];if(!info || info.boundingBox!=='block'||hazardous.test(block))throw Error('建築には通常の固体ブロックを指定してください。');
    for(const n of [width,height,depth])if(!Number.isInteger(n)||n<1||n>LIMITS.dimension)throw Error('建築寸法は1〜'+LIMITS.dimension+'です。');
    for(const n of [x,y,z])if(!Number.isInteger(n)||Math.abs(n)>30000000)throw Error('建築座標が不正です。');
    const total=width*height*depth;if(total>LIMITS.build)throw Error('建築は1回'+LIMITS.build+'ブロックまでです。');
    const f=this.feet();if(distance(f,{x,y,z})>16)throw Error('建築の開始位置は16ブロック以内にしてください。');
    const targets=[];for(let dy=0;dy<height;dy++)for(let dz=0;dz<depth;dz++)for(let dx=0;dx<width;dx++)targets.push({x:x+dx,y:y+dy,z:z+dz});
    for(const p of targets){const b=this.block(p);if(!b||!airNames.has(b.name))throw Error('建築予定地が空気であると確認できません。既存のブロックは上書きしません。');}
    let placed=0;
    for(const p of targets){this.check(signal);
      const slot=this.items.slice(0,9).findIndex(i=>i?.count>0 && this.registry.items[i.network_id]?.name===block);
      if(slot<0)throw Error(`ホットバーの${block}が足りません。確認済み設置数: ${placed}`);
      await this.goto({...p,y:this.feet().y},signal,3);
      const self=this.feet();if(Math.abs(self.x-(p.x+0.5))<0.8&&Math.abs(self.z-(p.z+0.5))<0.8&&p.y<self.y+2&&p.y>=self.y-1)throw Error('Bot自身と重なる場所には置けません。');
      let reference,face;
      for(const [dx,dy,dz,fce] of [[0,-1,0,1],[0,0,-1,3],[0,0,1,2],[-1,0,0,5],[1,0,0,4],[0,1,0,0]]){
        const r=this.block({x:p.x+dx,y:p.y+dy,z:p.z+dz});if(r?.boundingBox==='block'&&!hazardous.test(r.name)){reference=r;face=fce;break;}
      }
      if(!reference)throw Error('設置するための隣接ブロックがありません。');
      if(distance(this.position,{x:reference.position.x+0.5,y:reference.position.y+0.5,z:reference.position.z+0.5})>4.5)throw Error('設置先に手が届きません。');
      this.select(slot);this.look({x:p.x+0.5,y:p.y+0.5,z:p.z+0.5});
      this.pendingTransaction={legacy:{legacy_request_id:0},actions:[],data:useItemData(this.position,reference,face,slot,this.items[slot])};
      await this.confirmBlock(p,b=>b?.name===block,signal);placed++;if(placed%16===0)this.client.emit('taken_notice',{message:'建築中: '+placed+'/'+total+'ブロック。!stopで停止できます。'});
    }
    return {placed,block};
  }
  async execute(action,sender,signal){
    this.check(signal,{allowSleeping:action.type==='wake'||action.type==='sleep',allowLowHealth:action.type==='eat'||action.type==='wake'||action.type==='leave_boat'});
    if(this.boat.mounted&&!['status','leave_boat','board_boat'].includes(action.type))throw Error('ボートに乗船中です。先に !TAKEN ボートから降りて を実行してください。');
    switch(action.type){
      case 'board_boat':return this.boat.board(signal);
      case 'leave_boat':return this.boat.leave(signal);
      case 'status':return this.status();
      case 'dig_below':return this.digBelow(signal);
      case 'move':{
        const mode=action.mode || 'walk';if(!['walk','sprint','swim'].includes(mode))throw Error('移動モードが不正です。');
        if(mode==='sprint' && (this.food===null || this.food<=6))throw Error('ダッシュには満腹度7以上の確認が必要です。');
        if(mode==='swim' && distance(this.feet(),action)>24)throw Error('泳ぎは近距離24ブロック以内の水面経路に対応します。');
        this.navigationMode=mode;
        try{return await this.goto({x:action.x,y:action.y,z:action.z},signal);}finally{this.stop();}
      }
      case 'come':{const p=this.player(action.player || sender);return this.goto({...p.position,y:p.position.y-1.62},signal,2.5);}
      case 'follow':return this.follow(action.player || sender,action.seconds || 15,signal);
      case 'mine':return this.mine(action.block,action.count || 1,signal,{targetPosition:action.targetPosition,tool:action.tool});
      case 'build':return this.build(action,signal);
      case 'combat':return this.combat(action.target,action.seconds || 20,signal);
      case 'eat':return this.eat(signal,action);
      case 'sleep':return this.bed.sleep(signal);
      case 'wake':return this.bed.wake(signal);
      case 'gather':return this.resourceSearch.gather(action.block,action.count,signal);
      case 'collect':return this.pickup.collect(action,signal);
      case 'offhand':return this.equipOffhand(action.item,signal);
      case 'resource_manage':return manageResources(this,action,signal);
      case 'food_supply':return supplyFood(this,action,signal);
      case 'smelt':return this.furnace.smelt(action.item,action.count,signal);
      case 'wear':return this.wearArmor(action.item,signal);
      case 'equip':return this.equipItem(action.item,signal);
      case 'tunnel_mine':
      case 'branch_mine':return branchMine(this,action,signal);
      case 'give':return this.giveItem(action.item,action.count,sender,signal);
      case 'craft':return this.crafting.craft(action.item,action.count,signal);
      default:throw Error('未対応の操作です。');
    }
  }
}














