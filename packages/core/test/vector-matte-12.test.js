import test from 'node:test';import assert from 'node:assert/strict';import {pointInVectorPaths,signedDistanceToVectorPaths,rasterizeVectorMatte} from '../src/vector-matte.js';
const square=[{points:[[1,1],[5,1],[5,5],[1,5]]}];
test('vector matte computes inside and signed distance',()=>{assert.equal(pointInVectorPaths(3,3,square),true);assert.equal(pointInVectorPaths(0,0,square),false);assert.ok(signedDistanceToVectorPaths(3,3,square)<0);assert.ok(signedDistanceToVectorPaths(0,0,square)>0);});
test('vector matte rasterizer feathers deterministic alpha edge',()=>{const mask=rasterizeVectorMatte({width:7,height:7,paths:square,feather:1,supersample:2});assert.equal(mask.alpha[3*7+3],255);assert.ok(mask.alpha[1*7+1]>0&&mask.alpha[1*7+1]<255);assert.equal(mask.alpha[6*7+6],0);});
