export const LIMITS=Object.freeze({travelRadius:256,searchRadius:256,searchStops:48,searchPath:768,searchMilliseconds:600000,craft:64,mine:64,build:256,dimension:16,followSeconds:120,combatSeconds:60,actions:8,taskMilliseconds:900000});
export function capabilitySummary(){return '所持防具の装着・交換、盾と不死のトーテムのオフハンド装備。空の通常かまどで材料1指示合計16個まで精錬・調理、石炭か木炭が必要。移動: 読み取れた足場256ブロック以内（短い区間に分けて移動）、高低差8以内。1段ずつの上りジャンプ・下りに試験対応。追従: 最大'+LIMITS.followSeconds+'秒。採掘: 1指示合計'+LIMITS.mine+'ブロック。建築: 1指示合計'+LIMITS.build+'ブロック、各寸法1〜'+LIMITS.dimension+'。近距離戦闘: 最大'+LIMITS.combatSeconds+'秒。通常クラフト: 完成品1指示合計'+LIMITS.craft+'個。所持材料を使用。3×3レシピは近くの作業台が必要。特殊材料条件は未対応。ホットバーの食事、持ち物表示、レシピ材料表示、周囲表示、自動復活。近くのベッドで就寝・起床に試験対応（オーバーワールドのみ）。自動食事: 満腹度16以下。自動防衛: 被ダメージ直後の近接敵のみ、追跡なし。穴越えジャンプ・2段以上の段差・階段やハーフブロック・潜水・長距離水泳・逃走は未対応。ダッシュ移動は満腹度7以上。水面泳ぎは24ブロック以内、頭上が空気の経路のみ。資源探索: 開始地点256ブロック以内、最大48地点・経路768歩分・600秒。原木・露出した鉱石を探して採掘回収。資源探索gatherは地下を掘り進みません。ブランチマイニング: 同じ高さの幅1・高さ2の通路、3マスごとに左右の枝道、通路と鉱石で64個以内・最大10分。完了後に開始地点へ帰還。ブランチ状態で確認。溶岩・水・穴・落下ブロック・未読込・道具不足で停止。松明自動設置は未対応。落下アイテム回収: 開始位置16ブロック以内、希望1〜64個、最大16山・60秒。安全な足場へ接近し持ち物の増加を確認。採掘後も周辺の回収を試します。建築は固体ブロック・所持ホットバー材料のみ。';}
const names={土:'dirt',砂:'sand',砂利:'gravel',石:'stone',丸石:'cobblestone',深層岩:'deepslate',深層岩の丸石:'cobbled_deepslate',安山岩:'andesite',閃緑岩:'diorite',花崗岩:'granite',砂岩:'sandstone',ガラス:'glass',レンガ:'brick_block',石レンガ:'stone_bricks',木:'oak_log',原木:'oak_log'};
for(const [j,en] of Object.entries({オーク:'oak',トウヒ:'spruce',シラカバ:'birch',ジャングル:'jungle',アカシア:'acacia',ダークオーク:'dark_oak',マングローブ:'mangrove',サクラ:'cherry',ペールオーク:'pale_oak'})){
 names[j+'の原木']=en+'_log';names[j+'の板材']=en+'_planks';
 const hiragana=j.replace(/[ァ-ヶ]/gu,ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
 names[j+'のげんぼく']=names[hiragana+'のげんぼく']=en+'_log';
}
for(const [j,en] of Object.entries({石炭:'coal',鉄:'iron',銅:'copper',金:'gold',ダイヤモンド:'diamond',エメラルド:'emerald',ラピスラズリ:'lapis',レッドストーン:'redstone'})){
 names[j+'鉱石']=en+'_ore';names['深層'+j+'鉱石']='deepslate_'+en+'_ore';names['深層岩の'+j+'鉱石']='deepslate_'+en+'_ore';
}
Object.assign(names,{ネザークォーツ鉱石:'quartz_ore',ネザー金鉱石:'nether_gold_ore',古代の残骸:'ancient_debris',竹の板材:'bamboo_planks'});
export function canonicalBlock(name){return names[name] || lookupName(name,'blocks');}

const itemNames={木炭:'charcoal',生の牛肉:'beef',生の豚肉:'porkchop',生の鶏肉:'chicken',生の羊肉:'mutton',生のウサギ肉:'rabbit',生のタラ:'cod',生の鮭:'salmon',ジャガイモ:'potato',盾:'shield',不死のトーテム:'totem_of_undying',原鉄:'raw_iron',原銅:'raw_copper',原金:'raw_gold',石炭:'coal',鉄インゴット:'iron_ingot',棒:'stick',作業台:'crafting_table',松明:'torch'};
for(const [j,en] of Object.entries({木:'wooden',石:'stone',鉄:'iron',金:'golden',ダイヤモンド:'diamond'}))for(const [tool,name] of Object.entries({ツルハシ:'pickaxe',斧:'axe',シャベル:'shovel',剣:'sword',クワ:'hoe'}))itemNames[j+'の'+tool]=en+'_'+name;
for(const [j,en] of Object.entries({革:'leather',銅:'copper',チェーン:'chainmail',鉄:'iron',金:'golden',ダイヤモンド:'diamond',ネザライト:'netherite',亀:'turtle'}))for(const [part,suffix] of Object.entries({ヘルメット:'helmet',チェストプレート:'chestplate',レギンス:'leggings',ブーツ:'boots'}))itemNames[j+'の'+part]=en+'_'+suffix;
export function canonicalItem(name){return itemNames[name] || names[name] || lookupName(name,'items') || lookupName(name,'blocks');}
import {lookupName} from './item-dictionary.js';


