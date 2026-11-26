import {configuredBedrockVersion} from './bedrock-version.js';
import './signalling-fix.js';
import bedrock from 'bedrock-protocol';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import {attachAIChat} from './ai-chat.js';
import {RealmControls} from './realm-controls.js';
import {RealmRecovery} from './realm-recovery.js';
console.log('[Bot更新] 日本語持ち物・道具別採掘速度 / 起動元:',fileURLToPath(import.meta.url));

const authDir = fileURLToPath(new URL('./auth/', import.meta.url));
mkdirSync(authDir, {recursive:true});
const require=createRequire(import.meta.url);
const bedrockVersion=configuredBedrockVersion();
if (bedrockVersion==='1.26.51') {
  // minecraft-data currently carries preview-era PlayerAuthInput ordinals
  // under the 1.26.51 stable key. Protocol 2193 has no north_jump or the two
  // later camera flags, so correct the schema before bedrock-protocol compiles it.
  const mcData=require('minecraft-data')('bedrock_1.26.51');
  const stableInputData=[
    'ascend','descend','jump_down','sprint_down','change_height','jumping','auto_jumping_in_water','sneaking','sneak_down',
    'up','down','left','right','up_left','up_right','want_up','want_down','want_down_slow','want_up_slow','sprinting',
    'ascend_block','descend_block','sneak_toggle_down','persist_sneak','start_sprinting','stop_sprinting','start_sneaking',
    'stop_sneaking','start_swimming','stop_swimming','start_jumping','start_gliding','stop_gliding','item_interact',
    'block_action','item_stack_request','handled_teleport','emoting','missed_swing','start_crawling','stop_crawling',
    'start_flying','stop_flying','received_server_data','client_predicted_vehicle','paddling_left','paddling_right',
    'block_breaking_delay_enabled','horizontal_collision','vertical_collision','down_left','down_right','start_using_item',
    'start_spin_attack','stop_spin_attack','hotbar_only_touch','jump_released_raw','jump_pressed_raw','jump_current_raw',
    'sneak_released_raw','sneak_pressed_raw','sneak_current_raw','internal_update'
  ];
  mcData.protocol.types.InputData.mappings=Object.fromEntries(stableInputData.map((name,index)=>[index,name]));
  console.log('Bedrock 1.26.51のPlayerAuthInput入力番号を適用しました。');
}
console.log('Bedrock接続バージョン:',bedrockVersion);
const realmId = process.env.REALM_ID?.trim();
const realmName = process.env.REALM_NAME?.trim();
let currentClient=null;
function connectSession(){
const client = bedrock.createClient({
  username: process.env.BEDROCK_ACCOUNT || 'taken-realms-bot',
  profilesFolder: authDir,
  offline: false,
  version: bedrockVersion,
  raknetBackend: 'jsp-raknet',
  connectTimeout: 30000,
  realms: realmId ? {realmId} : {pickRealm(realms) {
    const selected = realmName ? realms.filter(realm => realm.name === realmName) : realms;
    if (selected.length !== 1) {
      console.log('このアカウントで参加できるRealms:');
      for (const realm of realms) console.log(`名前: ${realm.name} / ID: ${realm.id}`);
      throw new Error(selected.length ? '.envのREALM_NAMEまたはREALM_IDで1つを指定してください' : 'Realmが見つかりません。Bot専用アカウントへの招待とRealm名を確認してください');
    }
    console.log(`接続先Realm: ${selected[0].name}`);
    return selected[0];
  }},
  onMsaCode(code) {
    console.log('Bot専用のMicrosoftアカウントで認証してください。');
    console.log(`認証ページ: ${code.verification_uri || 'https://www.microsoft.com/link'}`);
    console.log(`認証コード: ${code.user_code}`);
  }
});
const aiEnabled = process.env.AI_ENABLED === '1';
currentClient=client;
const controls=aiEnabled ? new RealmControls(client,bedrockVersion) : undefined;
console.log(`起動モード: ${aiEnabled ? 'AI操作（試験版）' : '接続確認のみ'} / 指示を許可する名前: ${process.env.MC_OWNERS === '*' ? 'すべてのRealm参加者' : process.env.MC_OWNERS || 'Takken1212'}`);
if (aiEnabled) attachAIChat(client, {
  owners:(process.env.MC_OWNERS || 'Takken1212').split(',').map(name => name.trim()).filter(Boolean),
  model:process.env.OLLAMA_MODEL || 'qwen3:4b-instruct', controls
});
client.on('spawn', () => console.log(aiEnabled
  ? 'Realmsに参加できました。!TAKEN 指示 / !TAKEN 状態 / !stop。採掘64個・建築256個・通常クラフト64個まで。落下アイテム回収・256ブロック以内の移動・資源探索に試験対応。自動防衛・自動食事オン。ベッドで寝て / 起きて に試験対応。!TAKEN 自動行動状態 / 対応範囲 で確認できます。'
  : 'Realmsに参加できました。現在は接続確認モードです。移動・採掘・AI操作はまだ実装していません。'));
client.on('text', packet => {
  if (packet.source_name) console.log(`<${packet.source_name}> ${packet.message}`);
  else console.log(`[受信チャット:${packet.type}] ${String(packet.message || '').slice(0, 1200)}`);
});
client.on('kick', packet => {
  console.log('サーバーから切断されました:', packet.message || packet.filtered_message || packet.reason || '説明文なし');
  console.log('切断情報:', JSON.stringify(packet));
  if (packet.reason === 'server_id_conflict') console.log('接続情報の競合が報告されました。TAKE6866のMinecraftと他のBotを終了し、1分待ってから再起動してください。');
});
client.on('error', error => console.error('接続エラー:', error.message));
client.on('close', () => console.log('接続が終了しました。'));
return client;
}
const recovery=new RealmRecovery(connectSession);
recovery.attach(connectSession());
let stopping = false;
process.on('SIGINT', async () => {
  if (stopping) return;
  stopping = true;
  recovery.stop();
  console.log('Botの接続を終了しています。');
  currentClient?.close();
  // close() starts asynchronous NetherNet cleanup. Do not exit before it completes.
  await Promise.race([
    Promise.resolve(currentClient?._nethernetCleanup).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 3000))
  ]);
  console.log('Botを終了しました。');
  process.exit(0);
});

