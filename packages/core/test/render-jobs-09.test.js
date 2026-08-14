import test from 'node:test';
import assert from 'node:assert/strict';
import { claimNextRenderChunk, createRenderJobPlan, releaseRenderChunk } from '../src/render-jobs.js';

test('releasing an aborted render chunk does not consume a retry by default',()=>{const manifest={signature:'x',settings:{fps:30,rangeStart:0,rangeEnd:2},dependencies:[]};let job=createRenderJobPlan(manifest,{chunkFrames:30,maxAttempts:2});const claim=claimNextRenderChunk(job,'local');job=claim.job;assert.equal(job.chunks[0].attempts,1);job=releaseRenderChunk(job,claim.chunk.id);assert.equal(job.chunks[0].status,'pending');assert.equal(job.chunks[0].attempts,0);});
