const offsets=[-0.29,0.29],hazard=/lava|water|fire|cactus|magma|campfire|berry|powder_snow/;
const solid=b=>b && b.boundingBox==='block' && !hazard.test(b.name);
const climbable=new Set(['vine','ladder','scaffolding','weeping_vines','weeping_vines_plant','twisting_vines','twisting_vines_plant']);
export function touchesClimbable(read,x,y,z){
 for(const ox of offsets)for(const oz of offsets)for(const h of [0.02,0.9,1.78]){
  if(climbable.has(read({x:x+ox,y:y+h,z:z+oz})?.name))return true;
 }
 return false;
}
export function bodyClear(read,x,y,z){
 for(const ox of offsets)for(const oz of offsets)for(const h of [0.02,0.9,1.78]){const b=read({x:x+ox,y:y+h,z:z+oz});if(!b || climbable.has(b.name) || hazard.test(b.name) || (b.boundingBox!=='empty' && !['air','cave_air','void_air'].includes(b.name)))return false;}
 return true;
}
function safeBelow(read,x,z,minY,maxY){
 for(const ox of offsets)for(const oz of offsets){let supported=false;for(let y=Math.floor(maxY)-1;y>=Math.floor(minY)-1;y--){const b=read({x:x+ox,y:y+0.5,z:z+oz});if(!b || hazard.test(b.name))return false;if(solid(b)){supported=true;break;}}if(!supported)return false;}return true;
}
function landing(read,x,z,from,to){
 let highest=null;
 for(const ox of offsets)for(const oz of offsets)for(let y=Math.floor(from+0.001)-1;y>=Math.floor(to)-1;y--){const top=y+1;if(top<to-0.001 || top>from+0.001)continue;if(solid(read({x:x+ox,y:y+0.5,z:z+oz})))highest=highest===null?top:Math.max(highest,top);}
 return highest;
}
export function planStepPath(controls,target,radius){
 const f=controls.feet(),start={x:Math.floor(f.x),y:Math.round(f.y),z:Math.floor(f.z)};
 const key=p=>p.x+','+p.y+','+p.z,queue=[start],parent=new Map([[key(start),null]]);let found,index=0;
 const goalRadius=Math.max(radius,Math.SQRT1_2+0.01);
 while(index<queue.length && parent.size<5000){const p=queue[index++];if(Math.hypot(p.x+0.5-target.x,p.z+0.5-target.z)<=goalRadius && Math.abs(p.y-target.y)<0.2){found=p;break;}
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])for(const dy of [0,1,-1]){
   const n={x:p.x+dx,y:p.y+dy,z:p.z+dz};if(parent.has(key(n)) || Math.hypot(n.x-start.x,n.z-start.z)>24 || Math.abs(n.y-start.y)>8 || !controls.walkable(n.x+0.5,n.y,n.z+0.5))continue;
   // A step up needs jump headroom at the source and clearance above the
   // destination. Two-high walls, gaps, and unknown floors are never edges.
   if(dy===1 && !bodyClear(q=>controls.block(q),p.x+0.5,p.y+1.26,p.z+0.5))continue;
   if(dy===-1 && !bodyClear(q=>controls.block(q),n.x+0.5,p.y,n.z+0.5))continue;
   parent.set(key(n),p);queue.push(n);
  }
 }
 if(!found)return null;const path=[];for(let n=found;n;n=parent.get(key(n)))path.unshift(n);return path;
}
export function smoothStepPath(path){
 return path.filter((p,i)=>{
  if(i===0 || i===path.length-1)return true;
  const a=path[i-1],b=path[i+1];
  return a.y!==p.y || p.y!==b.y || p.x-a.x!==b.x-p.x || p.z-a.z!==b.z-p.z;
 });
}
export function advanceStep(read,feet,target,velocity=0,{sprint=false}={}){
 let p={...feet},vy=velocity,jumpStarted=false,blocked=false,forward=false;
 const groundedBefore=landing(read,p.x,p.z,p.y+0.02,p.y-0.02)!==null;
 const rise=target?target.y-p.y:0;
 if(target && rise>0.1 && groundedBefore && vy<=0){
  if(!bodyClear(read,p.x,p.y+1.26,p.z))return {feet:p,velocity:0,grounded:true,blocked:true,forward:false,jumpStarted:false,jumping:false};
  vy=0.42;jumpStarted=true;
 }
 let ny=p.y+vy;
 if(target){const d=Math.hypot(target.x-p.x,target.z-p.z);if(d>0.08){
  const speed=Math.min(sprint?0.13:0.1,d),nx=p.x+(target.x-p.x)/d*speed,nz=p.z+(target.z-p.z)/d*speed;
  forward=true;
  if(bodyClear(read,nx,ny,nz) && safeBelow(read,nx,nz,Math.min(p.y,target.y)-1,Math.max(p.y,target.y))){p.x=nx;p.z=nz;}
  else {blocked=true;if((vy===0 && rise<=0.1) || touchesClimbable(read,nx,ny,nz))forward=false;}
 }}
 let grounded=false;
 if(vy<=0){const floor=landing(read,p.x,p.z,feet.y+0.001,ny);if(floor!==null){ny=floor;vy=0;grounded=true;}}
 if(!bodyClear(read,p.x,ny,p.z)){ny=feet.y;vy=0;blocked=true;}
 p.y=ny;
 if(!grounded && (target || velocity!==0 || jumpStarted))vy=(vy-0.08)*0.98;
 return {feet:p,velocity:vy,grounded,blocked,forward,jumpStarted,jumping:jumpStarted || (!grounded && (velocity!==0 || vy!==0))};
}
