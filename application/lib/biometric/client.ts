// Expected transport failures resolve as data, including aborts and late reads.
export type ClientResult<T>={ok:true;value:T}|{ok:false;kind:"timeout"|"cancelled"|"unauthorized"|"http"|"network"|"response";message:string};
type Options={timeoutMs?:number;signal?:AbortSignal;fetcher?:typeof fetch;timeoutMessage?:string;xhrFactory?:()=>XMLHttpRequest};
const cancelled={ok:false,kind:"cancelled",message:"Request cancelled. Refresh your status before trying again."} as const;
const network={ok:false,kind:"network",message:"The Face Recognition Attendance System server could not be reached. Check the server, then refresh your status."} as const;
const unreadable={ok:false,kind:"response",message:"The server response could not be read. Refresh your status and try again."} as const;
// Browser requests use event-based XHR. Settle our one promise before aborting
// the transport; never reject a fetch promise with a string cancellation reason.
function browserRequest<T>(url:string,init:RequestInit,options:Options,factory:()=>XMLHttpRequest):Promise<ClientResult<T>>{
  return new Promise(resolve=>{
    let xhr:XMLHttpRequest|undefined,timer:ReturnType<typeof setTimeout>|undefined,settled=false;
    const signal=options.signal??init.signal;
    const finish=(result:ClientResult<T>)=>{
      if(settled)return;settled=true;if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener("abort",cancel);
      if(xhr)xhr.onload=xhr.onerror=xhr.onabort=xhr.ontimeout=xhr.onprogress=null;
      resolve(result);
    };
    const stop=()=>{try{xhr?.abort();}catch{/* Request is already settled. */}};
    const cancel=()=>{finish(cancelled);stop();};
    const timeout=()=>{finish({ok:false,kind:"timeout",message:options.timeoutMessage??"Camera settings timed out. The camera is off. Refresh status and try again."});stop();};
    if(signal?.aborted){finish(cancelled);return;}
    try{
      if(typeof location!=="undefined"&&new URL(url,location.href).origin!==location.origin){finish({ok:false,kind:"http",message:"Use the Face Recognition Attendance System server origin for camera requests."});return;}
      xhr=factory();xhr.open(init.method??"GET",url,true);xhr.responseType="text";xhr.withCredentials=false;
      xhr.timeout=options.timeoutMs??30000;
      const headers=new Headers(init.headers);headers.set("Cache-Control","no-store");headers.set("Pragma","no-cache");
      headers.forEach((value,name)=>xhr!.setRequestHeader(name,value));
      xhr.onload=()=>{
        if(settled)return;
        try{
          if(xhr!.responseText.length>2097152){finish(unreadable);return;}
          const body=JSON.parse(xhr!.responseText) as unknown;
          if(xhr!.status>=200&&xhr!.status<300){finish({ok:true,value:body as T});return;}
          const error=(body as {error?:unknown}|null)?.error;
          finish({ok:false,kind:xhr!.status===401?"unauthorized":"http",message:typeof error==="string"?error.slice(0,400):"Camera request failed. Refresh your status and try again."});
        }catch{finish(unreadable);}
      };
      xhr.onerror=()=>finish(network);xhr.onabort=()=>finish(cancelled);xhr.ontimeout=timeout;
      xhr.onprogress=event=>{if(event.loaded>2097152){finish(unreadable);stop();}};
      signal?.addEventListener("abort",cancel,{once:true});
      if(signal?.aborted){cancel();return;}
      timer=setTimeout(timeout,options.timeoutMs??30000);
      xhr.send((init.body??null) as XMLHttpRequestBodyInit|null);
    }catch{finish(network);stop();}
  });
}
export function enrollmentRequest<T>(url:string,init:RequestInit={},options:Options={}):Promise<ClientResult<T>>{
  if(options.signal?.aborted)return Promise.resolve(cancelled);
  const factory=options.xhrFactory??(typeof XMLHttpRequest!=="undefined"?()=>new XMLHttpRequest():undefined);
  if(factory&&!options.fetcher)return browserRequest<T>(url,init,options,factory);
  const controller=new AbortController();
  return new Promise(resolve=>{
    let settled=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const finish=(result:ClientResult<T>)=>{
      if(settled)return;settled=true;if(timer!==undefined)clearTimeout(timer);
      options.signal?.removeEventListener("abort",abort);resolve(result);
    };
    const abort=()=>{finish(cancelled);controller.abort();};
    timer=setTimeout(()=>{
      finish({ok:false,kind:"timeout",message:options.timeoutMessage??"Camera settings timed out. The camera is off. Refresh status and try again."});
      controller.abort();
    },options.timeoutMs??30000);
    options.signal?.addEventListener("abort",abort,{once:true});
    if(options.signal?.aborted){abort();return;}
    void (async()=>{
      try{
        const response=await (options.fetcher??fetch)(url,{...init,cache:"no-store",credentials:"same-origin",signal:controller.signal});
        if(settled)return;
        let body:unknown;
        try{body=await response.json();}
        catch{finish({ok:false,kind:"response",message:"The server response could not be read. Refresh your status and try again."});return;}
        if(settled)return;
        if(response.ok){finish({ok:true,value:body as T});return;}
        const error=(body as {error?:unknown}|null)?.error;
        finish({ok:false,kind:response.status===401?"unauthorized":"http",message:typeof error==="string"?error.slice(0,400):"Camera request failed. Refresh your status and try again."});
      }catch{
        finish({ok:false,kind:"network",message:"The Face Recognition Attendance System server could not be reached. Check the server, then refresh your status."});
      }
    })();
  });
}
