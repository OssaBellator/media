import { openMediaDatabase, planAssetGarbageCollection } from './storage.js';

function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('IndexedDB request failed'));});}
function transactionDone(transaction){return new Promise((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error??new Error('IndexedDB transaction failed'));transaction.onabort=()=>reject(transaction.error??new Error('IndexedDB transaction aborted'));});}
function assetNodes(graph){return Object.values(graph?.nodes??{}).filter((node)=>node?.kind==='asset');}
export function mergeAssetRetentionGraph(persistedGraph,retentionGraph){const nodes={};for(const node of [...assetNodes(persistedGraph),...assetNodes(retentionGraph)])nodes[String(node.id)]=node;return{projectId:String(persistedGraph?.projectId??retentionGraph?.projectId??'retention'),nodes};}
export async function garbageCollectStoredAssetsWithRetention({retentionGraph=null,now=Date.now(),olderThanMs=30*24*60*60*1000,maxDeleteBytes=Infinity,databaseProvider=openMediaDatabase}={}){
  const database=await databaseProvider();if(!database)return{deletedIds:[],deleteBytes:0,candidates:[],retained:[],referencedIds:[],referencedHashes:[]};
  const tx=database.transaction(['workspace','assets'],'readwrite'),workspace=tx.objectStore('workspace'),assets=tx.objectStore('assets');
  try{
    const current=await requestResult(workspace.get('current'));
    if(!current?.graph){await transactionDone(tx);return{deletedIds:[],deleteBytes:0,candidates:[],retained:[],referencedIds:[],referencedHashes:[]};}
    const records=await requestResult(assets.getAll()),graph=mergeAssetRetentionGraph(current.graph,retentionGraph),plan=planAssetGarbageCollection(graph,records,{now,olderThanMs,maxDeleteBytes});
    for(const candidate of plan.candidates)assets.delete(candidate.id);
    await transactionDone(tx);return{...plan,deletedIds:plan.candidates.map((candidate)=>candidate.id)};
  }catch(error){try{tx.abort?.();}catch{}throw error;}
}
