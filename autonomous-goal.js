import {resourceSpec} from './resource-search.js';
import {canonicalItem,LIMITS} from './capabilities.js';
export function parseGoal(instruction){
 const text=instruction.normalize('NFKC').trim();
 const explicit=/^自律(?:\s|[:：])/.test(text);
 const body=text.replace(/^自律[\s:：]+/,'');
 const m=body.match(/^(.+?)を(\d+)\s*(?:個|本)?(?:集めて|回収して|探して集めて)(?:[、,\s]*)(?:(拠点|開始地点|ここ)に戻って)?[。!！]?$/u);
 if(!m || (!explicit && !m[3]))return null;
 const resource=/^(木|木材|原木)$/.test(m[1])?'wood':canonicalItem(m[1]);
 if(!resource || !['wood',...resourceSpec('wood').items,'coal','raw_iron','raw_copper','raw_gold','diamond','emerald','lapis_lazuli','redstone'].includes(resource))throw Error('自律目標は原木または露出した鉱石の回収に対応します。');
 const count=Number(m[2]);if(!Number.isInteger(count)||count<1||count>64)throw Error('自律回収の目標は1〜64個です。');
 return {resource,count,returnHome:Boolean(m[3])};
}
export async function runGoal({goal,controls:c,sender,signal,say}){
 c.check(signal);
 if(!c.pickup.inventoryReady)throw Error('持ち物全体が未受信です。少し待ってください。');
 const origin={...c.feet()};if(!Object.values(origin).every(Number.isFinite))throw Error('開始座標が未取得です。');
 const baseline=c.pickup.snapshot(),spec=resourceSpec(goal.resource);
 const gained=()=>c.pickup.gains(baseline).filter(i=>spec.items.includes(i.item)).reduce((n,i)=>n+i.count,0);
 const state={goal,origin,phase:'探索',gained:0,broken:0,steps:0};c.autonomousGoal=state;c.autonomousOrigin=origin;
 let failure='';
 const check=()=>{signal.throwIfAborted();c.check(signal);const p=c.feet();if(Math.hypot(p.x-origin.x,p.z-origin.z)>LIMITS.searchRadius)throw Error('自律目標の開始地点から256ブロックを超えました。');};
 try{
  say(`自律目標: ${goal.resource}を新たに${goal.count}個回収${goal.returnHome?'し、この開始地点へ戻ります':''}。!stopで停止できます。`);
  while(gained()<goal.count && state.steps<6 && state.broken<64){
   check();const before=gained();state.phase='探索・採掘';state.steps++;
   const count=Math.min(goal.count-before,64-state.broken);
   try{
    const result=await c.execute({type:'gather',block:goal.resource,count},sender,signal);
    state.broken+=result.broken || 0;
    if(result.notes?.length)failure=result.notes[0];
   }catch(e){
    check();failure=e.message;
    // A failed mine may have changed blocks before the exception; do not
    // repeat it or reset the aggregate mining budget after an uncertain result.
    state.phase='回収確認';
    try{await c.execute({type:'collect',count:Math.max(1,goal.count-gained())},sender,signal);}catch(recovery){check();failure+=' / '+recovery.message;}
    break;
   }
   check();state.gained=gained();
   say(`自律進捗: 回収確認 ${state.gained}/${goal.count}個。`);
   if(state.gained<=before){
    state.phase='回収再確認';
    try{await c.execute({type:'collect',count:Math.max(1,goal.count-gained())},sender,signal);}catch(e){check();failure=e.message;}
    check();state.gained=gained();
    if(state.gained<=before){failure='持ち物の増加がないため、同じ採掘を繰り返さず停止します。'+failure;break;}
   }
  }
  check();state.gained=gained();
  if(goal.returnHome){
   state.phase='帰還';say('開始地点へ戻ります。');
   await c.execute({type:'move',...origin},sender,signal);check();
   const p=c.feet();if(Math.hypot(p.x-origin.x,p.z-origin.z)>1.5 || Math.abs(p.y-origin.y)>1)throw Error('開始地点への到着を確認できません。');
  }
  state.phase='終了';
  const complete=gained()>=goal.count;
  say(`${complete?'自律目標を達成':'自律目標は未達成'}: 回収確認 ${gained()}/${goal.count}個。${goal.returnHome?'開始地点へ帰還しました。':''}${complete?'':failure || '行動回数または採掘上限に達しました。'}`);
  return {complete,gained:gained(),returned:goal.returnHome,broken:state.broken};
 }finally{c.autonomousOrigin=null;c.autonomousGoal=null;c.stop();}
}
