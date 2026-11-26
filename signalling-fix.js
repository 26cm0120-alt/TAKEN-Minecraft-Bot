import {createRequire} from 'node:module';
import {lookup} from 'node:dns/promises';
const require = createRequire(import.meta.url);
const {NethernetSignal} = require('./node_modules/bedrock-protocol/src/nethernet/signalling.js');
const originalInit = NethernetSignal.prototype.init;
NethernetSignal.prototype.init = async function () {
  if (this.host && !this._checkedSignalHost) {
    this._checkedSignalHost = true;
    try {
      await lookup(this.host);
    } catch (error) {
      if (error.code !== 'ENOTFOUND') throw error;
      console.log('地域別の仲介サーバーが見つからないため、標準の仲介サーバーを使います。');
      this.host = 'signal.franchise.minecraft-services.net';
    }
  }
  return originalInit.call(this);
};
