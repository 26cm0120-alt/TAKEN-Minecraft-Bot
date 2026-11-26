import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {RealmControls} from '../src/realm-controls.js';
const require=createRequire(import.meta.url);
const Stream=require('prismarine-chunk/src/bedrock/common/Stream');
function fixture(){
 const client=new EventEmitter();client.queue=()=>{};
 const c=new RealmControls(client);
 c.registry.handleStartGame({itemstates:c.registry.writeItemStates(),block_network_ids_are_hashes:true});
 const id=name=>Number(Object.keys(c.registry.blocksByRuntimeId).find(k=>c.registry.blocksByRuntimeId[k].name===name));
 const payload=(name,y=4)=>{const s=new Stream();s.writeUInt8(9);s.writeUInt8(1);s.writeUInt8(y&255);s.writeUInt8(1);const rid=id(name);s.writeVarInt(((rid<<1)^(rid>>31))>>>0);return s.getBuffer();};
 const section=(name,y=4)=>c.loadSubchunks({dimension:0,cache_enabled:false,origin:{x:0,y,z:0},entries:[{dx:0,dy:0,dz:0,result:'success',payload:payload(name,y)}]});
 return {c,client,id,payload,section};
}
test('fresh subchunk snapshot replaces older individual block updates only in its section',async()=>{
 const {c,client,id,section}=fixture();
 client.emit('update_block',{position:{x:1,y:64,z:1},block_runtime_id:id('dirt'),layer:0});
 client.emit('update_block',{position:{x:1,y:80,z:1},block_runtime_id:id('stone'),layer:0});
 await section('air');
 assert.equal(c.block({x:1,y:64,z:1}).name,'air');
 assert.equal(c.block({x:1,y:80,z:1}).name,'stone');
 client.emit('update_block',{position:{x:1,y:64,z:1},block_runtime_id:id('dirt'),layer:0});
 assert.equal(c.block({x:1,y:64,z:1}).name,'dirt');
});
test('all-air subchunk replaces an existing solid section and its updates',async()=>{
 const {c,client,id,section}=fixture();await section('dirt');
 client.emit('update_block',{position:{x:1,y:64,z:1},block_runtime_id:id('stone'),layer:0});
 await c.loadSubchunks({dimension:0,cache_enabled:false,origin:{x:0,y:4,z:0},entries:[{dx:0,dy:0,dz:0,result:'success_all_air'}]});
 assert.equal(c.block({x:2,y:64,z:2}).name,'air');
 assert.equal(c.block({x:1,y:64,z:1}).name,'air');
});
test('level chunk snapshots supersede older updates including negative section Y',()=>{
 const {c,client,id,payload}=fixture();
 client.emit('update_block',{position:{x:1,y:-16,z:1},block_runtime_id:id('dirt'),layer:0});
 c.loadChunk({dimension:0,x:0,z:0,sub_chunk_count:1,cache_enabled:false,payload:payload('air',-1)});
 assert.equal(c.block({x:1,y:-16,z:1}).name,'air');
});
test('evicting distant columns also removes individual updates',async()=>{
 const {c,client,id,section}=fixture();await section('dirt');
 client.emit('update_block',{position:{x:1,y:64,z:1},block_runtime_id:id('dirt'),layer:0});
 for(let x=1;x<=101;x++)c.column(x,0);
 c.position={x:1600,y:65.62,z:0};c.requestNearby();
 assert.equal(c.chunks.has('0,0'),false);
 assert.equal(c.block({x:1,y:64,z:1}),null);
});
