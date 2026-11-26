import {toolCondition} from './tool-condition.js';
const tier={wooden:0,golden:0,stone:1,copper:1,iron:2,diamond:3,netherite:4};
export function miningToolSlot(items,registry,block,{required=false}={}) {
  const pick=/(?:_ore|ancient_debris)$/.test(block) || registry.blocksByName[block]?.material?.includes('pickaxe') || block==='deepslate';
  const suffix=pick?'pickaxe':/dirt|grass_block|sand|gravel|clay|snow|mud|soul_soil/.test(block)?'shovel':/log|wood|stem|hyphae|planks/.test(block)?'axe':null;
  const minimum=block==='ancient_debris'?3:/diamond_ore|emerald_ore|gold_ore|redstone_ore/.test(block)&&block!=='nether_gold_ore'?2:/iron_ore|lapis_ore/.test(block)?1:0;
  const choices=Array.from({length:Math.min(items.length,36)},(_,slot)=>({slot,item:items[slot],name:registry.items[items[slot]?.network_id]?.name || ''}))
    .filter(x=>x.item?.count>0 && suffix && x.name.endsWith('_'+suffix) && (!pick || tier[x.name.slice(0,-suffix.length-1)]>=minimum))
    .sort((a,b)=>Number((toolCondition(b.item,registry)?.ratio??1)>.2)-Number((toolCondition(a.item,registry)?.ratio??1)>.2)||tier[b.name.slice(0,-suffix.length-1)]-tier[a.name.slice(0,-suffix.length-1)]||(toolCondition(b.item,registry)?.ratio??0)-(toolCondition(a.item,registry)?.ratio??0));
  if(!choices.length && (pick || required))throw Error((minimum===3?'ダイヤモンド以上':minimum===2?'鉄以上':minimum===1?'石以上':'採掘用')+'のツルハシをBotに渡してください。!TAKEN 持ち物 で受け取りを確認できます。');
  return choices[0]?.slot ?? -1;
}
