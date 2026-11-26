import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResourceSearch} from './resource-search.js';
function setup(cells){
 const c={feet:()=>({x:.5,y:64,z:.5}),walkable:(x,y,z)=>y===64&&cells.has(Math.floor(x)+','+Math.floor(z)),block:p=>({name:Math.floor(p.y)<64?'stone':'air',boundingBox:Math.floor(p.y)<64?'block':'empty'})};return new ResourceSearch(c);
}
test('short known corridor can be explored without a six-block endpoint',()=>{
 const s=setup(new Set(['0,0','1,0','2,0','3,0'])),origin=s.c.feet();const n=s.next(origin,[origin]);assert.equal(n.target.x,3.5);assert.equal(n.path.length,4);
});
test('bent corridor selects a reachable endpoint rather than distant rays',()=>{
 const cells=new Set(['0,0','1,0','2,0','2,1','2,2','2,3','2,4']),s=setup(cells),origin=s.c.feet(),n=s.next(origin,[origin]);assert.deepEqual(n.target,{x:2.5,y:64,z:4.5});assert.ok(n.path.every(p=>cells.has(p.x+','+p.z)));
});
test('isolated or visited known area never invents a path',()=>{
 const s=setup(new Set(['0,0'])),origin=s.c.feet();assert.equal(s.next(origin,[origin]),null);
 const t=setup(new Set(['0,0','1,0','2,0']));assert.equal(t.next(origin,[origin,{x:1.5,y:64,z:.5},{x:2.5,y:64,z:.5}]),null);
});
