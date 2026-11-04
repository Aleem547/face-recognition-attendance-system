"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import Link from "next/link";
import {Camera,CameraOff,ShieldCheck} from "lucide-react";
import {LocalCamera,type CameraState} from "@/lib/privacy/camera";
import {enrollmentRequest,type ClientResult} from "@/lib/biometric/client";
import {captureFrame} from "@/lib/verification/capture";
import type {PadScores} from "@/lib/verification/paired";
const PAD_NOTICE="paired-pad-research-v1";
import {ResearchLabelsForm,DownloadObservation,initialLabels,type ResearchLabels} from "./research-observation";
import {MODEL_VERSION,validateObservation,type Observation} from "@/lib/evaluation/reliability";
import type {VerificationState,Trial} from "@/lib/verification/contracts";
function api<T>(body?:unknown,timeoutMs=30000,signal?:AbortSignal){
  return enrollmentRequest<T>("/api/verification",{method:body?"POST":"GET",...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})},
    {timeoutMs,signal,timeoutMessage:"Comparison settings timed out. The camera is off. Refresh status before trying again."});
}
const date=(value:string|null)=>value?new Date(value).toLocaleString():"—";
const canCompare=(value:VerificationState|null)=>Boolean(value?.configured&&value.ready);
export default function FaceComparison(){
  const [recordResearch,setRecordResearch]=useState(false),[labels,setLabels]=useState<ResearchLabels>(initialLabels),[observation,setObservation]=useState<Observation|null>(null);
  const [sessionId,setSessionId]=useState(""),[sessionAck,setSessionAck]=useState(false);
  const [padAck,setPadAck]=useState(false),[pairedResult,setPairedResult]=useState<{trialId:string;pad:PadScores}|null>(null);
  const [data,setData]=useState<VerificationState|null>(null),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [ack,setAck]=useState(false),[saving,setSaving]=useState(false),[capturing,setCapturing]=useState(false),[supported,setSupported]=useState(false);
  const [camera,setCamera]=useState<CameraState>({mode:"idle",message:"Camera is off.",promptPending:false});
  const video=useRef<HTMLVideoElement>(null),alert=useRef<HTMLDivElement>(null),preview=useRef<LocalCamera|null>(null);
  const mounted=useRef(false),epoch=useRef(0),loadSequence=useRef(0),changing=useRef(false),capturePending=useRef(false);
  const lifecycle=useRef<AbortController|null>(null),upload=useRef<AbortController|null>(null);
  const report=useCallback((result:ClientResult<unknown>)=>{
    if(result.ok||!mounted.current)return;
    if(result.kind!=="cancelled")setError(result.message);
    if(result.kind==="unauthorized")window.location.assign("/login");
  },[]);
  const load=useCallback(async(timeoutMs=30000)=>{
    const sequence=++loadSequence.current;
    const result=await api<VerificationState>(undefined,timeoutMs,lifecycle.current?.signal);
    if(!mounted.current||sequence!==loadSequence.current)return null;
    if(!result.ok){preview.current?.stop("Camera stopped because your consent could not be checked.");report(result);return null;}
    setData(result.value);
    setSessionId(previous=>result.value.sessions.some(s=>s.id===previous)?previous:"");
    setPairedResult(previous=>previous&&result.value.trials.some(t=>t.trial_id===previous.trialId)?previous:null);
    if(!canCompare(result.value))preview.current?.stop("Camera is off. Current enrollment and separate comparison consent are required.");
    return result.value;
  },[report]);
  useEffect(()=>{
    mounted.current=true;epoch.current++;changing.current=false;capturePending.current=false;setSaving(false);setCapturing(false);
    lifecycle.current=new AbortController();
    setSupported(Boolean(window.isSecureContext&&navigator.mediaDevices?.getUserMedia));
    preview.current=new LocalCamera({
      check:async()=>{const value=await load(8000);return {allowed:canCompare(value),revision:value?.preference?.revision??0,
        noticeVersion:(value?.notice.version??"unavailable")+":"+(value?.template?.template_id??"none"),
        expiresAt:Math.min(Date.parse(value?.preference?.expires_at??""),Date.parse(value?.template?.expires_at??""))};},
      getStream:()=>navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false}),
      attach:async stream=>{if(!video.current){if(stream)throw new Error("Preview unavailable.");return;}video.current.srcObject=stream;if(stream)await video.current.play();},
      visible:()=>document.visibilityState==="visible",state:value=>{if(mounted.current)setCamera(value);},
      gateHint:"Review your enrollment and separate comparison choice before starting the camera.",
      activeMessage:"Camera active. Capture only your own face. The preview stops within 60 seconds.",
    });
    void load();
    const hidden=()=>{if(document.visibilityState!=="visible"){preview.current?.stop("Camera stopped because this page was hidden.");upload.current?.abort();}};
    const leaving=()=>{preview.current?.stop("Camera stopped because you left this page.");upload.current?.abort();};
    document.addEventListener("visibilitychange",hidden);window.addEventListener("pagehide",leaving);
    return ()=>{mounted.current=false;epoch.current++;loadSequence.current++;lifecycle.current?.abort();upload.current?.abort();upload.current=null;
      preview.current?.dispose();preview.current=null;document.removeEventListener("visibilitychange",hidden);window.removeEventListener("pagehide",leaving);};
  },[load]);
  useEffect(()=>setAck(false),[data?.notice.version,data?.preference?.revision]);
  useEffect(()=>{if(error)alert.current?.scrollIntoView({block:"nearest",behavior:"smooth"});},[error]);
  async function change(action:"grantComparison"|"chooseManual"|"withdraw"|"clearTrials"){
    if(changing.current||!data)return;
    setObservation(null);setPairedResult(null);setPadAck(false);setSessionAck(false);preview.current?.stop("Camera is off while your choice is saved.");changing.current=true;
    const current=++epoch.current;upload.current?.abort();capturePending.current=false;setCapturing(false);setSaving(true);setError("");setMessage("");
    try{
      const result=await api(action==="grantComparison"?{action,acknowledged:ack,noticeVersion:data.notice.version,expectedRevision:data.preference?.revision??0}:{action},30000,lifecycle.current?.signal);
      if(!mounted.current||current!==epoch.current)return;
      if(!result.ok){report(result);await load();return;}
      setMessage(action==="grantComparison"?"Comparison consent saved. Start the camera when you are ready.":action==="clearTrials"?"Comparison results deleted and pending comparisons cancelled. Your enrollment template is still managed separately.":"Comparison disabled and active results deleted. Manage enrollment separately to delete your template.");
      await load();
    }catch{if(current===epoch.current&&mounted.current){setError("The choice result could not be confirmed. Refresh status before another action.");}}
    finally{if(current===epoch.current){changing.current=false;if(mounted.current)setSaving(false);}}
  }
  async function capture(){
    if(capturePending.current||changing.current||!video.current||camera.mode!=="active"||(sessionId&&!sessionAck))return;
    let pendingObservation:Observation|null=null;
    if(recordResearch){
      try{
        if(!padAck)throw Error("Choose paired PAD scoring for a labelled reliability attempt.");
        pendingObservation=validateObservation({schema:"attendai-observation-v1",id:crypto.randomUUID(),...labels,referenceSubjectId:labels.subjectId,
          capturedAt:new Date().toISOString(),modelVersion:MODEL_VERSION,outcome:"processing_failed",similarity:null,padV1:null,padV2:null});
      }catch(e){setError((e as Error).message);return;}
    }
    setObservation(pendingObservation);
    const usePad=padAck,boundSession=sessionId;setSessionAck(false);setPadAck(false);setPairedResult(null);
    capturePending.current=true;setCapturing(true);setError("");setMessage("");const current=++epoch.current;
    const controller=new AbortController();upload.current=controller;
    try{
      const fresh=await load(8000);if(current!==epoch.current||!mounted.current)return;
      if(!fresh||!canCompare(fresh)||document.visibilityState!=="visible"||controller.signal.aborted)throw new Error("Your consent could not be confirmed. Review your status before capturing.");
      const blob=await captureFrame(video.current!,controller.signal);preview.current?.stop("Camera is off while the captured frame is compared.");
      if(current!==epoch.current||controller.signal.aborted)return;
      const attempt=await api<{token:string}>(boundSession?{action:"beginSessionComparison",sessionId:boundSession,acknowledged:true,sessionNoticeVersion:"session-research-v1"}:{action:"beginComparison"},30000,controller.signal);
      if(current!==epoch.current||!mounted.current)return;
      if(!attempt.ok){report(attempt);await load();return;}
      // Once an upload starts, retain an explicit unsuccessful observation unless a paired result replaces it.
      if(pendingObservation)setObservation(pendingObservation);
      const result=await enrollmentRequest<{trial:Trial;evaluationOnly:true;attendanceChanged:false;pairedResearch?:{trialId:string;pad:PadScores}}>("/api/face-verify",{
        method:"POST",headers:{"Content-Type":"image/jpeg","X-AttendAI-Token":attempt.value.token,...(usePad?{"X-AttendAI-PAD-Research":PAD_NOTICE}:{})},body:blob},
        {signal:controller.signal,timeoutMs:45000,timeoutMessage:"The comparison result was not confirmed in time. Refresh status before another capture. Delete results or withdraw to remove a result that may have been saved."});
      if(current!==epoch.current||!mounted.current)return;
      if(!result.ok){
        if(pendingObservation)setObservation({...pendingObservation,outcome:result.kind==="timeout"?"timeout":"processing_failed"});
        report(result);await load();return;
      }
      if(pendingObservation&&result.value.pairedResearch){
        const scores=result.value.pairedResearch.pad.models;
        const row=validateObservation({...pendingObservation,outcome:"processed",capturedAt:result.value.trial.created_at,
          similarity:result.value.trial.similarity,padV1:scores.find(m=>m.model==="MiniFASNetV1SE.onnx")?.class1Score,
          padV2:scores.find(m=>m.model==="MiniFASNetV2.onnx")?.class1Score});
        if(result.value.trial.model_version!=="sface2021dec-yunet2023mar-v1"||result.value.pairedResearch.pad.version!=="attendai-pad-minifas-research-v1"||result.value.pairedResearch.trialId!==result.value.trial.trial_id)throw Error("Unexpected comparison model version.");
        setObservation(row);
      }
      if(result.value.pairedResearch)setPairedResult(result.value.pairedResearch);
      setMessage("Comparison saved. Review the experimental score below. Your attendance was unchanged.");await load();
    }catch(e){if(current===epoch.current&&mounted.current){preview.current?.stop();setError(e instanceof Error?e.message:"Comparison failed. Refresh your status.");await load();}}
    finally{if(current===epoch.current){capturePending.current=false;upload.current=null;if(mounted.current)setCapturing(false);}}
  }
  const allowed=canCompare(data),latest=data?.trials[0];
  return <div className="camera-content"><p className="eyebrow">CONTROLLED RESEARCH TRIAL</p><h1>Face comparison</h1>
    <p className="camera-intro">Compare a fresh capture with your own encrypted template. Scores help evaluate the prototype; this research comparison leaves attendance unchanged.</p>
    {error&&<div ref={alert} className="register-alert error" role="alert">{error}</div>}{message&&<div className="register-alert success" role="status">{message}</div>}
    {!data?<section className="panel camera-notice"><p>Loading your comparison settings…</p><button className="btn outline" onClick={()=>void load()}>Reload settings</button></section>:<>
      <section className="panel camera-notice"><div className="camera-heading"><div className="safety-icon"><ShieldCheck size={22}/></div><div><h2>{data.notice.title}</h2><span className="pill neutral">Separate comparison choice</span></div></div>
        {data.notice.body.split("\n\n").map((p,i)=><p key={i}>{p}</p>)}<p className="camera-version">Notice version: {data.notice.version}</p></section>
      {!data.student?<section className="panel camera-notice"><h2>Student link required</h2><p>Ask your administrator to link your account to your own student record.</p></section>:<div className="camera-grid">
        <section className="panel"><h2>Your comparison choice</h2><p className="note">{data.student.student_code} · {data.student.display_name}</p>
          <p><span className={`pill ${allowed?"success":"neutral"}`}>{allowed?"Ready for optional comparison":data.preference?.choice==="withdrawn"?"Comparison consent withdrawn":"Comparison unavailable"}</span></p>
          {!data.configured&&<p className="note">Complete the server comparison setup first. Withdrawal and result deletion remain available.</p>}
          {data.template?<p className="note">Your enrollment template is available until {date(data.template.expires_at)}.</p>:<p className="note">No current enrollment template is available. Voluntarily enroll your own face first.</p>}
          {data.preference?.expires_at&&<p className="note">Comparison choice expires: {date(data.preference.expires_at)}</p>}
          <Link className="text-link" href="/enrollment">Manage enrollment or delete my template →</Link>
          <label className="camera-ack"><input type="checkbox" checked={ack} disabled={saving||capturing||!data.student.is_active} onChange={e=>setAck(e.target.checked)}/><span>I have read this separate notice and voluntarily choose comparison using only my own face.</span></label>
          <div className="camera-choice-buttons"><button className="btn primary" disabled={saving||capturing||!ack||!data.configured||!data.template||!data.student.is_active} onClick={()=>void change("grantComparison")}>Grant comparison consent</button><button className="btn outline" disabled={saving} onClick={()=>void change("chooseManual")}>Use manual attendance</button></div>
          <button className="text-link" disabled={saving} onClick={()=>void change("withdraw")}>Withdraw comparison and delete results</button>
        </section>
        <section className="panel"><h2>Capture your own face</h2><p className="note">Use even light. Keep your full face visible and nobody else in the frame.</p>
          <label className="note">Optional attendance-session research rehearsal<select value={sessionId} disabled={saving||capturing||camera.mode==="active"} onChange={e=>{setSessionId(e.target.value);setSessionAck(false);}}><option value="">Comparison only — no session</option>{data.sessions.map(s=><option key={s.id} value={s.id}>{s.course_code} · {s.session_code} · {s.title}</option>)}</select></label>
          <p className="note">Only open sessions with your active enrollment, frozen roster membership and no existing attendance mark are listed. This is a rehearsal and cannot mark attendance. Staff-controlled open state determines availability; scheduled dates do not automatically open or close sessions.</p>
          {sessionId&&<label className="camera-ack"><input type="checkbox" checked={sessionAck} disabled={saving||capturing} onChange={e=>setSessionAck(e.target.checked)}/><span>For my next capture, I voluntarily link this comparison to the selected session. Its ID and notice version are retained with the attempt and comparison receipt. Research scores follow existing expiry/deletion rules; receipts remain. My attendance is unchanged. Notice: session-research-v1.</span></label>}
          <label className="camera-ack"><input type="checkbox" checked={padAck} disabled={saving||capturing} onChange={e=>setPadAck(e.target.checked)}/><span>For my next capture only, I voluntarily choose experimental PAD scoring on the same frame as my comparison. Both CPU models process my image; PAD scores are shown on this page and are not saved by the server. A separately selected research export can download them to your device. This does not prove liveness or mark attendance. Notice: {PAD_NOTICE}.</span></label>
          <label className="camera-ack"><input type="checkbox" checked={recordResearch} disabled={saving||capturing} onChange={e=>{setRecordResearch(e.target.checked);setObservation(null);}}/><span>Prepare a labelled research export for the next comparison. I will save failures as well as scores and use anonymous labels.</span></label>
          {recordResearch&&<ResearchLabelsForm value={labels} onChange={setLabels} disabled={saving||capturing}/>}
          <div className={`camera-preview ${camera.mode==="active"?"is-active":""}`}><video ref={video} muted autoPlay playsInline aria-label="Face comparison camera preview"/>{camera.mode!=="active"&&<div className="camera-placeholder"><CameraOff size={34}/><span>{capturing?"Processing your captured frame":camera.promptPending?"Waiting for camera permission":"Camera is off"}</span></div>}</div>
          <p className="camera-state" role="status">{capturing?"Comparing the captured frame. You can withdraw at any time.":camera.message}</p>
          <div className="camera-choice-buttons"><button className="btn outline" disabled={!supported||!allowed||saving||capturing||camera.promptPending||["active","checking","permission","validating"].includes(camera.mode)} onClick={()=>void preview.current?.start()}><Camera size={16}/> Start camera</button>
            <button className="btn outline" onClick={()=>preview.current?.stop()}>Stop camera</button><button className="btn primary" disabled={camera.mode!=="active"||saving||capturing||!allowed||Boolean(sessionId&&!sessionAck)} onClick={()=>void capture()}>Capture and compare</button></div>
          {!supported&&<p className="note">Camera access requires localhost or HTTPS and a browser with camera support.</p>}
          <p className="note">Start opens the preview only. Capture sends one frame and stops the camera. Stop camera stops the video stream. Withdraw cancels comparison permission and deletes active results.</p>
        </section></div>}
      <DownloadObservation row={observation}/>
      {pairedResult&&<section className="panel camera-notice"><h2>Paired PAD research result</h2><p>Comparison receipt: <span className="mono">{pairedResult.trialId}</span></p><p>Mean experimental class-1 score: <strong>{pairedResult.pad.meanClass1Score.toFixed(6)}</strong></p>{pairedResult.pad.models.map(m=><p key={m.model}>{m.model}: {m.class1Score.toFixed(6)}</p>)}<p>No calibrated decision. Attendance unchanged. A labelled export is a separate downloaded copy. Page scores disappear on refresh, the next capture, consent changes, or deletion of this comparison. Comparison quality gates still apply.</p></section>}
      <section className="panel camera-notice"><h2>Your recent comparison scores</h2><p>A cosine similarity score ranges from −1 to 1. A higher value means the two numerical features are more similar. It does not prove identity or liveness.</p>
        {latest&&<p><strong>Latest score: <span className="mono">{latest.similarity.toFixed(4)}</span></strong><br/><span className="note">Experimental · no decision threshold · attendance unchanged</span></p>}
        {data.trials.length?<div className="table-scroll"><table><thead><tr><th>CAPTURE TIME</th><th>SIMILARITY</th><th>RESULT EXPIRES</th><th>RESEARCH SESSION</th></tr></thead><tbody>{data.trials.map(trial=><tr key={trial.trial_id}><td>{date(trial.created_at)}</td><td className="mono">{trial.similarity.toFixed(4)}</td><td>{date(trial.expires_at)}</td><td className="mono">{trial.session_id??"Comparison only"}</td></tr>)}</tbody></table></div>:<p className="note">No active comparison scores. A new capture is always your choice.</p>}
        <p className="note">Latest 25 results. Results expire within seven days and may expire sooner with either consent or the reference template.</p>
        <button className="btn outline" disabled={saving} onClick={()=>void change("clearTrials")}>Delete comparison results</button>
      </section>
      <section className="panel camera-notice"><h2>Recent receipts</h2><p className="note">Latest 25 choice, comparison and deletion events. Receipts contain no images, features or scores.</p>
        {data.history.length?<ul className="receipt-list">{data.history.map(event=><li key={event.event_id}><strong>{event.event_type.replace(/_/g," ")}</strong><p>{date(event.occurred_at)} · Choice revision {event.choice_revision}{event.session_id&&<> · Session {event.session_id} · {event.session_notice_version}</>}</p></li>)}</ul>:<p className="note">No comparison events recorded.</p>}
        <button className="btn outline" disabled={saving||capturing} onClick={()=>void load()}>Refresh status</button>
      </section>
    </>}<Link className="text-link" href="/">Return to my attendance →</Link></div>;
}
