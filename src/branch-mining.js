import {LIMITS} from './capabilities.js';
const vectors={north:{x:0,z:-1},south:{x:0,z:1},east:{x:1,z:0},west:{x:-1,z:0}};
const hazard=/water|lava|fire|cactus|magma|campfire|berry|powder_snow/;
const falling=/^(sand|red_sand|gravel|.*concrete_powder|anvil|chipped_anvil|damaged_anvil)$/;
const tunnelBlocks=new Set(['stone','deepslate','cobblestone','cobbled_deepslate','andesite','diorite','granite','tuff','dirt','grass_block','clay','netherrack','blackstone','basalt','end_stone']);
const ore=n=>/^(?:deepslate_)?(?:coal|iron|copper|gold|diamond|emerald|lapis|redstone)_ore$/.test(n)||['quartz_ore','nether_gold_ore','ancient_debris'].includes(n);
const air=b=>b&&['air','cave_air','void_air'].includes(b.name);
export function tunnelBudget({direction='facing',length=6}={}){
 if(![...Object.keys(vectors),'facing'].includes(direction)||!Number.isInteger(length)||length<1||length>32)throw Error('直線採掘は方向と1〜32マスを指定してください。');
 return length*2;
}
export function branchBudget({direction='facing',length=6,branchLength=2}={}){
 if(![...Object.keys(vectors),'facing'].includes(direction)||!Number.isInteger(length)||length<1||length>16||!Number.isInteger(branchLength)||branchLength<1||branchLength>4)throw Error('ブランチマイニングは方向、主通路1〜16マス、枝道1〜4マスで指定してください。');
 const cells=length+Math.floor(length/3)*branchLength*2,budget=cells*2+16;
 if(budget>LIMITS.mine)throw Error('通路と鉱石の採掘上限64個を超えます。主通路6マス・枝道2マス等へ短くしてください。');
 return budget;
}
export async function branchMine(c,options,signal){
 const {direction='facing',length=6,branchLength=2}=options,straight=options.type==='tunnel_mine',budget=straight?tunnelBudget(options):branchBudget(options);c.check(signal);
 if(!c.pickup.inventoryReady)throw Error('持ち物全体が未受信です。');
 c.pickaxeSlot('stone');
 const f=c.feet();if(![f.x,f.y,f.z].every(Number.isFinite)||Math.abs(f.y-Math.round(f.y))>.15)throw Error('平らな地面に着地してから開始してください。');
 const start={x:Math.floor(f.x)+.5,y:Math.round(f.y),z:Math.floor(f.z)+.5},dimension=c.dimension;
 const heading=direction==='facing'?['south','west','north','east'][Math.round((((c.yaw||0)%360)+360)%360/90)%4]:direction,d=vectors[heading],side={x:-d.z,z:d.x};
 const ac=AbortSignal.timeout(600000),combined=signal?AbortSignal.any([signal,ac]):ac,baseline=c.pickup.snapshot();
 const state={running:true,direction:heading,length,branchLength,broken:0,oreBroken:0,mainCompleted:0,branchesCompleted:0,position:{...start},reason:''};c.branchMiningStatus=state;
 const check=()=>{c.check(combined);if(c.dimension!==dimension)throw Error('ディメンションが変わったため停止しました。');if(state.broken>=budget)throw Error('今回の採掘上限に達しました。');};
 const read=p=>{const b=c.block(p);if(!b)throw Error('地形が未読込のため停止しました。');if(hazard.test(b.name))throw Error('水・溶岩などの危険ブロックを検出しました。');return b;};
 const safeBreak=p=>{const b=read(p);if(air(b))return b;if(!(tunnelBlocks.has(b.name)||ore(b.name)))throw Error('通路に未対応ブロック '+b.name+' があります。設備・建築用ブロックは掘りません。');
  for(const [x,y,z] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const adjacent=read({x:p.x+x,y:p.y+y,z:p.z+z});if(y===1&&falling.test(adjacent.name))throw Error('頭上の砂・砂利などが落下するため停止しました。');}
  return b;
 };
 const mine=async p=>{check();const b=safeBreak(p);if(air(b))return;
  c.pickaxeSlot(b.name);const result=await c.mine(b.name,1,combined,{targetPosition:p});
  if(result.broken!==1||!air(c.block(p)))throw Error('通路のブロック破壊を確認できません。');state.broken++;if(ore(b.name))state.oreBroken++;
 };
 const harvest=async cell=>{
  if(straight||state.oreBroken>=16)return;
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])for(const y of [cell.y,cell.y+1]){if(state.oreBroken>=16)return;const p={x:Math.floor(cell.x)+dx,y,z:Math.floor(cell.z)+dz},b=c.block(p);if(b&&ore(b.name)&&!c.supportsPlayer(p))await mine(p);}
 };
 const advance=async cell=>{
  check();c.requestNearby();await c.wait(200,combined);
  const p={x:Math.floor(cell.x),y:cell.y,z:Math.floor(cell.z)},floor=read({...p,y:p.y-1});if(floor.boundingBox!=='block'||falling.test(floor.name))throw Error('通路の下に安全な固体の足場がありません。');
  // Validate both blocks before breaking either. Dig overhead first.
  safeBreak({...p,y:p.y+1});safeBreak(p);await mine({...p,y:p.y+1});await mine(p);
  if(!c.walkable(cell.x,cell.y,cell.z))throw Error('掘った通路の足場・頭上空間を確認できません。');
  await c.goto(cell,combined,.35);state.position={...c.feet()};await harvest(cell);
 };
 try{
  if(!c.walkable(start.x,start.y,start.z))throw Error('開始位置の足場・空間を確認できません。');
  await c.goto(start,combined,.35);
  c.client.emit('taken_notice',{message:(straight?'直線採掘開始: ':'ブランチマイニング開始: ')+heading+'へ'+length+'マス'+(straight?'、高さ2マス。':'、3マスごとに左右'+branchLength+'マス。')+'!stopで中止。'});
  for(let i=1;i<=length;i++){
   const junction={x:start.x+d.x*i,y:start.y,z:start.z+d.z*i};await advance(junction);state.mainCompleted=i;
   if(!straight&&i%3===0){for(const sign of [1,-1]){for(let j=1;j<=branchLength;j++)await advance({x:junction.x+side.x*j*sign,y:start.y,z:junction.z+side.z*j*sign});await c.goto(junction,combined,.35);state.branchesCompleted++;}}
  }
  if(!straight)await c.goto(start,combined,.35);const collected=c.pickup.gains(baseline);return {broken:state.broken,oreBroken:state.oreBroken,mainCompleted:state.mainCompleted,branchesCompleted:state.branchesCompleted,collected,returned:!straight,verification:'server_block_and_inventory'};
 }catch(e){state.reason=e.message;e.message+=' 確認済み採掘: '+state.broken+'個、主通路: '+state.mainCompleted+'/'+length+'マス。';throw e;}finally{state.running=false;state.position={...c.feet()};c.stop();}
}
