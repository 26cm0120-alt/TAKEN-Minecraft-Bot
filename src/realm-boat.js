export class RealmBoat {
 constructor(c,empty){this.c=c;this.empty=empty;this.mounted=null;this.pending=null;this.own=null;this.seats=new Map();
  c.client.on('start_game',p=>{this.own=String(p.entity_id);this.reset();});
  c.client.on('set_entity_link',p=>this.link(p.link));
  c.client.on('add_entity',p=>{for(const link of p.links||[])this.link(link);});
  c.client.on('remove_entity',p=>{const id=String(p.entity_id_self);this.seats.delete(id);if(this.mounted?.uniqueId===id)this.mounted=null;});
  for(const event of ['close','taken_death','change_dimension'])c.client.on(event,()=>this.reset());
 }
 reset(){this.mounted=null;this.pending=null;this.seats.clear();}
 link(l){if(!l)return;const vehicle=String(l.ridden_entity_id),rider=String(l.rider_entity_id);let seats=this.seats.get(vehicle);if(!seats){seats=new Set();this.seats.set(vehicle,seats);}if(l.type===0)seats.delete(rider);else seats.add(rider);
  if(rider!==this.own)return;
  if(l.type===0){this.mounted=null;return;}
  const e=[...this.c.entities.values()].find(e=>e.uniqueId===vehicle)||this.pending;if(!e||e.uniqueId!==vehicle)return;
  this.mounted=e;this.c.stop();
 }
 async board(signal){const c=this.c;c.check(signal);if(this.mounted)return {boat:this.mounted.name,alreadyMounted:true};
  const f=c.feet(),boats=[...c.entities.values()].filter(e=>/^(?:boat|chest_boat|[a-z_]+_boat|[a-z_]*raft)$/.test(e.name)&&Math.hypot(e.position.x-f.x,e.position.y-f.y,e.position.z-f.z)<=8&&(this.seats.get(e.uniqueId)?.size||0)<2);
  boats.sort((a,b)=>Math.hypot(a.position.x-f.x,a.position.z-f.z)-Math.hypot(b.position.x-f.x,b.position.z-f.z));const e=boats[0];if(!e)throw Error('8ブロック以内に空席のあるボートが見つかりません。岸の近くへ置いてください。');
  if(Math.hypot(e.position.x-c.position.x,e.position.y-c.position.y,e.position.z-c.position.z)>3){const candidates=[];for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)for(const dy of [0,1,-1]){const p={x:Math.floor(e.position.x)+x+.5,y:Math.round(f.y)+dy,z:Math.floor(e.position.z)+z+.5};if(c.walkable(p.x,p.y,p.z)&&Math.hypot(p.x-e.position.x,p.y+1.62-e.position.y,p.z-e.position.z)<=3)candidates.push(p);}candidates.sort((a,b)=>Math.hypot(a.x-f.x,a.z-f.z)-Math.hypot(b.x-f.x,b.z-f.z));if(!candidates.length)throw Error('ボートに届く安全な岸辺がありません。Botの近くへ寄せてください。');await c.goto(candidates[0],signal,.35);}
  const current=c.entities.get(String(e.runtimeId));if(!current)throw Error('ボートが見えなくなりました。');if(Math.hypot(current.position.x-c.position.x,current.position.y-c.position.y,current.position.z-c.position.z)>3.5)throw Error('ボートに手が届きません。');
  this.pending=current;c.stop();try{c.client.queue('inventory_transaction',{transaction:{legacy:{legacy_request_id:0},actions:[],transaction_type:'item_use_on_entity',transaction_data:{entity_runtime_id:current.runtimeId,action_type:'interact',hotbar_slot:c.slot,held_item:c.items[c.slot]||this.empty(),player_pos:{...c.position},click_pos:{x:0,y:0,z:0}}}});
   const end=Date.now()+8000;while(!this.mounted&&Date.now()<end){c.check(signal);await c.wait(100,signal);}if(!this.mounted)throw Error('サーバーから乗船確認を受信できません。');return {boat:this.mounted.name,verification:'server_entity_link'};
  }finally{this.pending=null;}
 }
 async leave(signal){const c=this.c;c.check(signal,{allowLowHealth:true});if(!this.mounted)return {alreadyUnmounted:true};const e=this.mounted;c.stop();c.client.queue('interact',{action_id:'leave_vehicle',target_entity_id:e.runtimeId,has_position:false});const end=Date.now()+8000;while(this.mounted&&Date.now()<end){c.check(signal,{allowLowHealth:true});await c.wait(100,signal);}if(this.mounted)throw Error('サーバーから降船確認を受信できません。');return {verification:'server_entity_link'};}
}
