import {LIMITS} from './capabilities.js';
import {planStepPath,bodyClear} from './step-movement.js';
const horizontal=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const key=p=>Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z);
const wood=['oak','spruce','birch','jungle','acacia','dark_oak','mangrove','cherry','pale_oak'];
export function resourceSpec(name){
 if(name==='cobblestone')return {blocks:['stone','cobblestone'],items:['cobblestone']};
 if(name==='wood')return {blocks:wood.map(w=>w+'_log'),items:wood.map(w=>w+'_log')};
 const ores={coal:'coal',raw_iron:'iron',raw_copper:'copper',raw_gold:'gold',diamond:'diamond',emerald:'emerald',lapis_lazuli:'lapis',redstone:'redstone'};
 if(ores[name])return {blocks:[ores[name]+'_ore','deepslate_'+ores[name]+'_ore'],items:[name]};
 if(/^deepslate_.*_ore$/.test(name))return resourceSpec(name.replace(/^deepslate_/,''));
 if(/_ore$/.test(name)){
  const base=name.replace(/_ore$/,''),drop={iron:'raw_iron',copper:'raw_copper',gold:'raw_gold',lapis:'lapis_lazuli',quartz:'quartz',nether_gold:'gold_nugget'}[base] || base;
  return {blocks:base==='quartz'||base==='nether_gold'?[name]:[name,'deepslate_'+name],items:[drop]};
 }
 return {blocks:[name],items:[name]};
}
export class ResourceSearch {
 constructor(controls){this.c=controls;}
 gains(before,spec){return this.c.pickup.gains(before).filter(i=>spec.items.includes(i.item));}
 path(target){const path=planStepPath(this.c,target,0.6);return path && (!this.origin || path.every(p=>horizontal(this.origin,p)<=LIMITS.searchRadius))?path:null;}
 exposed(b){for(const [x,y,z] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const q=this.c.block({x:b.position.x+x,y:b.position.y+y,z:b.position.z+z});if(q && q.boundingBox==='empty' && !/water|lava|fire/.test(q.name))return true;}return false;}
 approach(block,origin){
  const f=this.c.feet(),options=[];
  for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=-2;dy<=2;dy++){
   const p={x:block.position.x+dx+0.5,y:Math.round(f.y)+dy,z:block.position.z+dz+0.5};
   if(horizontal(origin,p)>LIMITS.searchRadius || horizontal(f,p)>20 || !this.c.walkable(p.x,p.y,p.z) || Math.hypot(p.x-(block.position.x+0.5),p.y+1.62-(block.position.y+0.5),p.z-(block.position.z+0.5))>4.5)continue;
   options.push(p);
  }
  options.sort((a,b)=>horizontal(f,a)-horizontal(f,b));
  for(const p of options.slice(0,12)){const path=this.path(p);if(path)return {target:p,path};}return null;
 }
 nearby(spec,origin,ignored){
  const f=this.c.feet(),found=[];
  for(let dx=-16;dx<=16;dx++)for(let dz=-16;dz<=16;dz++)for(let dy=-3;dy<=5;dy++){
   const b=this.c.block({x:Math.floor(f.x)+dx,y:Math.floor(f.y)+dy,z:Math.floor(f.z)+dz});
   if(b && spec.blocks.includes(b.name) && !ignored.has(key(b.position)) && horizontal(origin,b.position)<=LIMITS.searchRadius-5 && !this.c.supportsPlayer(b.position) && this.exposed(b))found.push(b);
  }
  return found.sort((a,b)=>horizontal(f,a.position)-horizontal(f,b.position));
 }
 next(origin,visited,blocked=[]){
  const f=this.c.feet(),candidates=[];
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[0.707,0.707],[0.707,-0.707],[-0.707,0.707],[-0.707,-0.707]])for(const length of [12,6]){
   for(const dy of [0,1,-1,2,-2,3,-3,4,-4]){
    const p={x:Math.floor(f.x+dx*length)+0.5,y:Math.round(f.y)+dy,z:Math.floor(f.z+dz*length)+0.5};
    if(horizontal(origin,p)>LIMITS.searchRadius-4 || visited.some(v=>horizontal(v,p)<5) || blocked.some(v=>horizontal(v,p)<3) || !this.c.walkable(p.x,p.y,p.z))continue;
    candidates.push(p);break;
   }
  }
  candidates.sort((a,b)=>horizontal(origin,b)-horizontal(origin,a));
  for(const p of candidates){const path=this.path(p);if(path)return {target:p,path};}
  // Sparse distant targets miss bends and short reachable areas. Traverse only
  // known, safe one-block edges; preserve the same jump clearance as navigation.
  const start={x:Math.floor(f.x),y:Math.round(f.y),z:Math.floor(f.z)},queue=[start],parents=new Map([[key(start),null]]),reachable=[];let index=0;
  while(index<queue.length && parents.size<1200){const a=queue[index++];
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])for(const dy of [0,1,-1]){
    const b={x:a.x+dx,y:a.y+dy,z:a.z+dz},target={x:b.x+.5,y:b.y,z:b.z+.5};
    if(parents.has(key(b)) || horizontal(f,target)>12 || Math.abs(b.y-start.y)>8 || horizontal(origin,target)>LIMITS.searchRadius-4 || !this.c.walkable(target.x,target.y,target.z))continue;
    if(dy===1&&!bodyClear(q=>this.c.block(q),a.x+.5,a.y+1.26,a.z+.5))continue;
    if(dy===-1&&!bodyClear(q=>this.c.block(q),b.x+.5,a.y,b.z+.5))continue;
    parents.set(key(b),a);queue.push(b);
    const novelty=Math.min(...visited.map(v=>horizontal(v,target)));
    if(novelty>=1.5&&!blocked.some(v=>horizontal(v,target)<3))reachable.push({b,target,novelty});
   }
  }
  reachable.sort((a,b)=>b.novelty-a.novelty || horizontal(origin,b.target)-horizontal(origin,a.target));
  const best=reachable[0];if(!best)return null;
  const path=[];for(let n=best.b;n;n=parents.get(key(n)))path.unshift(n);
  return {target:best.target,path};
 }
 async gather(name,count,signal){
  if(!/^[a-z0-9_]{1,64}$/.test(name || '') || !Number.isInteger(count)||count<1||count>LIMITS.mine)throw Error('資源探索は種類と希望1〜64個を指定してください。');
  const c=this.c;c.check(signal);if(!c.pickup.inventoryReady)throw Error('持ち物全体が未受信です。少し待ってください。');
  const spec=resourceSpec(name);for(const b of spec.blocks)if(!c.registry.blocksByName[b]?.diggable)throw Error('その資源の探索は未対応です。');
  if(spec.blocks.some(b=>/chest|barrel|shulker|furnace|bed|spawner/.test(b)))throw Error('収納や設備を探索採掘できません。');
  if(spec.blocks.some(b=>/_ore$|ancient_debris/.test(b)))c.pickaxeSlot(spec.blocks[0]);
  const origin={...(c.autonomousOrigin || c.feet())},baseline=c.pickup.snapshot(),visited=[{...c.feet()}],ignored=new Set(),notes=[];this.origin=origin;
  const timer=AbortSignal.timeout(LIMITS.searchMilliseconds),combined=signal?AbortSignal.any([signal,timer]):timer;
  let broken=0,steps=0,pathLength=0,routeFailures=0;const blocked=[];
  const move=async target=>{
   try{await c.goto(target,combined);return true;}
   catch(e){
    c.check(combined);
    if(!/^(?:前方の足場を確認できないため停止しました。|安全な経路がありません。)/.test(e.message))throw e;
    c.stop();c.requestNearby();await c.wait(400,combined);c.check(combined);
    const server=c.lastAuthoritativePosition;
    if(!server||!['x','y','z'].every(k=>Number.isFinite(server[k])))throw e;
    const feet={...server,y:server.y-1.62};
    if(!c.walkable(feet.x,feet.y,feet.z))throw Error(e.message+' 現在のサーバー位置にも安全な足場を確認できません。');
    c.position={...server};c.verticalVelocity=0;
    routeFailures++;blocked.push({...target});notes.push('経路候補を除外: '+key(target));
    if(routeFailures>=3)throw Error('探索中に3つの経路で移動できなかったため停止しました。'+e.message);
    c.client.emit('taken_notice',{message:'進めない探索経路を除外しました。現在地から別の安全な候補を探します（'+routeFailures+'/3）。'});
    return false;
   }
  };
  try{
   while(broken<count && this.gains(baseline,spec).reduce((n,i)=>n+i.count,0)<count){
    c.check(combined);if(horizontal(origin,c.feet())>LIMITS.searchRadius)throw Error('探索範囲を超えたため停止しました。');
    c.requestNearby();await c.wait(400,combined);
    let work;
    for(const block of this.nearby(spec,origin,ignored).slice(0,12)){ignored.add(key(block.position));const approach=this.approach(block,origin);if(approach){work={block,...approach};break;}}
    if(work){
     if(pathLength+work.path.length-1>LIMITS.searchPath){notes.push('探索経路の上限');break;}pathLength+=work.path.length-1;
     if(!await move(work.target))continue;
     try{const result=await c.mine(work.block.name,1,combined,{targetPosition:work.block.position});broken+=result.broken;}catch(e){if(combined.aborted || !c.ready || c.respawning || c.health===0 || c.health<=8)throw e;notes.push(e.message);break;}
     continue;
    }
    if(steps>=LIMITS.searchStops){notes.push('探索地点の上限');break;}
    let next=this.next(origin,visited,blocked);
    if(!next){
     // Allow late subchunk replies to populate terrain before declaring failure.
     for(let retry=0;retry<3&&!next;retry++){c.requestNearby();await c.wait(800,combined);next=this.next(origin,visited,blocked);}
    }
    if(!next){console.log('[探索足場診断]',c.nearbySummary?.() || '周辺地形不明');notes.push('未探索の場所へ安全に移動できません。!TAKEN 周囲 で足場を確認してください');break;}
    if(pathLength+next.path.length-1>LIMITS.searchPath){notes.push('探索経路の上限');break;}pathLength+=next.path.length-1;
    c.client.emit('taken_notice',{message:'資源を探索中: '+name+'。探索地点 '+(steps+1)+'/'+LIMITS.searchStops+'。!stopで停止できます。'});
    steps++;if(!await move(next.target)){visited.push({...c.feet()});continue;}visited.push({...c.feet()});
   }
  }finally{c.stop();this.origin=null;}
  const collected=this.gains(baseline,spec),total=collected.reduce((n,i)=>n+i.count,0);
  const result={resource:name,requested:count,broken,collected,total,explorationStops:steps,pathLength,routeFailures,notes,verification:'server_inventory_increase'};
  console.log('[資源探索診断]',JSON.stringify(result));
  if(!broken && !total)throw Error('安全に採掘できる資源が見つかりません。'+(notes[0] || '読み取れた地形に対象がありません。'));
  return result;
 }
}

