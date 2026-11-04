import assert from 'node:assert/strict';
import {assertImageRequest,readImage} from '../lib/biometric/http.ts';
let checks=0;const origin='http://localhost:3000';
async function check(name,fn){await fn();console.log(`PASS ${++checks}: ${name}`);}
function request(headers={},body=new Uint8Array(30)){return new Request(origin+'/api/biometric/enroll',{method:'POST',headers:{origin,'content-type':'image/jpeg',...headers},body});}
await check('exact configured origin and JPEG content type are required',async()=>{assert.doesNotThrow(()=>assertImageRequest(request(),origin));for(const headers of [{origin:'https://other.example'},{origin:'null'},{'sec-fetch-site':'cross-site'},{'content-type':'application/json'}])assert.throws(()=>assertImageRequest(request(headers),origin));assert.throws(()=>assertImageRequest(request(),undefined));});
await check('bounded binary input is returned intact',async()=>{const bytes=Buffer.alloc(100,47);assert.deepEqual(await readImage(request({},bytes)),bytes);});
await check('declared oversized or malformed lengths are rejected before reading',async()=>{for(const value of ['1048577','-1','NaN'])await assert.rejects(readImage(request({'content-length':value})),e=>e.status===413);});
await check('streamed oversized bodies are rejected even without content-length',async()=>{await assert.rejects(readImage(request({},new Uint8Array(1048577))),e=>e.status===413);});
await check('empty and tiny bodies fail closed',async()=>{await assert.rejects(readImage(request({},new Uint8Array(1))),e=>e.status===400);await assert.rejects(readImage(new Request(origin,{method:'POST'})),e=>e.status===400);});
console.log(`Biometric binary HTTP checks passed: ${checks}.`);
