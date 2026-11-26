import {ingredientMatches} from './realm-crafting.js';
import {resourceSpec} from './resource-search.js';
import {smelts} from './realm-furnace.js';

// Material reservations use the same matching rules as actual server crafting.
export function materialRequirements(c,item,missing){
 return [...(c.crafting?.recipes?.values()||[])].filter(r=>c.registry.items[r.output?.[0]?.network_id]?.name===item&&r.output[0].count>0).map(r=>{
  const times=Math.ceil(missing/r.output[0].count),available=c.items.slice(0,36).map(i=>i?.count||0),ingredients=[];
  const ordered=(r.input||[]).filter(i=>i.type==='valid'&&i.descriptor_type!=='empty'&&i.count>0).sort((a,b)=>Number(a.descriptor_type==='item_tag')-Number(b.descriptor_type==='item_tag'));
  for(const ingredient of ordered){
   const required=ingredient.count*times;let left=required;
   for(let s=0;s<available.length&&left;s++)if(available[s]&&ingredientMatches(ingredient,c.items[s],c.registry)){
    const n=Math.min(left,available[s]);available[s]-=n;left-=n;
   }
   ingredients.push({name:ingredient.name,tag:ingredient.tag,required,allocated:required-left,missing:left});
  }
  return {recipe:r.network_id,output:item,produces:times*r.output[0].count,ingredients,missing:ingredients.reduce((n,i)=>n+i.missing,0)};
 }).sort((a,b)=>a.missing-b.missing).slice(0,3);
}
export function inventoryFingerprint(rows){
 const totals=new Map();
 for(const row of rows){const key=JSON.stringify([row.item,row.remaining??null]);totals.set(key,(totals.get(key)||0)+row.count);}
 return JSON.stringify([...totals].sort(([a],[b])=>a.localeCompare(b)));
}
export function actionGain(action,before,after){
 const names=action.type==='gather'?resourceSpec(action.item).items:action.type==='smelt'?[smelts[action.item]]:[action.item];
 const count=rows=>rows.filter(i=>names.includes(i.item)).reduce((n,i)=>n+i.count,0);
 return count(after)-count(before);
}
export function readyCraft(c,item,missing){
 if(typeof c.crafting?.select!=='function')return null;
 let recipe;try{recipe=c.crafting.select(item,missing);}catch{return null;}
 if(c.crafting.needsTable(recipe)){
  const f=c.feet();let nearby=false;
  for(let x=-6;x<=6&&!nearby;x++)for(let z=-6;z<=6&&!nearby;z++)for(let y=-2;y<=3;y++)if(c.block({x:Math.floor(f.x)+x,y:Math.floor(f.y)+y,z:Math.floor(f.z)+z})?.name==='crafting_table'){nearby=true;break;}
  if(!nearby)return null;
 }
 return {action:{type:'craft',item,count:missing},reason:'受信済みレシピと所持材料から作成可能'};
}
