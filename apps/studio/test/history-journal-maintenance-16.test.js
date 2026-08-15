import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryJournalSession } from '../history-journal-session.js';

const createHistory=(graph)=>({present:graph,past:[],future:[]});
const commitHistory=(history,graph,label)=>({present:graph,past:[...history.past,{graph:history.present,label}],future:[]});
const undoHistory=(history)=>{const previous=history.past.at(-1);return previous?{present:previous.graph,past:history.past.slice(0,-1),future:[{graph:history.present,label:previous.label},...history.future]}:history;};
const redoHistory=(history)=>{const next=history.future[0];return next?{present:next.graph,past:[...history.past,{graph:history.present,label:next.label}],future:history.future.slice(1)}:history;};
const createTransaction=(label,operations,metadata={})=>({id:`tx:${label}:${JSON.stringify(metadata)}`,label,operations:structuredClone(operations),metadata:structuredClone(metadata)});
const applyTransaction=(graph,transaction)=>({...graph,value:transaction.operations.reduce((value,operation)=>value+Number(operation.delta??0),Number(graph.value??0))});
function make({compact,compactThreshold=2}={}){return new HistoryJournalSession({history:createHistory({projectId:'p',value:0}),applyTransaction,createTransaction,persist:async()=>{},compact,compactThreshold,commitHistory,undoHistory,redoHistory,createHistory});}

test('automatic compaction rolls the durable journal at the configured threshold',async()=>{const compactions=[],session=make({compact:async(request)=>{compactions.push(request);return{compacted:true};}});const first=await session.edit('One',[{delta:1}]);assert.equal(first.maintenance,null);const second=await session.edit('Two',[{delta:2}]);assert.equal(second.maintenance.compacted,true);assert.equal(compactions.length,1);assert.equal(compactions[0].sequence,2);assert.equal(session.snapshot().graph.value,3);assert.equal(session.snapshot().history.past.length,2);assert.equal(session.stats().sequence,0);const third=await session.edit('Three',[{delta:4}]);assert.equal(third.entry.sequence,1);assert.equal(third.entry.previousChecksum,null);assert.equal(third.graph.value,7);});
test('automatic compaction failure never rolls back the durable edit',async()=>{const session=make({compact:async()=>{throw new Error('stale head');},compactThreshold:1});const result=await session.edit('One',[{delta:2}]);assert.equal(result.graph.value,2);assert.equal(result.entry.sequence,1);assert.equal(result.maintenance.compacted,false);assert.match(result.maintenance.error.message,/stale head/);assert.equal(session.stats().sequence,1);assert.equal(session.stats().maintenanceFailures,1);});
