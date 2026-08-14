import assert from 'node:assert/strict';
import test from 'node:test';
import { compactEncodedWindow, chunkTimeRange } from '../src/encoded-window.js';
import { MemoryByteSink, CountingByteSink, writeByteParts } from '../src/byte-sink.js';
import { createDerivativeJob, claimDerivativeSegment, completeDerivativeSegment, failDerivativeSegment, recoverDerivativeJob, derivativeArtifactManifest, derivativeJobProgress, planDerivativeSegments } from '../src/derivative-jobs.js';
import { FragmentedMp4StreamWriter, StreamingWebmWriter } from '../src/stream-mux.js';

test('compacts encoded chunks into a transferable byte window', () => {
  const source = new Uint8Array([0,1,2,3,4,5,6,7,8,9]);
  const chunks = [
    { trackId:'v', offset:2, byteLength:3, timestamp:1_000_000, duration:500_000, type:'key' },
    { trackId:'v', offset:7, byteLength:2, timestamp:1_500_000, duration:500_000, type:'delta' },
  ];
  const compact = compactEncodedWindow(source, chunks);
  assert.deepEqual([...compact.bytes], [2,3,4,7,8]);
  assert.deepEqual(compact.chunks.map((c) => c.offset), [0,3]);
  assert.deepEqual(chunkTimeRange(compact.chunks), { start:1_000_000, end:2_000_000, duration:1_000_000 });
  assert.notEqual(compact.buffer, source.buffer);
});

test('rejects compact windows that point outside the source', () => {
  assert.throws(() => compactEncodedWindow(new Uint8Array(4), [{trackId:'v',offset:3,byteLength:2}]), /range is invalid/);
});

test('memory and counting byte sinks preserve ordered writes', async () => {
  const memory = new MemoryByteSink();
  const counting = new CountingByteSink(memory);
  const total = await writeByteParts(counting, [new Uint8Array([1,2]), new Uint8Array([3]), new Uint8Array([4,5])]);
  assert.equal(total, 5);
  assert.equal(counting.writes, 3);
  assert.equal(counting.byteLength, 5);
  await counting.close();
  assert.deepEqual([...memory.bytes()], [1,2,3,4,5]);
  await assert.rejects(() => memory.write(new Uint8Array([6])), /closed/);
});

test('plans derivative segments on keyframes and supports resumable lifecycle', () => {
  const segments = planDerivativeSegments({assetId:'asset',duration:10,segmentDuration:3.1,keyframes:[0,2,4,6,8,10]});
  assert.deepEqual(segments.map((s) => [s.start,s.end]), [[0,4],[4,8],[8,10]]);
  let job = createDerivativeJob({assetId:'asset',sourceHash:'hash',duration:10,segmentDuration:3.1,keyframes:[0,2,4,6,8,10],maxAttempts:2});
  let claim = claimDerivativeSegment(job, 'worker-a');
  assert.equal(claim.segment.start, 0);
  job = completeDerivativeSegment(claim.job, claim.segment.id, { key:'segment-0' });
  assert.equal(derivativeJobProgress(job).completedSegments, 1);
  claim = claimDerivativeSegment(job, 'worker-b');
  job = failDerivativeSegment(claim.job, claim.segment.id, new Error('temporary'));
  assert.equal(job.segments[1].status, 'pending');
  claim = claimDerivativeSegment(job, 'worker-c');
  job = completeDerivativeSegment(claim.job, claim.segment.id, { key:'segment-1' });
  claim = claimDerivativeSegment(job, 'worker-d');
  job = completeDerivativeSegment(claim.job, claim.segment.id, { key:'segment-2' });
  assert.equal(job.status, 'complete');
  assert.equal(derivativeArtifactManifest(job).segments.length, 3);
});

test('recovers interrupted derivative jobs without redoing completed segments', () => {
  let job = createDerivativeJob({assetId:'a',duration:4,segmentDuration:2});
  let claim = claimDerivativeSegment(job);
  job = completeDerivativeSegment(claim.job, claim.segment.id, {key:'done'});
  claim = claimDerivativeSegment(job);
  const recovered = recoverDerivativeJob(claim.job);
  assert.equal(recovered.segments[0].status, 'complete');
  assert.equal(recovered.segments[1].status, 'pending');
});

test('fragmented MP4 stream writer writes init once and ordered media segments', async () => {
  const sink = new MemoryByteSink();
  let sequence = [];
  const writer = new FragmentedMp4StreamWriter({container:'mp4',tracks:[{id:'v'}]}, sink, {
    sequenceNumber: 5,
    initWriter: () => new Uint8Array([0xaa]),
    segmentWriter: (_plan, options) => { sequence.push(options.sequenceNumber); return new Uint8Array([options.sequenceNumber]); },
  });
  await writer.writeSegment({samples:[1]});
  await writer.writeSegment({samples:[2]});
  const summary = await writer.close();
  assert.deepEqual(sequence, [5,6]);
  assert.deepEqual([...sink.bytes()], [0xaa,5,6]);
  assert.deepEqual(summary, {segments:2, byteLength:3});
});

test('streaming WebM writes header and clusters incrementally', async () => {
  const inner = new MemoryByteSink();
  const sink = new CountingByteSink(inner);
  const writer = new StreamingWebmWriter([{id:'v',type:'video',codec:'vp09.00.10.08',config:{width:320,height:180}}], sink, {maxClusterMs:1000});
  await writer.addSample({trackId:'v',timestamp:0,duration:33_333,keyframe:true,payload:new Uint8Array([1])});
  await writer.addSample({trackId:'v',timestamp:500_000,duration:33_333,keyframe:false,payload:new Uint8Array([2])});
  await writer.addSample({trackId:'v',timestamp:1_500_000,duration:33_333,keyframe:true,payload:new Uint8Array([3])});
  const summary = await writer.close();
  assert.ok(sink.writes >= 3, 'header and at least two clusters should be separate writes');
  assert.equal(summary.clusters, 2);
  const bytes = inner.bytes();
  assert.equal(bytes[0], 0x1a);
  assert.ok(bytes.includes(0xa3));
});
