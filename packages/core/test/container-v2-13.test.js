import test from 'node:test';import assert from 'node:assert/strict';import {sniffContainerV2,MEDIA_CONTAINERS_V2} from '../src/container-v2.js';import {basicAacTs} from './ts-fixture.js';
test('v2 container sniff recognizes MPEG-TS by bytes',()=>assert.equal(sniffContainerV2({bytes:basicAacTs()}),'mpegts'));
test('v2 container contract retains existing common containers',()=>{assert.ok(MEDIA_CONTAINERS_V2.includes('mp4'));assert.equal(sniffContainerV2({name:'clip.webm'}),'webm');});
