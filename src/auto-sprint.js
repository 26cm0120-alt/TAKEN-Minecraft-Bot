// Decide from current received terrain, not from the LLM's description.
export function shouldAutoSprint(c){
 const f=c.feet(),t=c.walkTarget;
 if(!f||!t||c.navigationMode!=='walk'||c.health===null||c.health<=8||c.food===null||c.food<=6||c.verticalVelocity!==0||c.sleeping||c.respawning)return false;
 const distance=Math.hypot(t.x-f.x,t.z-f.z);
 // Hysteresis prevents repeated start/stop inputs around the start threshold.
 if(distance<=(c.autoSprintActive?2:4)||Math.abs(t.y-f.y)>0.05)return false;
 const dx=(t.x-f.x)/distance,dz=(t.z-f.z)/distance;
 // Verify a wider corridor so unknown ground, water, edges and obstacles
 // slow us down before they enter the player's immediate collision box.
 for(let along=0;along<=2;along+=0.5)for(const side of [-0.65,0,0.65]){
  if(!c.walkable(f.x+dx*along-dz*side,f.y,f.z+dz*along+dx*side))return false;
 }
 return true;
}
