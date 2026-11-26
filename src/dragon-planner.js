import {runIron} from './dragon-iron.js';
import {fileURLToPath} from 'node:url';
import {createProgressStore,defaultProgressFile,roadmap} from './dragon-progress.js';
import {resourceSpec} from './resource-search.js';
const tools=['stone_pickaxe','stone_axe','stone_sword','stone_shovel','stone_hoe'];
const cost={stone_pickaxe:[3,2],stone_axe:[3,2],stone_sword:[2,1],stone_shovel:[1,2],stone_hoe:[2,2]};
const dangerous=/lava|water|fire|cactus|magma|campfire|berry|powder_snow/;
export function dragonCommand(text){
 const t=text.normalize('NFKC').trim().replace(/^自律\s*/,'');
 if(/^(?:討伐再開|再開|再開して|続けて|続行)(?:[。!！])?$/.test(t))return 'resume';
 if(/^(?:討伐段階2|段階2|鉄装備をそろえて|鉄装備の準備)$/.test(t))return 'iron';
 if(/^(?:エンドラ|エンダードラゴン)?討伐計画$/.test(t))return 'plan';
 if(/^(?:エンドラ|エンダードラゴン)?討伐進捗$/.test(t))return 'status';
 if(/^(?:エンドラ|エンダードラゴン)(?:討伐|討伐の準備|を倒す準備)(?:を始めて|を進めて|して)?$/.test(t)||/^(?:石の道具一式をそろえて|討伐開始|討伐再開)$/.test(t))return 'run';
 return null;
}
export class DragonPlanner {
 constructor(c,{store=createProgressStore(fileURLToPath(defaultProgressFile()))}={}){this.c=c;this.store=store;this.state=store.load();if(this.state.status==='running'){this.state.status='paused';this.state.reason='前回の作業が中断されました。持ち物を再確認して再開します。';}this.running=false;}
 count(name){return this.c.items.slice(0,36).reduce((n,i)=>n+(this.c.registry.items[i?.network_id]?.name===name?(i.count||0):0),0);}
 planks(){return this.c.items.slice(0,36).reduce((n,i)=>n+(/_planks$/.test(this.c.registry.items[i?.network_id]?.name||'')?(i.count||0):0),0);}
 save(){this.state.updatedAt=new Date().toISOString();this.store.save(this.state);}
 runIron(options){return runIron(this,options);}
 summary(){return 'エンドラ討伐準備: '+this.state.status+' / 石の道具: '+tools.map(t=>t+' '+this.count(t)).join('、')+' / 段階: '+(this.state.stage||1)+' / 鉄装備準備: '+(this.state.status==='iron_ready'?'完了':'!TAKEN 討伐段階2')+' / 食料・拠点の自動整備は未対応。'+(this.state.reason?'停止理由: '+this.state.reason:'');}
 plan(){return roadmap.map((s,i)=>(i+1)+'. '+s).join(' → ')+'。段階1は石の道具、段階2は鉄装備・盾・バケツ。開始は !TAKEN 討伐段階2。食料・拠点の自動整備と段階3以降は未実装です。';}
 table(){const f=this.c.feet();for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)for(let y=-1;y<=1;y++){const p={x:Math.floor(f.x)+x,y:Math.round(f.y)+y,z:Math.floor(f.z)+z};if(this.c.block(p)?.name==='crafting_table')return p;}return null;}
 place(){const c=this.c,f=c.feet(),y=Math.round(f.y);for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++){
  if(Math.hypot(dx,dz)<2)continue;const p={x:Math.floor(f.x)+dx,y,z:Math.floor(f.z)+dz},b=c.block(p),floor=c.block({...p,y:y-1});
  if(b?.name==='air'&&floor?.boundingBox==='block'&&!dangerous.test(floor.name)&&c.walkable(p.x+.5,y,p.z+.5))return p;
 }throw Error('作業台を設置する安全な空き地がありません。近くに作業台を用意してください。');}
 async run({sender,signal,say}){
  if(this.running)throw Error('討伐準備は実行中です。');const c=this.c;c.check(signal);if(!c.pickup.inventoryReady)throw Error('持ち物全体が未受信です。');
  const feet=c.feet();if(!feet||![feet.x,feet.y,feet.z].every(Number.isFinite))throw Error('現在座標が未取得です。');
  this.running=true;let steps=0,mined=0,crafted=0;const origin={...feet};c.autonomousOrigin=origin;
  this.state.stage=1;this.state.status='running';this.state.reason='';this.state.base ||= origin;
  const check=()=>{signal.throwIfAborted();c.check(signal);if(steps>=32)throw Error('今回の準備の操作上限32回に達しました。');const p=c.feet();if(Math.hypot(p.x-origin.x,p.z-origin.z)>256)throw Error('開始位置から256ブロックを超えました。');};
  const action=async a=>{check();if(a.type==='gather'){mined+=a.count;if(mined>64)throw Error('今回の採掘上限64ブロックに達しました。');}if(a.type==='craft'){crafted+=a.count;if(crafted>64)throw Error('今回の作成上限64個に達しました。');}steps++;this.state.steps=steps;this.state.current=a;this.save();say('討伐準備 '+steps+': '+a.type+' '+(a.item||a.block||''));const result=await c.execute(a,sender,signal);check();this.state.events.push({at:new Date().toISOString(),action:a});this.state.events=this.state.events.slice(-64);this.save();return result;};
  const ensurePlanks=async n=>{while(this.planks()<n){check();const logs=resourceSpec('wood').items.filter(name=>this.count(name)).sort((a,b)=>this.count(b)-this.count(a));if(!logs.length){await action({type:'gather',block:'wood',count:Math.max(1,Math.ceil((n-this.planks())/4))});if(!resourceSpec('wood').items.some(name=>this.count(name)))throw Error('原木の回収を確認できません。');continue;}const before=this.planks();await action({type:'craft',item:logs[0].replace(/_log$/,'_planks'),count:Math.min(n-before,this.count(logs[0])*4)});if(this.planks()<=before)throw Error('板材の実増加を確認できません。');}};
  const ensureSticks=async n=>{if(this.count('stick')>=n)return;await ensurePlanks(Math.ceil((n-this.count('stick'))/4)*2);await action({type:'craft',item:'stick',count:n-this.count('stick')});if(this.count('stick')<n)throw Error('棒の必要数を確認できません。');};
  try{
   this.save();say('エンドラ討伐の段階1: 石の道具一式をそろえます。死亡・危険・材料の未確認で停止し、進捗を保存します。');
   if(tools.every(t=>this.count(t)>0)){this.state.status='stone_tools_ready';this.state.current=null;this.save();say('石の道具一式はすでに所持しています。次は食料と安全な拠点の整備です。');return;}
   if(!this.table()){if(!this.count('crafting_table')){await ensurePlanks(4);await action({type:'craft',item:'crafting_table',count:1});}if(!this.count('crafting_table'))throw Error('作業台の作成を確認できません。');const p=this.place();await action({type:'equip',item:'crafting_table'});await action({type:'build',block:'crafting_table',...p,width:1,height:1,depth:1});if(c.block(p)?.name!=='crafting_table')throw Error('作業台の設置を確認できません。');}
   const tableAnchor={...c.feet()};
   const returnToTable=async()=>{if(!this.table()){await action({type:'move',...tableAnchor});if(!this.table())throw Error('近くの作業台へ戻れません。作業台のそばで討伐再開してください。');}};
   const missing=()=>tools.filter(t=>!this.count(t)),needed=()=>missing().reduce((n,t)=>n+cost[t][0],0);
   if(this.count('cobblestone')<needed()){
    if(!['wooden','stone','iron','diamond','netherite','golden','copper'].some(t=>this.count(t+'_pickaxe'))){await ensureSticks(2);await ensurePlanks(3);await returnToTable();await action({type:'craft',item:'wooden_pickaxe',count:1});if(!this.count('wooden_pickaxe'))throw Error('木のツルハシの作成を確認できません。');}
    const want=needed();await action({type:'gather',block:'cobblestone',count:want-this.count('cobblestone')});if(this.count('cobblestone')<want)throw Error('丸石が不足しています。回収を確認できた分だけ進捗を保存しました。');
   }
   for(const tool of tools){check();if(this.count(tool))continue;await ensureSticks(cost[tool][1]);await returnToTable();await action({type:'craft',item:tool,count:1});if(!this.count(tool))throw Error(tool+'の所持を確認できません。');}
   if(!tools.every(t=>this.count(t)))throw Error('石の道具一式の所持を確認できません。');this.state.status='stone_tools_ready';this.state.current=null;this.save();say('石の道具一式の所持を確認しました。次は食料と安全な拠点の整備です。段階2は !TAKEN 討伐段階2 で開始できます。');
  }catch(e){this.state.status='paused';this.state.reason=e.message || '停止または死亡';this.save();throw e;}finally{this.running=false;c.autonomousOrigin=null;c.stop();}
 }
}




