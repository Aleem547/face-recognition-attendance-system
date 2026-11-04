import assert from 'node:assert/strict';
import {createOneShotCheckin} from '../lib/checkin/one-shot.ts';
import {waitForPositioning} from '../lib/checkin/positioning.ts';
import {describeCheckinResult,receiptDecision,selectedSessionId,savedRegisterPath} from '../lib/checkin/outcome.ts';

let n=0;
const check=async(name,fn)=>{await fn();console.log(`PASS ${++n}: ${name}`);};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
 const controller=new AbortController(),queued=[],active=new Set(),counts=[];let ready=true;
 const options={signal:controller.signal,ready:()=>ready,count:value=>counts.push(value),
  schedule:(fn,ms)=>{assert.equal(ms,1000);const timer={fn};queued.push(timer);active.add(timer);return timer;},cancel:timer=>active.delete(timer)};
 return {controller,options,queued,active,counts,unready:()=>ready=false,
  tick(){const timer=queued.shift();assert(timer);active.delete(timer);timer.fn();}};
}

await check('positioning displays a local three-second countdown before allowing submission',async()=>{
 const f=fixture();let complete=false;const p=waitForPositioning(f.options).then(()=>complete=true);
 assert.deepEqual(f.counts,[3]);assert.equal(complete,false);f.tick();assert.deepEqual(f.counts,[3,2]);f.tick();assert.equal(complete,false);f.tick();await p;
 assert.deepEqual(f.counts,[3,2,1,0]);assert.equal(f.active.size,0);
});
await check('cancelling positioning stops its timer immediately and refuses a frame',async()=>{
 const f=fixture(),p=waitForPositioning(f.options);f.controller.abort();await assert.rejects(p,e=>e.name==='AbortError');assert.equal(f.active.size,0);
 const before=[...f.counts];f.tick();assert.deepEqual(f.counts,before);assert.equal(f.active.size,0);
});
await check('a pre-cancelled start never schedules positioning work',async()=>{
 const f=fixture();f.controller.abort();await assert.rejects(waitForPositioning(f.options),e=>e.name==='AbortError');assert.equal(f.queued.length,0);
});
await check('hiding or stopping the preview during positioning prevents readiness',async()=>{
 const f=fixture(),p=waitForPositioning(f.options);f.unready();f.tick();await assert.rejects(p,/hidden/);assert.equal(f.active.size,0);
});
await check('loss of readiness at the final countdown boundary cannot submit a frame',async()=>{
 const f=fixture(),p=waitForPositioning(f.options);f.tick();f.tick();f.unready();f.tick();await assert.rejects(p);assert.equal(f.active.size,0);
});
await check('invalid countdown values cannot create timers',async()=>{
 for(const seconds of [0,-1,6,NaN,Infinity,1.5]){const f=fixture();await assert.rejects(waitForPositioning({...f.options,seconds}));assert.equal(f.queued.length,0);}
});
await check('one explicit check-in waits for preparation and then captures once',async()=>{
 const events=[];let prepared;
 const one=createOneShotCheckin({start:async()=>events.push('start'),ready:()=>true,
  prepare:()=>{events.push('prepare');return new Promise(r=>prepared=r);},capture:async()=>events.push('capture'),busy:value=>events.push(value)});
 const p=one.run();await flush();assert.deepEqual(events,[true,'start','prepare']);await one.run();prepared();await p;
 assert.deepEqual(events,[true,'start','prepare','capture',false]);
});
await check('cancel during camera preparation prevents a delayed upload',async()=>{
 let prepared,captures=0;const one=createOneShotCheckin({start:async()=>{},ready:()=>true,
  prepare:()=>new Promise(r=>prepared=r),capture:async()=>{captures++;},busy:()=>{}});
 const p=one.run();await flush();one.cancel();prepared();await p;assert.equal(captures,0);
});
await check('a cancelled older preparation cannot capture or clear the busy state of a newer attempt',async()=>{
 const resolvers=[],busy=[];let captures=0;
 const one=createOneShotCheckin({start:async()=>{},ready:()=>true,prepare:()=>new Promise(r=>resolvers.push(r)),capture:async()=>{captures++;},busy:v=>busy.push(v)});
 const first=one.run();await flush();one.cancel();const second=one.run();await flush();resolvers[0]();await first;
 assert.equal(captures,0);assert.equal(busy.at(-1),true);resolvers[1]();await second;assert.equal(captures,1);assert.equal(busy.at(-1),false);
});
await check('a class that becomes ineligible while preparing cannot submit',async()=>{
 let ready=true,captures=0;const one=createOneShotCheckin({start:async()=>{},ready:()=>ready,
  prepare:async()=>{ready=false;},capture:async()=>{captures++;},busy:()=>{}});
 await one.run();assert.equal(captures,0);
});
await check('preparation failure clears busy state without an automatic retry',async()=>{
 const busy=[];let captures=0;const one=createOneShotCheckin({start:async()=>{},ready:()=>true,
  prepare:async()=>{throw Error('camera stopped');},capture:async()=>{captures++;},busy:value=>busy.push(value)});
 await assert.rejects(one.run(),/stopped/);assert.equal(captures,0);assert.deepEqual(busy,[true,false]);
});
await check('camera permission completing after cancellation never starts preparation',async()=>{
 let grant,preparations=0,captures=0;const one=createOneShotCheckin({start:()=>new Promise(r=>grant=r),ready:()=>true,
  prepare:async()=>{preparations++;},capture:async()=>{captures++;},busy:()=>{}});
 const p=one.run();one.cancel();grant();await p;assert.equal(preparations,0);assert.equal(captures,0);
});
await check('capture errors are surfaced after exactly one submission attempt',async()=>{
 let captures=0;const busy=[];const one=createOneShotCheckin({start:async()=>{},ready:()=>true,prepare:async()=>{},
  capture:async()=>{captures++;throw Error('result not confirmed');},busy:v=>busy.push(v)});
 await assert.rejects(one.run());assert.equal(captures,1);assert.deepEqual(busy,[true,false]);
});

