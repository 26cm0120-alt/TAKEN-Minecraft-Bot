import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dictionary,lookupName} from '../src/item-dictionary.js';
import {canonicalItem,canonicalBlock} from '../src/capabilities.js';
import {smoothStepPath} from '../src/step-movement.js';
test('all registered item and block IDs resolve and fictional items fail',()=>{
 for(const id of Object.keys(dictionary.items.names))assert.equal(lookupName(id),id);
 for(const id of Object.keys(dictionary.blocks.names))assert.equal(lookupName(id,'blocks'),id);
 assert.equal(canonicalItem('wooden_knife'),null);assert.equal(canonicalItem('木のナイフ'),null);
});
test('official Japanese names resolve with normalization and ambiguous names are not guessed',()=>{
 assert.equal(canonicalItem('弓'),'bow');assert.equal(canonicalItem('ネザライトのツルハシ'),'netherite_pickaxe');assert.equal(canonicalItem('黒色のバンドル'),'black_bundle');assert.equal(canonicalBlock('黒曜石'),'obsidian');assert.equal(canonicalItem('minecraft:bow'),'bow');
 for(const name of dictionary.items.ambiguous)assert.equal(dictionary.items.aliases[name],undefined);
});
test('path smoothing removes straight waypoints but retains turns and every height transition',()=>{
 const path=[{x:0,y:64,z:0},{x:1,y:64,z:0},{x:2,y:64,z:0},{x:2,y:64,z:1},{x:2,y:65,z:2},{x:2,y:65,z:3}];
 assert.deepEqual(smoothStepPath(path),[path[0],path[2],path[3],path[4],path[5]]);assert.deepEqual(smoothStepPath([]),[]);
});
