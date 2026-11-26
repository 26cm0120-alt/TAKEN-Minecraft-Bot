import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmRecovery} from '../src/realm-recovery.js';
function client(){const c=new EventEmitter();c.close=()=>c.emit('close');c._nethernetCleanup=Promise.resolve();return c;}
const shutdown=()=>new Error('Signal connection closed (1001): Signaling server instance is shutting down.');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('known signaling shutdown closes old connection and reconnects once with bounded delay',async()=>{const sessions=[client()],waits=[],r=new RealmRecovery(()=>{const c=client();sessions.push(c);return c;},{now:()=>0,wait:async ms=>waits.push(ms)});r.attach(sessions[0]);sessions[0].emit('error',shutdown());sessions[0].emit('error',shutdown());await settle();assert.equal(sessions.length,2);assert.equal(r.current,sessions[1]);assert.ok(waits.includes(5000));sessions[0].emit('error',shutdown());await settle();assert.equal(sessions.length,2);r.stop();});
test('authentication errors, kicks and ordinary close do not trigger retries',async()=>{for(const kind of ['auth','kick','close']){const c=client();let calls=0;const r=new RealmRecovery(()=>{calls++;return client();},{wait:async()=>{}});r.attach(c);if(kind==='auth')c.emit('error',new Error('401 Unauthorized'));if(kind==='kick'){c.emit('kick',{reason:'server_id_conflict'});c.emit('error',shutdown());}if(kind==='close')c.emit('close');await settle();assert.equal(calls,0);r.stop();}});
test('signaling recovery shares the two-attempt limit and never resumes mining',async()=>{const sessions=[client()],waits=[],r=new RealmRecovery(()=>{const c=client();sessions.push(c);return c;},{now:()=>0,wait:async ms=>waits.push(ms)});r.attach(sessions[0]);for(let i=0;i<3;i++){r.current.emit('error',shutdown());await settle();}assert.equal(sessions.length,3);assert.ok(waits.includes(10000));r.stop();});
