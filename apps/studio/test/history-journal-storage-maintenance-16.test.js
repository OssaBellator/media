import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryJournalSession } from '../history-journal-session.js';

const createHistory=(graph)=>({present:graph,past:[],future:[]});
const commitHistory=(history,graph,label)=>({present:graph,past:[...history.past,{graph:history.present,label}],future:[]});
const undoHistory=(history)=>history;
const redoHistory=(history)=>history;
const createTransaction=(label,operations,metadata={})=>({id:`tx:${label}`,label,operations,metadata});
const applyTransaction=(graph,tx)=>({...graph,value:(graph.value??0)+tx.operations.reduce((n,op)=>n+(op.delta??0),0)});
function session(options={}){return new HistoryJournalSession({history:createHistory({projectId:'p',value:0,nodes:{old:{id:'old',kind:'asset',props:{hash:'old'}}}}),applyTransaction,createTransaction,persist:async()=>{},compactThreshold:0,commitHistory,undoHistory,redoHistory,createHistory,...options});}

test('pressure cleanup targets quota delta and retains present plus undo sources',async()=>{const calls=[],s=session({estimateStorage:async()=>({usage:95,quota:100,ratio:.95}),collectAssets:async(options)=>{calls.push(options);return{deletedIds:['stale'],deleteBytes:15};}});const result=await s.commitGraphFactory('Import',(graph)=>({...graph,value:1,nodes:{new:{id:'new',kind:'asset',props:{hash:'new'}}}}),{}, {persistContext:{assetWrites:[{assetId:'new',blob:{}}]}});assert.equal(calls.length,1);assert.equal(calls[0].maxDeleteBytes,15);assert.equal(calls[0].retentionGraph.nodes.new.id,'new');assert.equal(calls[0].retentionGraph.nodes.old.id,'old');assert.equal(result.assetCleanup.deleteBytes,15);assert.equal(s.stats().assetCollections,1);assert.equal(s.stats().assetBytesDeleted,15);});

test('below pressure does not invoke cleanup',async()=>{let called=0,s=session({estimateStorage:async()=>({usage:80,quota:100,ratio:.8}),collectAssets:async()=>{called++;return{};}});const result=await s.edit('edit',[{delta:1}],{}, {persistContext:{assetWrites:[{assetId:'a',blob:{}}]}});assert.equal(called,0);assert.equal(result.assetCleanup,null);});

test('cleanup failure never rolls back a durable edit',async()=>{const s=session({estimateStorage:async()=>{throw new Error('estimate failed');}}),result=await s.edit('edit',[{delta:2}],{}, {persistContext:{assetWrites:[{assetId:'a',blob:{}}]}});assert.equal(result.graph.value,2);assert.match(result.assetCleanup.error.message,/estimate failed/);assert.equal(s.stats().maintenanceFailures,1);});
