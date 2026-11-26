export class RequestQueue {
 constructor(execute,notify){this.execute=execute;this.notify=notify;this.pending=[];this.running=null;this.paused=false;this.generation=0;}
 submit(entry){
  if(this.running||this.paused||this.pending.length){
   if(this.pending.length>=5){this.notify('待機列は5件までです。完了後にもう一度指示してください。');return Promise.resolve();}
   if(this.pending.some(p=>p.sender===entry.sender&&p.message===entry.message)){this.notify('同じ指示はすでに待機中です。');return Promise.resolve();}
   if(this.pending.filter(p=>p.sender===entry.sender).length>=2){this.notify('1人あたりの待機は2件までです。');return Promise.resolve();}
   this.pending.push(entry);this.notify('指示を待機列に登録しました。'+this.pending.length+'番目'+(this.paused?'（待機停止中）':'')+'。');return Promise.resolve();
  }
  return this.run(entry);
 }
 async run(entry){
  const generation=this.generation;this.running=entry;let failed=false;
  // 通常の作業失敗は実行側で報告済み。次の独立した指示へ進む。
  try{await this.execute(entry.packet);}
  catch(e){failed=true;this.notify('指示の処理に失敗しました: '+e.message);}
  finally{
   this.running=null;
   if(generation===this.generation&&failed){this.paused=true;if(this.pending.length)this.notify('作業が完了しなかったため待機列を停止しました。確認後に !TAKEN 待機再開。');}
   if(!this.paused&&this.pending.length){const next=this.pending.shift();void this.run(next);}
  }
 }
 clear({pause=false}={}){this.generation++;this.pending=[];this.paused=pause;}
 resume(){this.paused=false;if(!this.running&&this.pending.length)void this.run(this.pending.shift());}
 summary(){return '実行中: '+(this.running?this.running.sender+'「'+this.running.message.slice(0,60)+'」':'なし')+' / 待機'+this.pending.length+'件'+(this.paused?'（停止中）':'')+(this.pending.length?' / '+this.pending.map((p,i)=>(i+1)+': '+p.sender+'「'+p.message.slice(0,30)+'」').join('、'):'');}
}
