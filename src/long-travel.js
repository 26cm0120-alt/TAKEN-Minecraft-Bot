import {planStepPath} from './step-movement.js';
import {LIMITS} from './capabilities.js';
export async function travelFar(c,target,signal,radius=0.6){
 const start={...c.feet()},horizontal=p=>Math.hypot(p.x-target.x,p.z-target.z);
 if(horizontal(start)>LIMITS.travelRadius || Math.abs(start.y-target.y)>8)throw Error('遠距離移動は256ブロック以内・高低差8以内です。');
 const timeout=AbortSignal.timeout(600000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const visited=new Set();let legs=0;
 try{
  while(horizontal(c.feet())>20){
   c.check(combined);if(legs>=64)throw Error('遠距離移動の区間上限に達しました。');
   c.requestNearby();await c.wait(400,combined);const f=c.feet(),angle=Math.atan2(target.z-f.z,target.x-f.x),options=[];
   for(const length of [16,12,8])for(const turn of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2])for(const dy of [0,1,-1,2,-2,3,-3,4,-4]){
    const p={x:Math.floor(f.x+Math.cos(angle+turn)*length)+0.5,y:Math.round(f.y)+dy,z:Math.floor(f.z+Math.sin(angle+turn)*length)+0.5};
    const k=p.x+','+p.y+','+p.z;
    if(visited.has(k) || horizontal(p)>=horizontal(f)-1 || Math.hypot(p.x-start.x,p.z-start.z)>LIMITS.travelRadius || Math.abs(p.y-start.y)>8 || !c.walkable(p.x,p.y,p.z))continue;
    options.push({p,k});
   }
   options.sort((a,b)=>horizontal(a.p)-horizontal(b.p));let chosen;
   for(const o of options){const path=planStepPath(c,o.p,0.6);if(path && path.every(p=>Math.hypot(p.x-start.x,p.z-start.z)<=LIMITS.travelRadius && Math.abs(p.y-start.y)<=8)){chosen=o;break;}}
   if(!chosen)throw Error('目的地へ近づく安全な経路が見つかりません。未知の地形・水・大きな障害物では停止します。');
   visited.add(chosen.k);await c.goto(chosen.p,combined);legs++;
   if(legs%4===0)c.client.emit('taken_notice',{message:'遠距離移動中。残り約'+Math.round(horizontal(c.feet()))+'ブロック。!stopで停止できます。'});
  }
  const result=await c.goto(target,combined,radius);return {...result,travelLegs:legs};
 }finally{c.stop();}
}
