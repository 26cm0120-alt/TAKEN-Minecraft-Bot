// Tool-aware timing estimate; server block updates remain the source of truth.
const speeds={wooden:2,stone:4,copper:4,iron:6,diamond:8,netherite:9,golden:12};
export function miningTicks(block,tool,{submerged=false,grounded=true}={}){
 const material=block.material||'',pick=material.includes('pickaxe')||/_ore$|ancient_debris|^deepslate$/.test(block.name);
 const suffix=pick?'pickaxe':material.includes('shovel')?'shovel':material.includes('axe')?'axe':material.includes('hoe')?'hoe':null;
 const tier=String(tool||'').split('_')[0],matches=suffix&&String(tool||'').endsWith('_'+suffix);
 let speed=matches?(speeds[tier]||1):1;
 if(submerged)speed/=5;if(!grounded)speed/=5;
 const needsTool=pick||Boolean(block.harvestTools&&Object.keys(block.harvestTools).length);
 const divisor=needsTool&&!matches?100:30;
 return Math.max(1,Math.min(1200,Math.ceil(Math.max(0,block.hardness??1)*divisor/speed)));
}
