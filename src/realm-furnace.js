export const smelts={raw_iron:'iron_ingot',raw_copper:'copper_ingot',raw_gold:'gold_ingot',beef:'cooked_beef',porkchop:'cooked_porkchop',chicken:'cooked_chicken',mutton:'cooked_mutton',rabbit:'cooked_rabbit',cod:'cooked_cod',salmon:'cooked_salmon',potato:'baked_potato',cobblestone:'stone',sand:'glass'};
const emptyItem=()=>({network_id:0,count:0,metadata:0,has_stack_id:false,block_runtime_id:0,extra:{has_nbt:'false',can_place_on:[],can_destroy:[]}});
export class RealmFurnace{
 constructor(c){
  this.c=c;this.slots=[];this.known=false;this.window=null;
  c.client.on('container_open',p=>{if(p.window_type==='furnace'){this.window=p;this.slots=[];this.known=false;}});
  c.client.on('container_close',p=>{if(p.window_id===this.window?.window_id){this.window=null;this.known=false;}});
  c.client.on('inventory_content',p=>{if(this.window && p.window_id===this.window.window_id){this.slots=p.input;this.known=p.input.length>=3;}});
  c.client.on('inventory_slot',p=>{if(this.window && p.window_id===this.window.window_id && p.slot<3)this.slots[p.slot]=p.item;});
  for(const event of ['close','start_game','taken_death'])c.client.on(event,()=>{this.window=null;this.known=false;});
 }
 name(i){return this.c.registry.items[i?.network_id]?.name;}
 count(name){return this.c.items.slice(0,36).reduce((n,i)=>n+(i?.count && this.name(i)===name?i.count:0),0);}
 source(name){return this.c.items.slice(0,36).findIndex(i=>i?.count && this.name(i)===name);}
 async open(signal){
  const c=this.c;if(c.crafting.window || c.crafting.pending || c.crafting.uncertain)throw Error('別の所持品操作が実行中または未確定です。');
  const f=c.feet(),found=[];
  for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)for(let y=-2;y<=3;y++){const b=c.block({x:Math.floor(f.x)+x,y:Math.floor(f.y)+y,z:Math.floor(f.z)+z});if(b?.name==='furnace')found.push(b);}
  found.sort((a,b)=>Math.hypot(a.position.x-f.x,a.position.z-f.z)-Math.hypot(b.position.x-f.x,b.position.z-f.z));
  const b=found[0];if(!b)throw Error('6ブロック以内に通常のかまどを置いてください。');
  await c.goto({...b.position,y:f.y},signal,3);
  if(Math.hypot(c.position.x-b.position.x-0.5,c.position.y-b.position.y-0.5,c.position.z-b.position.z-0.5)>4.5)throw Error('かまどに手が届きません。');
  c.look({x:b.position.x+0.5,y:b.position.y+0.5,z:b.position.z+0.5});
  c.pendingTransaction={legacy:{legacy_request_id:0},actions:[],data:{action_type:'click_block',trigger_type:'player_input',block_position:b.position,face:1,hotbar_slot:c.slot,hand:'main_hand',held_item:c.items[c.slot] || emptyItem(),player_pos:{...c.position},click_pos:{x:0.5,y:1,z:0.5},block_runtime_id:b.runtimeId,client_prediction:'success',client_cooldown_state:'off'}};
  const end=Date.now()+8000;while((!this.window || !this.known) && Date.now()<end)await c.wait(100,signal);
  if(!this.window || !this.known)throw Error('かまど画面と所持枠の応答を確認できません。');
 }
 async smelt(input,count,signal){
  const c=this.c;c.check(signal);const output=smelts[input];
  if(!output || !Number.isInteger(count)||count<1||count>16)throw Error('精錬・調理は対応材料1〜16個です。');
  if(!c.pickup.inventoryReady)throw Error('持ち物全体が未受信です。');
  if(this.count(input)<count)throw Error(input+'の所持材料が不足しています。');
  const fuel=['coal','charcoal'].find(n=>this.count(n)>=Math.ceil(count/8));if(!fuel)throw Error('燃料の石炭または木炭を'+Math.ceil(count/8)+'個以上用意してください。');
  const before=this.count(output);let recovered=0;
  try{
   await this.open(signal);
   if(this.slots.some(i=>i?.count))throw Error('使用中または材料の入ったかまどは操作しません。空のかまどを用意してください。');
   for(const [name,needed,key] of [[input,count,'furnace_ingredient:0'],[fuel,Math.ceil(count/8),'furnace_fuel:1']]){
    let remaining=needed;while(remaining){const slot=this.source(name);if(slot<0)throw Error('投入中に材料が不足しました。');const amount=Math.min(remaining,c.items[slot].count);await c.crafting.transferSlots(slot,key,amount,signal);remaining-=amount;}
   }
   c.client.emit('taken_notice',{message:'かまどで'+input+'を'+count+'個処理中です。!stopで待機を中止できます。'});
   const end=Date.now()+count*12000+30000;
   while(recovered<count && Date.now()<end){
    c.check(signal);if(!this.window || !this.known)throw Error('かまど画面が閉じられました。');
    const item=this.slots[2];
    if(item?.count){
     if(this.name(item)!==output)throw Error('予期しない完成品です。かまどを確認してください。');
     const amount=Math.min(item.count,count-recovered),destination=Array.from({length:36},(_,s)=>s).find(s=>!c.items[s]?.count);
     if(destination===undefined)throw Error('完成品を入れる空き枠がありません。');
     await c.crafting.transferSlots('furnace_output:2',destination,amount,signal);recovered+=amount;
    }else await c.wait(500,signal);
   }
   const gained=this.count(output)-before;if(recovered<count || gained<count)throw Error('希望数の完成品回収を確認できません。');
   return {input,item:output,produced:gained,requested:count,verification:'server_inventory'};
  }catch(e){e.message+=' 回収確認: '+Math.max(0,this.count(output)-before)+'個。投入済みの材料・燃料はかまどに残る場合があります。';throw e;}
  finally{if(this.window && c.crafting.window?.window_id===this.window.window_id)c.crafting.close();this.window=null;this.known=false;}
 }
}
