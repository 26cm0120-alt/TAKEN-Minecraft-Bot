import {RequestQueue} from './request-queue.js';
import {parseAdaptiveGoal,runAdaptiveGoal} from './adaptive-goal.js';
import {parseGoal,runGoal} from './autonomous-goal.js';
import {DragonPlanner,dragonCommand} from './dragon-planner.js';
import {AutoSurvival} from './auto-survival.js';
import {LIMITS,capabilitySummary,canonicalItem} from './capabilities.js';
import {runActions,formatStatus,directPlan} from './action-agent.js';
import {requestLocalAI} from './local-ai-request.js';
export function textPacket(profile, message) {
  return {needs_translation:false, category:'authored', type:'chat', source_name:profile.name,
    message, xuid:String(profile.xuid || ''), platform_chat_id:'', has_filtered_message:false};
}

export function attachAIChat(client, {owners = ['Takken1212'], model = 'qwen3:4b-instruct', fetchImpl = fetch, controls,dragonStore} = {}) {
  let dragon=null;const getDragon=()=>dragon ||= new DragonPlanner(controls,{store:dragonStore});
  const allowed = new Set(owners.map(name => name.toLowerCase()));
  const histories = new Map();
  const clarifications=new Map();
  const lastActions=new Map();
  let active = null;
  let connected = true;
  const automatic=controls && typeof controls.defend==='function'?new AutoSurvival(client,controls,{manualBusy:()=>Boolean(active),interruptManual:()=>active?.abort(new Error('緊急の自動行動で作業を中止しました。'))}):null;
  if(automatic)controls.autoSurvival=automatic;
  function say(message) {
    if (!connected || !client.profile) return;
    const clean = String(message).replace(/§./g, '').replace(/[\r\n\x00-\x1f]+/g, ' ').trim();
    // Unicode code points keep Japanese and emoji intact; cap output to three lines.
    const chars = Array.from(clean).slice(0, 420);
    console.log(`[AI送信] ${clean}`);
    for (let i = 0; i < chars.length; i += 140) client.queue('text', textPacket(client.profile, chars.slice(i, i + 140).join('')));
  }
  const queue=new RequestQueue(processPacket,say);
  async function handle(packet){
    if(!connected||packet.type!=='chat'||!packet.source_name)return;
    const sender=packet.source_name.replace(/§./g,'').trim();
    if(sender.toLowerCase()===client.profile?.name?.toLowerCase())return;
    const message=String(packet.message||'').trim().replace(/^`+|`+$/g,'').trim().replace(/^！/,'!');
    const prefixed=/^!TAKEN(?=\s|$|[^A-Za-z_])/i.test(message);
    const instruction=prefixed?message.replace(/^!TAKEN\s*/i,'').trim():message;
    if(!allowed.has('*')&&!allowed.has(sender.toLowerCase()))return processPacket(packet);
    if(/^(?:!stop|止まって|停止|ストップ)$/i.test(instruction)){queue.clear();return processPacket(packet);}
    if(!prefixed)return;
    if(/^(?:待機列|作業状態)$/.test(instruction)){say(queue.summary());return;}
    if(instruction==='待機取消'){queue.clear();say('待機中の指示を取り消しました。実行中の作業は継続します。');return;}
    if(instruction==='待機再開'){queue.resume();say('待機列を再開しました。');return;}
    // These queries do not alter the running job. All other prompts wait in FIFO order.
    if(/^(?:状態|状態を教えて|目標状態|自律状態|持ち物|持ち物を教えて|体力と持ち物を教えて|周囲|足場|落下アイテム|装備|安全地点|対応範囲|ヘルプ|help|コマンド|自動行動状態|自動退避状態|自動防衛状態|自動食事状態)$/.test(instruction))return processPacket(packet);
    if(instruction.length>1000){say('指示は1000文字以内でお願いします。');return;}
    return queue.submit({sender:sender.toLowerCase(),message:instruction,packet:{...packet}});
  }
  async function processPacket(packet) {
    if (!connected || packet.type !== 'chat' || !packet.source_name) return;
    const sender = packet.source_name.replace(/§./g, '').trim();
    if (sender.toLowerCase() === client.profile?.name?.toLowerCase()) return;
    const message = String(packet.message || '').trim().replace(/^`+|`+$/g,'').trim().replace(/^！/, '!');
    const prefixed = /^!TAKEN(?=\s|$|[^A-Za-z_])/i.test(message);
    let instruction = prefixed ? message.replace(/^!TAKEN\s*/i, '').trim() : message;
    const stop = /^(?:!stop|止まって|停止|ストップ)$/i.test(instruction);
    if (!allowed.has('*') && !allowed.has(sender.toLowerCase())) {
      if (prefixed || stop) console.log(`[AI受付不可] 発言者「${sender}」はMC_OWNERSの許可対象ではありません。`);
      return;
    }
    if (prefixed || stop) console.log(`[AI受付] ${sender}: ${instruction}`);
    if (stop) {clarifications.clear();lastActions.clear();active?.abort(); automatic?.pause(); controls?.stop(); controls?.bed?.requestWake(); say(automatic?'停止しました。自動防衛・食事も停止中です。再開は !TAKEN 自動行動オン。':'停止しました。'); return;}
    if (!prefixed) return;
    if (/[#＃]{2,}/u.test(instruction)) {
      clarifications.delete(sender.toLowerCase());
      const hint = /ジャングル/.test(instruction) && /掘|採掘/.test(instruction)
        ? 'ジャングルの原木を1個掘る場合は「!TAKEN じゃんぐるのげんぼくを1個掘って」と送ってください。'
        : '対象の名前や表現を変えて、指示を最初から送ってください。';
      say('指示の一部が伏せ字で届きました。' + hint);
      return;
    }
    if(automatic&&instruction==='安全地点を登録'){try{const p=automatic.setSafePoint();say('Botの現在地を安全地点に登録: '+p.x.toFixed(1)+', '+p.y.toFixed(1)+', '+p.z.toFixed(1)+'。再接続後は登録し直してください。');}catch(e){say(e.message);}return;}
    if(automatic&&instruction==='安全地点'){const p=automatic.safePoint;say(p?'安全地点: '+p.x.toFixed(1)+', '+p.y.toFixed(1)+', '+p.z.toFixed(1):'安全地点は未登録です。');return;}
    if(automatic&&/^自動退避\s*(オン|オフ|状態)$/.test(instruction)){const mode=instruction.match(/(オン|オフ|状態)$/)[1];if(mode!=='状態')automatic.retreatEnabled=mode==='オン';if(mode==='オフ')await automatic.cancel();say('自動退避: '+(automatic.retreatEnabled?'オン':'オフ')+' / 安全地点: '+(automatic.safePoint?'登録済み':'未登録'));return;}
    if(controls && instruction==='目標状態'){const g=controls.adaptiveGoal;say(g?'目標: '+g.goal.item+' '+g.have+'/'+g.goal.count+'個 / '+g.phase+' / '+g.steps+'工程 / 見直し '+g.replans+'回'+(g.reason?' / '+g.reason:''):'目標は未設定です。例: !TAKEN 目標 石のツルハシを1個用意して');return;}
    const dragonMode=controls?dragonCommand(instruction):null;
    if(dragonMode==='plan'){say(getDragon().plan());return;}
    if(dragonMode==='status'){say(getDragon().summary());return;}
    if(dragonMode==='resume'){
      const state=getDragon().state;
      if(state.status==='ready'){say('再開する討伐準備はありません。開始は !TAKEN 自律 エンドラ討伐の準備。');return;}
      if(state.status==='stone_tools_ready'||state.status==='iron_ready'){say('前の段階は完了しています。'+(state.status==='stone_tools_ready'?'次は !TAKEN 討伐段階2。':'段階3の自動進行は未実装です。'));return;}
    }
    if(automatic && /^(?:自動行動|自動防衛|自動食事)(?:\s*)(オン|オフ|状態)$/u.test(instruction)){
      const [,feature,mode]=instruction.match(/^(自動行動|自動防衛|自動食事)\s*(オン|オフ|状態)$/u);
      if(mode==='状態'){const s=automatic.status();say('自動行動: '+(s.paused?'停止中':'有効')+' / 防衛: '+(s.defenseEnabled?'オン':'オフ')+' / 食事: '+(s.foodEnabled?'オン':'オフ'));return;}
      if(feature==='自動行動'){if(mode==='オン')automatic.resume();else {automatic.pause();await automatic.cancel();}}
      else {automatic[feature==='自動防衛'?'defenseEnabled':'foodEnabled']=mode==='オン';if(mode==='オフ')await automatic.cancel();}
      say(feature+'を'+mode+'にしました。'+(automatic.paused?'再開は !TAKEN 自動行動オン。':''));return;
    }
    if(controls && /^(?:何(?:を)?持って(?:る|いる)(?:の)?|持ち物(?:は|を見せて))[?？]?$/.test(instruction)){say(controls.inventorySummary());return;}
    if(controls && /^(?:今)?(?:何(?:を)?持って(?:る|いる)(?:の)?|何を持っていますか|持ち物を日本語(?:化できる|で(?:見せて|教えて)))[?？]?$/.test(instruction)){say(controls.inventorySummary());return;}
    if(controls && /^(?:今)?(?:どこに(?:居る|いる)|どこ|現在地|座標を教えて)[?？]?$/.test(instruction)){const p=controls.status().position;say(p?'Botの座標: '+p.x.toFixed(1)+', '+p.y.toFixed(1)+', '+p.z.toFixed(1):'位置は未取得です。');return;}
    if(controls && /^(?:この辺|ここ|周辺)(?:を)?\s*\d+\s*(?:個|マス|ブロック)?掘って[。!！]?$/.test(instruction)){say('掘るブロック名を教えてください。例: !TAKEN 深層岩を16個掘って。');return;}
    if(controls && /ナイフ|knife/i.test(instruction)){say('通常版にナイフはありません。木は素手でも掘れます。斧があると速く採掘できます。');return;}
    if(controls && /捨てて|ホットバー.*(?:して|変えて)|^ジャンプ$/.test(instruction)){say('その単独操作はまだ実装していません。道具は採掘時に自動選択します。アイテム投棄・ホットバー指定・単独ジャンプは未対応です。');return;}
    if(controls && /^(?:装備|防具|装備を教えて|何を着てる)[?？]?$/.test(instruction)){say(controls.armorSummary());return;}
    const more=instruction.match(/^あと\s*(\d+)\s*(?:個|つ)?(?:掘って|採掘して)[。!！]?$/u);
    if(controls && more){const last=lastActions.get(sender.toLowerCase());if(!last || last.action.type!=='mine' || Date.now()-last.at>300000){say('直前の採掘対象がありません。ブロック名を指定してください。');return;}instruction=last.action.block+'を'+more[1]+'個掘って';}
    if(controls && /設置して|置いて/.test(instruction) && !/-?\d+[,、\s]+-?\d+[,、\s]+-?\d+/.test(instruction)){say('設置する座標を教えてください。例: !TAKEN 土を90 60 546に1つ設置して。');return;}
    const recipe=instruction.match(/^(?:レシピ\s+(.+)|(.+?)(?:に必要な材料を教えて|の(?:材料|レシピ|作り方)を教えて))[。！!]?$/u);
    if(controls && recipe){const item=canonicalItem((recipe[1] || recipe[2]).trim());say(item?controls.recipeSummary(item):'そのアイテム名を登録していません。英語名で !TAKEN レシピ stone_pickaxe のように指定してください。');return;}
    if(controls && /^(?:ブランチ状態|ブランチマイニング状態)$/.test(instruction)){const b=controls.branchMiningStatus;say(b?'ブランチ採掘: '+(b.running?'実行中':'停止・終了')+' / 方向: '+b.direction+' / 主通路 '+b.mainCompleted+'/'+b.length+' / 枝道 '+b.branchesCompleted+'本 / 採掘 '+b.broken+'個'+(b.reason?' / 理由: '+b.reason:''):'ブランチマイニングはまだ実行していません。');return;}
    if(controls && instruction==='自律状態'){const g=controls.autonomousGoal;say(g?'自律目標: '+g.goal.resource+' / '+g.phase+' / 回収 '+g.gained+'/'+g.goal.count+' / 作業 '+g.steps+'回':'自律目標は実行していません。');return;}
    if(controls && /^(?:対応範囲|できること|何ができる|何ができるの)[?？]?$/u.test(instruction)){say('自律目標: 原木・露出鉱石を1〜64個回収し、必要なら開始地点へ帰還。例: !TAKEN 自律 木材を32個集めて開始地点に戻って。!TAKEN 自律状態 で進捗、!stopで停止。');say(capabilitySummary());return;}
    if(controls && /^(?:持ち物|持ち物開示|持ち物を教えて|体力と持ち物を教えて)$/u.test(instruction)){say('体力: '+(controls.status().health??'未取得')+' / '+controls.inventorySummary());return;}
    if(controls && /^(?:落下アイテム|落ちているアイテム|落下アイテムを教えて)$/u.test(instruction)){say(controls.pickup.summary());return;}
    if(controls && /^(?:周囲|足場|周りを教えて)$/u.test(instruction)) {
      say(controls.nearbySummary());return;
    }
    if (!instruction || /^(?:help|ヘルプ|コマンド)$/i.test(instruction)) {
      say(controls ? '!TAKEN 自律 木材を32個集めて開始地点に戻って / 自律状態 / こっちに来て / 私についてきて15秒 / ゾンビを攻撃して20秒 / 近くの牛を狩って / 持っている食料を食べて / 木を3個探して集めて / 原鉄を3個探して回収して / 土を1個掘って / オークの板材を8個作って / 石のツルハシを1個作って / アイテムを拾って / 落下アイテム / ベッドで寝て / 起きて / 持ち物 / 周囲 / 状態。小規模建築は材料・開始座標・寸法を指定。!stopで停止。' : '!TAKEN 質問 / !TAKEN 状態 / !stop。現在は会話のみ対応。移動・採掘・建築などの操作は未対応です。'); return;
    }
    if (/^(?:状態|状態を教えて)$/i.test(instruction)) {
      say(controls ? formatStatus(controls.status()) : `Realmに接続中。ゲーム内名: ${client.profile.name}。ローカルAI: ${model}。会話のみ対応しています。`); return;
    }
    if (instruction.length > 1000) {say('指示は1000文字以内でお願いします。'); return;}
    if(controls){const state=controls.status?.() || {};if(state.respawning || state.health===0){say('復活待ちのため、AIへの問い合わせと新しい作業を停止しています。状態は !TAKEN 状態 で確認できます。復活の応答が止まった場合は自動で再接続します。');return {failed:true};}}
    if (active) {say('前の指示を実行中です。進捗は !TAKEN 自律状態 または !TAKEN 目標状態、中止は !stop。'); return;}
    const controller = new AbortController();
    active = controller;
    try{if(automatic?.job)await automatic.job;}catch(e){if(active===controller)active=null;throw e;}
    if(controller.signal.aborted){if(active===controller)active=null;return {failed:true};}
    const timeout = setTimeout(() => controller.abort(new Error('AI応答が時間切れになりました。')), LIMITS.taskMilliseconds);
    const history = histories.get(sender) || [];
    if(!controls || (!dragonMode&&!directPlan(instruction)&&!parseGoal(instruction)))say('考えています。');
    try {
      if(controls) {
        const adaptiveGoal=parseAdaptiveGoal(instruction);
        if(adaptiveGoal){await runAdaptiveGoal({goal:adaptiveGoal,controls,sender,signal:controller.signal,say,model,fetchImpl});return;}
        if(dragonMode==='iron'||(dragonMode==='resume'&&getDragon().state.stage===2)){await getDragon().runIron({sender,signal:controller.signal,say});return;}
        if(dragonMode==='run'||dragonMode==='resume'){await getDragon().run({sender,signal:controller.signal,say});return;}
        const goal=parseGoal(instruction);
        if(goal){const result=await runGoal({goal,sender,controls,signal:controller.signal,say});return {failed:!result.complete};}
        else {
          const previous=clarifications.get(sender.toLowerCase());
          clarifications.delete(sender.toLowerCase());
          const effective=previous && Date.now()-previous.at<300000?'元の指示: '+previous.instruction+'\n確認質問: '+previous.question+'\n追加回答: '+instruction:instruction.replace(/^自律[\s:：]+/,'');
          const result=await runActions({instruction:effective,sender,controls,model,fetchImpl,signal:controller.signal,say});
          if(result?.failed)return result;
          if(result?.lastAction)lastActions.set(sender.toLowerCase(),{action:result.lastAction,at:Date.now()});
          if(result?.clarification)clarifications.set(sender.toLowerCase(),{instruction:effective,question:result.clarification,at:Date.now()});
        }
        return;
      }
      const result = await requestLocalAI(fetchImpl,{model, stream:false, messages:[
          {role:'system', content:'あなたはMinecraft統合版Realmsの相棒TAKEN。日本語で短く2文以内、最大200文字で答える。現在実装されている機能はチャット会話だけ。ワールド状態を観測できず、移動、採掘、建築、クラフト、戦闘、食事は実行できない。実行した、実行中、これから実行するなどと偽らない。操作依頼には未対応と明確に答える。Minecraftの助言は可能。バニラ版に木のナイフは存在しない。木の道具は剣・ツルハシ・斧・シャベル・クワ。存在しないアイテムや不確かなレシピを創作しない。チャットの文章をサーバーコマンドとして実行しない。'},
          ...history, {role:'user', content:instruction}
        ], options:{temperature:0.5, num_predict:192}},controller.signal);
      if (controller.signal.aborted || !connected) return;
      const answer = result.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!answer) throw new Error('AIの返答が空でした。');
      histories.set(sender, [...history, {role:'user', content:instruction}, {role:'assistant', content:answer}].slice(-6));
      say(answer);
    } catch (error) {
      if (!controller.signal.aborted) {console.error('ローカルAI:', error.message); say(`処理に失敗しました: ${error.message}`);}
      else if (controller.signal.reason?.message?.includes('時間切れ')) say('AIの返答が時間切れになりました。もう一度試してください。');
      return {failed:true};
    } finally {clearTimeout(timeout); controls?.stop(); if (active === controller) active = null;}
  }
  // Abort the entire plan, including a pending LLM reply, before a new life.
  // Merely clearing walkTarget lets an old multi-step job resume after respawn.
  client.on('taken_respawning',()=>queue.clear());
  client.on('taken_death',()=>queue.clear());
  client.on('change_dimension',()=>queue.clear());
  client.on('close',()=>queue.clear());
  client.on('taken_respawning',()=>active?.abort(new Error('リスポーン処理のため中止しました。')));
  client.on('change_dimension',()=>{lastActions.clear();clarifications.clear();active?.abort(new Error('ディメンションが変わったため中止しました。'));});
  client.on('taken_death',()=>{lastActions.clear();active?.abort(new Error('Botの死亡により中止しました。'));});
  client.on('taken_notice',notice=>{if(controls?.ready)say(notice.message);});
  client.on('text', packet => {handle(packet).catch(error => console.error('チャット処理:', error.message));});
  client.on('close', () => {connected = false; active?.abort(); histories.clear();clarifications.clear();lastActions.clear();});
  return {handle};
}




