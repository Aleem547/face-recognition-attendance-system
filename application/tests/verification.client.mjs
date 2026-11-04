import assert from 'node:assert/strict';
import {captureFrame} from '../lib/verification/capture.ts';
let count=0,canvas,draws=0,serializations=0,sizes;
const original=globalThis.document,originalPerformance=globalThis.performance;
const video={readyState:4,videoWidth:1280,videoHeight:720};
// Synthetic JPEG boundary bytes test the browser adapter contract, not recognition.
const jpeg=Buffer.concat([Buffer.from([255,216]),Buffer.alloc(76),Buffer.from([255,217])]);
const data=bytes=>'data:image/jpeg;base64,'+bytes.toString('base64');
function setup(mode='normal',encoded=data(jpeg),duringEncode=()=>{}){
 draws=0;serializations=0;sizes=undefined;
 const context={drawImage(){draws++;if(mode==='throw')throw new Error('PRIVATE');}};
 canvas={width:0,height:0,getContext:()=>mode==='no-context'?null:context,
  toBlob(){throw new Error('Asynchronous canvas serialization must not be used.');},
  toDataURL(type,quality){assert.equal(type,'image/jpeg');assert.equal(quality,0.88);serializations++;sizes=[canvas.width,canvas.height];duringEncode();return encoded;}};
 globalThis.document={createElement(name){assert.equal(name,'canvas');return canvas;}};
}
async function check(name,fn){await fn();console.log(`PASS ${++count}: ${name}`);}
try{
 await check('capture serializes one JPEG without any toBlob callback',async()=>{setup();const blob=await captureFrame(video,new AbortController().signal);assert.equal(blob.type,'image/jpeg');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),jpeg);assert.equal(canvas.width,0);assert.equal(canvas.height,0);assert.equal(draws,1);assert.equal(serializations,1);});
 await check('capture scales to at most 640 pixels',async()=>{setup();await captureFrame(video,new AbortController().signal);assert.deepEqual(sizes,[640,360]);});
 await check('small supported frames are never upscaled',async()=>{setup();await captureFrame({...video,videoWidth:320,videoHeight:240},new AbortController().signal);assert.deepEqual(sizes,[320,240]);});
 await check('pre-cancelled capture does no drawing',async()=>{setup();const controller=new AbortController();controller.abort('synthetic string reason');await assert.rejects(captureFrame(video,controller.signal),/cancelled/);assert.equal(draws,0);});
 await check('cancellation during native serialization prevents a JPEG result',async()=>{const controller=new AbortController();setup('normal',data(jpeg),()=>controller.abort('synthetic string reason'));await assert.rejects(captureFrame(video,controller.signal),e=>e instanceof Error&&e.message.includes('cancelled'));assert.equal(canvas.width,0);});
 await check('slow synchronous output is rejected after its elapsed budget',async()=>{let clock=0;Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}});setup('normal',data(jpeg),()=>clock=6000);await assert.rejects(captureFrame(video,new AbortController().signal),/too slow/);assert.equal(canvas.width,0);Object.defineProperty(globalThis,'performance',{configurable:true,value:originalPerformance});});
 await check('zero or invalid encoding budgets are refused',async()=>{for(const budget of [0,-1,NaN,Infinity]){setup();await assert.rejects(captureFrame(video,new AbortController().signal,budget));assert.equal(draws,0);}});
 await check('PNG fallback and unsupported serialization formats are refused',async()=>{for(const encoded of ['data:,','data:image/png;base64,'+jpeg.toString('base64'),'https://private.example.test']){setup('normal',encoded);await assert.rejects(captureFrame(video,new AbortController().signal));assert.equal(canvas.width,0);}});
 await check('tiny or oversized frames are refused before creating a Blob',async()=>{for(const bytes of [Buffer.from([255,216,255,217]),Buffer.alloc(1048577)]){setup('normal',data(bytes));await assert.rejects(captureFrame(video,new AbortController().signal));assert.equal(canvas.width,0);}});
 await check('malformed base64 and JPEG boundaries fail closed',async()=>{for(const encoded of ['data:image/jpeg;base64,!invalid!',data(Buffer.alloc(80))]){setup('normal',encoded);await assert.rejects(captureFrame(video,new AbortController().signal));}});
 await check('unready, tiny and nonfinite video dimensions do no drawing',async()=>{for(const bad of [{...video,readyState:0},{...video,videoWidth:32},{...video,videoHeight:NaN},{...video,videoWidth:Infinity}]){setup();await assert.rejects(captureFrame(bad,new AbortController().signal),/clear camera/);assert.equal(draws,0);}});
 await check('drawing failure is sanitized and the canvas is reset',async()=>{setup('throw');await assert.rejects(captureFrame(video,new AbortController().signal),e=>!e.message.includes('PRIVATE'));assert.equal(canvas.width,0);assert.equal(canvas.height,0);});
 await check('missing canvas support fails without retaining the frame',async()=>{setup('no-context');await assert.rejects(captureFrame(video,new AbortController().signal),/unavailable/);assert.equal(canvas.width,0);});
 await check('clearing temporary bytes does not clear the returned immutable JPEG Blob',async()=>{setup();const blob=await captureFrame(video,new AbortController().signal);await new Promise(r=>setTimeout(r,0));assert.deepEqual(Buffer.from(await blob.arrayBuffer()),jpeg);});
 console.log(`Comparison capture checks passed: ${count}.`);
}finally{globalThis.document=original;Object.defineProperty(globalThis,'performance',{configurable:true,value:originalPerformance});}
