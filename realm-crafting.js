// Only server-advertised recipes and server-confirmed inventory changes are used.
// Protocol references: Mojang ItemStackRequestPacket and Player UI container slots.
import {LIMITS} from './capabilities.js';
const name = s => String(s || '').replace(/^minecraft:/,'');
const woods=['oak','spruce','birch','jungle','acacia','dark_oak','mangrove','cherry','pale_oak','crimson','warped','bamboo'];
const tags={planks:woods.map(w=>w+'_planks'),stone_crafting_materials:['cobblestone','blackstone','cobbled_deepslate'],logs:woods.filter(w=>!['crimson','warped','bamboo'].includes(w)).flatMap(w=>[w+'_log',w+'_wood','stripped_'+w+'_log','stripped_'+w+'_wood'])};
function plain(i){return !i.extra?.nbt && ['false',false,0,undefined].includes(i.extra?.has_nbt);}
function slotRef(slot,id,container='hotbar_and_inventory'){return {slot_type:{container_id:container},slot,stack_id:id};}
function getSlot(c,key){return typeof key==='string'?(key.startsWith('furnace_')?c.furnace.slots:key.startsWith('offhand:')?c.offhandItems:c.armorItems)[Number(key.split(':')[1])]:c.items[key];}
function putSlot(c,key,item){if(typeof key==='string')(key.startsWith('furnace_')?c.furnace.slots:key.startsWith('offhand:')?c.offhandItems:c.armorItems)[Number(key.split(':')[1])]=item;else c.items[key]=item;}
function identity(i){return `${i?.network_id || 0}:${i?.metadata || 0}:${i?.block_runtime_id || 0}`;}
function empty(){return {network_id:0,count:0,metadata:0,has_stack_id:false,block_runtime_id:0,extra:{has_nbt:'false',can_place_on:[],can_destroy:[]}};}
export function ingredientMatches(ingredient,item,registry){
  if(!item?.count || !plain(item))return false;
  const itemName=name(registry.items[item.network_id]?.name);
  if(ingredient.descriptor_type==='name')return itemName===name(ingredient.name) && (ingredient.metadata===-1 || ingredient.metadata===32767 || (ingredient.metadata || 0)===(item.metadata || 0));
  if(ingredient.descriptor_type==='item_tag')return Boolean(tags[name(ingredient.tag)]?.includes(itemName));
  return false;
}
export function allocateIngredients(recipe,items,registry,times=1){
  const counts=items.map(i=>i?.count || 0),used=new Map(),descriptors=[];
  // Exact names before tags avoid spending an item that a later exact ingredient needs.
  const input=recipe.input.filter(i=>i.type==='valid' && i.descriptor_type!=='empty' && i.count>0).sort((a,b)=>Number(a.descriptor_type==='item_tag')-Number(b.descriptor_type==='item_tag'));
  if(!input.length)throw Error('空のレシピは実行しません。');
  for(const ingredient of input){
    if(!['name','item_tag'].includes(ingredient.descriptor_type) || (ingredient.descriptor_type==='item_tag' && !tags[name(ingredient.tag)]))throw Error('このレシピの材料条件は未対応です。');
    let needed=ingredient.count*times;
    for(let slot=0;slot<Math.min(items.length,36)&&needed;slot++){
      const item=items[slot];if(!counts[slot] || !ingredientMatches(ingredient,item,registry))continue;
      if(!item.has_stack_id || !Number.isInteger(item.stack_id) || item.stack_id<=0)throw Error('材料のサーバー所持IDが未取得です。Botを接続し直してください。');
      const take=Math.min(needed,counts[slot]);counts[slot]-=take;needed-=take;used.set(slot,(used.get(slot)||0)+take);
      descriptors.push({type:'name',legacy_type:1,name:'minecraft:'+name(registry.items[item.network_id]?.name),metadata:item.metadata || 0,count:take});
    }
    if(needed)throw Error('材料不足: '+name(ingredient.name || ingredient.tag)+' があと'+needed+'個必要です。');
  }
  return {used,descriptors};
}
export function buildCraftRequest(recipe,items,registry,requestId){
  const output=recipe.output[0],allocation=allocateIngredients(recipe,items,registry);
  const max=Math.min(64,registry.items[output.network_id]?.stackSize || 64);
  if(output.count>max)throw Error('1レシピの完成品数が所持枠の上限を超えます。');
  let destination=-1;
  // Prefer a matching stack, then an empty hotbar slot, then inventory.
  for(let s=0;s<36;s++)if(items[s]?.count && identity(items[s])===identity(output) && plain(items[s]) && items[s].count+output.count<=max && !allocation.used.has(s)){destination=s;break;}
  if(destination<0)for(let s=0;s<36;s++)if(!items[s]?.count){destination=s;break;}
  if(destination<0)throw Error('完成品を入れる所持枠がありません。');
  const expected=new Map();
  const actions=[{type_id:'craft_recipe_auto',legacy_type_id:13,recipe_network_id:recipe.network_id,times_crafted:1,ingredients:allocation.descriptors}];
  for(const [slot,count] of allocation.used){
    const item=items[slot];actions.push({type_id:'consume',legacy_type_id:5,count,source:slotRef(slot,item.stack_id)});
    expected.set(slot,{before:{...item},after:{...item,count:item.count-count}});
  }
  const existing=items[destination];
  if(existing?.count && (!existing.has_stack_id || !Number.isInteger(existing.stack_id)||existing.stack_id<=0))throw Error('完成品を入れる所持枠のサーバーIDが未取得です。');
  actions.push({type_id:'take',legacy_type_id:0,count:output.count,source:{slot_type:{container_id:'creative_output'},slot:50,stack_id:requestId},destination:slotRef(destination,existing?.count?existing.stack_id:0)});
  expected.set(destination,{before:existing || empty(),after:{...output,count:(existing?.count || 0)+output.count}});
  return {request:{request_id:requestId,actions,custom_names:[],cause:-1},expected,destination,output};
}
export class RealmCrafting {
  constructor(controls,{timeout=8000}={}){
    this.controls=controls;this.client=controls.client;this.recipes=new Map();this.requestId=-1;this.timeout=timeout;this.pending=null;this.window=null;this.uncertain=false;
    this.client.on('crafting_data',p=>{
      if(p.clear_recipes)this.recipes.clear();
      for(const [kind,recipes] of [['shaped',p.shaped_recipes],['shapeless',p.shapeless_recipes]])for(const r of recipes || []){
        if(r.block!=='crafting_table' || r.output?.length!==1 || !Number.isInteger(r.network_id) || r.network_id<=0 || !r.output[0].count || !plain(r.output[0]))continue;
        this.recipes.set(r.network_id,{...r,kind});
      }
      console.log('[クラフト診断:レシピ]',this.recipes.size+'件');
    });
    this.client.on('container_open',p=>{this.window=p;});
    this.client.on('container_close',()=>{this.window=null;});
    this.client.on('inventory_content',p=>{if(p.window_id===0 || p.window_id==='inventory'){if(!this.pending)this.uncertain=false;}});
    this.client.on('item_stack_response',p=>{for(const r of p.responses || [])this.receive(r);});
  }
  receive(response){
    const pending=this.pending;if(!pending || response.request_id!==pending.request.request_id)return;
    pending.response=response;
    console.log('[クラフト診断:応答]',JSON.stringify({id:response.request_id,status:response.status}));
    if(response.status!=='ok'){pending.error=Error('Realmがクラフト要求を拒否しました。材料と作業台を確認してください。');return;}
    const slots=new Map();
    for(const c of response.containers || [])for(const s of c.slots || []){
      const type=c.slot_type?.container_id;
      const slot=(['armor','offhand'].includes(type) || type?.startsWith('furnace_'))?type+':'+s.slot:type==='hotbar_and_inventory'?s.slot:type==='hotbar'?s.slot:type==='inventory'?s.slot:null;
      if(slot!==null)slots.set(slot,s);
    }
    // No predicted inventory writes: every affected slot must match the exact
    // count acknowledged by the server, with a new positive stack ID if nonempty.
    for(const [slot,{after}] of pending.expected){const s=slots.get(slot);if(!s || s.count!==after.count || (s.count>0 && (!Number.isInteger(s.item_stack_id)||s.item_stack_id<=0)))return;}
    for(const [slot,{before,after}] of pending.expected){
      const current=getSlot(this.controls,slot) || empty();
      if(current.count && identity(current)!==identity(before) && identity(current)!==identity(after))return;
      if((current.count || 0)!==(before.count || 0) && (current.count || 0)!==(after.count || 0))return;
    }
    for(const [slot,{after}] of pending.expected){const s=slots.get(slot);putSlot(this.controls,slot,s.count?{...after,has_stack_id:true,stack_id:s.item_stack_id}:empty());}
    pending.confirmed=true;
  }
  count(output){return this.controls.items.reduce((n,i)=>n+(identity(i)===identity(output)?i.count || 0:0),0);}
  needsTable(recipe){return recipe.kind==='shaped'?(recipe.width>2 || recipe.height>2):recipe.input.filter(i=>i.type==='valid'&&i.count>0).length>4;}
  select(item,count){
    const c=this.controls,candidates=[...this.recipes.values()].filter(r=>name(c.registry.items[r.output[0].network_id]?.name)===item);
    if(!candidates.length)throw Error('Realmから受信した'+item+'の通常レシピがありません。');
    let error;
    for(const recipe of candidates.sort((a,b)=>Number(this.needsTable(a))-Number(this.needsTable(b))))try{allocateIngredients(recipe,c.items,c.registry,Math.ceil(count/recipe.output[0].count));return recipe;}catch(e){error=e;}
    throw error;
  }
  async open(recipe,signal){
    const c=this.controls;
    if(this.window)throw Error('別の画面が開いています。少し待ってから実行してください。');
    if(this.needsTable(recipe)){
      const f=c.feet(),tables=[];
      for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)for(let y=-2;y<=3;y++){
        const b=c.block({x:Math.floor(f.x)+x,y:Math.floor(f.y)+y,z:Math.floor(f.z)+z});if(b?.name==='crafting_table')tables.push(b);
      }
      tables.sort((a,b)=>Math.hypot(a.position.x-f.x,a.position.z-f.z)-Math.hypot(b.position.x-f.x,b.position.z-f.z));
      const table=tables[0];if(!table)throw Error('近くに作業台が必要です。Botの近くに作業台を置いてください。');
      await c.goto({...table.position,y:f.y},signal,3);
      const b=c.block(table.position);if(b?.name!=='crafting_table')throw Error('作業台が見つからなくなりました。');
      if(Math.hypot(c.position.x-(b.position.x+0.5),c.position.y-(b.position.y+0.5),c.position.z-(b.position.z+0.5))>4.5)throw Error('作業台に手が届きません。');
      c.look({x:b.position.x+0.5,y:b.position.y+0.5,z:b.position.z+0.5});
      c.pendingTransaction={legacy:{legacy_request_id:0},actions:[],data:{action_type:'click_block',trigger_type:'player_input',block_position:b.position,face:1,hotbar_slot:c.slot,hand:'main_hand',held_item:c.items[c.slot] || empty(),player_pos:{...c.position},click_pos:{x:0.5,y:1,z:0.5},block_runtime_id:b.runtimeId,client_prediction:'success',client_cooldown_state:'off'}};
    }else this.client.queue('interact',{action_id:'open_inventory',target_entity_id:c.entityId,has_position:false});
    const end=Date.now()+this.timeout;
    while(!this.window && Date.now()<end)await c.wait(50,signal);
    c.check(signal);
    if(!this.window || (this.needsTable(recipe)?this.window.window_type!=='workbench':!['inventory',-1].includes(this.window.window_type)))throw Error('クラフト画面を開く応答がありません。');
  }
  close(){
    const w=this.window;this.window=null;
    if(w && this.controls.ready && !this.controls.respawning && this.controls.health!==0)this.client.queue('container_close',{window_id:w.window_id,window_type:w.window_type,server:false});
    this.controls.pendingTransaction=null;
  }
  async transferSlots(source,destination,count,signal){
    const c=this.controls;c.check(signal);
    if(this.pending || this.uncertain)throw Error('所持品操作が未確定です。');
    const from=getSlot(c,source),to=getSlot(c,destination) || empty();
    if(!Number.isInteger(count)||count<1||count>64||!from?.count||from.count<count||!from.has_stack_id||!(from.stack_id>0))throw Error('移動元の個数・所持IDが未確認です。');
    if(to.count && (identity(to)!==identity(from) || !to.has_stack_id || !(to.stack_id>0)))throw Error('移動先を確認できません。');
    const reference=key=>slotRef(typeof key==='string'?Number(key.split(':')[1]):key,(getSlot(c,key)?.count?getSlot(c,key).stack_id:0),typeof key==='string'?key.split(':')[0]:'hotbar_and_inventory');
    const pending={request:{request_id:this.requestId--,actions:[{type_id:'take',legacy_type_id:0,count,source:reference(source),destination:reference(destination)}],custom_names:[],cause:-1},expected:new Map([[source,{before:{...from},after:{...from,count:from.count-count}}],[destination,{before:{...to},after:{...from,count:(to.count || 0)+count}}]])};
    this.pending=pending;this.client.queue('item_stack_request',{requests:[pending.request]});
    try{
      const end=Date.now()+this.timeout;
      while(!pending.error && !pending.confirmed && Date.now()<end){await c.wait(50,signal);if(pending.response?.status==='ok')pending.confirmed=[...pending.expected].every(([key,{after}])=>{const a=getSlot(c,key) || empty();return (a.count || 0)===after.count && (!after.count || identity(a)===identity(after));});}
      if(pending.error){this.pending=null;throw Error('Realmがかまどのアイテム移動を拒否しました。');}
      if(!pending.confirmed)throw Error('かまどと持ち物の変更を確認できません。');
      this.pending=null;
    }finally{if(this.pending){this.uncertain=true;this.pending=null;}}
  }
  async equipInventorySlot(source,signal,armorSlot,container='armor'){
    const c=this.controls;c.check(signal);
    if(source<9 && armorSlot===undefined)return source;
    if(this.pending || this.uncertain)throw Error('持ち物操作の結果が未確定です。Botを接続し直してください。');
    const item=c.items[source];
    if(!item?.count || !item.has_stack_id || !(item.stack_id>0))throw Error('道具のサーバー所持IDが未取得です。!TAKEN 持ち物 で受け取りを確認してください。');
    let destination=Array.from({length:9},(_,s)=>s).find(s=>!c.items[s]?.count);
    if(destination===undefined)destination=c.slot;
    const destinationKey=armorSlot===undefined?destination:container+':'+armorSlot;
    const old=getSlot(c,destinationKey) || empty();
    if(old.count && (!old.has_stack_id || !(old.stack_id>0)))throw Error('交換先の持ち物IDが未取得です。Botを接続し直してください。');
    try{
      await this.open({kind:'shaped',width:1,height:1},signal);
      const pending={request:{request_id:this.requestId--,actions:[{type_id:'swap',legacy_type_id:2,source:slotRef(source,item.stack_id),destination:slotRef(armorSlot===undefined?destination:armorSlot,old.count?old.stack_id:0,armorSlot===undefined?'hotbar_and_inventory':container)}],custom_names:[],cause:-1},expected:new Map([[source,{before:{...item},after:{...old}}],[destinationKey,{before:{...old},after:{...item}}]])};
      this.pending=pending;this.client.queue('item_stack_request',{requests:[pending.request]});
      const end=Date.now()+this.timeout;
      while(!pending.error && !pending.confirmed && Date.now()<end){
        await c.wait(50,signal);
        if(pending.response?.status==='ok')pending.confirmed=[...pending.expected].every(([s,{after}])=>{const a=getSlot(c,s) || empty();return (a.count || 0)===after.count && (!after.count || identity(a)===identity(after));});
      }
      if(pending.error){this.pending=null;throw Error('Realmが道具・防具・オフハンドの交換を拒否しました。');}
      if(!pending.confirmed)throw Error('道具のホットバー移動をRealmで確認できません。Botを接続し直してください。');
      this.pending=null;return destination;
    }finally{
      if(this.pending){this.uncertain=true;this.pending=null;}
      this.close();
    }
  }
  async dropInventorySlot(source,count,signal){
    const c=this.controls;c.check(signal);
    if(this.pending||this.uncertain)throw Error('持ち物操作が未確定です。自動で渡し直しません。');
    const item=c.items[source];
    if(!Number.isInteger(source)||source<0||source>=36||!Number.isInteger(count)||count<1||count>64||!item?.count||item.count<count||!item.has_stack_id||!(item.stack_id>0))throw Error('渡すアイテムの個数・所持IDが未確認です。');
    try{
      await this.open({kind:'shaped',width:1,height:1},signal);
      const pending={request:{request_id:this.requestId--,actions:[{type_id:'drop',legacy_type_id:3,count,source:slotRef(source,item.stack_id),randomly:false}],custom_names:[],cause:-1},expected:new Map([[source,{before:{...item},after:{...item,count:item.count-count}}]])};
      this.pending=pending;this.client.queue('item_stack_request',{requests:[pending.request]});
      const end=Date.now()+this.timeout;
      while(!pending.error&&!pending.confirmed&&Date.now()<end){await c.wait(50,signal);if(pending.response?.status==='ok'){const actual=c.items[source]||empty();pending.confirmed=actual.count===item.count-count&&(!actual.count||identity(actual)===identity(item));}}
      if(pending.error){this.pending=null;throw Error('Realmがアイテムを渡す要求を拒否しました。');}
      if(!pending.confirmed)throw Error('渡したアイテムの所持数減少を確認できません。自動再試行はしません。');
      this.pending=null;return count;
    }finally{if(this.pending){this.uncertain=true;this.pending=null;}this.close();}
  }
  async craft(item,count,signal){
    if(!/^[a-z0-9_]{1,64}$/.test(item || '') || !Number.isInteger(count) || count<1 || count>LIMITS.craft)throw Error('クラフトは完成品1〜'+LIMITS.craft+'個で指定してください。');
    const c=this.controls;c.check(signal);
    if(this.pending || this.uncertain)throw Error('前のクラフト結果が未確定です。重複作成を防ぐためBotを接続し直してください。');
    const recipe=this.select(item,count),output=recipe.output[0],before=this.count(output);let made=0;
    try{
      await this.open(recipe,signal);
      while(made<count){
        c.check(signal);if(!this.window)throw Error('クラフト画面が閉じられました。');
        const pending=buildCraftRequest(recipe,c.items,c.registry,this.requestId--);this.pending=pending;
        this.client.queue('item_stack_request',{requests:[pending.request]});
        console.log('[クラフト診断:要求]',JSON.stringify({item,recipe:recipe.network_id,id:pending.request.request_id,output:output.count}));
        const end=Date.now()+this.timeout;
        while(!pending.error && !pending.confirmed && Date.now()<end){
          await c.wait(50,signal);
          // Full inventory packets may confirm changes even if the response omits slot details.
          if(pending.response?.status==='ok')pending.confirmed=[...pending.expected].every(([slot,{after}])=>{const actual=getSlot(c,slot) || empty();return (actual.count || 0)===after.count && (!after.count || identity(actual)===identity(after));});
        }
        if(pending.error){this.pending=null;throw pending.error;}
        if(!pending.confirmed){this.uncertain=true;throw Error('材料消費と完成品の増加をサーバーで確認できません。自動再試行はしません。');}
        this.pending=null;made=this.count(output)-before;
        await c.wait(50,signal);
      }
      return {item,crafted:made,requested:count,verification:'server_inventory'};
    }catch(e){if(this.pending){this.uncertain=true;this.pending=null;}e.message+=' 確認済み作成数: '+made;throw e;}
    finally{this.close();}
  }
}

