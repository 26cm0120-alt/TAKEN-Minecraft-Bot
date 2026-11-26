import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {attachAIChat} from '../src/ai-chat.js';
const packet=(message,name='one')=>({type:'chat',source_name:name,message});
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(){const client=new EventEmitter();client.profile={name:'bot'};const messages=[];client.queue=(name,p)=>messages.push(p.message);return {client,messages};}
test('second player prompt is deferred but status is answered immediately',async()=>{
 const {client,messages}=fixture();let release,calls=0;
 const ai=attachAIChat(client,{owners:['*'],fetchImpl:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return {ok:true,json:async()=>({message:{content:'返答'}})};}});
 const running=ai.handle(packet('!TAKEN 最初の質問'));
 await ai.handle(packet('!TAKEN 次の質問','two'));assert.equal(calls,1);assert.match(messages.join(''),/待機列/);
 await ai.handle(packet('!TAKEN 状態','two'));assert.match(messages.at(-1),/Realmに接続中/);
 release();await running;await flush();assert.equal(calls,2);client.emit('close');
});
test('stop cancels current response and discards queued prompts',async()=>{
 const {client,messages}=fixture();let release,calls=0;
 const ai=attachAIChat(client,{owners:['*'],fetchImpl:async()=>{calls++;await new Promise(r=>release=r);return {ok:true,json:async()=>({message:{content:'古い返答'}})};}});
 const running=ai.handle(packet('!TAKEN 最初'));await ai.handle(packet('!TAKEN 次','two'));await ai.handle(packet('!stop'));release();await running;await flush();
 assert.equal(calls,1);assert.ok(!messages.includes('古い返答'));client.emit('close');
});
test('unauthorized user cannot inspect or resume waiting queue',async()=>{
 const {client,messages}=fixture();const ai=attachAIChat(client,{owners:['one']});
 await ai.handle(packet('!TAKEN 待機列','stranger'));await ai.handle(packet('!TAKEN 待機再開','stranger'));assert.equal(messages.length,0);client.emit('close');
});
test('initial respawn does not pause future requests',async()=>{
 const {client}=fixture();let calls=0;const ai=attachAIChat(client,{owners:['*'],fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({message:{content:'返答'}})};}});
 client.emit('taken_respawning');await ai.handle(packet('!TAKEN こんにちは'));assert.equal(calls,1);client.emit('close');
});
test('physical task finishes before the next player task starts',async()=>{
 const {client}=fixture();let release;const executed=[];
 const controls={status:()=>({health:20}),stop(){},execute:async a=>{executed.push(a.block);if(a.block==='dirt')await new Promise(r=>release=r);return {block:a.block,broken:1,pickup:{collected:[]}};}};
 const ai=attachAIChat(client,{owners:['*'],controls});const current=ai.handle(packet('!TAKEN 土を1個掘って'));
 await ai.handle(packet('!TAKEN 砂を1個掘って','two'));assert.deepEqual(executed,['dirt']);release();await current;await flush();assert.deepEqual(executed,['dirt','sand']);client.emit('close');
});
