import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createClassClock,tickClassClock} from '../lib/automation/clock.ts';
import {createOneShotCheckin} from '../lib/checkin/one-shot.ts';
let n=0;async function check(name,fn){await fn();console.log(`PASS ${++n}: ${name}`);}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function clockFixture({failure=false}={}){let calls=0,errors=0,resolveTick;const timers=[],cancelled=[];
 const clock=createClassClock({tick:()=>{calls++;return failure?Promise.reject(Error('synthetic private failure')):new Promise(r=>resolveTick=r);},error:()=>errors++,
  schedule:(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;},cancel:id=>cancelled.push(id)});
 return {clock,timers,cancelled,get calls(){return calls;},get errors(){return errors;},finish:async(result={})=>{resolveTick?.(result);await flush();}};
}
await check('server clock starts immediately and repeated start does not duplicate it',async()=>{const f=clockFixture();f.clock.start();f.clock.start();assert.equal(f.calls,1);await f.finish();assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,20000);f.clock.stop();});
await check('clock never overlaps a pending database tick',async()=>{const f=clockFixture();f.clock.start();await flush();assert.equal(f.calls,1);assert.equal(f.timers.length,0);await f.finish();f.timers[0].fn();assert.equal(f.calls,2);assert.equal(f.timers.length,1);f.clock.stop();await f.finish();});
await check('database failure is handled and the next tick is scheduled',async()=>{const f=clockFixture({failure:true});f.clock.start();await flush();assert.equal(f.errors,1);assert.equal(f.timers.length,1);f.clock.stop();});
await check('due class backlog drains promptly without overlapping ticks',async()=>{const f=clockFixture();f.clock.start();await f.finish({moreDue:true});assert.equal(f.timers[0].ms,250);f.clock.stop();});
await check('stop during a tick prevents rescheduling',async()=>{const f=clockFixture();f.clock.start();f.clock.stop();await f.finish();assert.equal(f.timers.length,0);});
await check('stop clears a scheduled tick and prevents later work',async()=>{const f=clockFixture();f.clock.start();await f.finish();f.clock.stop();assert.equal(f.cancelled.length,1);f.timers[0].fn();assert.equal(f.calls,1);});
function dbFixture(fail=false,rollbackFails=false){const calls=[];let released;const client={query:async sql=>{calls.push(sql);if(sql.startsWith('SELECT attendai.tick')&&fail)throw Error('synthetic query failure');if(sql==='ROLLBACK'&&rollbackFails)throw Error('synthetic disconnect');return {rows:[{result:{opened:1}}]};},release:value=>released=value};return {pool:{connect:async()=>client},calls,get released(){return released;}};}
await check('clock transaction clears end-user identity, sets bounds and commits',async()=>{const f=dbFixture(),r=await tickClassClock(f.pool);assert.equal(r.opened,1);assert(f.calls.some(x=>x.includes("set_config('attendai.actor_id','',true)")));assert.equal(f.calls.at(-1),'COMMIT');assert.equal(f.released,false);});
await check('failed tick rolls back and releases the connection',async()=>{const f=dbFixture(true);await assert.rejects(tickClassClock(f.pool));assert.equal(f.calls.at(-1),'ROLLBACK');assert(!f.calls.includes('COMMIT'));assert.equal(f.released,false);});
await check('failed rollback discards the connection',async()=>{const f=dbFixture(true,true);await assert.rejects(tickClassClock(f.pool));assert.equal(f.released,true);});
function captureFixture(){let startCalls=0,captures=0,ready=true,grant;const busy=[];
 const capture=createOneShotCheckin({start:()=>{startCalls++;return new Promise(r=>grant=r);},ready:()=>ready,capture:async()=>{captures++;},busy:v=>busy.push(v)});
 return {capture,busy,get startCalls(){return startCalls;},get captures(){return captures;},grant:()=>grant(),unready:()=>ready=false};}
await check('explicit one-click check-in captures once after preview readiness',async()=>{const f=captureFixture(),p=f.capture.run();assert.equal(f.captures,0);f.grant();await p;assert.equal(f.captures,1);assert.deepEqual(f.busy,[true,false]);});
await check('double clicks during permission cannot initiate a second capture',async()=>{const f=captureFixture(),p=f.capture.run();await f.capture.run();assert.equal(f.startCalls,1);f.grant();await p;assert.equal(f.captures,1);});
await check('cancel while permission is pending prevents a late upload',async()=>{const f=captureFixture(),p=f.capture.run();f.capture.cancel();f.grant();await p;assert.equal(f.captures,0);assert.equal(f.busy.at(-1),false);});
await check('unready or stopped preview never captures',async()=>{const f=captureFixture(),p=f.capture.run();f.unready();f.grant();await p;assert.equal(f.captures,0);});
await check('capture failure clears its busy state without an automatic retry',async()=>{let captures=0;const busy=[];const f=createOneShotCheckin({start:async()=>{},ready:()=>true,capture:async()=>{captures++;throw Error('synthetic capture failure');},busy:v=>busy.push(v)});await assert.rejects(f.run());assert.equal(captures,1);assert.deepEqual(busy,[true,false]);});
const source=await readFile(new URL('../instrumentation.ts',import.meta.url),'utf8');
const code=ts.transpile(source.replace("await import('./lib/automation/runner')",'await importRunner()'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
async function register(env){let imports=0,starts=0;const exports={};new Function('exports','process','importRunner',code)(exports,{env},async()=>{imports++;return {startClassClock:()=>starts++};});await exports.register();return {imports,starts};}
await check('instrumentation starts the clock in the configured Node server',async()=>assert.deepEqual(await register({NEXT_RUNTIME:'nodejs',APP_DATABASE_URL:'synthetic'}),{imports:1,starts:1}));
await check('instrumentation never starts work during build, in Edge or without runtime DB config',async()=>{for(const env of [{NEXT_RUNTIME:'edge',APP_DATABASE_URL:'synthetic'},{NEXT_RUNTIME:'nodejs',NEXT_PHASE:'phase-production-build',APP_DATABASE_URL:'synthetic'},{NEXT_RUNTIME:'nodejs'}])assert.deepEqual(await register(env),{imports:0,starts:0});});
console.log(`Class clock and one-shot checks passed: ${n}. Native camera and live database are not used.`);
