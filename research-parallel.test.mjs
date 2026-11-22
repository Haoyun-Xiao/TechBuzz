import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parallelMap} from './research-parallel.mjs';
test('parallel requests keep order, respect the cap and finish independent work after failure',async()=>{
 let active=0,peak=0;const complete=[];
 await assert.rejects(parallelMap([0,1,2,3,4],3,async n=>{
  peak=Math.max(peak,++active);
  await new Promise(resolve=>setTimeout(resolve,5-n));
  active--;complete.push(n);
  if(n===1)throw Error('one request failed');
  return n;
 }),/one request failed/);
 assert(peak>1&&peak<=3);assert.equal(complete.length,5);
 assert.deepEqual(await parallelMap([3,2,1],2,async n=>n*2),[6,4,2]);
});
