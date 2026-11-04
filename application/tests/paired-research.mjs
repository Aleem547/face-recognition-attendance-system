import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {pairedChoice,validatePad,PAD_NOTICE} from '../lib/verification/paired.ts';
import {RegisterError} from '../lib/register/service.ts';
let n=0;async function check(name,fn){await fn();console.log(`PASS ${++n}: ${name}`);}
const pad=()=>({version:'attendai-pad-minifas-research-v1',models:[{model:'MiniFASNetV1SE.onnx',class1Score:0.8},{model:'MiniFASNetV2.onnx',class1Score:0.6}],meanClass1Score:0.7,decision:'not_calibrated',readyForAttendance:false});
await check('no choice preserves comparison-only mode',()=>assert.equal(pairedChoice(null),false));
await check('only the current notice enables PAD',()=>{assert.equal(pairedChoice(PAD_NOTICE),true);for(const v of ['', 'true', 'old'])assert.throws(()=>pairedChoice(v));});
await check('valid scores remain uncalibrated',()=>assert.deepEqual(validatePad(pad()),pad()));
for(const [name,mutate] of [
 ['nonfinite',p=>p.meanClass1Score=NaN],['range',p=>p.models[0].class1Score=1.5],['mean',p=>p.meanClass1Score=0.6],['missing model',p=>p.models.pop()],['duplicate model',p=>p.models[1].model=p.models[0].model],['version',p=>p.version='other'],['decision',p=>p.decision='live'],['attendance',p=>p.readyForAttendance=true],['extra feature',p=>p.embedding=[]]
])await check('rejects invalid '+name,()=>{const p=pad();mutate(p);assert.throws(()=>validatePad(p));});
const source=await readFile(new URL('../app/api/face-verify/route.ts',import.meta.url),'utf8');
const code=ts.transpile(source.replace(/^import .*;\n/gm,''),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
function setup(o={}){
 const calls=[],image=Buffer.alloc(40,77),key=Buffer.alloc(32,88),probe=Array(128).fill(1),controller=new AbortController();let auth=0;
 const dep={NextResponse:{json:(body,init)=>({body,...init})},RegisterError,pairedChoice,PAD_NOTICE,
 requireApiAccount:async()=>{calls.push('auth');auth++;return o.noAuth?{response:{status:401}}:{account:{id:o.changedIdentity&&auth>1?'other':'owner'}};},
 getAppPool:()=>({}),assertImageRequest:()=>{calls.push('origin');if(o.badOrigin)throw new RegisterError(403,'Untrusted');},verificationKey:()=>key,
 reserveEngine:()=>{calls.push('reserve');return ()=>calls.push('release');},
 consumeComparison:async()=>{calls.push('consume');if(o.badToken)throw new RegisterError(409,'Used');return {};},
 readImage:async()=>{calls.push('read');return image;},
 extractPaired:async(frame,signal)=>{assert.equal(frame,image);assert.equal(signal,controller.signal);calls.push('paired');if(o.padFails)throw new RegisterError(503,'PAD failed');if(o.abort)controller.abort();return {embedding:probe,pad:pad()};},
 extractFace:async(frame)=>{assert.equal(frame,image);calls.push('face');return probe;},
 finishComparison:async(pool,account,attempt,feature,k)=>{calls.push('save');assert.equal(feature,probe);assert.equal(k,key);if(o.withdrawn)throw new RegisterError(409,'Withdrawn');return {trial:{trial_id:'receipt-1',similarity:0.9},evaluationOnly:true,attendanceChanged:false};},
 verificationError:e=>({status:e.status??503,error:e.message})};
 const exports={};new Function('exports',...Object.keys(dep),code)(exports,...Object.values(dep));
 const headers=new Headers();if(!o.withoutPad)headers.set('x-attendai-pad-research',o.invalidNotice?'old':PAD_NOTICE);
 return {run:()=>exports.POST({headers,signal:controller.signal}),calls,image,key,probe};
}
await check('one upload one paired worker bound to receipt with cleanup',async()=>{const t=setup(),r=await t.run();assert.equal(r.body.pairedResearch.trialId,r.body.trial.trial_id);assert.equal(r.body.pairedResearch.storage,'response_only');assert.equal(r.body.attendanceChanged,false);assert.deepEqual(t.calls,['auth','origin','reserve','consume','read','paired','auth','save','release']);assert(t.image.every(v=>v===0)&&t.key.every(v=>v===0)&&t.probe.every(v=>v===0));});
await check('without choice no PAD worker or scores',async()=>{const t=setup({withoutPad:true}),r=await t.run();assert(!t.calls.includes('paired'));assert(t.calls.includes('face'));assert(!r.body.pairedResearch);});
for(const [label,options,status] of [['unauthenticated',{noAuth:true},401],['origin',{badOrigin:true},403],['notice',{invalidNotice:true},400],['token',{badToken:true},409],['PAD failure',{padFails:true},503],['identity change',{changedIdentity:true},409],['withdrawal',{withdrawn:true},409],['cancelled',{abort:true},409]])await check(label+' cannot return scores',async()=>{const t=setup(options),r=await t.run();assert.equal(r.status,status);assert(!r.body?.pairedResearch);if(!options.withdrawn)assert(!t.calls.includes('save'));if(t.calls.includes('reserve'))assert(t.calls.includes('release'));});
console.log(`Paired research checks passed: ${n}. No biometric performance is claimed.`);
