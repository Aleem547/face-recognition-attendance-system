// Exercise the JPEG adapter with mocked auth/worker and assert admission order,
// failure behavior and cleanup. Database behavior is tested in automatic-checkin.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {RegisterError} from '../lib/register/service.ts';
import {assertImageRequest} from '../lib/biometric/http.ts';
let n=0;async function check(name,fn){await fn();console.log(`PASS ${++n}: ${name}`);}
const source=await readFile(new URL('../app/api/face-checkin/route.ts',import.meta.url),'utf8');
const code=ts.transpile(source.replace(/^import .*;\n/gm,''),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
function setup(o={}){
 const calls=[],image=Buffer.alloc(40,77),key=Buffer.alloc(32,88),probe=Array(128).fill(1),controller=new AbortController();let auth=0;
 const account={id:'owner',role:'student'},attempt={tokenHash:'a'.repeat(64)},pad={server:'only'};
 const dep={NextResponse:{json:(body,init)=>({body,...init})},RegisterError,
  requireApiAccount:async(req,roles)=>{calls.push('auth');assert.deepEqual(roles,['student']);auth++;return o.noAuth?{response:{status:401}}:o.staff?{response:{status:403}}:{account:o.changedIdentity&&auth>1?{id:'other'}:account};},
  getAppPool:()=>({}),assertImageRequest:()=>{calls.push('origin');if(o.badOrigin)throw new RegisterError(403,'Untrusted');},enrollmentKey:()=>key,
  reserveEngine:()=>{calls.push('reserve');if(o.busy)throw new RegisterError(503,'Busy');return ()=>calls.push('release');},
  consumeCheckin:async(p,a,token)=>{calls.push('consume');assert.equal(a,account);assert.equal(token,'server-token');if(o.badToken)throw new RegisterError(409,'Used');return attempt;},
  readImage:async()=>{calls.push('read');if(o.largeImage)throw new RegisterError(413,'Too large');return image;},
  extractPaired:async(frame,signal)=>{assert.equal(frame,image);assert.equal(signal,controller.signal);calls.push('paired');if(o.padFails)throw new RegisterError(503,'PAD failed');if(o.qualityFails)throw new RegisterError(422,'Image quality');if(o.abort)controller.abort();return {embedding:probe,pad};},
  finishCheckin:async(p,a,token,feature,scores,k)=>{calls.push('commit');assert.equal(a,account);assert.equal(token,attempt);assert.equal(feature,probe);assert.equal(scores,pad);assert.equal(k,key);
   if(o.withdrawn)throw new RegisterError(409,'Withdrawn');return {receiptId:'receipt-1',attendanceChanged:!o.rejected,decision:o.rejected?'pad_below_threshold':'accepted',experimental:true};},
  checkinError:e=>({status:e.status??503,error:e.message})};
 const exports={};new Function('exports',...Object.keys(dep),code)(exports,...Object.values(dep));
 const headers=new Headers({'x-attendai-token':'server-token'});
 return {run:()=>exports.POST({headers,signal:controller.signal}),calls,image,key,probe};
}
await check('one JPEG uses mandatory paired worker and one commit after fresh auth',async()=>{const t=setup(),r=await t.run();assert.equal(r.body.attendanceChanged,true);assert.deepEqual(t.calls,['auth','origin','reserve','consume','read','paired','auth','commit','release']);assert(t.image.every(v=>v===0)&&t.key.every(v=>v===0)&&t.probe.every(v=>v===0));assert.equal(r.headers['Cache-Control'],'no-store');});
await check('policy rejection is returned without falsely claiming a saved mark',async()=>{const t=setup({rejected:true}),r=await t.run();assert.equal(r.body.attendanceChanged,false);assert.equal(r.body.decision,'pad_below_threshold');});
for(const [name,options,status] of [['anonymous',{noAuth:true},401],['staff',{staff:true},403],['origin',{badOrigin:true},403],['busy engine',{busy:true},503],['used token',{badToken:true},409],['oversized image',{largeImage:true},413],['PAD failure',{padFails:true},503],['quality failure',{qualityFails:true},422],['changed identity',{changedIdentity:true},409],['aborted request',{abort:true},409],['withdrawn at commit',{withdrawn:true},409]])await check(name+' does not return success',async()=>{const t=setup(options),r=await t.run();assert.equal(r.status,status);assert(!r.body?.attendanceChanged);if(!options.withdrawn)assert(!t.calls.includes('commit'));if(t.calls.includes('consume'))assert(t.calls.includes('release'));if(!options.noAuth&&!options.staff&&!options.badOrigin)assert(t.key.every(x=>x===0));});
await check('JPEG route uses exact configured origin and rejects wrong media type',()=>{
 assert.doesNotThrow(()=>assertImageRequest(new Request('http://localhost:3000/api/face-checkin',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'image/jpeg'}}),'http://localhost:3000'));
 for(const headers of [{origin:'http://evil.test','content-type':'image/jpeg'},{origin:'http://localhost:3000','content-type':'application/json'},{origin:'http://localhost:3000','content-type':'image/jpeg','sec-fetch-site':'cross-site'}])assert.throws(()=>assertImageRequest(new Request('http://localhost:3000/api/face-checkin',{method:'POST',headers}),'http://localhost:3000'));
});
console.log(`Automatic check-in HTTP checks passed: ${n}. The real camera/worker is not exercised by this adapter fixture.`);
