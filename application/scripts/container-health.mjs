try{
 const port=process.env.PORT??'3000';if(!/^\d+$/.test(port))throw Error();
 const response=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(3500)});
 if(!response.ok||(await response.json()).status!=='ok')throw Error();
}catch{process.exitCode=1;}
