const bedName=n=>n==='bed'||n?.endsWith('_bed');
export class BedControl {
 constructor(c){this.c=c;this.entered=0;this.pending=false;this.cancelled=false;this.waking=false;
  c.client.on('set_entity_data',p=>{if(String(p.runtime_entity_id)!==String(c.entityId))return;for(const m of p.metadata || []){
   if(m.key!=='player_flags' && m.key!==26)continue;
   const sleeping=(Number(m.value)&2)!==0;
   if(sleeping&&!c.sleeping){this.entered++;c.stop();c.verticalVelocity=0;}
   c.sleeping=sleeping;if(!sleeping)this.waking=false;if(sleeping&&this.cancelled)this.requestWake();
  }});
  for(const event of ['taken_death','taken_respawning','change_dimension','close'])c.client.on(event,()=>{c.sleeping=false;this.pending=false;this.cancelled=true;this.waking=false;});
 }
 requestWake(){
  if(!this.pending&&!this.c.sleeping)return;this.cancelled=true;this.c.pendingTransaction=null;
  if(this.waking || !this.c.ready || this.c.respawning || this.c.health===0)return;
  this.waking=true;this.c.client.queue('player_action',{runtime_entity_id:this.c.entityId,action:'stop_sleeping',position:{x:0,y:0,z:0},result_position:{x:0,y:0,z:0},face:0});
 }
 async wake(signal){
  this.c.check(signal,{allowSleeping:true,allowLowHealth:true});if(!this.c.sleeping)return {sleeping:false,alreadyAwake:true};
  this.requestWake();const end=Date.now()+5000;while(this.c.sleeping&&Date.now()<end)await this.c.wait(50,signal,{allowSleeping:true,allowLowHealth:true});
  if(this.c.sleeping)throw Error('起床をサーバーで確認できません。');return {sleeping:false};
 }
 async sleep(signal){
  const c=this.c;c.check(signal,{allowSleeping:true});if(c.sleeping)return {sleeping:true,alreadySleeping:true};
  if(c.dimension!==0)throw Error('ベッド操作はオーバーワールドだけに対応します。');
  const f=c.feet(),beds=[];for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)for(let y=-2;y<=3;y++){
   const b=c.block({x:Math.floor(f.x)+x,y:Math.floor(f.y)+y,z:Math.floor(f.z)+z});if(bedName(b?.name))beds.push(b);
  }
  beds.sort((a,b)=>Math.hypot(a.position.x-f.x,a.position.z-f.z)-Math.hypot(b.position.x-f.x,b.position.z-f.z));
  if(!beds.length)throw Error('近くにベッドがありません。Botの近くにベッドを置いてください。');const b=beds[0];
  await c.goto({...b.position,y:f.y},signal,2);if(!bedName(c.block(b.position)?.name))throw Error('ベッドが見つからなくなりました。');
  if(Math.hypot(c.position.x-(b.position.x+0.5),c.position.y-(b.position.y+0.5),c.position.z-(b.position.z+0.5))>4.5)throw Error('ベッドに手が届きません。');
  const entered=this.entered;this.pending=true;this.cancelled=false;this.waking=false;
  c.look({x:b.position.x+0.5,y:b.position.y+0.5,z:b.position.z+0.5});
  c.pendingTransaction={legacy:{legacy_request_id:0},actions:[],data:{action_type:'click_block',trigger_type:'player_input',block_position:b.position,face:1,hotbar_slot:c.slot,hand:'main_hand',held_item:c.items[c.slot] || {network_id:0,count:0,metadata:0,has_stack_id:false,block_runtime_id:0,extra:{has_nbt:'false',can_place_on:[],can_destroy:[]}},player_pos:{...c.position},click_pos:{x:0.5,y:0.5,z:0.5},block_runtime_id:b.runtimeId,client_prediction:'success',client_cooldown_state:'off'}};
  try{
   const end=Date.now()+5000;while(this.entered===entered&&Date.now()<end)await c.wait(50,signal,{allowSleeping:true});
   if(this.entered===entered)throw Error('睡眠をサーバーで確認できません。昼間・使用中・近くの敵など、Realmの条件を確認してください。');
   return {sleeping:Boolean(c.sleeping),bed:b.position,verification:'server_player_flags'};
  }catch(e){this.requestWake();throw e;}finally{this.pending=false;c.pendingTransaction=null;}
 }
}
