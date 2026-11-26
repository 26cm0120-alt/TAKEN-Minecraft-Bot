import {toolCondition} from './tool-condition.js';
const costs={pickaxe:[3,2],axe:[3,2],shovel:[1,2],sword:[2,1],hoe:[2,2]};
const supported=/^(wooden|stone|iron)_(pickaxe|axe|shovel|sword|hoe)$/;
const woods=['oak','spruce','birch','jungle','acacia','dark_oak','mangrove','cherry','pale_oak'];
export async function manageResources(c,{item}={},signal){
 if(item&&!supported.test(item))throw Error('資源管理は木・石・鉄のツルハシ・斧・シャベル・剣・クワに対応しています。');
 c.check(signal);if(!c.pickup.inventoryReady)throw Error('持ち物全体が未受信です。');
 const origin={...c.feet()},previousOrigin=c.autonomousOrigin;let steps=0,gathered=0,crafted=0;
 const made=[],kept=[],notes=[];
 const entries=()=>c.items.slice(0,36).map((i,slot)=>({item:i,slot,name:c.registry.items[i?.network_id]?.name,condition:toolCondition(i,c.registry)})).filter(e=>e.item?.count);
 const count=name=>entries().filter(e=>e.name===name).reduce((n,e)=>n+e.item.count,0);
 const healthy=name=>entries().some(e=>e.name===name&&e.condition?.ratio>.2);
 const announce=message=>c.client.emit('taken_notice',{message:'資源管理: '+message});
 const check=()=>{c.check(signal);if(steps>=32)throw Error('資源管理の操作上限32回です。');if(Math.hypot(c.feet().x-origin.x,c.feet().z-origin.z)>256)throw Error('出発地点から256ブロックを超えました。');};
 const act=async(type,name,n)=>{check();steps++;announce(name+' ×'+n);
  if(type==='gather'){gathered+=n;if(gathered>64)throw Error('資源回収の要求上限64個です。');await c.resourceSearch.gather(name,n,signal);}
  else {crafted+=n;if(crafted>64)throw Error('作成要求の上限64個です。');await c.crafting.craft(name,n,signal);}
  c.check(signal);
 };
 const back=async()=>{check();steps++;await c.goto(origin,signal,.6);};
 const planks=()=>entries().filter(e=>/_planks$/.test(e.name)).reduce((n,e)=>n+e.item.count,0);
 const ensurePlanks=async n=>{while(planks()<n){
  check();let log=woods.map(w=>w+'_log').find(n=>count(n));
  if(!log){await act('gather','wood',Math.ceil((n-planks())/4));log=woods.map(w=>w+'_log').find(n=>count(n));if(!log)throw Error('原木の回収を確認できません。');}
  const before=planks();await act('craft',log.replace(/_log$/,'_planks'),Math.min(n-before,count(log)*4));if(planks()<=before)throw Error('板材の増加を確認できません。');
 }};
 const ensureSticks=async n=>{if(count('stick')>=n)return;await ensurePlanks(Math.ceil((n-count('stick'))/4)*2);await act('craft','stick',n-count('stick'));if(count('stick')<n)throw Error('棒が不足しています。');};
 const gatherTo=async(name,n)=>{if(count(name)<n)await act('gather',name,n-count(name));if(count(name)<n)throw Error(name+'があと'+(n-count(name))+'個不足しています。');};
 const ensureTool=async name=>{
  check();if(healthy(name))return;
  const [material,kind]=name.split('_'),[units,sticks]=costs[kind];
  await ensureSticks(sticks);
  if(material==='wooden')await ensurePlanks(units);
  if(material==='stone'&&count('cobblestone')<units){
   if(!entries().some(e=>/_pickaxe$/.test(e.name)&&e.condition?.ratio>.2))await ensureTool('wooden_pickaxe');
   await gatherTo('cobblestone',units);
  }
  if(material==='iron'&&count('iron_ingot')<units){
   if(!entries().some(e=>/^(stone|iron|diamond|netherite)_pickaxe$/.test(e.name)&&e.condition?.ratio>.2))await ensureTool('stone_pickaxe');
   const needed=units-count('iron_ingot');await gatherTo('raw_iron',needed);
   if(!count('coal')&&!count('charcoal'))await gatherTo('coal',1);
   await back();check();steps++;await c.furnace.smelt('raw_iron',needed,signal);
   if(count('iron_ingot')<units)throw Error('鉄インゴットが不足しています。');
  }
  // Bootstrap pickaxes may consume the sticks prepared for the requested tool.
  await ensureSticks(sticks);await back();
  await act('craft',name,1);
  if(!healthy(name))throw Error(name+'の新しい道具を確認できません。');
  made.push(name);
 };
 const hasTable=()=>{for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)for(let y=-2;y<=3;y++)if(c.block({x:Math.floor(origin.x)+x,y:Math.floor(origin.y)+y,z:Math.floor(origin.z)+z})?.name==='crafting_table')return true;return false;};
 const targets=item?[item]:['pickaxe','axe','shovel'].map(kind=>{
  const available=entries().filter(e=>e.name?.endsWith('_'+kind));
  const usable=available.find(e=>e.condition?.ratio>.2);
  if(usable)return usable.name;
  return available.find(e=>supported.test(e.name))?.name||available[0]?.name||'stone_'+kind;
 });
 if(!item)for(const e of entries())if(supported.test(e.name)&&/_(sword|hoe)$/.test(e.name)&&!targets.includes(e.name))targets.push(e.name);
 c.autonomousOrigin=origin;
 try{
  for(const name of targets){
   check();if(healthy(name)){kept.push(name);continue;}
   if(!supported.test(name)){notes.push(name+': 作り直し未対応。古い道具を保持');continue;}
   if(entries().some(e=>e.name===name&&!e.condition)){notes.push(name+': 耐久値未確認のため交換を省略');continue;}
   if(!hasTable())throw Error('出発地点の6ブロック以内に作業台を置いてください。');
   await ensureTool(name);
  }
  // Select the best confirmed pickaxe, rather than the first worn copy.
  const tiers={wooden:0,golden:0,stone:1,copper:1,iron:2,diamond:3,netherite:4};
  const pick=entries().filter(e=>/_pickaxe$/.test(e.name)&&e.condition?.ratio>.2).sort((a,b)=>(tiers[b.name.split('_')[0]]??0)-(tiers[a.name.split('_')[0]]??0)||b.condition.ratio-a.condition.ratio)[0];
  if(pick&&made.length){check();const slot=pick.slot<9?pick.slot:await c.crafting.equipInventorySlot(pick.slot,signal);c.select(slot);}
  return {made,kept,notes,steps,verification:'server_inventory'};
 }catch(e){e.message='資源管理: '+e.message+' 作成確認: '+(made.join('、')||'なし');throw e;}
 finally{c.autonomousOrigin=previousOrigin;c.stop();}
}
