import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {attachAIChat} from '../src/ai-chat.js';
import {DragonPlanner,dragonCommand} from '../src/dragon-planner.js';
function fixture(state){const client=new EventEmitter(),messages=[];client.profile={name:'bot'};client.queue=(n,p)=>messages.push(p.message);let llm=0;const controls={status:()=>({health:20}),stop(){}};const ai=attachAIChat(client,{owners:['*'],controls,dragonStore:{load:()=>structuredClone(state),save(){}},fetchImpl:async()=>{llm++;throw Error('must not call AI');}});return {client,messages,ai,llm:()=>llm};}
test('natural resume phrases bypass language model and resume saved phase',async()=>{
 const old=DragonPlanner.prototype.run,oldIron=DragonPlanner.prototype.runIron;const calls=[];
 DragonPlanner.prototype.run=async()=>calls.push(1);DragonPlanner.prototype.runIron=async()=>calls.push(2);
 try{for(const stage of [1,2])for(const phrase of ['再開して','討伐再開','続けて']){assert.equal(dragonCommand(phrase),'resume');const f=fixture({version:1,events:[],status:'paused',stage});await f.ai.handle({type:'chat',source_name:'player',message:'!TAKEN '+phrase});assert.equal(f.llm(),0);assert.equal(calls.at(-1),stage);f.client.emit('close');}}finally{DragonPlanner.prototype.run=old;DragonPlanner.prototype.runIron=oldIron;}
});
test('resume without saved work or after completion returns guidance without actions',async()=>{
 for(const status of ['ready','stone_tools_ready','iron_ready']){const f=fixture({version:1,events:[],status});await f.ai.handle({type:'chat',source_name:'player',message:'!TAKEN 再開して'});assert.equal(f.llm(),0);assert.ok(f.messages.some(m=>/ありません|完了/.test(m)));f.client.emit('close');}
});
