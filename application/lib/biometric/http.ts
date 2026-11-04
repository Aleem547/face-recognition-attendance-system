import { RegisterError } from "../register/service.ts";
export function assertImageRequest(request: Request,configuredOrigin:string|undefined) {
  let origin:string;try {origin=new URL(configuredOrigin??"").origin;}catch {throw new RegisterError(503,"Authentication origin is not configured.");}
  if(request.headers.get("origin")!==origin||request.headers.get("sec-fetch-site")==="cross-site")throw new RegisterError(403,"Untrusted request origin.");
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="image/jpeg")throw new RegisterError(415,"Use image/jpeg.");
}
export async function readImage(request:Request):Promise<Buffer> {
  const declared=request.headers.get("content-length");
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>1048576))throw new RegisterError(413,"The camera frame exceeds 1 MiB.");
  if(!request.body)throw new RegisterError(400,"A JPEG camera frame is required.");
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;void reader.cancel();},10000);
  try {
    while(true){const {done,value}=await reader.read();if(timedOut)throw new RegisterError(408,"Camera upload timed out.");if(done)break;
      size+=value.byteLength;if(size>1048576){void reader.cancel();throw new RegisterError(413,"The camera frame exceeds 1 MiB.");}chunks.push(value);}
    if(size<20)throw new RegisterError(400,"The camera frame is empty.");
    return Buffer.concat(chunks,size);
  } finally {clearTimeout(timer);reader.releaseLock();for(const chunk of chunks)chunk.fill(0);}
}
