import {resourceSpec} from './resource-search.js';
export const ironCosts={iron_helmet:5,iron_chestplate:8,iron_leggings:7,iron_boots:4,iron_pickaxe:3,iron_sword:2,shield:1,bucket:3};
const armor=['iron_helmet','iron_chestplate','iron_leggings','iron_boots'];
export async function runIron(p,{sender,signal,say}){
 const c=p.c;if(p.running)throw Error('討伐準備は実行中です。');c.check(signal);
 if(!c.pickup.inventoryReady)throw Error('持ち物全体が未受信です。');
 const origin={...c.feet()};if(!Object.values(origin).every(Number.isFinite))throw Error('現在座標が未取得です。');
 const name=i=>i?.count?c.registry.items[i.network_id]?.name:null;
 const equipped=item=>armor.includes(item)?name(c.armorItems?.[armor.indexOf(item)])===item:item==='shield'&&name(c.offhandItems?.[0])===item;
 const have=item=>p.count(item)>0||equipped(item);
 const missing=()=>Object.keys(ironCosts).filter(i=>!have(i));
 p.running=true;c.autonomousOrigin=origin;p.state.stage=2;p.state.status='running';p.state.reason='';let steps=0,mined=0,crafted=0;
 const check=()=>{signal.throwIfAborted();c.check(signal);const f=c.feet();if(Math.hypot(f.x-origin.x,f.z-origin.z)>256)throw Error('開始位置から256ブロックを超えました。');};
 const act=async a=>{check();if(steps>=48)throw Error('段階2の操作上限48回です。');if(a.type==='gather'&&(mined+=a.count)>64)throw Error('段階2の採掘上限64個です。');if(a.type==='craft'&&(crafted+=a.count)>64)throw Error('段階2の作成上限64個です。');p.state.current=a;p.state.steps=++steps;p.save();say('鉄装備準備 '+steps+': '+a.type+' '+(a.item||a.block||''));await c.execute(a,sender,signal);check();p.state.events.push({at:new Date().toISOString(),action:a});p.state.events=p.state.events.slice(-64);p.save();};
 const gather=async(item,n)=>{if(p.count(item)>=n)return;await act({type:'gather',block:item,count:n-p.count(item)});if(p.count(item)<n)throw Error(item+'の必要数の回収を確認できません。');};
 const planks=async n=>{while(p.planks()<n){const log=resourceSpec('wood').items.find(i=>p.count(i));if(!log){await act({type:'gather',block:'wood',count:Math.ceil((n-p.planks())/4)});if(!resourceSpec('wood').items.some(i=>p.count(i)))throw Error('原木回収を確認できません。');continue;}const before=p.planks();await act({type:'craft',item:log.replace(/_log$/,'_planks'),count:Math.min(n-before,p.count(log)*4)});if(p.planks()<=before)throw Error('板材の増加を確認できません。');}};
 const sticks=async n=>{if(p.count('stick')>=n)return;await planks(Math.ceil((n-p.count('stick'))/4)*2);await act({type:'craft',item:'stick',count:n-p.count('stick')});if(p.count('stick')<n)throw Error('棒の作成を確認できません。');};
 const craft=async item=>{await act({type:'craft',item,count:1});if(!p.count(item))throw Error(item+'の作成を確認できません。');};
 try{
  p.save();say('段階2: 鉄防具・ツルハシ・剣・盾・バケツを準備します。精錬は16個ずつ。');
  if(missing().length){
   if(!p.table()){if(!p.count('crafting_table')){await planks(4);await craft('crafting_table');}const pos=p.place();await act({type:'equip',item:'crafting_table'});await act({type:'build',block:'crafting_table',...pos,width:1,height:1,depth:1});if(!p.table())throw Error('作業台の設置を確認できません。');}
   const anchor={...c.feet()};const back=async()=>{await act({type:'move',...anchor});if(!p.table())throw Error('作業台へ戻れません。');};
   const need=missing().reduce((n,i)=>n+ironCosts[i],0);
   if(p.count('iron_ingot')<need){
    if(!['stone','iron','diamond','netherite','copper'].some(t=>p.count(t+'_pickaxe')))throw Error('鉄鉱石の採掘には石以上のツルハシが必要です。段階1を先に実行してください。');
    const raw=need-p.count('iron_ingot');await gather('raw_iron',raw);await gather('coal',Math.ceil(raw/8));
    await back();
    let furnace=false;const f=c.feet();for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)for(let y=-2;y<=3;y++)if(c.block({x:Math.floor(f.x)+x,y:Math.floor(f.y)+y,z:Math.floor(f.z)+z})?.name==='furnace')furnace=true;
    if(!furnace){if(!p.count('furnace')){await gather('cobblestone',8);await back();await craft('furnace');}const pos=p.place();await act({type:'equip',item:'furnace'});await act({type:'build',block:'furnace',...pos,width:1,height:1,depth:1});if(c.block(pos)?.name!=='furnace')throw Error('かまどの設置を確認できません。');}
    while(p.count('iron_ingot')<need){const amount=Math.min(16,need-p.count('iron_ingot')),before=p.count('iron_ingot');await act({type:'smelt',item:'raw_iron',count:amount});if(p.count('iron_ingot')-before<amount)throw Error('鉄インゴットの回収を確認できません。');}
   }
   await sticks((have('iron_pickaxe')?0:2)+(have('iron_sword')?0:1));
   if(!have('shield'))await planks(6);
   await back();for(const item of missing())await craft(item);
  }
  for(const item of armor){if(!equipped(item))await act({type:'wear',item});if(!equipped(item))throw Error(item+'の装着を確認できません。');}
  if(!equipped('shield'))await act({type:'offhand',item:'shield'});
  if(!equipped('shield')||missing().length)throw Error('鉄装備一式の所持・装着を確認できません。');
  p.state.status='iron_ready';p.state.current=null;p.save();say('段階2完了: 鉄防具4点を装着、盾をオフハンドへ装備。鉄のツルハシ・剣・バケツの所持を確認しました。盾の自動防御と段階3の自動進行は未対応です。');
 }catch(e){p.state.status='paused';p.state.reason=e.message;p.save();throw e;}finally{p.running=false;c.autonomousOrigin=null;c.stop();}
}
