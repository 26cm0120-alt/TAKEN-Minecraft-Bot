import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls} from './realm-controls.js';
test('partial mob movement preserves omitted coordinates',()=>{const client=new EventEmitter();client.queue=()=>{};const c=new RealmControls(client);c.entities.set('7',{uniqueId:'90',position:{x:1,y:64,z:3}});client.emit('move_entity_delta',{runtime_entity_id:7n,x:2,z:NaN});assert.deepEqual(c.entities.get('7').position,{x:2,y:64,z:3});client.emit('close');});
test('player removal matches unique ID rather than runtime ID',()=>{const client=new EventEmitter();client.queue=()=>{};const c=new RealmControls(client);client.emit('add_player',{runtime_id:7n,unique_id:90n,username:'owner',position:{x:1,y:64,z:3}});client.emit('add_player',{runtime_id:90n,unique_id:100n,username:'other',position:{x:2,y:64,z:3}});client.emit('remove_entity',{entity_id_self:90n});assert.equal(c.players.has('7'),false);assert.equal(c.players.has('90'),true);client.emit('close');});
