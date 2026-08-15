import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {verifyPluginIntegrity,validatePluginHostVersion,compareVersions,CodecPluginCompatibilityError} from '../src/codec-plugin-integrity.js';
async function integrity(bytes){const digest=new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes));return`sha256-${Buffer.from(digest).toString('base64')}`;}
test('version comparison handles semantic triples',()=>{assert.equal(compareVersions('0.13.0','0.12.9'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);});
test('host version bounds are enforced',()=>{assert.throws(()=>validatePluginHostVersion({id:'x',minHostVersion:'0.14.0'},{runtimeVersion:'0.13.0'}),CodecPluginCompatibilityError);assert.equal(validatePluginHostVersion({maxHostVersion:'0.13.0'},{runtimeVersion:'0.13.0'}),true);});
test('SRI SHA-256 verification succeeds',async()=>{const bytes=new TextEncoder().encode('export const x=1'),result=await verifyPluginIntegrity(bytes,await integrity(bytes),{subtle:webcrypto.subtle});assert.equal(result.verified,true);assert.equal(result.sha256.length,64);});
test('integrity mismatch is typed',async()=>{const bytes=new Uint8Array([1,2,3]);await assert.rejects(()=>verifyPluginIntegrity(bytes,'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',{subtle:webcrypto.subtle}),e=>e.code==='ERR_CODEC_PLUGIN_INTEGRITY');});
