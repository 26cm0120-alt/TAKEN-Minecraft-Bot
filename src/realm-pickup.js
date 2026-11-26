const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const valid=p=>p && [p.x,p.y,p.z].every(Number.isFinite);
const identity=i=>`${i?.network_id || 0}:${i?.metadata || 0}`;
export class RealmPickup {
 constructor(controls){
  this.controls=controls;this.client=controls.client;this.drops=new Map();this.inventoryReady=false;
  this.client.on('inventory_content',p=>{if(p.window_id===0 || p.window_id==='inventory')this.inventoryReady=true;});
  this.client.on('add_item_entity',p=>{if(valid(p.position)&&p.item?.count>0)this.drops.set(String(p.runtime_entity_id),{id:String(p.runtime_entity_id),uniqueId:String(p.entity_id_self),item:p.item,position:{...p.position},spawnPosition:{...p.position}});});
  this.client.on('move_entity',p=>{const d=this.drops.get(String(p.runtime_entity_id));if(d&&valid(p.position))d.position={...p.position};});
  this.client.on('move_entity_delta',p=>{const d=this.drops.get(String(p.runtime_entity_id));if(d)for(const k of ['x','y','z'])if(Number.isFinite(p[k]))d.position[k]=p[k];});
  this.client.on('remove_entity',p=>{for(const [id,d] of this.drops)if(d.uniqueId===String(p.entity_id_self))this.drops.delete(id);});
  this.client.on('take_item_entity',p=>{this.drops.delete(String(p.runtime_entity_id));});
  for(const event of ['change_dimension','close','start_game'])this.client.on(event,()=>this.drops.clear());
  for(const event of ['close','start_game'])this.client.on(event,()=>{this.inventoryReady=false;});
 }
 name(item){return this.controls.registry.items[item.network_id]?.name || 'unknown';}
 snapshot(){const m=new Map();for(const i of this.controls.items.slice(0,36))if(i?.count>0){const k=identity(i),prev=m.get(k);m.set(k,{name:this.name(i),count:(prev?.count || 0)+i.count});}return m;}
 gains(before,item){const result=[];for(const [id,i] of this.snapshot()){const count=i.count-(before.get(id)?.count || 0);if(count>0 && (!item || i.name===item))result.push({item:i.name,count});}return result;}
 nearby(origin=this.controls.feet(),radius=16,item){if(!valid(origin))return[];return [...this.drops.values()].filter(d=>distance(origin,d.position)<=radius && (!item || this.name(d.item)===item)).sort((a,b)=>distance(origin,a.position)-distance(origin,b.position));}
 summary(){const entries=this.nearby().slice(0,16);return entries.length?'近くの落下アイテム: '+entries.map(d=>`${this.name(d.item)}×${d.item.count} (${distance(this.controls.feet(),d.position).toFixed(1)}m)`).join('、'):'16ブロック以内に受信済みの落下アイテムはありません。';}
 async approach(drop,standing,signal,start){
  const c=this.controls;
  await c.goto(standing,signal,0.35);
  // A path ends at the centre of a cell. Pickups near its edge need a final,
  // collision-checked approach to the actor, including actors still falling.
  const deadline=Date.now()+5000;
  try{
   while(Date.now()<deadline && !this.gains(start,this.name(drop.item)).length){
    c.check(signal);const live=this.drops.get(drop.id);
    if(!live)break;
    const feet=c.feet(),target={x:live.position.x,y:feet.y,z:live.position.z};
    const horizontal=Math.hypot(feet.x-target.x,feet.z-target.z);
    if(Math.abs(live.position.y-feet.y)<=1.2 && horizontal>0.12 && horizontal<=1.6 && c.walkable(target.x,target.y,target.z))c.walkTarget=target;
    else c.walkTarget=null;
    await c.wait(100,signal);
   }
  }finally{c.stop();}
 }
 async collect({item,count=64,positions,baseline,optional=false}={},signal){
  if(!Number.isInteger(count)||count<1||count>64 || (item && !/^[a-z0-9_]{1,64}$/.test(item)))throw Error('回収は希望1〜64個で指定してください。');
  const c=this.controls;c.check(signal);if(!this.inventoryReady){if(optional)return {collected:[],total:0,requested:count,attempts:0,skipped:['持ち物全体が未受信のため回収確認を省略しました'],verification:'unconfirmed'};throw Error('持ち物全体がまだ未受信です。少し待ってから回収してください。');}const origin={...c.feet()},before=baseline || this.snapshot(),attempted=new Set(),skipped=[];
  const timer=AbortSignal.timeout(60000),combined=signal?AbortSignal.any([signal,timer]):timer;
  let attempts=0;const arrivalUntil=Date.now()+(positions?.length?2500:0);
  try{
   while(attempts<16){
    c.check(combined);const gains=this.gains(before,item);if(gains.reduce((n,i)=>n+i.count,0)>=count)break;
    const candidates=this.nearby(origin,16,item).filter(d=>!attempted.has(d.id) && (!positions || positions.some(p=>distance(p,d.position)<=2.5||(valid(d.spawnPosition)&&distance(p,d.spawnPosition)<=2.5))));
    const drop=candidates[0];
    if(!drop){
     if(Date.now()<arrivalUntil){await c.wait(100,combined);continue;}
     if(!attempts && positions?.length && !this.gains(before,item).length){
      const drops=[...this.drops.values()].slice(0,16).map(d=>({item:this.name(d.item),position:d.position,fromBot:valid(origin)?distance(origin,d.position):null,fromMining:Math.min(...positions.map(p=>distance(p,d.position)))}));
      console.log('[回収診断:対象なし]',JSON.stringify({minedPositions:positions,feet:c.feet(),trackedDrops:this.drops.size,drops,inventoryReady:this.inventoryReady}));
      skipped.push('採掘地点付近の落下アイテム通知・持ち物増加を確認できません');
     }
     break;
    }
    attempted.add(drop.id);attempts++;
    const capacity=Array.from({length:36},(_,slot)=>c.items[slot]).some(i=>!i?.count || (identity(i)===identity(drop.item) && i.count<(c.registry.items[drop.item.network_id]?.stackSize || 64)));
    if(!capacity){skipped.push('持ち物に空きがありません');break;}
    const start=this.snapshot(),dropName=this.name(drop.item);
    try{
     // Item actors use ground coordinates, unlike the player's eye-height position.
     // Find a verified standable floor near the actor instead of trusting its bobbing Y.
     let options=[];
     for(let settling=0;settling<=30;settling++){
     options=[];
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      const p={x:Math.floor(drop.position.x)+dx+0.5,y:Math.floor(drop.position.y)+dy,z:Math.floor(drop.position.z)+dz+0.5};
      if(distance(p,drop.position)<=1.6 && c.walkable(p.x,p.y,p.z))options.push(p);
     }
     if(options.length||this.gains(start,dropName).length||!this.drops.has(drop.id)||settling===30)break;
     await c.wait(100,combined);
     }
     if(this.gains(start,dropName).length)continue;
     options.sort((a,b)=>distance(a,drop.position)-distance(b,drop.position));
     if(!options.length)throw Error('落下アイテム近くの安全な足場を確認できません');
     let reached=false,lastPathError;
     for(const standing of options.slice(0,8)){
      c.check(combined);
      if(this.gains(start,dropName).length){reached=true;break;}
      if(!this.drops.has(drop.id))break;
      try{await this.approach(drop,standing,combined,start);reached=true;break;}
      catch(e){
       // Retry only a route rejection before walking, never a cancelled job,
       // failed server confirmation, timeout, or changed health state.
       if(combined.aborted||!/^安全な経路がありません|^移動先との高低差/.test(e.message))throw e;
       c.check(combined);lastPathError=e;
      }
     }
     if(!reached&&lastPathError)throw lastPathError;
     const end=Date.now()+3000;
     while(Date.now()<end && !this.gains(start,dropName).length)await c.wait(100,combined);
     if(!this.gains(start,dropName).length){
      const live=this.drops.get(drop.id),server=c.lastAuthoritativePosition;
      console.log('[回収診断:未確認]',JSON.stringify({item:dropName,drop:live?.position || null,predictedFeet:c.feet(),serverFeet:server?{...server,y:server.y-1.62}:null,inventoryReady:this.inventoryReady,actorPresent:Boolean(live)}));
      throw Error('持ち物の増加を確認できません');
     }
    }catch(e){if(combined.aborted || !c.ready || c.respawning || (c.health!==null && c.health<=8))throw e;skipped.push(dropName+': '+e.message);}
   }
  }finally{c.stop();}
  const collected=this.gains(before,item),total=collected.reduce((n,i)=>n+i.count,0);
  console.log('[回収診断]',JSON.stringify({collected,total,attempts,skipped}));
  if(!total && !optional)throw Error('回収を確認できません。'+(skipped[0] || '16ブロック以内に対象アイテムがありません。')+' !TAKEN 落下アイテム で確認してください。');
  return {collected,total,requested:count,attempts,skipped,verification:'server_inventory_increase'};
 }
}

