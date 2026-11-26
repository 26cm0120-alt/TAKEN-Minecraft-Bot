const water=b=>b && /^(flowing_)?water$/.test(b.name);
const clear=b=>b && (water(b)||b.boundingBox==='empty'||['air','cave_air','void_air'].includes(b.name)) && !/lava|fire|cactus|magma|campfire|berry|powder_snow/.test(b.name);
export const inWater=(read,p)=>water(read({...p,y:p.y+0.1}));
export function waterBodyClear(read,p){
 for(const x of [-0.29,0.29])for(const z of [-0.29,0.29])for(const y of [0.02,0.9,1.78])if(!clear(read({x:p.x+x,y:p.y+y,z:p.z+z})))return false;
 return true;
}
export function surfaceWalkable(c,x,y,z){
 const read=p=>c.block(p),p={x,y,z};
 if(c.walkable(x,y,z))return true;
 if(!waterBodyClear(read,p))return false;
 for(const ox of [-0.29,0.29])for(const oz of [-0.29,0.29]){
  const foot=read({x:x+ox,y:y+0.1,z:z+oz}),floor=read({x:x+ox,y:y-0.05,z:z+oz});
  if(!water(foot) && !(clear(foot)&&floor?.boundingBox==='block'&&!/lava|water|fire|cactus|magma|campfire|berry|powder_snow/.test(floor.name)))return false;
  const head=read({x:x+ox,y:y+1.62,z:z+oz});if(!clear(head)||water(head))return false;
 }
 return true;
}
export function advanceSurface(c,feet,target){
 const read=p=>c.block(p),p={...feet};
 const submerged=water(read({...p,y:p.y+1.62}));
 // Surface automatically after a server correction; never plan a dive.
 const dy=submerged?0.1:target?Math.max(-0.08,Math.min(0.12,target.y-p.y)):0;
 const raised={...p,y:p.y+dy};if(waterBodyClear(read,raised))p.y=raised.y;
 let forward=false,blocked=false;
 if(target&&!submerged){const d=Math.hypot(target.x-p.x,target.z-p.z);
  if(d>0.08){const speed=Math.min(0.08,d),n={x:p.x+(target.x-p.x)/d*speed,y:p.y,z:p.z+(target.z-p.z)/d*speed};
   if(surfaceWalkable(c,n.x,n.y,n.z) || (waterBodyClear(read,n)&&water(read({...n,y:n.y-0.1})))){p.x=n.x;p.z=n.z;forward=true;}else blocked=true;
  }
 }
 return {feet:p,velocity:0,forward,blocked,jumpStarted:false,jumping:false,swimming:inWater(read,p),ascending:submerged || dy>0};
}
