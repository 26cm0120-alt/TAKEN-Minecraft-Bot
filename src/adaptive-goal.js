import {materialRequirements,inventoryFingerprint,actionGain,readyCraft} from './goal-evidence.js';
import {canonicalItem} from './capabilities.js';
import {requestLocalAI} from './local-ai-request.js';
import {toolCondition} from './tool-condition.js';

export function parseAdaptiveGoal(text){
 if(!/^目標(?:\s|[:：])/.test(text.trim()))return null;
 const m=text.normalize('NFKC').trim().replace(/^目標[\s:：]+/,'').match(/^(.+?)を\s*(\d+)\s*(?:個|本)(?:用意して|そろえて|揃えて|作って|集めて)[。!！]?$/u);
 const item=m&&canonicalItem(m[1].trim()),count=Number(m?.[2]);
 if(!item||!Number.isInteger(count)||count<1||count>64)throw Error('目標は実在するアイテム1〜64個で指定してください。例: 目標 石のツルハシを1個用意して');
 return {item,count};
}
const schema={type:'object',properties:{reason:{type:'string'},action:{type:'object',properties:{type:{type:'string',enum:['gather','collect','craft','smelt','return_home','stop']},item:{type:'string'},count:{type:'integer'}},required:['type'],additionalProperties:false}},required:['reason','action'],additionalProperties:false};
function inventory(c){return c.items.slice(0,36).filter(i=>i?.count>0).map(i=>({item:c.registry.items[i.network_id]?.name||'unknown',count:i.count,remaining:toolCondition(i,c.registry)?.remaining??null,ratio:toolCondition(i,c.registry)?.ratio??null}));}
function countGoal(c,goal){return inventory(c).filter(i=>i.item===goal.item&&(!c.registry.itemsByName?.[i.item]?.maxDurability||(i.ratio!==null&&i.ratio>.2))).reduce((n,i)=>n+i.count,0);}
function recipeHints(c,goal){
 const wanted=new Set([goal.item,'stick','wooden_pickaxe','stone_pickaxe','crafting_table','furnace']);
 for(const i of inventory(c))if(/_log$/.test(i.item))wanted.add(i.item.replace(/_log$/,'_planks'));
 wanted.add('oak_planks');
 return [...(c.crafting?.recipes?.values()||[])].filter(r=>wanted.has(c.registry.items[r.output?.[0]?.network_id]?.name)).slice(0,24).map(r=>({item:c.registry.items[r.output[0].network_id].name,count:r.output[0].count,ingredients:r.input?.filter(i=>i.count>0).map(i=>({name:i.name,tag:i.tag,count:i.count}))}));
}
function validateAction(a,c){
 if(!a||!['gather','collect','craft','smelt','return_home','stop'].includes(a.type))throw Error('目標計画に未対応の操作が含まれています。');
 if(['return_home','stop'].includes(a.type))return {type:a.type};
 if(!Number.isInteger(a.count)||a.count<1||a.count>(a.type==='smelt'?16:64))throw Error('目標計画の個数が不正です。');
 if(typeof a.item!=='string'||!(a.type==='gather'&&a.item==='wood')&&!c.registry.itemsByName?.[a.item])throw Error('目標計画のアイテム名が不正です。');
 return {type:a.type,item:a.item,count:a.count};
}
export async function runAdaptiveGoal({goal,controls:c,sender,signal,say,model,fetchImpl=fetch,planStep}){
 c.check(signal);if(!c.pickup.inventoryReady)throw Error('持ち物全体が未受信です。');
 const origin={...c.feet()},previous=c.autonomousOrigin;
 if(!['x','y','z'].every(k=>Number.isFinite(origin[k])))throw Error('開始地点が未取得です。');
 const combined=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(600000)]);
 const state={goal,phase:'計画',steps:0,replans:0,have:countGoal(c,goal),history:[]};
 c.adaptiveGoal=state;c.autonomousOrigin=origin;
 const budgets={gather:0,collect:0,craft:0,smelt:0},failures=new Set();
 const check=()=>{combined.throwIfAborted();c.check(combined);const p=c.feet();if(Math.hypot(p.x-origin.x,p.z-origin.z)>256)throw Error('目標の開始地点から256ブロックを超えました。');};
 const plan=planStep|| (async context=>{
  const result=await requestLocalAI(fetchImpl,{model,stream:false,format:schema,messages:[
   {role:'system',content:'Minecraftの持ち物目標を達成する計画担当。次の1工程だけJSONで返す。現在の所持数と直前の結果を使う。materialRequirementsはコードで計算した必要数・割当済み数・不足数。割当済みの材料を重複して数えない。producesはレシピ単位の完成数であり、必要なレシピ回数を切り上げている。不足分だけ調達する。成功を推測しない。実行可能: gather(item,count)は原木woodや露出した鉱石raw_iron、coal、丸石cobblestone等の探索回収。craftは完成品の希望個数。smeltは生の材料名と個数、空の通常かまどと石炭/木炭が必要。collectは落下アイテム。return_homeは開始地点へ帰る。stopは理由を説明して停止。作業台等の設備は自動設置できない。木→板材→棒→木のツルハシ→丸石→石のツルハシ→原鉄と石炭→鉄インゴット→鉄道具の依存順を守る。採掘から戻ったら必要に応じreturn_homeして出発地点の設備を使う。道具の素材名やレシピを創作しない。持ち物増加を確認できない同じ操作は再提案せず、collectや足りない道具の作成など別の解決を提案する。必要な設備がなければstopで設置を依頼する。建築・戦闘・投棄・地下掘進は計画しない。残り予算を守る。reasonは日本語の短い理由。'},
   {role:'user',content:JSON.stringify(context)}],options:{temperature:0,num_predict:256}},combined);
  return JSON.parse((result.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'').replace(/^```(?:json)?\s*|\s*```$/g,'').trim());
 });
 try{
  say('目標: '+goal.item+'を所持合計'+goal.count+'個用意します。最大12工程・計画見直し3回。!stopで停止。');
  while(state.steps<12){
   check();state.have=countGoal(c,goal);
   if(state.have>=goal.count){state.phase='達成';say('目標達成を持ち物で確認: '+goal.item+' '+state.have+'/'+goal.count+'個。');return {complete:true,...state};}
   state.phase='計画';
   const before=inventory(c),context={goal,inventory:before,position:c.feet(),origin,health:c.health,food:c.food,recipes:recipeHints(c,goal),materialRequirements:materialRequirements(c,goal.item,goal.count-state.have),history:state.history.slice(-6),remaining:{steps:12-state.steps,gather:64-budgets.gather,collect:64-budgets.collect,craft:64-budgets.craft,smelt:16-budgets.smelt}};
   let proposed,a;
   try{
    const direct=readyCraft(c,goal.item,goal.count-state.have);
    proposed=direct&&!failures.has(JSON.stringify([direct.action,inventoryFingerprint(before)]))?direct:await plan(context);
    check();a=validateAction(proposed.action,c);
   }catch(e){
    check();if(!(e instanceof SyntaxError)&&!String(e.message).includes('目標計画'))throw e;
    state.replans++;state.history.push({action:{type:'plan'},error:String(e.message).slice(0,250)});
    if(state.replans>=3)throw Error('計画の形式・内容を修正できなかったため停止しました。'+e.message);
    say('計画の形式・内容を見直します。');continue;
   }
   if(a.type==='stop')throw Error(String(proposed.reason||'実行できる計画がありません。').slice(0,250));
   const key=JSON.stringify([a,inventoryFingerprint(before)]);
   if(failures.has(key))throw Error('同じ持ち物で失敗した操作が再提案されたため停止しました。');
   if(a.count){budgets[a.type]+=a.count;if(budgets[a.type]>(a.type==='smelt'?16:64))throw Error('目標全体の'+a.type+'上限に達しました。');}
   state.steps++;state.phase='実行';say('目標 '+state.steps+'/12: '+a.type+(a.item?' '+a.item+'×'+a.count:'')+'。');
   const action=a.type==='return_home'?{type:'move',...origin}:a.type==='gather'?{type:'gather',block:a.item,count:a.count}:a;
   try{
    await c.execute(action,sender,combined);check();
    if(a.type==='return_home'){
     const p=c.lastAuthoritativePosition;if(!p||Math.hypot(p.x-origin.x,p.y-1.62-origin.y,p.z-origin.z)>1.5)throw Error('開始地点への帰還を確認できません。');
     if(state.history.at(-1)?.action.type==='return_home')throw Error('帰還だけを繰り返しているため停止します。');
    }else if(actionGain(a,before,inventory(c))<=0)throw Error('対象の材料・完成品の増加を確認できません。');
    state.have=countGoal(c,goal);
    state.history.push({action:a,result:'対象品の増加または帰還を確認',gained:a.type==='return_home'?null:actionGain(a,before,inventory(c))});
   }catch(e){
    check();failures.add(key);state.replans++;state.phase='計画見直し';
    state.history.push({action:a,error:String(e.message).slice(0,250)});
    // Uncertain item-stack operations must not be retried until inventory resynchronizes.
    if(c.crafting?.uncertain||c.crafting?.pending||c.furnace?.window)throw Error('所持品操作が未確定です。再計画を止めます。'+e.message);
    if(state.replans>=3)throw Error('計画見直しの上限に達しました。'+e.message);
    say('計画を見直します: '+String(e.message).slice(0,150));
   }
  }
  state.have=countGoal(c,goal);
  if(state.have>=goal.count){state.phase='達成';say('目標達成を持ち物で確認: '+goal.item+' '+state.have+'/'+goal.count+'個。');return {complete:true,...state};}
  throw Error('12工程で目標を達成できませんでした。');
 }catch(e){state.phase=combined.aborted?'中断':'停止';state.reason=e.message;state.have=countGoal(c,goal);throw e;}
 finally{c.autonomousOrigin=previous;c.stop();}
}
