import {setTimeout as delay} from 'node:timers/promises';
export class RealmRecovery {
 constructor(connect,{now=Date.now,wait=delay}={}){this.connect=connect;this.now=now;this.wait=wait;this.attempts=[];this.current=null;this.stopped=false;this.busy=false;this.abort=new AbortController();}
 attach(client){
  this.current=client;let kicked=false;
  const recover=reason=>this.recover(client,reason).catch(e=>{if(!this.stopped)console.error('[Realm再接続]',e.message);});
  client.on('kick',()=>{kicked=true;});
  client.on('taken_reconnect_required',reason=>recover(reason));
  client.on('error',error=>{
   if(!kicked&&/Signal connection closed \(1001\):.*Signaling server instance is shutting down\.?/i.test(String(error?.message||'')))recover('signaling_server_shutdown');
  });
 }
 async recover(client,reason){
  if(this.stopped||this.busy||client!==this.current)return;
  this.attempts=this.attempts.filter(at=>this.now()-at<300000);
  if(this.attempts.length>=2){const message='5分以内に2回再接続を試しました。自動再接続を止めます。起動画面と !TAKEN 状態 を確認してください。';console.warn('[Realm再接続]',message);client.emit('taken_notice',{message});return;}
  this.busy=true;this.attempts.push(this.now());
  try{
   const transient=reason==='signaling_server_shutdown',waitMs=transient?5000*this.attempts.length:3000;
   console.log('[Realm再接続]',JSON.stringify({reason,attempt:this.attempts.length,waitMilliseconds:waitMs}));
   client.emit('taken_notice',{message:(transient?'仲介サーバーが終了したため':'復活の応答が止まっているため')+'、BotをRealmへ再接続します。前の作業は中止します。'});
   client.close();
   await Promise.race([Promise.resolve(client._nethernetCleanup).catch(()=>{}),this.wait(3000,undefined,{signal:this.abort.signal})]);
   await this.wait(waitMs,undefined,{signal:this.abort.signal});
   if(!this.stopped){const next=await this.connect();if(this.stopped){next.close();await Promise.resolve(next._nethernetCleanup).catch(()=>{});}else this.attach(next);}
  }finally{this.busy=false;}
 }
 stop(){this.stopped=true;this.abort.abort();}
}

