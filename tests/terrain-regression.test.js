import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls} from '../src/realm-controls.js';
function controls(){const c=new EventEmitter();c.queue=()=>{};const b=new RealmControls(c);b.position={x:-109.5,y:76.62,z:313.5};return b;}
test('noncolliding grass and flowers allow walking while water and solid blocks do not',()=>{
  const b=controls();
  b.block=p=>p.y<75?{name:'grass_block',boundingBox:'block'}:{name:'short_grass',boundingBox:'empty'};
  assert.equal(b.walkable(-108.5,75,313.5),true);
  b.block=p=>p.y<75?{name:'dirt',boundingBox:'block'}:{name:'water',boundingBox:'empty'};
  assert.equal(b.walkable(-108.5,75,313.5),false);
});
test('dirt search includes grass blocks, but all blocks supporting player remain protected',()=>{
  const b=controls();
  assert.equal(b.mineMatches('dirt',{name:'grass_block'}),true);
  assert.equal(b.mineMatches('dirt',{name:'stone'}),false);
  assert.equal(b.supportsPlayer({x:-110,y:74,z:313}),true);
  assert.equal(b.supportsPlayer({x:-109,y:74,z:313}),false);
});
