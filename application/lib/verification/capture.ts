// One small in-memory JPEG. Avoid the asynchronous toBlob callback queue.
// A synchronous encoder cannot be interrupted by a JS timer; reject its output
// if it exceeds the elapsed budget. No frame is uploaded or retried here.
export async function captureFrame(video:HTMLVideoElement,signal:AbortSignal,budgetMs=5000):Promise<Blob>{
  const check=()=>{if(signal.aborted)throw new Error("Capture cancelled. Refresh status before trying again.");};
  check();
  if(!Number.isFinite(budgetMs)||budgetMs<=0)throw new Error("Camera capture is unavailable.");
  if(video.readyState<2||!Number.isFinite(video.videoWidth)||!Number.isFinite(video.videoHeight)||video.videoWidth<64||video.videoHeight<64)
    throw new Error("Wait for a clear camera preview before capturing.");
  const canvas=document.createElement("canvas"),scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.max(1,Math.floor(video.videoWidth*scale));canvas.height=Math.max(1,Math.floor(video.videoHeight*scale));
  const started=performance.now();let bytes:Uint8Array|undefined;
  try{
    const context=canvas.getContext("2d");if(!context)throw new Error("Camera capture is unavailable.");
    context.drawImage(video,0,0,canvas.width,canvas.height);check();
    const encoded=canvas.toDataURL("image/jpeg",0.88);check();
    if(performance.now()-started>budgetMs)throw new Error("Camera frame preparation was too slow. Close other busy tabs, then start the camera and retry.");
    const prefix="data:image/jpeg;base64,",limit=1048576;
    if(!encoded.startsWith(prefix)||encoded.length>prefix.length+4*Math.ceil(limit/3))throw new Error("The camera frame could not be prepared as a bounded JPEG.");
    let decoded:string;
    try{decoded=atob(encoded.slice(prefix.length));}catch{throw new Error("The camera frame could not be read.");}
    if(decoded.length<20||decoded.length>limit)throw new Error("The camera frame is empty or too large.");
    bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
    if(bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error("The camera frame could not be read as JPEG.");
    check();return new Blob([bytes as Uint8Array<ArrayBuffer>],{type:"image/jpeg"});
  }catch(error){
    if(error instanceof Error&&/^(Capture cancelled\.|Camera capture is unavailable\.|Camera frame preparation was too slow\.|The camera frame )/.test(error.message))throw error;
    throw new Error("The camera frame could not be prepared. Start the camera again and retry.");
  }finally{bytes?.fill(0);canvas.width=canvas.height=0;}
}
