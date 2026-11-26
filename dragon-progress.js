import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
export const roadmap=['石の道具一式・食料・安全な拠点','鉄の装備・盾・バケツ','ダイヤ装備・ネザー進出','ブレイズロッド・エンダーパール','エンダーアイ・要塞探索','エンド突入・エンドラ討伐'];
export function createProgressStore(file){return {
 load(){try{const p=JSON.parse(readFileSync(file,'utf8'));if(p.version!==1||!Array.isArray(p.events)||!['ready','running','paused','stone_tools_ready','iron_ready'].includes(p.status))throw Error('討伐進捗ファイルの形式が不正です。');return p;}catch(e){if(e.code==='ENOENT')return {version:1,status:'ready',events:[],base:null,reason:'',steps:0};throw e;}},
 save(p){mkdirSync(dirname(file),{recursive:true});const temp=file+'.tmp';writeFileSync(temp,JSON.stringify(p,null,2));renameSync(temp,file);}
};}
export function defaultProgressFile(){const realm=process.env.REALM_ID || process.env.REALM_NAME || 'default';const key=createHash('sha256').update(realm).digest('hex').slice(0,16);return new URL('./progress/dragon-'+key+'.json',import.meta.url);}

