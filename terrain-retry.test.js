import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RealmControls} from './realm-controls.js';
test('terrain requests cover five columns and retry missing sections with backoff',()=>{const sent=[],c=Object.create(RealmControls.prototype);Object.assign(c,{position:{x:0,y:65,z:0},dimension:0,requested:new Set(),loaded:new Set(),chunks:new Map(),client:{queue:(n,p)=>sent.push(p)}});c.requestNearby();assert.equal(sent[0].requests.length,75);c.requestNearby();assert.equal(sent.length,1);c.loaded.add('0,4,0');for(const k of c.terrainRequestTimes.keys())c.terrainRequestTimes.set(k,Date.now()-11000);c.requestNearby();assert.equal(sent[1].requests.length,74);assert.ok(sent[1].requests.every(p=>!(p.x===0&&p.y===0&&p.z===0)));});
