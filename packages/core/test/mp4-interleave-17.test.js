import test from 'node:test';import assert from 'node:assert/strict';
import {planMp4Interleave,projectClassicMp4Scale,validateClassicMp4Scale} from '../src/mp4-scale.js';

test('MP4 interleave planner groups alternating A/V packets into bounded per-track chunks',()=>{const samples=[];for(let i=0;i<6;i++){samples.push({trackId:'v',_trackOrder:1,dts:i*10_000,duration:10_000,byteLength:100});samples.push({trackId:'a',_trackOrder:2,dts:i*10_000,duration:10_000,byteLength:40});}const plan=planMp4Interleave(samples,{maxChunkDuration:30_000,maxChunkBytes:10_000});assert.deepEqual(plan.chunks.map(c=>[c.trackId,c.sampleCount,c.dts]),[['v',3,0],['a',3,0],['v',3,30_000],['a',3,30_000]]);assert.deepEqual(plan.sampleOrder,[0,2,4,1,3,5,6,8,10,7,9,11]);});

test('MP4 interleave planner honors byte and sample-count bounds independently',()=>{const samples=Array.from({length:8},(_,i)=>({trackId:'v',dts:i*1000,duration:1000,byteLength:100}));const plan=planMp4Interleave(samples,{maxChunkDuration:100_000,maxChunkBytes:250,maxSamplesPerChunk:3});assert.deepEqual(plan.chunks.map(c=>c.sampleCount),[2,2,2,2]);});

test('MP4 interleave planner splits across timestamp gaps even when packet durations are short',()=>{const plan=planMp4Interleave([{trackId:'v',dts:0,duration:10_000,byteLength:1},{trackId:'v',dts:2_000_000,duration:10_000,byteLength:1}],{maxChunkDuration:1_000_000});assert.deepEqual(plan.chunks.map(c=>c.sampleCount),[1,1]);});

test('classic MP4 scale projection covers a three-day output under an explicit long-output metadata budget',()=>{const projection=projectClassicMp4Scale({durationSeconds:72*3600,videoFps:30,interleaveSeconds:1});const validation=validateClassicMp4Scale(projection,{maxTableBytes:128*1024*1024});assert.equal(validation.passed,true);assert.equal(projection.chunkCount,72*3600*2);assert.ok(projection.sampleCount>19_000_000);assert.ok(projection.tables.total<128*1024*1024);});
