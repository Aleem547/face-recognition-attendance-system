'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Camera,Fingerprint,ShieldCheck,Square,Video} from 'lucide-react';
import {LocalCamera,type CameraState} from '@/lib/privacy/camera';
import {FaceTracker,type GuideState} from '@/lib/camera-overlay/tracker';
import {projectFace} from '@/lib/camera-overlay/geometry';
import {captureFrame} from '@/lib/verification/capture';
import {DEMO_STUDENT,DEMO_CLASS,type DemoStore,type DemoAccount} from '@/lib/demo/store';
import type {PadScores} from '@/lib/verification/paired';
const noticeVersion='recruiter-camera-v1';
type Trial={similarity:number;pad?:PadScores;modelVersion:string;remaining:number;scope:string;at:string};
const timeout=(signal:AbortSignal)=>AbortSignal.any([signal,AbortSignal.timeout(35000)]);
function delay(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{if(signal.aborted)return reject(new Error('Cancelled'));const abort=()=>{clearTimeout(timer);reject(new Error('Cancelled'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}

export default function DemoCamera({store,account,changed}:{store:DemoStore;account:DemoAccount;changed:()=>void}){
 const video=useRef<HTMLVideoElement>(null),preview=useRef<HTMLDivElement>(null),camera=useRef<LocalCamera|null>(null),allowed=useRef(false),choiceRevision=useRef(0),expiry=useRef(0),processing=useRef<AbortController|null>(null),live=useRef<AbortController|null>(null),started=useRef(false);
 const [cameraState,setCameraState]=useState<CameraState>({mode:'idle',message:'Camera is off. Start only when you choose.',promptPending:false}),[previewChoice,setPreviewChoice]=useState(false),[uploadChoice,setUploadChoice]=useState(false),[paired,setPaired]=useState(false),[markChoice,setMarkChoice]=useState(false),[liveChoice,setLiveChoice]=useState(false),[busy,setBusy]=useState(false),[running,setRunning]=useState(false),[reference,setReference]=useState(''),[expiresAt,setExpiresAt]=useState(''),[remaining,setRemaining]=useState(6),[trials,setTrials]=useState<Trial[]>([]),[message,setMessage]=useState(''),[error,setError]=useState(''),[guide,setGuide]=useState<GuideState>({mode:'off',boxes:[]}),[size,setSize]=useState({width:0,height:0,videoWidth:0,videoHeight:0}),[sessionId,setSessionId]=useState(DEMO_CLASS),[studentId,setStudentId]=useState(store.data.students.find(s=>s.user_id===account.id)?.id??store.data.students.find(s=>s.user_id===DEMO_STUDENT)?.id??'');
 const active=cameraState.mode==='active';
 function withdrawRequest(){if(!started.current)return;started.current=false;void fetch('/api/demo/face-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'withdraw'}),cache:'no-store',credentials:'same-origin',keepalive:true}).catch(()=>{});}
 function stop(text='Camera stopped.'){live.current?.abort();processing.current?.abort();camera.current?.stop(text);setRunning(false);}
 function withdraw(){stop('Camera choice withdrawn.');withdrawRequest();setReference('');setExpiresAt('');setTrials([]);setMessage('Temporary reference and scores cleared from this page.');}
 useEffect(()=>{
  camera.current=new LocalCamera({check:async()=>({allowed:allowed.current,revision:choiceRevision.current,noticeVersion,expiresAt:expiry.current}),getStream:()=>navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false}),attach:async stream=>{if(video.current){video.current.srcObject=stream;if(stream)await video.current.play();}},visible:()=>!document.hidden,state:setCameraState,activeMessage:'Local preview active. No image is sent until you choose a capture. Preview stops within 60 seconds.'});
  const hidden=()=>{if(document.hidden){live.current?.abort();processing.current?.abort();camera.current?.stop('Camera stopped because this page was hidden.');setRunning(false);}};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',hidden);
  return()=>{live.current?.abort();processing.current?.abort();camera.current?.dispose();withdrawRequest();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',hidden);};
 },[]);
 useEffect(()=>{if(!active){live.current?.abort();setRunning(false);}},[active]);
 useEffect(()=>{
  const element=video.current,parent=preview.current;if(!active||!element||!parent){setGuide({mode:'off',boxes:[]});return;}
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  const resize=()=>setSize({width:parent.clientWidth,height:parent.clientHeight,videoWidth:element.videoWidth,videoHeight:element.videoHeight});
  const tracker=new FaceTracker({worker:()=>new Worker('/attendai-face-overlay/detector-worker.js'),active:()=>!document.hidden&&Boolean(element.srcObject),state:setGuide,pixels:()=>{if(!context||element.readyState<2||!element.videoWidth)return null;resize();const scale=Math.min(1,320/Math.max(element.videoWidth,element.videoHeight));canvas.width=Math.round(element.videoWidth*scale);canvas.height=Math.round(element.videoHeight*scale);context.drawImage(element,0,0,canvas.width,canvas.height);return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data.buffer as ArrayBuffer};}});
  const observer=new ResizeObserver(resize);observer.observe(parent);tracker.start();return()=>{tracker.dispose();observer.disconnect();canvas.width=canvas.height=0;};
 },[active]);
 async function capture(kind:'enroll'|'compare'|'checkin',liveSignal?:AbortSignal){
  if(!uploadChoice||!allowed.current||!video.current||!active)throw Error('Review both camera choices and start a clear preview first.');
  if(kind!=='enroll'&&!reference)throw Error('Create a temporary reference before comparing.');
  if(kind==='checkin'&&(!markChoice||!paired))throw Error('Choose both PAD scores and demo-only attendance recording before check-in.');
  const controller=new AbortController();processing.current=controller;const signal=liveSignal?AbortSignal.any([controller.signal,liveSignal]):controller.signal;
  setBusy(true);setError('');setMessage(kind==='enroll'?'Preparing your temporary reference…':'Comparing your fresh frame…');
  try{
   const session=await fetch('/api/demo/face-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',noticeVersion}),credentials:'same-origin',cache:'no-store',signal:timeout(signal)}),choice=await session.json();
   if(!session.ok)throw Error(choice.error??'The camera demo could not start.');started.current=true;
   const frame=await captureFrame(video.current,signal);if(!liveSignal)camera.current?.stop('One frame captured. Processing your demo trial…');
   const response=await fetch('/api/demo/face',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Demo-Action':kind==='enroll'?'enroll':'compare',...(kind!=='enroll'?{'X-Demo-Reference':reference}:{}),...(kind!=='enroll'&&paired?{'X-Demo-Pad':'1'}:{})},body:frame,credentials:'same-origin',cache:'no-store',signal:timeout(signal)}),result=await response.json();
   if(!response.ok)throw Error(result.error??'The frame could not be processed.');if(signal.aborted)throw Error('Capture cancelled.');setRemaining(result.remaining);
   if(kind==='enroll'){setReference(result.reference);setExpiresAt(result.expiresAt);setMessage('Temporary encrypted reference ready. Restart the camera, then capture a fresh comparison.');}
   else{
    const trial:Trial={...result,at:new Date().toISOString()};setTrials(rows=>[trial,...rows].slice(0,8));
    if(kind==='checkin'){
     if(!result.pad)throw Error('Both PAD model scores are required for this demo check-in.');
     const outcome=store.checkin(account,sessionId,studentId,{similarity:result.similarity,pad:result.pad.models.map((m:{class1Score:number})=>m.class1Score),sample:false});changed();
     setMessage('Demo check-in: '+outcome.decision+(outcome.status?' · '+outcome.status:'')+'. Only sample attendance records are involved.');
    }else setMessage('Real camera comparison complete. The similarity and optional PAD scores are shown below. Attendance is unchanged.');
   }
  }finally{if(processing.current===controller)processing.current=null;setBusy(false);}
 }
 async function manual(kind:'enroll'|'compare'|'checkin'){try{await capture(kind);}catch(e){setError((e as Error).message);setMessage('');}}
 async function startLive(){if(!liveChoice||!reference||!active||busy||running)return;const controller=new AbortController();live.current=controller;setRunning(true);
  try{for(let i=0;i<3;i++){if(controller.signal.aborted)break;await capture('compare',controller.signal);if(i<2)await delay(3000,controller.signal);}setMessage('Live demo finished after up to three measured frames. Scores stay on this page.');}
  catch(e){if(!controller.signal.aborted)setError((e as Error).message);}
  finally{if(live.current===controller)live.current=null;setRunning(false);camera.current?.stop('Live comparison ended. Camera is off.');}
 }
 const visible=store.read(account,{resource:'sessions'}) as {items:typeof store.data.sessions};
 const students=store.data.students.filter(s=>account.role!=='student'||s.user_id===account.id),latest=trials[0];
 return <><div className="demo-feature-heading"><p className="eyebrow">OPTIONAL CAMERA LAB</p><h1>Try the real face pipeline.</h1><p>Start a private preview, create a temporary reference, and compare a fresh capture using the project’s YuNet/SFace engine. No account or approval is needed.</p></div>
 <div className="demo-two-column"><section className="panel demo-controls"><h2><Camera size={20}/> Your camera choices</h2>
  <p className="note">Use only your own face. Preview stays on your device. A capture sends one JPEG to this application’s server for temporary processing. The server returns an encrypted reference token or measured scores; it does not save your image, reference or scores to the application database. The token stays in page memory and expires within ten minutes. Up to six captures are available per trial, subject to a shared CPU allowance.</p>
  <label className="demo-check"><input type="checkbox" checked={previewChoice} onChange={e=>{const value=e.target.checked;allowed.current=value;choiceRevision.current++;expiry.current=Date.now()+600000;setPreviewChoice(value);if(!value)withdraw();}}/>I choose to open my camera for this demo.</label>
  <label className="demo-check"><input type="checkbox" checked={uploadChoice} onChange={e=>{setUploadChoice(e.target.checked);if(!e.target.checked)withdraw();}}/>I choose to send captures of my own face for this temporary camera trial.</label>
  <div className="buttons"><button className="btn primary" disabled={!previewChoice||active||cameraState.promptPending||busy||running} onClick={()=>{setError('');void camera.current?.start();}}><Video size={15}/>Start camera</button><button className="btn outline" onClick={()=>stop()} disabled={!active&&!busy&&!running}><Square size={14}/>Stop camera</button></div>
  <p className="note" role="status">{cameraState.message}</p>
  <div ref={preview} className={'camera-preview demo-camera-preview'+(active?' is-active':'')}>
   <video ref={video} playsInline muted aria-label="Recruiter demo camera preview"/>
   {!active&&<div className="demo-camera-placeholder"><Fingerprint size={52}/><span>Your camera is off</span></div>}
   {active&&guide.boxes.map((box,index)=>{const p=projectFace(box,size.videoWidth,size.videoHeight,size.width,size.height,true);return p&&<div key={index} className="demo-face-box" style={{left:p.x,top:p.y,width:p.width,height:p.height}}><span>Your demo preview</span></div>;})}
   {active&&<span className="demo-camera-caption">{guide.mode==='unavailable'?'Face guide unavailable · capture controls remain available':guide.mode==='multiple'?'Keep only your own face in view':guide.mode==='tracking'?'Face positioning guide · not identity recognition':'Look toward the camera in even light'}</span>}
  </div>
 </section><section className="panel demo-controls"><h2>Enrollment & comparison</h2><p className="note">The temporary reference belongs only to this browser’s camera trial. The encrypted token cannot be used as a real student enrollment.</p>
  <div className="demo-reference-state"><ShieldCheck size={20}/><div><strong>{reference?'Temporary reference ready':'No temporary reference yet'}</strong><small>{expiresAt?'Expires '+new Date(expiresAt).toLocaleTimeString():'Create a reference from a clear, front-facing capture.'}</small></div></div>
  <div className="demo-action-grid"><button className="btn primary" disabled={!active||!uploadChoice||busy||running} onClick={()=>void manual('enroll')}>Create temporary reference</button><button className="btn outline" disabled={!active||!uploadChoice||!reference||busy||running} onClick={()=>void manual('compare')}>Capture and compare</button></div>
  <label className="demo-check"><input type="checkbox" checked={paired} disabled={busy||running} onChange={e=>setPaired(e.target.checked)}/>Include both MiniFASNet PAD research scores in comparisons.</label>
  <div className="demo-score"><span>Latest measured similarity</span><strong>{latest?latest.similarity.toFixed(4):'—'}</strong><small>Cosine similarity, −1 to 1 · {latest?latest.modelVersion:'No camera measurement yet'}</small></div>
  {latest?.pad&&<div className="demo-pad-scores">{latest.pad.models.map(m=><div key={m.model}><span>{m.model}</span><strong>{m.class1Score.toFixed(4)}</strong></div>)}</div>}
  <p className="note">Similarity is not an accuracy percentage. PAD scores are uncalibrated research outputs and do not establish liveness or identity.</p>
  <div className="demo-live-panel"><h3>Bounded live comparison</h3><label className="demo-check"><input type="checkbox" checked={liveChoice} onChange={e=>{setLiveChoice(e.target.checked);if(!e.target.checked)stop('Live comparison choice withdrawn.');}}/>For this run, compare up to three fresh frames while the preview stays on, within 60 seconds.</label><div className="buttons"><button className="btn primary" disabled={!active||!uploadChoice||!liveChoice||!reference||busy||running||remaining===0} onClick={()=>void startLive()}>Start live comparison</button><button className="btn outline" disabled={!running} onClick={()=>stop('Live comparison stopped.')}>Stop live comparison</button></div></div>
  <p className="note">Last reported captures remaining: {remaining}. Failed processing attempts also consume the allowance.</p><button className="text-link" onClick={withdraw}>Withdraw trial and clear reference / scores</button>
 </section></div>
 {error&&<p className="register-alert error" role="alert">{error}</p>}{message&&<p className="register-alert success" role="status">{message}</p>}
 <section className="panel demo-controls"><h2>Try a camera check-in in the sample register</h2><p className="note">Your current face is compared with your own temporary reference. Choosing a sample student below demonstrates record creation for that synthetic account; it does not identify you as that person. Only demo records can change.</p><div className="demo-policy-grid"><label>Sample class<select aria-label="Camera check-in class" value={sessionId} onChange={e=>setSessionId(e.target.value)}>{visible.items.map(s=><option key={s.id} value={s.id}>{s.session_code} · {s.state}</option>)}</select></label><label>Sample student<select aria-label="Camera check-in student" value={studentId} onChange={e=>setStudentId(e.target.value)}>{students.map(s=><option key={s.id} value={s.id}>{s.student_code} · {s.display_name}</option>)}</select></label></div>
 <label className="demo-check"><input type="checkbox" checked={markChoice} onChange={e=>setMarkChoice(e.target.checked)}/>I choose to let an accepted experimental camera result save Present or Late in this tab’s sample register.</label><div className="buttons"><button className="btn primary" disabled={!active||!uploadChoice||!reference||!paired||!markChoice||busy||running} onClick={()=>void manual('checkin')}>Capture and check in</button><Link className="btn outline" href="/demo?view=attendance">View demo register</Link><Link className="btn outline" href="/demo?view=check-in">Try sample timing scenarios</Link></div>
 </section>
 {trials.length>0&&<section className="panel"><h2>This page’s measured comparisons</h2><div className="table-scroll"><table><thead><tr><th>CAPTURE TIME</th><th>SIMILARITY</th><th>PAD MODELS</th><th>SCOPE</th></tr></thead><tbody>{trials.map((t,i)=><tr key={i}><td>{new Date(t.at).toLocaleTimeString()}</td><td>{t.similarity.toFixed(4)}</td><td>{t.pad?t.pad.models.map(m=>m.class1Score.toFixed(4)).join(' / '):'Not requested'}</td><td>Temporary camera demo</td></tr>)}</tbody></table></div></section>}
 </>;
}
