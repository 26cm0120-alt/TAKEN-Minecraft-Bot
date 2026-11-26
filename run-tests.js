import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const cwd=fileURLToPath(new URL('.',import.meta.url));
const tests=readdirSync(cwd,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.test.js')).map(e=>e.name).sort();
if(!tests.length)throw Error('テストファイルがありません。');
const result=spawnSync(process.execPath,['--test','--test-isolation=none',...tests],{cwd,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
