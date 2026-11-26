import {branchBudget,tunnelBudget} from './branch-mining.js';
import {LIMITS,capabilitySummary,canonicalBlock,canonicalItem} from './capabilities.js';
import {requestLocalAI} from './local-ai-request.js';
import {planningPrompt} from './planning-prompt.js';
const types=new Set(['status','move','come','follow','mine','build','combat','eat','craft','collect','gather','sleep','wake','equip','wear','offhand','smelt','board_boat','leave_boat','dig_below','give','branch_mine','tunnel_mine','food_supply','resource_manage']);
const combatTargets=new Set(['hostile','zombie','skeleton','creeper','spider','enderman','drowned','husk','stray','bogged','cow','pig','sheep','chicken','rabbit']);
export function directPlan(instruction) {
  const manage=instruction.normalize('NFKC').trim().match(/^(?:資源管理(?:して)?|道具を整備して)(?:\s+(.+?))?[。!！]?$/u);
  if(manage){const item=manage[1]?canonicalItem(manage[1]):undefined;return manage[1]&&!item?{reply:'',question:'整備する道具の名前を指定してください。',actions:[]}:{reply:'',actions:[{type:'resource_manage',...(item?{item}:{})}]};}
  const supply=instruction.trim().match(/^(?:食料調達(?:して)?|食料を(?:(\d+)個)?(?:調達して|取ってきて|集めて|確保して))(?:ください)?[。!！]?$/u);
  if(supply&&Number(supply[1]||3)>8)return {reply:'',question:'食料調達は1〜8個です。何個調達しますか？',actions:[]};
  if(supply)return {reply:'',actions:[{type:'food_supply',count:Number(supply[1]||3)}]};
  let text=instruction.trim().replace(/^`+|`+$/g,'').trim().normalize('NFKC');
  text=text.replace(/^(.+?)で座標\s*(-?\d+)[,、\s]+(-?\d+)[,、\s]+(-?\d+)に/,'座標$2 $3 $4から$1で').replace(/[、,](?=\s*(?:高さ|奥行き))/g,' ').replace(/を設置して$/,'を作って');
  const canonical=canonicalBlock;
  if(/^(?:スイカ|すいか|melon)を探して[。!！]?$/.test(text))return {reply:'スイカの遠方探索はまだ未対応です。見つけたスイカは「スイカを1個掘って」で採掘できます。',actions:[]};
  const englishFollow=text.match(/^follow(?:\s*(\d+)(?:\s*(?:秒|s|seconds?))?)?[.!]?$/i);
  if(englishFollow)return {reply:'',actions:[{type:'follow',seconds:Number(englishFollow[1]||15)}]};
  const tunnel=text.match(/^(?:一直線に|直線で)(?:(北|南|東|西)へ?\s*(\d+)\s*マス)?(?:\s*)(?:掘って|採掘して)[。!！]?$/u);
  if(tunnel&&tunnel[2])return {reply:'',actions:[{type:'tunnel_mine',direction:({北:'north',南:'south',東:'east',西:'west'})[tunnel[1]],length:Number(tunnel[2])}]};
  if(/一直線|直線/.test(text))return {reply:'',question:'直線採掘は床を残して高さ2マスを掘ります。例: 一直線に西へ15マス掘って（最大30ブロック）。座標指定や特定の材質だけを選ぶ直線採掘は未対応です。方向と距離を指定してください。',actions:[]};
  const branch=text.match(/^ブランチマイニング(?:して|をして|開始)?(?:\s+(北|南|東|西)(?:\s*(\d+))?(?:\s+枝(?:道)?\s*(\d+))?)?[。!！]?$/u);
  if(branch)return {reply:'',actions:[{type:'branch_mine',direction:({北:'north',南:'south',東:'east',西:'west'})[branch[1]]||'facing',length:branch[2]?Number(branch[2]):6,branchLength:branch[3]?Number(branch[3]):2}]};
  const specialMove=text.match(/^(?:(?:ダッシュで|走って|泳いで)\s*)?(?:x\s*=\s*|座標\s*)?(-?\d+(?:\.\d+)?)[,、\s]+(?:y\s*=\s*)?(-?\d+(?:\.\d+)?)[,、\s]+(?:z\s*=\s*)?(-?\d+(?:\.\d+)?)\s*(?:に|へ)(?:ダッシュして|走って|泳いで|(?:移動して))[。!！]?$/u);
  if(specialMove && /ダッシュ|走って|泳いで/.test(text))return {reply:'',actions:[{type:'move',mode:/泳いで/.test(text)?'swim':'sprint',x:Number(specialMove[1]),y:Number(specialMove[2]),z:Number(specialMove[3])}]};
  if(/^(?:近くの)?(?:ボート|舟|船)に(?:乗って|乗船して)[。!！]?$/u.test(text))return {reply:'',actions:[{type:'board_boat'}]};
  if(/^(?:(?:ボート|舟|船)から)?(?:降りて|降船して)[。!！]?$/u.test(text))return {reply:'',actions:[{type:'leave_boat'}]};
  if(/^(?:自分の下|真下|足元)(?:にある)?(?:の)?(?:ブロック)?(?:を)?(?:1|一|ひと)?(?:マス|個|つ)?(?:掘って|採掘して)[。!！]?$/u.test(text))return {reply:'',actions:[{type:'dig_below'}]};
  const food=text.match(/^(.+?)(?:を)?\s*(?:(\d+)\s*個)?食べて[。!！]?$/u);
  if(food&&canonicalItem(food[1]))return {reply:'',actions:[{type:'eat',item:canonicalItem(food[1]),count:Number(food[2]||8)}]};
  const give=text.match(/^(?:持ち物から|インベントリから)?(.+?)を\s*(\d+)\s*(?:個|つ|本)?(?:私に)?(?:ちょうだい|ください|渡して|くれ|分けて)[。!！]?$/u);
  if(give&&canonicalItem(give[1]))return {reply:'',actions:[{type:'give',item:canonicalItem(give[1]),count:Number(give[2])}]};
  const giveOne=text.match(/^(?:持ち物から|インベントリから)?(.+?)を(?:私に)?(?:ちょうだい|ください|渡して|くれ|分けて)[。!！]?$/u);
  if(giveOne&&canonicalItem(giveOne[1]))return {reply:'',actions:[{type:'give',item:canonicalItem(giveOne[1]),count:1}]};
  const smelt=text.match(/^(.+?)を\s*(\d+)\s*(?:個|つ)?(?:精錬して|焼いて|調理して)[。!！]?$/u);
  if(smelt && canonicalItem(smelt[1]))return {reply:'',actions:[{type:'smelt',item:canonicalItem(smelt[1]),count:Number(smelt[2])}]};
  const offhand=text.match(/^(?:左手に|オフハンドに)?(盾|不死のトーテム|shield|totem_of_undying)を(?:左手に|オフハンドに)?(?:装備して|持って)[。!！]?$/u);
  if(offhand)return {reply:'',actions:[{type:'offhand',item:canonicalItem(offhand[1])}]};
  const armor=text.match(/^(.+?)を(?:装備して|着て|履いて|かぶって)[。!！]?$/u);
  if(armor && canonicalItem(armor[1]))return {reply:'',actions:[{type:'wear',item:canonicalItem(armor[1])}]};
  const equip=text.match(/^(?:インベントリから|持ち物から)?(.+?)(?:に持ち替えて|を持って|を手に持って)[。!！]?$/u);
  if(equip && canonicalItem(equip[1]))return {reply:'',actions:[{type:'equip',item:canonicalItem(equip[1])}]};
  const withTool=text.match(/^(.+?)で(.+?)(?:を)?\s*(\d+)\s*(?:個|つ|ブロック)?(?:掘って|採掘して)[。!！]?$/u);
  if(withTool){const tool=canonicalItem(withTool[1]),raw=withTool[2].replace(/を$/,'');const block=canonical({'銅の原石':'銅鉱石','鉄の原石':'鉄鉱石','金の原石':'金鉱石'}[raw] || raw);if(tool && block)return {reply:'',actions:[{type:'mine',tool,block,count:Number(withTool[3])}]};}
  const single=text.match(/^(.+?)を\s*(-?\d+)[,、\s]+(-?\d+)[,、\s]+(-?\d+)に\s*(?:1|一|ひと)\s*(?:個|つ)(?:設置して|置いて|作って)[。!！]?$/u);
  if(single && canonical(single[1].replace(/ブロック$/,'')))return {reply:'',actions:[{type:'build',block:canonical(single[1].replace(/ブロック$/,'')),x:Number(single[2]),y:Number(single[3]),z:Number(single[4]),width:1,height:1,depth:1}]};
  const plainMove=text.match(/^(?:座標\s*)?(-?\d+)[,、\s]+(-?\d+)[,、\s]+(-?\d+)\s*(?:ここ)?(?:に|へ)(?:移動して|来て)[。!！]?$/u);
  if(plainMove)return {reply:'',actions:[{type:'move',x:Number(plainMove[1]),y:Number(plainMove[2]),z:Number(plainMove[3])}]};
  const uncounted=text.match(/^(.+?)(?:を)?(?:掘って|採掘して)[。!！]?$/u);
  if(uncounted && canonical(uncounted[1]))return {reply:'',actions:[{type:'mine',block:canonical(uncounted[1]),count:1}]};
  text=text.replace(/x\s*=\s*(-?\d+(?:\.\d+)?)\s+y\s*=\s*(-?\d+(?:\.\d+)?)\s+z\s*=\s*(-?\d+(?:\.\d+)?)/i,'座標$1 $2 $3').replace(/を角にして[,、]?\s*/,'から');
  if(/^(?:こっちに来て|こちらに来て|私のところに来て|ここに来て|私のそばまで歩いてきて)(?:ください)?[。！!]?$/u.test(text))return {reply:'',actions:[{type:'come'}]};
  if(/^(?:持っている)?(?:食料|食べ物|食べられるもの)(?:を)?食べて(?:ください)?[。！!]?$/u.test(text))return {reply:'',actions:[{type:'eat'}]};
  if(/^(?:近くの)?(?:ベッドで)?(?:寝て|眠って|寝てください)[。！!]?$/u.test(text))return {reply:'',actions:[{type:'sleep'}]};
  if(/^(?:起きて|起床して|ベッドから出て)[。！!]?$/u.test(text))return {reply:'',actions:[{type:'wake'}]};
  const follow=text.match(/^(?:私に|私の後に)?ついてきて\s*(?:(\d+)\s*秒)?[。！!]?$/u);
  if(follow)return {reply:'',actions:[{type:'follow',seconds:Number(follow[1] || 15)}]};
  const move=text.match(/^座標\s*(-?\d+(?:\.\d+)?)[,、\s]+(-?\d+(?:\.\d+)?)[,、\s]+(-?\d+(?:\.\d+)?)\s*(?:に|へ)(?:移動して|歩いて)[。！!]?$/u);
  if(move)return {reply:'',actions:[{type:'move',x:Number(move[1]),y:Number(move[2]),z:Number(move[3])}]};
  const gather=text.match(/^(?:遠くの|近くの)?(.+?)を\s*(\d+)\s*(?:個)?(?:探して(?:集めて|回収して|掘って)|探索して(?:集めて|回収して))[。！!]?$/u);
  if(gather){const raw=gather[1];const block=/^(?:木|木材|原木)$/.test(raw)?'wood':canonicalItem(raw);if(block)return {reply:'',actions:[{type:'gather',block,count:Number(gather[2])}]};}
  const woodRequest=text.replace(/#+/g,'の').replace(/のの/g,'の');
  const woodMatch=woodRequest.match(/^(?:近くの|遠くの)?(木|木材|原木|.+?の(?:木|原木))(?:を)?\s*(?:(\d+)\s*(?:個|本)?)?(?:集めて|探して集めて|回収して|切って|伐って)[。!！]?$/u);
  if(woodMatch){const block=/^(木|木材|原木)$/.test(woodMatch[1])?'wood':canonical(woodMatch[1].replace(/の木$/,'の原木'));if(block && (block==='wood'||/_log$/.test(block)))return {reply:woodMatch[2]?'':'個数が未指定なので、原木8個の探索回収を試します。',actions:[{type:'gather',block,count:Number(woodMatch[2] || 8)}]};}
  const mine=text.match(/^(?:近くの|近くにある)?(.+?)を\s*(\d+|ひとつ|一つ)\s*(?:個|ブロック|つ)?\s*(?:だけ)?(?:掘って|採掘して|掘る)(?:ください)?[。！!]?$/u);
  if(mine && canonical(mine[1]))return {reply:'',actions:[{type:'mine',block:canonical(mine[1]),count:/ひとつ|一つ/.test(mine[2])?1:Number(mine[2])}]};
  if(/^(?:近くの|落ちている|落下した)?(?:落下アイテム|アイテム)(?:を)?(?:拾って|回収して|集めて)[。！!]?$/u.test(text))return {reply:'',actions:[{type:'collect',count:64}]};
  const collect=text.match(/^(?:近くの|落ちている|落下した)?(.+?)を\s*(\d+)\s*(?:個)?(?:拾って|回収して)[。！!]?$/u);
  if(collect && canonicalItem(collect[1]))return {reply:'',actions:[{type:'collect',item:canonicalItem(collect[1]),count:Number(collect[2])}]};
  const craft=text.match(/^(.+?)を\s*(\d+|ひとつ|一つ)\s*(?:個|つ)?\s*(?:だけ)?(?:作って|作成して|クラフトして)(?:ください)?[。！!]?$/u);
  if(craft && canonicalItem(craft[1]))return {reply:'',actions:[{type:'craft',item:canonicalItem(craft[1]),count:/ひとつ|一つ/.test(craft[2])?1:Number(craft[2])}]};
  const mobNames={敵:'hostile',敵モブ:'hostile',モンスター:'hostile',ゾンビ:'zombie',ドラウンド:'drowned',ハスク:'husk',ストレイ:'stray',ボグド:'bogged',スケルトン:'skeleton',クリーパー:'creeper',クモ:'spider',エンダーマン:'enderman',牛:'cow',ブタ:'pig',豚:'pig',羊:'sheep',ニワトリ:'chicken',鶏:'chicken',ウサギ:'rabbit'};
  const combat=text.match(/^(?:近くの)?(.+?)(?:を)?(?:攻撃して|倒して|狩って)(?:ください)?[。！!、]?\s*(?:(\d+)\s*秒)?[。！!]?$/u);
  if(combat){const target=mobNames[combat[1].replace(/^近くの/u,'')];if(target)return {reply:'',actions:[{type:'combat',target,seconds:Number(combat[2]||20)}]};}
  const build=text.match(/^座標\s*(-?\d+)[,、\s]+(-?\d+)[,、\s]+(-?\d+)\s*から(.+?)で\s*幅\s*(\d+)\s*高さ\s*(\d+)\s*奥行き\s*(\d+)(?:の床|の壁|の柱)?(?:を作って|を建てて)[。！!]?$/u);
  if(build && canonical(build[4]))return {reply:'',actions:[{type:'build',x:Number(build[1]),y:Number(build[2]),z:Number(build[3]),block:canonical(build[4]),width:Number(build[5]),height:Number(build[6]),depth:Number(build[7])}]};
  const surface=text.match(/^座標\s*(-?\d+)[,、\s]+(-?\d+)[,、\s]+(-?\d+)\s*から\s*(.+?)で\s*(\d+)\s*[×x*]\s*(\d+)(?:の)?(床|壁)(?:を作って|を建てて)[。！!]?$/u);
  if(surface && canonical(surface[4]))return {reply:'',actions:[{type:'build',x:Number(surface[1]),y:Number(surface[2]),z:Number(surface[3]),block:canonical(surface[4]),width:Number(surface[5]),height:surface[7]==='壁'?Number(surface[6]):1,depth:surface[7]==='床'?Number(surface[6]):1}]};
  return null;
}
function describeOutcome(action,result) {
  if(action.type==='resource_manage')return '資源管理: 作成 '+(result.made.join('、')||'なし')+'。継続使用 '+(result.kept.join('、')||'なし')+'。'+result.notes.join('。');
  if(action.type==='food_supply')return '食料調達: '+result.item+'を'+result.produced+'個調理（希望'+result.requested+'個）、'+result.eaten+'個食事。満腹度: '+result.food+'。';
  if(action.type==='tunnel_mine')return '直線通路'+result.mainCompleted+'マス、採掘'+result.broken+'個。回収確認: '+(result.collected.map(i=>i.item+'×'+i.count).join('、')||'なし')+'。';
  if(action.type==='branch_mine')return '主通路'+result.mainCompleted+'マス・枝道'+result.branchesCompleted+'本、採掘'+result.broken+'個。回収確認: '+(result.collected.map(i=>i.item+'×'+i.count).join('、')||'なし')+'。開始地点へ戻りました。';
  if(action.type==='give')return result.recipient+'の近くへ'+result.item+'を'+result.dropped+'個落としました。拾って受け取ってください。';
  if(action.type==='dig_below')return '真下の'+result.block+'を1マス採掘。回収確認: '+(result.pickup?.total||0)+'個。';
  if(action.type==='board_boat')return result.alreadyMounted?'すでにボートに乗っています。':'サーバーからボートへの乗船を確認しました。';
  if(action.type==='leave_boat')return result.alreadyUnmounted?'ボートには乗っていません。':'サーバーから降船を確認しました。';
  if(action.type==='smelt')return result.item+'を'+result.produced+'個回収しました。';
  if(action.type==='offhand')return result.item+(result.alreadyEquipped?'はすでにオフハンドに装備しています。':'のオフハンド装備をサーバーで確認しました。');
  if(action.type==='wear')return result.item+(result.alreadyEquipped?'はすでに装備しています。':'の防具スロットへの装着をサーバーで確認しました。');
  if(action.type==='equip')return result.item+'の持ち替え入力を送信しました（ホットバー'+(result.slot+1)+'）。';
  if(action.type==='sleep')return result.sleeping?'ベッドで睡眠中です。!TAKEN 起きて で起床できます。':'睡眠開始をサーバーで確認し、すでに起床しています。';
  if(action.type==='wake')return result.alreadyAwake?'すでに起きています。':'起床をサーバーで確認しました。';
  if(action.type==='status')return formatStatus(result);
  if(action.type==='mine')return `${result.block}を${result.broken}ブロック採掘。回収確認: ${result.pickup?.collected?.map(i=>i.item+'×'+i.count).join('、') || 'なし'}。`;
  if(action.type==='gather')return `探索採掘: ${result.broken}ブロック。回収確認: ${result.collected.map(i=>i.item+'×'+i.count).join('、') || 'なし'}。${result.total<result.requested?'希望数に未到達。'+(result.notes[0] || '採掘上限または対象不足です。'):''}`;
  if(action.type==='collect')return `持ち物の増加を確認: ${result.collected.map(i=>i.item+'×'+i.count).join('、')}。${result.total<result.requested?'希望数に満たない、または残りの対象がありません。':''}`;
  if(action.type==='build')return `${result.block}を${result.placed}ブロック設置。サーバーのブロック変更を確認しました。`;
  if(action.type==='follow')return result.movementInputs===0?'追従を終了。近くにいると判定されたため、歩行入力は送っていません。Botから5ブロックほど離れて試してください。':`${result.followed}への追従を終了。サーバー補正を${result.corrections||0}回確認しました。`;
  if(action.type==='combat')return `${result.target}へ${result.attacks}回攻撃しました。対象の消滅確認: ${result.removed?'あり':'なし'}。`;
  if(action.type==='craft')return `${result.item}を${result.crafted}個作成しました（希望${result.requested}個）。材料消費と完成品をサーバーで確認しました。`;
  if(action.type==='eat')return `${result.eaten}個食べました。満腹度: ${result.food}。`;
  const p=result.position;if(p)return `移動完了。座標: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}。`;
  return '処理を終了しました。';
}
export function formatStatus(s) {
  const p=s.position;return `座標: ${p?`${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`:'未取得'} / 体力: ${s.health??'未取得'} / 満腹度: ${s.food??'未取得'} / 近くのモブ: ${s.nearbyEntities??0}体${s.sleeping?' / ベッドで睡眠中':''}${s.respawning?' / リスポーン待機中':''}${s.recentDeaths?' / 直近2分の死亡: '+s.recentDeaths+'回':''}${s.deathLoop?' / 死亡が繰り返されています。復活地点の保護が必要です':''}${s.automatic?' / 自動行動: '+(s.automatic.paused?'停止中':s.automatic.mode)+' (防衛'+(s.automatic.defenseEnabled?'オン':'オフ')+'・食事'+(s.automatic.foodEnabled?'オン':'オフ')+')':''}。移動・1段の段差ジャンプ・追従・採掘・建築・近距離戦闘・食事・クラフト・道具作成・落下アイテム回収に対応。`;
}
export function validatePlan(plan) {
  if(!plan || typeof plan.reply!=='string' || !Array.isArray(plan.actions) || plan.actions.length>LIMITS.actions)throw Error('AIの操作計画を読み取れません。');
  if(plan.question!==undefined && (typeof plan.question!=='string' || plan.question.length>200 || (plan.question.trim() && plan.actions.length)))throw Error('確認質問と操作を同時に実行できません。');
  let mined=0,built=0,crafted=0,collected=0,smelted=0,given=0;
  for(const a of plan.actions){
    if(a?.type==='resource_manage'&&(plan.actions.length!==1||(a.item!==undefined&&!/^(wooden|stone|iron)_(pickaxe|axe|shovel|sword|hoe)$/.test(a.item))))throw Error('資源管理は単独指示で木・石・鉄の道具を指定してください。');
    if(a?.type==='food_supply'&&(!Number.isInteger(a.count)||a.count<1||a.count>8||plan.actions.length!==1))throw Error('食料調達は単独の指示で1〜8個です。');
    if(!a || !types.has(a.type))throw Error('AIが未対応の操作を選びました。');
    if(a.mode!==undefined && (a.type!=='move' || !['walk','sprint','swim'].includes(a.mode)))throw Error('移動モードが不正です。');
    if(a.type==='move'||a.type==='build')for(const k of ['x','y','z'])if(!Number.isFinite(a[k])||Math.abs(a[k])>30000000)throw Error('移動・建築座標が不正です。');
    if(a.type==='build'){
      for(const k of ['x','y','z'])if(!Number.isInteger(a[k]))throw Error('建築座標は整数にしてください。');
      for(const k of ['width','height','depth'])if(!Number.isInteger(a[k])||a[k]<1||a[k]>LIMITS.dimension)throw Error('建築寸法は1〜'+LIMITS.dimension+'です。');
      built+=a.width*a.height*a.depth;
      if(built>LIMITS.build)throw Error('建築は1指示合計'+LIMITS.build+'ブロック以内です。');
    }
    if(a.type==='tunnel_mine'){mined+=tunnelBudget(a);if(mined>LIMITS.mine)throw Error('採掘は1指示合計64個以内です。');}
    if(a.type==='branch_mine'){mined+=branchBudget(a);if(mined>LIMITS.mine)throw Error('採掘は1指示合計64個以内です。');}
    if(a.type==='mine'||a.type==='gather'){if(!Number.isInteger(a.count)||a.count<1)throw Error('採掘数は正の整数です。');mined+=a.count;if(mined>LIMITS.mine)throw Error('採掘は1指示合計'+LIMITS.mine+'ブロック以内です。');}
    if(a.type==='eat'&&a.count!==undefined&&(!Number.isInteger(a.count)||a.count<1||a.count>8))throw Error('食事は1〜8個です。');
    if(a.type==='give'){if(!/^[a-z0-9_]{1,64}$/.test(a.item||'')||!Number.isInteger(a.count)||a.count<1||(given+=a.count)>64)throw Error('渡すアイテムは1指示合計1〜64個です。');}
    if(a.type==='collect'){if(!Number.isInteger(a.count)||a.count<1 || (a.item && !/^[a-z0-9_]{1,64}$/.test(a.item)))throw Error('回収対象または個数が不正です。');collected+=a.count;if(collected>64)throw Error('回収は1指示合計64個以内です。');}
    if(['equip','wear','offhand'].includes(a.type) && !/^[a-z0-9_]{1,64}$/.test(a.item || ''))throw Error('持ち替えるアイテム名が不正です。');
    if(a.tool && !/^[a-z0-9_]{1,64}$/.test(a.tool))throw Error('道具名が不正です。');
    if(a.type==='smelt'){if(!/^[a-z0-9_]{1,64}$/.test(a.item || '') || !Number.isInteger(a.count)||a.count<1||a.count>16)throw Error('精錬・調理は材料1〜16個です。');smelted+=a.count;if(smelted>16)throw Error('精錬・調理は1指示合計16個です。');}
    if(a.type==='craft'){if(!/^[a-z0-9_]{1,64}$/.test(a.item || '') || !Number.isInteger(a.count)||a.count<1)throw Error('クラフト対象または個数が不正です。');crafted+=a.count;if(crafted>LIMITS.craft)throw Error('クラフトは1指示合計'+LIMITS.craft+'個以内です。');}
    if(a.targetPosition){for(const k of ['x','y','z'])if(!Number.isInteger(a.targetPosition[k]))throw Error('採掘対象座標が不正です。');}
    if(a.type==='follow' && (!Number.isFinite(a.seconds)||a.seconds<1||a.seconds>LIMITS.followSeconds))throw Error('追従は1〜'+LIMITS.followSeconds+'秒です。');
    if(a.type==='combat' && (!combatTargets.has(a.target)||!Number.isFinite(a.seconds)||a.seconds<1||a.seconds>LIMITS.combatSeconds))throw Error('戦闘対象または時間が不正です。');
    if((a.type==='mine'||a.type==='gather'||a.type==='build') && !/^[a-z0-9_]{1,64}$/.test(a.block || ''))throw Error('ブロック名が不正です。');
  }
  return plan;
}
const fields={direction:{type:'string',enum:['north','south','east','west','facing']},length:{type:'integer'},branchLength:{type:'integer'},mode:{type:'string',enum:['walk','sprint','swim']},tool:{type:'string'},item:{type:'string'},x:{type:'number'},y:{type:'number'},z:{type:'number'},block:{type:'string'},count:{type:'integer'},seconds:{type:'number'},player:{type:'string'},width:{type:'integer'},height:{type:'integer'},depth:{type:'integer'},target:{type:'string',enum:[...combatTargets]}};
const schema={type:'object',properties:{reply:{type:'string'},question:{type:'string',description:'不足情報を質問する。質問時actionsは空。不要なら空文字。'},actions:{type:'array',maxItems:8,items:{type:'object',properties:{type:{type:'string',enum:[...types]},...fields},required:['type'],additionalProperties:false}}},required:['reply','actions'],additionalProperties:false};
export async function runActions({instruction,sender,controls,model,fetchImpl,signal,say}) {
  let plan=directPlan(instruction);
  if(!plan && /^目の前のブロックを(?:掘って|採掘して)[。!！]?$/.test(instruction)){
    let target;const eye=controls.position,yaw=controls.yaw*Math.PI/180,pitch=controls.pitch*Math.PI/180;
    if(eye && controls.block)for(let d=0.25;d<=4.5;d+=0.25){const b=controls.block({x:eye.x-Math.sin(yaw)*Math.cos(pitch)*d,y:eye.y-Math.sin(pitch)*d,z:eye.z+Math.cos(yaw)*Math.cos(pitch)*d});if(!b)break;if(b.boundingBox==='block'){target=b;break;}}
    plan=target?{reply:'',actions:[{type:'mine',block:target.name,count:1,targetPosition:target.position}]}:{reply:'',question:'Botが向いている先に採掘できるブロックを確認できません。対象の名前を教えてください。',actions:[]};
  }
  if(!plan){
  const state=controls.status();
  const compactState={position:state.position,health:state.health,food:state.food,respawning:state.respawning,sleeping:state.sleeping,nearbyEntities:state.nearbyEntities,players:state.players?.slice(0,8)};
  const result=await requestLocalAI(fetchImpl,{model,stream:false,format:schema,messages:[
      {role:'system',content:planningPrompt(compactState,controls.inventorySummary?.({english:true}) || '未取得')},
      {role:'system',content:'自由な言い回しを操作に解釈する。「後ろを歩いて」「離れず一緒に来て」→follow、秒数なしは30秒。「そこらの木を少し集めて」→gather wood 8、「鉄を探して掘って」→gather raw_iron 3、「落ちているものを片付けて」→collect count64。「木を拾ってから板材にして」→gather、回収できる見込みの同じ樹種のplanksをcraft、必要ならstick等へ。複数段階は最大8操作。採掘と探索回収は言葉より目的で選ぶ。移動・建築の座標を捏造しない。開始地点へ戻る指示は最初のゲーム状況のpositionを使う。発言者のそばはcome。「床を作って」は材料・場所・寸法が不足ならquestionで一度に質問、actionsは空。質問への追加回答がある場合は元の指示と合わせて計画する。未対応の操作なら実行できないと正直に伝える。チェスト管理等の未実装動作を計画しない。replyは今から試す内容だけ、完了は実行結果に任せる。会話は日本語で穏やかに答える。'},
      {role:'user',content:JSON.stringify({sender,instruction})}
    ],options:{temperature:0,num_predict:512}},signal);
  signal.throwIfAborted();
  const content=(result.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g,'').trim().replace(/^```(?:json)?\s*|\s*```$/g,'');
  plan=validatePlan(JSON.parse(content));
  }
  validatePlan(plan);
  if(plan.actions.some(a=>a.type==='branch_mine')&&!/ブランチマイニング/.test(instruction)){const question='採掘するブロック名を教えてください。ブランチマイニングなら、その名前と方向を指定してください。';say('確認: '+question);return {clarification:question};}
  if(!plan.actions.length && /ナイフ|knife/i.test(plan.reply)){say('通常版にナイフはありません。木は素手でも採掘でき、斧があると速く掘れます。');return;}
  if(plan.question?.trim()){say('確認: '+plan.question.trim());return {clarification:plan.question.trim()};}
  if(!plan.actions.length){if(/集めて|回収して|掘って|採掘して|移動して|ついてきて|攻撃して|倒して/.test(instruction) && !/方法|教えて|やり方/.test(instruction)){say('実行できる操作計画がありません。まだ操作していません。対象と個数を指定してください。例: ジャングルの原木を3個探して集めて。');}else say(plan.reply);return;}
  // LLM narration is not evidence that an operation happened.
  if(plan.actions.length)say('操作を開始します。計画: '+plan.actions.map(a=>a.type+(a.block?' '+a.block:a.item?' '+a.item:'')+(a.count?'×'+a.count:'')).join(' → '));
  let lastAction=null;
  for(let i=0;i<plan.actions.length;i++){
    signal.throwIfAborted();const action=plan.actions[i];console.log(`[AI操作 ${i+1}/${plan.actions.length}]`,JSON.stringify(action));
    try{const outcome=await controls.execute(action,sender,signal);signal.throwIfAborted();
      console.log('[操作結果]',JSON.stringify(outcome));
      say(`${i+1}/${plan.actions.length}: ${describeOutcome(action,outcome)}`);
      lastAction=action;
    }catch(e){if(signal.aborted)throw e;say(`操作を停止: ${e.message}`);return {failed:true};}
  }
  return {lastAction};
}








