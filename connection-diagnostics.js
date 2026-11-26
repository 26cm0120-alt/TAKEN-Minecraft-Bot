import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {NethernetSignal} = require('./node_modules/bedrock-protocol/src/nethernet/signalling.js');
const original = NethernetSignal.prototype.onError;
NethernetSignal.prototype.onError = function (event) {
  console.error('仲介通信の詳細:', event.error?.code || '', event.message || '通信エラー');
  original.call(this, event);
};
const timer = setTimeout(() => {console.log('接続診断を終了します。'); process.exit(1);}, 55000);
timer.unref();
await import('./index.js');
