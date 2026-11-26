const meats={cow:['beef','cooked_beef'],pig:['porkchop','cooked_porkchop'],sheep:['mutton','cooked_mutton'],chicken:['chicken','cooked_chicken'],rabbit:['rabbit','cooked_rabbit']};
export async function supplyFood(c,{count=3}={},signal){
 if(!Number.isInteger(count)||count<1||count>8)throw Error('食料調達は1〜8個で指定してください。');
 c.check(signal);
 if(!c.pickup.inventoryReady)throw Error('持ち物全体がまだ未受信です。');
 const stock=name=>c.furnace.count(name);
 if(!['coal','charcoal'].some(n=>stock(n)>=1))throw Error('食料調達には燃料の石炭または木炭を1個以上用意してください。');
 const home={...c.feet()};let furnace=false;
 for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)for(let y=-2;y<=3;y++)if(c.block({x:Math.floor(home.x)+x,y:Math.floor(home.y)+y,z:Math.floor(home.z)+z})?.name==='furnace')furnace=true;
 if(!furnace)throw Error('出発地点の6ブロック以内に空の通常かまどを置いてください。');
 const announce=message=>c.client.emit('taken_notice',{message:'食料調達: '+message});
 let target=Object.keys(meats).find(n=>stock(meats[n][0])>=count);
 if(!target)target=c.nearbyEntities(24).find(e=>meats[e.name])?.name;
 if(!target)target=Object.keys(meats).find(n=>stock(meats[n][0])>0);
 if(!target)throw Error('24ブロック以内に牛・豚・羊・鶏・ウサギが見つからず、生肉もありません。');
 const [raw,cooked]=meats[target];let collected=0,stage='狩り';
 try{
  if(stock(raw)<count&&c.nearbyEntities(24).some(e=>e.name===target)){
   announce('近くの'+target+'を狩ります（最大30秒）。');
   const baseline=c.pickup.snapshot();
   await c.combat(target,30,signal);c.check(signal);
   stage='回収';announce('落下した食料を回収します。');
   const pickup=await c.pickup.collect({item:raw,count,baseline,optional:true},signal);
   collected=pickup.total;
  }
  c.check(signal);const amount=Math.min(count,stock(raw));
  if(!amount)throw Error('生肉の所持を確認できません。狩りの成功とは扱いません。');
  stage='帰還';announce('かまどのある出発地点に戻ります。');
  await c.goto(home,signal,.6);c.check(signal);
  stage='調理';announce(raw+'を'+amount+'個調理します。');
  const before=stock(cooked);
  await c.furnace.smelt(raw,amount,signal);c.check(signal);
  const produced=stock(cooked)-before;
  if(produced<amount)throw Error('調理済み食料の持ち物増加を確認できません。');
  stage='食事';announce('調理した食料を食べます。満腹なら保存します。');
  const meal=await c.eat(signal,{item:cooked,count:amount});
  return {item:cooked,requested:count,collected,produced,eaten:meal.eaten,food:meal.food,verification:'server_inventory'};
 }catch(e){e.message='食料調達（'+stage+'）: '+e.message;throw e;}
 finally{c.stop();}
}
