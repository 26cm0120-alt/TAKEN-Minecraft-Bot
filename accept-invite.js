import {configuredBedrockVersion} from './bedrock-version.js';
import auth from 'prismarine-auth';
import realms from 'prismarine-realms';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
const {Authflow, Titles} = auth;
const {RealmAPI} = realms;
const input = createInterface({input:process.stdin, output:process.stdout});
try {
  const folder = fileURLToPath(new URL('./auth/', import.meta.url));
  mkdirSync(folder, {recursive:true});
  const flow = new Authflow(process.env.BEDROCK_ACCOUNT || 'taken-realms-bot', folder,
    {authTitle:Titles.MinecraftNintendoSwitch, deviceType:'Nintendo', flow:'live'}, code => {
      console.log('TAKE6866のMicrosoftアカウントで認証してください。');
      console.log(`認証ページ: ${code.verification_uri || 'https://www.microsoft.com/link'}`);
      console.log(`認証コード: ${code.user_code}`);
    });
  const api = RealmAPI.from(flow, 'bedrock', {minecraftVersion:configuredBedrockVersion()});
  const invites = await api.getPendingInvites();
  if (!invites.length) {
    console.log('承諾待ちの招待がありません。TAKE6866への招待と、認証したアカウントを確認してください。');
    console.log('すでに承諾済みなら、Realms接続確認.batを試してください。');
  } else {
    invites.forEach((invite,index) => console.log(`${index+1}: ${invite.worldName} / 所有者: ${invite.worldOwnerName}`));
    const answer = (await input.question('自分のRealmの番号を入力（空欄で中止）: ')).trim();
    const index = Number(answer)-1;
    if (answer && Number.isInteger(index) && index >= 0 && index < invites.length) {
      const invite = invites[index];
      const confirmation = (await input.question(`「${invite.worldName}」への招待を承諾しますか？ yes と入力: `)).trim();
      if (confirmation === 'yes') {
        await api.acceptRealmInvitation(invite.invitationId);
        console.log('招待を承諾しました。Realms接続確認.batを開いてください。');
      } else console.log('中止しました。');
    } else console.log('中止しました。');
  }
} catch(error) {console.error('招待の確認エラー:',error.message); process.exitCode=1;}
finally {input.close();}
