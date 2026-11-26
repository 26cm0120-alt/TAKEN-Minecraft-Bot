import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {attachAIChat, textPacket} from './ai-chat.js';
function client() {
  const c = new EventEmitter(); c.profile = {name:'TAKE6866', xuid:'123'}; c.sent=[];
  c.queue = (name, packet) => c.sent.push(packet.message); return c;
}
const packet = (message, source_name='Takken1212') => ({type:'chat', source_name, message});
test('a masked mining command asks for a resend and a clear resend mines only the named log',async()=>{
  const c=client(),actions=[];let calls=0;
  const controls={status:()=>({health:20}),execute:async action=>{
    actions.push(action);return {broken:1,block:action.block};
  }};
  const ai=attachAIChat(c,{controls,fetchImpl:async()=>{calls++;throw Error('unexpected model request');}});
  await ai.handle(packet('!TAKEN ジャングル##木を1個掘って'));
  assert.equal(c.sent.length,1);assert.match(c.sent[0],/!TAKEN じゃんぐるのげんぼくを1個掘って/);
  assert.deepEqual(actions,[]);
  await ai.handle(packet('!TAKEN じゃんぐるのげんぼくを1個掘って'));
  assert.equal(calls,0);assert.deepEqual(actions,[{type:'mine',block:'jungle_log',count:1}]);
  c.emit('close');
});
test('death recovery answers immediately without invoking the model',async()=>{
 const c=client();let calls=0;const controls={status:()=>({health:0,respawning:true})};
 const ai=attachAIChat(c,{controls,fetchImpl:async()=>{calls++;throw Error('must not generate while dead');}});
 await ai.handle(packet('!TAKEN まだ？'));assert.equal(calls,0);assert.match(c.sent.join(''),/復活待ち/);c.emit('close');
});
test('only authorized player commands invoke local AI; replies do not invoke it', async () => {
  const c=client(); let calls=0;
  const ai=attachAIChat(c, {fetchImpl:async (url, options) => {
    calls++; assert.equal(url,'http://127.0.0.1:11434/api/chat');
    assert.equal(options.headers.Authorization,undefined);
    return {ok:true,json:async()=>({message:{content:'こんにちは。'}})};
  }});
  await ai.handle(packet('!TAKEN hello','stranger'));
  await ai.handle(packet('!TAKEN hello','TAKE6866'));
  await ai.handle(packet('普通の会話'));
  assert.equal(calls,0);
  await ai.handle(packet('!taken こんにちは'));
  assert.equal(calls,1); assert.equal(c.sent.at(-1),'こんにちは。');
});
test('stop aborts generation and prevents stale answer', async () => {
  const c=client(); let resolve;
  const ai=attachAIChat(c, {fetchImpl:()=>new Promise(r=>{resolve=r;})});
  const pending=ai.handle(packet('!TAKEN hello'));
  await ai.handle(packet('!stop'));
  resolve({ok:true,json:async()=>({message:{content:'stale'}})});
  await pending;
  assert.equal(c.sent.at(-1),'停止しました。'); assert.ok(!c.sent.includes('stale'));
});
test('Realm sender formatting is removed before authorization and self filtering', async () => {
  const c=client(); let calls=0;
  const ai=attachAIChat(c,{fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({message:{content:'返答成功'}})};}});
  await ai.handle(packet('!TAKEN こんにちは','Takken1212§r'));
  assert.equal(calls,1); assert.equal(c.sent.at(-1),'返答成功');
  await ai.handle(packet('!TAKEN hello','stranger§r'));
  await ai.handle(packet('!TAKEN hello','TAKE6866§r'));
  assert.equal(calls,1);
});
test('close suppresses reply and status/help never calls model', async () => {
  const c=client(); let resolve;
  const ai=attachAIChat(c,{fetchImpl:()=>new Promise(r=>{resolve=r;})});
  await ai.handle(packet('!TAKEN 状態'));
  assert.match(c.sent.at(-1),/会話のみ/);
  const pending=ai.handle(packet('!TAKEN hello'));
  c.emit('close'); const count=c.sent.length;
  resolve({ok:true,json:async()=>({message:{content:'stale'}})});
  await pending; assert.equal(c.sent.length,count);
});
test('chat packet serializes with installed Bedrock 26.51 protocol', () => {
  const require=createRequire(import.meta.url);
  const {createSerializer,createDeserializer}=require('./node_modules/bedrock-protocol/src/transforms/serializer.js');
  const params=textPacket({name:'TAKE6866',xuid:'123'},'こんにちは。');
  const buffer=createSerializer('1.26.60').createPacketBuffer({name:'text',params});
  const decoded=createDeserializer('1.26.60').parsePacketBuffer(buffer).data;
  assert.equal(decoded.params.message,params.message);
  assert.equal(decoded.params.source_name,'TAKE6866');
});
