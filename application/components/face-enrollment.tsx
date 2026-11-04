"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import Link from "next/link";
import {Camera,CameraOff,ShieldCheck} from "lucide-react";
import {LocalCamera,type CameraState} from "@/lib/privacy/camera";
import type {BiometricState} from "@/lib/biometric/contracts";
import {enrollmentRequest,type ClientResult} from "@/lib/biometric/client";
function api<T>(body?:unknown,timeoutMs=30000,signal?:AbortSignal){
  return enrollmentRequest<T>("/api/biometric",{method:body?"POST":"GET",
    ...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})},{timeoutMs,signal});
}
async function frame(video:HTMLVideoElement):Promise<Blob>{
  if(video.readyState<2||video.videoWidth<64||video.videoHeight<64)throw new Error("Wait for the camera to show a clear frame.");
  const canvas=document.createElement("canvas"),scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.floor(video.videoWidth*scale);canvas.height=Math.floor(video.videoHeight*scale);
  try{const context=canvas.getContext("2d");if(!context)throw new Error("Camera capture is unavailable.");context.drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",0.88));
    if(!blob||blob.type!=="image/jpeg"||blob.size<20||blob.size>1048576)throw new Error("The camera frame could not be prepared.");return blob;
  }finally{canvas.getContext("2d")?.clearRect(0,0,canvas.width,canvas.height);canvas.width=canvas.height=0;}
}
const date=(value:string|null)=>value?new Date(value).toLocaleString():"—";
export default function FaceEnrollment(){
  const [data,setData]=useState<BiometricState|null>(null),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [ack,setAck]=useState(false),[saving,setSaving]=useState(false),[capturing,setCapturing]=useState(false),[ready,setReady]=useState(false);
  const [camera,setCamera]=useState<CameraState>({mode:"idle",message:"Camera is off.",promptPending:false});
  const video=useRef<HTMLVideoElement>(null),preview=useRef<LocalCamera|null>(null),mounted=useRef(true),changing=useRef(false),capturePending=useRef(false),epoch=useRef(0),upload=useRef<AbortController|null>(null),lifecycle=useRef<AbortController|null>(null),loadSequence=useRef(0);
  const report=useCallback((result:ClientResult<unknown>)=>{
    if(result.ok)return;
    if(mounted.current&&result.kind!=="cancelled")setError(result.message);
    if(result.kind==="unauthorized"&&mounted.current)window.location.assign("/login");
  },[]);
  const load=useCallback(async(timeoutMs=30000)=>{
    const sequence=++loadSequence.current;
    const result=await api<BiometricState>(undefined,timeoutMs,lifecycle.current?.signal);
    if(!result.ok){
      if(mounted.current&&sequence===loadSequence.current){preview.current?.stop("Camera stopped because your current choice could not be verified.");report(result);}
      return null;
    }
    if(mounted.current&&sequence===loadSequence.current)setData(result.value);
    return result.value;
  },[report]);
  useEffect(()=>{
    mounted.current=true;epoch.current++;changing.current=false;capturePending.current=false;setSaving(false);setCapturing(false);lifecycle.current=new AbortController();
    setReady(Boolean(window.isSecureContext&&navigator.mediaDevices?.getUserMedia));void load();
    preview.current=new LocalCamera({
      check:async()=>{const value=await load(8000);return {allowed:Boolean(value?.configured&&value.student?.is_active&&value.preference?.allowed&&!value.template),revision:value?.preference?.revision??0,
        noticeVersion:value?.notice.version??"unavailable",expiresAt:value?.preference?.expires_at?Date.parse(value.preference.expires_at):NaN};},
      getStream:()=>navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false}),
      attach:async stream=>{if(!video.current){if(stream)throw new Error("Preview unavailable.");return;}video.current.srcObject=stream;if(stream)await video.current.play();},
      visible:()=>document.visibilityState==="visible",state:value=>{if(mounted.current)setCamera(value);},
      gateHint:"Refresh your enrollment status before starting the camera.",activeMessage:"Camera active. Capture only your own face. The camera stops within 60 seconds.",
    });
    const hidden=()=>{if(document.visibilityState!=="visible")preview.current?.stop("Camera stopped because this page was hidden.");};
    const leaving=()=>preview.current?.stop("Camera stopped because you left this page.");
    document.addEventListener("visibilitychange",hidden);window.addEventListener("pagehide",leaving);
    return ()=>{mounted.current=false;epoch.current++;loadSequence.current++;lifecycle.current?.abort("attendai_page_left");upload.current?.abort("attendai_page_left");preview.current?.dispose();preview.current=null;document.removeEventListener("visibilitychange",hidden);window.removeEventListener("pagehide",leaving);};
  },[load]);
  useEffect(()=>setAck(false),[data?.notice.version,data?.preference?.revision]);
  async function change(action:"grantEnrollment"|"chooseManual"|"withdraw"|"deleteTemplate"){
    preview.current?.stop("Camera is off while your choice is saved.");
    if(changing.current||!data)return;
    changing.current=true;const current=++epoch.current;upload.current?.abort("attendai_choice_changed");capturePending.current=false;setCapturing(false);setSaving(true);setError("");setMessage("");
    try{
      const result=await api(action==="grantEnrollment"?{action,acknowledged:ack,noticeVersion:data.notice.version,expectedRevision:data.preference?.revision??0}:{action},30000,lifecycle.current?.signal);
      if(!mounted.current||current!==epoch.current)return;
      if(!result.ok){report(result);await load();return;}
      setMessage(action==="grantEnrollment"?"Choice saved. Start the camera when you are ready.":action==="deleteTemplate"?"Active template deleted and pending attempts cancelled.":"Choice saved. The active template was deleted. Manual attendance remains available.");
      await load();
    }catch{if(mounted.current)setError("Your choice could not be confirmed. Refresh status before trying again.");}
    finally{if(current===epoch.current){changing.current=false;if(mounted.current)setSaving(false);}}
  }
  async function capture(){
    if(capturePending.current||changing.current||!video.current||camera.mode!=="active")return;
    capturePending.current=true;setCapturing(true);setError("");setMessage("");const current=++epoch.current;
    try{
      const fresh=await load(8000);if(current!==epoch.current)return;
      if(!fresh){preview.current?.stop("Camera stopped because enrollment consent could not be verified.");return;}
      if(!fresh.preference?.allowed||!fresh.configured||fresh.template||document.visibilityState!=="visible")throw new Error("Your enrollment choice changed. Review your status before capturing.");
      const blob=await frame(video.current!);preview.current?.stop("Camera is off while the captured frame is processed.");
      if(current!==epoch.current)return;
      const attempt=await api<{token:string}>({action:"beginEnrollment"},30000,lifecycle.current?.signal);if(current!==epoch.current)return;
      if(!attempt.ok){report(attempt);await load();return;}
      const controller=new AbortController();upload.current=controller;
      const result=await enrollmentRequest<{enrolled:boolean}>("/api/biometric/enroll",{method:"POST",headers:{"Content-Type":"image/jpeg","X-AttendAI-Token":attempt.value.token},body:blob},
        {signal:controller.signal,timeoutMs:45000,timeoutMessage:"The capture result was not confirmed in time. Refresh status before another capture. Withdrawal deletes any saved active template."});
      if(current!==epoch.current||!mounted.current)return;
      if(!result.ok){report(result);await load();return;}
      setMessage("Your encrypted template is saved. You can delete it or withdraw below.");await load();
    }catch(e){if(current===epoch.current&&mounted.current){preview.current?.stop();setError(e instanceof Error?e.message:"Capture failed. Refresh status and try again.");await load();}}
    finally{if(current===epoch.current){capturePending.current=false;upload.current=null;if(mounted.current)setCapturing(false);}}
  }
  const allowed=Boolean(data?.preference?.allowed),hasTemplate=Boolean(data?.template);
  return <div className="camera-content"><p className="eyebrow">OPTIONAL RESEARCH TRIAL</p><h1>Face enrollment</h1><p className="camera-intro">Your own account, a separate choice, and an encrypted template you can delete.</p>
    {error&&<div className="register-alert error" role="alert">{error}</div>}{message&&<div className="register-alert success" role="status">{message}</div>}
    {!data?<section className="panel camera-notice"><p>Loading your enrollment settings…</p><button className="btn outline" onClick={()=>void load()}>Reload settings</button></section>:<>
      <section className="panel camera-notice"><div className="camera-heading"><div className="safety-icon"><ShieldCheck size={22}/></div><div><h2>{data.notice.title}</h2><span className="pill neutral">Separate biometric choice</span></div></div>{data.notice.body.split("\n\n").map((p,i)=><p key={i}>{p}</p>)}<p className="camera-version">Notice version: {data.notice.version}</p></section>
      {!data.student?<section className="panel camera-notice"><h2>Student link required</h2><p>Ask your administrator to link your account to your own student record.</p></section>:<div className="camera-grid">
        <section className="panel"><h2>Your choice and template</h2><p className="note">{data.student.student_code} · {data.student.display_name}</p>
          <p><span className={`pill ${allowed?"success":"neutral"}`}>{allowed?"Enrollment consent active":data.preference?.choice==="withdrawn"?"Consent withdrawn":"Manual attendance"}</span></p>
          {!data.configured&&<p className="note">Enrollment is disabled until the server setup is completed. You can still withdraw or delete a saved template.</p>}
          {data.preference?.expires_at&&<p className="note">Choice expires: {date(data.preference.expires_at)}</p>}
          {data.template?<><p><strong>Encrypted template saved</strong></p><p className="note">Created: {date(data.template.created_at)}<br/>Expires: {date(data.template.expires_at)}</p><button className="btn outline" disabled={saving} onClick={()=>void change("deleteTemplate")}>Delete my template</button></>:<p className="note">No active template is saved.</p>}
          <label className="camera-ack"><input type="checkbox" checked={ack} disabled={saving||capturing||!data.student.is_active} onChange={e=>setAck(e.target.checked)}/><span>I have read this separate notice and voluntarily choose enrollment using only my own face.</span></label>
          <div className="camera-choice-buttons"><button className="btn primary" disabled={saving||capturing||!ack||!data.configured||!data.student.is_active} onClick={()=>void change("grantEnrollment")}>Grant enrollment consent</button><button className="btn outline" disabled={saving} onClick={()=>void change("chooseManual")}>Use manual attendance</button></div>
          <button className="text-link" disabled={saving} onClick={()=>void change("withdraw")}>Withdraw and delete template</button><Link className="text-link" href="/">Return to my attendance →</Link>
        </section>
        <section className="panel"><h2>Capture your own face</h2><p className="note">Face the camera in even light, keep your whole face visible, and make sure nobody else is in the frame.</p>
          <div className={`camera-preview ${camera.mode==="active"?"is-active":""}`}><video ref={video} muted autoPlay playsInline aria-label="Face enrollment camera preview"/>{camera.mode!=="active"&&<div className="camera-placeholder"><CameraOff size={34}/><span>{capturing?"Processing your captured frame":camera.mode==="permission"?"Waiting for permission":camera.mode==="checking"||camera.mode==="validating"?"Checking your choice":"Camera is off"}</span></div>}</div>
          <p className="camera-state" role="status">{capturing?"Processing the frame. You can withdraw your choice at any time.":camera.message}</p>
          <div className="camera-choice-buttons"><button className="btn outline" disabled={!ready||!allowed||!data.configured||hasTemplate||saving||capturing||camera.promptPending||["active","checking","permission","validating"].includes(camera.mode)} onClick={()=>void preview.current?.start()}><Camera size={16}/> Start camera</button><button className="btn outline" onClick={()=>preview.current?.stop()}>Stop camera</button><button className="btn primary" disabled={camera.mode!=="active"||saving||capturing||!allowed||hasTemplate} onClick={()=>void capture()}>Capture and enroll</button></div>
          <p className="note">Start only opens the preview. Capture and enroll sends one frame for processing and stops the camera. Stop camera stops the video stream. Use withdrawal to cancel enrollment and delete a saved template.</p>
        </section></div>}
      <section className="panel camera-notice"><h2>Recent receipts</h2><p className="note">Your latest 25 choice and template events. Receipts contain no images or face templates.</p>{data.history.length?<ul className="receipt-list">{data.history.map(event=><li key={event.event_id}><strong>{event.event_type.replace(/_/g," ")}</strong><p>{date(event.occurred_at)} · Choice revision {event.choice_revision}</p></li>)}</ul>:<p className="note">No events recorded.</p>}<button className="btn outline" disabled={saving||capturing} onClick={()=>void load()}>Refresh status</button></section>
    </>}<p className="note"><Link className="text-link" href="/verification">Optional face comparison has its own notice and choice →</Link><br/><Link className="text-link" href="/camera">Local preview choices →</Link></p></div>;
}
