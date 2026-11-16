import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {RegisterError} from '../register/service.ts';
import {assertMutationRequest,readSmallJson} from '../register/http.ts';
import {assertImageRequest,readImage} from '../biometric/http.ts';
import {featureBytes,MODEL_VERSION} from '../biometric/crypto.ts';
import {compareFeature} from '../verification/math.ts';
import {validatePad,type PadScores} from '../verification/paired.ts';
export const DEMO_FACE_NOTICE='recruiter-camera-v1';
const ttl=600000,windowMs=600000,headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const aad=Buffer.from('fras-recruiter-reference-v1');
type Guest={id:string;expires:number;captures:number;revoked:boolean};
type Window={start:number;count:number};
type Dependencies={secret:string;origin:string;enabled:boolean;now?:()=>number;
 extract:(image:Buffer,signal:AbortSignal,paired:boolean)=>Promise<{embedding:number[];pad?:PadScores}>;
 reserve:()=>()=>void};
function failure(error:unknown){const known=error instanceof RegisterError;return Response.json({error:known?error.message:'The demo face engine is temporarily unavailable. Try the sample scenarios or retry later.'},{status:known?error.status:503,headers});}

/** Anonymous, bounded camera trials. Does not import auth access or a DB pool. */
export class DemoFaceService{
 private guests=new Map<string,Guest>();private issued=new Map<string,Window>();private globalCaptures:Window={start:0,count:0};private globalIssues:Window={start:0,count:0};
 private key:Buffer;private cookieName:string;
 private deps:Dependencies;
 constructor(deps:Dependencies){this.deps=deps;if(Buffer.byteLength(deps.secret)<32)throw Error('Demo signing configuration unavailable.');this.key=createHmac('sha256',deps.secret).update('fras-demo-camera-sealing-v1').digest();this.cookieName=deps.origin.startsWith('https:')?'__Host-fras_demo':'fras_demo';}
 private now(){return (this.deps.now??Date.now)();}
 private signature(value:string){return createHmac('sha256',this.key).update('session:'+value).digest('base64url');}
 private cookie(guest:Guest|null){const value=guest?Buffer.from(JSON.stringify({id:guest.id,expires:guest.expires})).toString('base64url'):'';return this.cookieName+'='+(guest?value+'.'+this.signature(value):'')+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(guest?'600':'0')+(this.deps.origin.startsWith('https:')?'; Secure':'');}
 private active(request:Request){const parts=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(this.cookieName+'='));if(parts.length!==1)return null;
  try{const token=parts[0].slice(this.cookieName.length+1);if(token.length>1024||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return null;const [payload,signed]=token.split('.'),expected=Buffer.from(this.signature(payload)),provided=Buffer.from(signed);if(expected.length!==provided.length||!timingSafeEqual(expected,provided))return null;
   const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')),guest=this.guests.get(data.id);return guest&&!guest.revoked&&guest.expires===data.expires&&guest.expires>this.now()?guest:null;
  }catch{return null;}
 }
 private clean(){for(const [id,g]of this.guests)if(g.expires<=this.now())this.guests.delete(id);for(const [key,w]of this.issued)if(w.start+windowMs<=this.now())this.issued.delete(key);}
 private window(w:Window,limit:number,message:string){if(w.start+windowMs<=this.now()){w.start=this.now();w.count=0;}if(w.count>=limit)throw new RegisterError(429,message);w.count++;}
 private issue(request:Request){this.clean();const existing=this.active(request);if(existing)return existing;
  if(this.guests.size>=64||this.issued.size>=128)throw new RegisterError(429,'The camera demo is busy. The attendance sandbox remains available.');
  const address=(request.headers.get('x-forwarded-for')??'unavailable').split(',').at(-1)!.trim().slice(0,128),key=createHmac('sha256',this.key).update('client:'+address).digest('hex');
  const count=this.issued.get(key)??{start:this.now(),count:0};this.window(count,4,'Too many camera-demo starts. Try again in ten minutes; the sample scenarios remain available.');this.issued.set(key,count);
  this.window(this.globalIssues,32,'The shared camera demo is busy. Try the sample scenarios.');
  const guest={id:randomUUID(),expires:this.now()+ttl,captures:0,revoked:false};this.guests.set(guest.id,guest);return guest;
 }
 private seal(guest:Guest,embedding:number[]){const feature=featureBytes(embedding),meta=Buffer.from(JSON.stringify({id:guest.id,expires:guest.expires,model:MODEL_VERSION})),length=Buffer.alloc(2);length.writeUInt16BE(meta.length);const body=Buffer.concat([length,meta,feature]),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(aad);
  try{const ciphertext=Buffer.concat([cipher.update(body),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');}finally{feature.fill(0);body.fill(0);}
 }
 private open(guest:Guest,token:string){let body:Buffer|undefined;
  try{if(!/^[A-Za-z0-9_-]{40,2048}$/.test(token))throw Error();const bytes=Buffer.from(token,'base64url');if(bytes.length<550)throw Error();const decipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));decipher.setAAD(aad);decipher.setAuthTag(bytes.subarray(12,28));body=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);const size=body.readUInt16BE(),meta=JSON.parse(body.subarray(2,2+size).toString('utf8'));if(meta.id!==guest.id||meta.expires!==guest.expires||meta.expires<=this.now()||meta.model!==MODEL_VERSION||body.length!==2+size+512)throw Error();return Buffer.from(body.subarray(2+size));
  }catch{throw new RegisterError(409,'Your temporary reference expired or is unavailable. Create a new demo reference.');}finally{body?.fill(0);}
 }
 async session(request:Request){try{
  assertMutationRequest(request,this.deps.origin);const input=await readSmallJson(request) as {action?:string;noticeVersion?:string};
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','noticeVersion'].includes(k)))throw new RegisterError(400,'Invalid camera-demo choice.');
  if(input.action==='withdraw'){const guest=this.active(request);if(guest)guest.revoked=true;return Response.json({status:'withdrawn'},{headers:{...headers,'Set-Cookie':this.cookie(null)}});}
  if(input.action!=='start'||input.noticeVersion!==DEMO_FACE_NOTICE)throw new RegisterError(400,'Review the demo camera notice before starting a trial.');
  if(!this.deps.enabled)throw new RegisterError(503,'Camera processing is disabled on this installation. You can still try every sample attendance scenario.');
  const guest=this.issue(request);return Response.json({expiresAt:new Date(guest.expires).toISOString(),remaining:Math.max(0,6-guest.captures),scope:'demo_only'},{headers:{...headers,'Set-Cookie':this.cookie(guest)}});
 }catch(error){return failure(error);}}
 async capture(request:Request){let image:Buffer|undefined,reference:Buffer|undefined,probe:number[]|undefined,release:(()=>void)|undefined;
  try{
   assertImageRequest(request,this.deps.origin);if(!this.deps.enabled)throw new RegisterError(503,'Camera processing is disabled on this installation.');const guest=this.active(request);if(!guest)throw new RegisterError(401,'Start a new camera demo after reviewing its notice.');
   const action=request.headers.get('x-demo-action'),paired=request.headers.get('x-demo-pad');if(!['enroll','compare'].includes(action??'')||paired!==null&&paired!=='1')throw new RegisterError(400,'Choose a valid demo capture action.');
   if(action==='compare')reference=this.open(guest,request.headers.get('x-demo-reference')??'');
   if(guest.captures>=6)throw new RegisterError(429,'This camera demo has used its six captures. Try the sample scenarios, or return after ten minutes.');
   this.window(this.globalCaptures,24,'The shared camera-processing allowance is busy. Try the sample scenarios or return in ten minutes.');guest.captures++;
   image=await readImage(request);release=this.deps.reserve();const output=await this.deps.extract(image,request.signal,paired==='1');probe=output.embedding;
   if(request.signal.aborted||guest.revoked||guest.expires<=this.now()||this.active(request)?.id!==guest.id)throw new RegisterError(409,'Camera trial cancelled. No demo result was saved.');
   const checked=featureBytes(probe);checked.fill(0);const remaining=6-guest.captures;
   if(action==='enroll')return Response.json({reference:this.seal(guest,probe),expiresAt:new Date(guest.expires).toISOString(),modelVersion:MODEL_VERSION,remaining,scope:'demo_only'},{headers});
   const pad=paired==='1'?validatePad(output.pad):undefined;
   return Response.json({similarity:compareFeature(reference!,probe),...(pad?{pad}:{}),modelVersion:MODEL_VERSION,remaining,scope:'demo_only',attendanceChanged:false},{headers});
  }catch(error){return failure(error);}finally{image?.fill(0);reference?.fill(0);probe?.fill(0);release?.();}
 }
}
