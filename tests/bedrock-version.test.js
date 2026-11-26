import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {configuredBedrockVersion,DEFAULT_BEDROCK_VERSION} from '../src/bedrock-version.js';
import {inputPacket} from '../src/realm-controls.js';
const require=createRequire(import.meta.url);
test('26.6 version shorthand resolves to supported 26.60',()=>{
 for(const v of ['', '26.6','26.60','1.26.6','1.26.60'])assert.equal(configuredBedrockVersion(v),'1.26.60');
 const data=require('minecraft-data')('bedrock_'+DEFAULT_BEDROCK_VERSION);
 assert.equal(data.version.version,2225);
 assert.equal(require('bedrock-protocol/src/options.js').Versions[DEFAULT_BEDROCK_VERSION],2225);
});
test('26.60 movement input indices match Mojang protocol 2225',()=>{
 const mappings=require('minecraft-data')('bedrock_1.26.60').protocol.types.InputData[1].mappings;
 for(const [index,name] of Object.entries({10:'up',31:'start_jumping',44:'received_server_data',50:'vertical_collision',53:'start_using_item',56:'start_spin_attack'}))assert.equal(mappings[index],name);
 const {createSerializer,createDeserializer}=require('bedrock-protocol/src/transforms/serializer.js');
 const packet={name:'player_auth_input',params:inputPacket({x:1,y:65.62,z:2},1n,{forward:true,grounded:true,receivedServerData:true})};
 const decoded=createDeserializer(DEFAULT_BEDROCK_VERSION).parsePacketBuffer(createSerializer(DEFAULT_BEDROCK_VERSION).createPacketBuffer(packet)).data.params;
 assert.ok(decoded.input_data.includes('up'));assert.equal(decoded.move_vector.z,1);assert.ok(decoded.input_data.includes('received_server_data'));
});
