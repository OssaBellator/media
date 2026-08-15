import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const composition=await readFile(new URL('../composition-playback-engine.js',import.meta.url),'utf8');
const fidelity=await readFile(new URL('../fidelity-playback.js',import.meta.url),'utf8');
test('Cut fidelity mode reaches a request-scoped composition frame provider',()=>{assert.match(fidelity,/\{\.\.\.options,fidelity,graph,time,mode\}/);assert.match(composition,/mode='playback'/);assert.match(composition,/forRequest\?\.\(\{mode\}\)/);assert.equal((composition.match(/frameProvider,priority/g)??[]).length,3);});
