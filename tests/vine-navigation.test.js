import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls} from '../src/realm-controls.js';
import {planStepPath,advanceStep,bodyClear} from '../src/step-movement.js';
function fixture(){
 const client=new EventEmitter();const sent=[];client.queue=(name,params)=>sent.push({name,params});
 const c=new RealmControls(client);c.ready=true;c.health=20;c.position={x:.5,y:65.62,z:.5};
 c.block=p=>Math.floor(p.y)<64?{name:'dirt',boundingBox:'block'}:Math.floor(p.x)===1&&Math.floor(p.z)===0?{name:'vine',boundingBox:'empty'}:{name:'air',boundingBox:'empty'};
 return {c,client,sent};
}
test('walking route detours around vines rather than treating them as air',()=>{
 const {c}=fixture();assert.equal(c.walkable(1.5,64,.5),false);
 const path=planStepPath(c,{x:3.5,y:64,z:.5},.6);
 assert.ok(path);assert.ok(path.every(p=>!(p.x===1&&p.z===0)));assert.ok(path.some(p=>p.z!==0));
});
test('jump and walking inputs do not push forward into climbable surfaces',()=>{
 const {c}=fixture();
 for(const velocity of [0,.2]){
  const result=advanceStep(p=>c.block(p),{x:.7,y:64,z:.5},{x:2.5,y:64,z:.5},velocity);
  assert.equal(result.forward,false);assert.equal(result.blocked,true);assert.equal(result.feet.x,.7);
 }
});
test('server correction onto vines stops an active walk without inventing a new location',()=>{
 const {c,client}=fixture();c.walkTarget={x:3.5,y:64,z:.5};
 const position={x:1.5,y:66.62,z:.5};
 client.emit('correct_player_move_prediction',{prediction_type:'player',position,delta:{y:.2},tick:3n});
 assert.equal(c.walkTarget,null);assert.equal(c.verticalVelocity,0);assert.deepEqual(c.position,position);
});
test('body check detects torso obstacles and keeps harmless grass walkable',()=>{
 const {c}=fixture();c.block=p=>p.y<64?{name:'dirt',boundingBox:'block'}:p.y>64.5&&p.y<65.1?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'};
 assert.equal(c.walkable(.5,64,.5),false);
 assert.equal(bodyClear(()=>({name:'short_grass',boundingBox:'empty'}),.5,64,.5),true);
});