const session='2ed28610-f188-42e4-94cf-de041fd47a7d';
const valid={receiptId:'8beee221-9d84-44fb-a423-1e7456d833cb',decision:'accepted',attendanceChanged:true,experimental:true,policyRevision:2,
 arrivedAt:'2026-11-03T18:00:00.000Z',attendance:{id:'3096f3bf-ab17-46c7-8d6d-5af198a1b6cd',status:'present',revision:1,
  updatedAt:'2026-11-03T18:00:03.000Z',method:'experimental_face'}};
await check('Present success requires an acknowledged saved face record and receipt',async()=>{
 const result=describeCheckinResult(valid);assert.equal(result.kind,'saved');assert.equal(result.tone,'success');assert.equal(result.title,'Attendance saved: Present');assert.equal(result.receiptId,valid.receiptId);
});
await check('Late is displayed from the saved server status rather than the client clock',async()=>{
 const result=describeCheckinResult({...valid,attendance:{...valid.attendance,status:'late'}});assert.equal(result.title,'Attendance saved: Late');assert.equal(result.arrivedAt,valid.arrivedAt);
});
await check('a low face match is an explicit warning and never a saved attendance success',async()=>{
 const result=describeCheckinResult({...valid,decision:'identity_below_threshold',attendanceChanged:false,attendance:null});
 assert.equal(result.kind,'identity_rejected');assert.equal(result.tone,'warning');assert(result.title.includes('face match'));assert(!result.title.startsWith('Attendance saved:'));
});
await check('a PAD failure identifies the failed gate without claiming a fake face',async()=>{
 const result=describeCheckinResult({...valid,decision:'pad_below_threshold',attendanceChanged:false,attendance:null});
 assert.equal(result.kind,'pad_rejected');assert.equal(result.tone,'warning');assert(result.detail.includes('genuine face can fail'));assert(result.detail.includes('not proof'));
});
await check('an accepted flag without a valid persisted mark remains unconfirmed',async()=>{
 for(const attendance of [null,{}, {...valid.attendance,id:'invalid'}, {...valid.attendance,status:'absent'}, {...valid.attendance,method:'manual'},
  {...valid.attendance,revision:0},{...valid.attendance,updatedAt:'not a time'}])assert.equal(describeCheckinResult({...valid,attendance}).kind,'unconfirmed');
});
await check('contradictory acceptance and rejection envelopes cannot render success',async()=>{
 for(const extra of [{attendanceChanged:false},{decision:'pad_below_threshold'},{decision:'accepted',attendanceChanged:false,attendance:null},
  {decision:'identity_below_threshold',attendanceChanged:false,attendance:valid.attendance}])assert.equal(describeCheckinResult({...valid,...extra}).kind,'unconfirmed');
});
await check('missing receipts, missing policy revisions and malformed output are unconfirmed',async()=>{
 for(const value of [null,undefined,'accepted',{}, {...valid,receiptId:''},{...valid,policyRevision:0},{...valid,experimental:false}])assert.equal(describeCheckinResult(value).kind,'unconfirmed');
});
await check('an uncertain result asks for register inspection before any new attempt',async()=>{
 const result=describeCheckinResult({});assert(result.detail.includes('before another attempt'));assert.equal(result.tone,'warning');
});
await check('a missing optional arrival time does not invent a timestamp or discard a saved mark',async()=>{
 const result=describeCheckinResult({...valid,arrivedAt:undefined});assert.equal(result.kind,'saved');assert.equal(result.arrivedAt,null);
});
await check('a saved-register link retains the exact attempted class after the eligible class list changes',async()=>{
 assert.equal(savedRegisterPath(session),'/?session='+session);const nextSession='3819abfe-18ea-490a-80ca-84f78e8a0d23';
 assert.notEqual(savedRegisterPath(session),savedRegisterPath(nextSession));
});
await check('session query input accepts only one UUID and cannot introduce an external URL',async()=>{
 for(const value of [null,undefined,['a'],['a','b'],'https://example.test','../../admin','',session+'?x=1']){
  assert.equal(selectedSessionId(value),'');assert.equal(savedRegisterPath(value),null);
 }
 assert.equal(selectedSessionId(session),session);
});
await check('receipt labels distinguish saved attendance from both rejection conditions',async()=>{
 assert.equal(receiptDecision('accepted'),'Attendance saved');assert.equal(receiptDecision('identity_below_threshold'),'Face match below class cutoff');
 assert.equal(receiptDecision('pad_below_threshold'),'PAD below class cutoff');for(const decision of ['unknown','constructor','__proto__'])assert.equal(receiptDecision(decision),'Result not confirmed');
});
console.log(`Face check-in flow checks passed: ${n}. These are software checks, not camera or biometric validation.`);
