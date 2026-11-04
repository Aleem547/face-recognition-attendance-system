"use client";
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Camera,CameraOff} from 'lucide-react';
import {LocalCamera,type CameraState} from '@/lib/privacy/camera';
import {enrollmentRequest} from '@/lib/biometric/client';
import {createOneShotCheckin} from '@/lib/checkin/one-shot';
import {waitForPositioning} from '@/lib/checkin/positioning';
import {describeCheckinResult,receiptDecision,savedRegisterPath} from '@/lib/checkin/outcome';
import {captureFrame} from '@/lib/verification/capture';
import {CHECKIN_NOTICE,POLICY_NOTICE,type CheckinState,type CheckinSession,type CheckinResult} from '@/lib/checkin/contracts';

async function api<T>(body?:unknown,signal?:AbortSignal){
 const result=await enrollmentRequest<T>('/api/check-in',{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})},
  {signal,timeoutMs:15000,timeoutMessage:'Check-in settings could not be confirmed. Refresh attendance before retrying.'});
 if(!result.ok){if(result.kind==='unauthorized')window.location.assign('/login');throw new Error(result.message);}return result.value;
}
const date=(v:string)=>new Date(v).toLocaleString();
function eligible(data:CheckinState|null,session:string){return Boolean(data?.configured&&data.ready&&data.sessions.some(s=>s.id===session&&s.enabled&&s.window_open));}

export default function FaceCheckin(){
 const [data,setData]=useState<CheckinState|null>(null),[sessionId,setSessionId]=useState('');
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[ack,setAck]=useState(false),[supported,setSupported]=useState(false),[starting,setStarting]=useState(false);
 const [camera,setCamera]=useState<CameraState>({mode:'idle',message:'Camera is off.',promptPending:false});
 const [result,setResult]=useState<CheckinResult|null>(null);
 const [resultSession,setResultSession]=useState(''),[positionSeconds,setPositionSeconds]=useState(0);
 const video=useRef<HTMLVideoElement>(null),preview=useRef<LocalCamera|null>(null),selection=useRef('');
 const mounted=useRef(false),pending=useRef(false),sequence=useRef(0),epoch=useRef(0);
 const cameraMode=useRef<CameraState['mode']>('idle'),oneShot=useRef<ReturnType<typeof createOneShotCheckin>|null>(null),oneShotBusy=useRef(false),captureAction=useRef<()=>Promise<void>>(async()=>{});
 const lifetime=useRef<AbortController|null>(null),upload=useRef<AbortController|null>(null);
 const positioning=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{
  const request=++sequence.current,value=await api<CheckinState>(undefined,lifetime.current?.signal);
  if(!mounted.current||request!==sequence.current)return null;
  setData(value);
  if(!value.sessions.some(s=>s.id===selection.current)){selection.current=value.sessions[0]?.id??'';setSessionId(selection.current);}
  if(!eligible(value,selection.current)&&value.role==='student')preview.current?.stop('Check-in eligibility changed. Camera is off.');
  return value;
 },[]);
 useEffect(()=>{
  mounted.current=true;lifetime.current=new AbortController();
  setSupported(Boolean(window.isSecureContext&&navigator.mediaDevices?.getUserMedia));
  preview.current=new LocalCamera({
   check:async()=>{const value=await load(),s=value?.sessions.find(s=>s.id===selection.current);
    return {allowed:eligible(value,selection.current),revision:value?.choice?.revision??0,
     noticeVersion:[CHECKIN_NOTICE,value?.template?.template_id,s?.id,s?.revision].join(':'),
     expiresAt:Math.min(Date.parse(value?.choice?.expires_at??''),Date.parse(value?.template?.expires_at??''),Date.parse(s?.ends_at??''))};},
   getStream:()=>navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false}),
   attach:async stream=>{if(!video.current){if(stream)throw new Error('Preview unavailable.');return;}video.current.srcObject=stream;if(stream)await video.current.play();},
   visible:()=>document.visibilityState==='visible',state:value=>{cameraMode.current=value.mode;if(mounted.current)setCamera(value);},
   gateHint:'Select an eligible class and grant the separate check-in choice first.',
   activeMessage:'Preview active. Capture one frame to request automatic attendance. Camera stops within 60 seconds.'
  });
  const cameraReady=()=>mounted.current&&cameraMode.current==='active'&&document.visibilityState==='visible';
  oneShot.current=createOneShotCheckin({start:async()=>{setResult(null);setResultSession('');setMessage('');setError('');await preview.current?.start();},ready:cameraReady,
   prepare:async()=>{const controller=new AbortController();positioning.current=controller;
    try{await waitForPositioning({signal:controller.signal,ready:cameraReady,count:value=>{if(mounted.current)setPositionSeconds(value);}});}
    finally{if(positioning.current===controller)positioning.current=null;}},
   capture:()=>captureAction.current(),busy:value=>{oneShotBusy.current=value;if(mounted.current)setStarting(value);}});
  void load().catch(e=>{if(mounted.current)setError(e.message);});
  const refresh=setInterval(()=>{if(document.visibilityState==='visible'&&!pending.current&&!oneShotBusy.current&&cameraMode.current!=='permission')void load().catch(()=>{});},15000);
  const stop=()=>{oneShot.current?.cancel();positioning.current?.abort();preview.current?.stop('Camera stopped because this page was hidden or left.');upload.current?.abort();};
  const hidden=()=>{if(document.visibilityState!=='visible')stop();};
  window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',hidden);
  return ()=>{mounted.current=false;clearInterval(refresh);oneShot.current?.cancel();positioning.current?.abort();epoch.current++;sequence.current++;lifetime.current?.abort();upload.current?.abort();preview.current?.dispose();preview.current=null;
   window.removeEventListener('pagehide',stop);document.removeEventListener('visibilitychange',hidden);};
 },[load]);
 useEffect(()=>setAck(false),[data?.choice?.revision]);
 async function change(body:unknown,success:string){
  if(pending.current)return false;pending.current=true;setBusy(true);setError('');setMessage('');setResult(null);setResultSession('');oneShot.current?.cancel();positioning.current?.abort();preview.current?.stop();
  upload.current?.abort();const version=++epoch.current;
  try{await api(body,lifetime.current?.signal);if(!mounted.current||version!==epoch.current)return false;
   setMessage(success);await load();return true;
  }catch(e){if(mounted.current&&version===epoch.current){setError((e as Error).message);await load().catch(()=>{});}return false;}
  finally{if(version===epoch.current){pending.current=false;if(mounted.current)setBusy(false);}}
 }
 async function capture(){
  if(pending.current||cameraMode.current!=='active'||!video.current)return;
  pending.current=true;setBusy(true);setError('');setMessage('');setResult(null);setResultSession('');
  const controller=new AbortController(),version=++epoch.current,boundSession=selection.current;upload.current=controller;setResultSession(boundSession);
  try{
   const fresh=await load();if(!mounted.current||version!==epoch.current)return;
   if(!eligible(fresh,boundSession)||controller.signal.aborted||document.visibilityState!=='visible')throw new Error('Eligibility changed. Refresh your attendance.');
   const frame=await captureFrame(video.current!,controller.signal);
   preview.current?.stop('Camera is off while the captured frame is checked.');
   const attempt=await api<{token:string}>({action:'beginCheckin',sessionId:boundSession},controller.signal);
   if(controller.signal.aborted||!mounted.current||version!==epoch.current)return;
   const response=await enrollmentRequest<CheckinResult>('/api/face-checkin',{method:'POST',headers:{'Content-Type':'image/jpeg','X-AttendAI-Token':attempt.token},body:frame},
    {signal:controller.signal,timeoutMs:45000,timeoutMessage:'The check-in result was not confirmed. Refresh My attendance before retrying; the server may already have saved a mark.'});
   if(!mounted.current||version!==epoch.current)return;
   if(!response.ok)throw new Error(response.message);
   setResult(response.value);
   setResultSession(boundSession);
   await load().catch(()=>{if(mounted.current&&version===epoch.current)setError('The result was received, but the latest class list could not refresh. Open this class register to verify it.');});
  }catch(e){if(mounted.current&&version===epoch.current){preview.current?.stop();setError((e as Error).message);await load().catch(()=>{});}}
  finally{if(version===epoch.current){pending.current=false;upload.current=null;if(mounted.current)setBusy(false);}}
 }
 captureAction.current=capture;
 function select(value:string){oneShot.current?.cancel();positioning.current?.abort();preview.current?.stop('Camera stopped because the class changed.');upload.current?.abort();selection.current=value;setSessionId(value);setResult(null);setResultSession('');}
 const selected=data?.sessions.find(s=>s.id===sessionId),student=data?.role==='student',allowed=eligible(data,sessionId);
 const outcome=result?describeCheckinResult(result):null,registerPath=savedRegisterPath(resultSession||sessionId);
 return <div className="camera-content"><p className="eyebrow">EXPERIMENTAL AUTOMATIC ATTENDANCE</p><h1>Face check-in</h1>
  <p className="camera-intro">A qualifying capture can save your own Present or Late mark. Staff must enable the class and select its test policy. Face/PAD reliability remains unverified.</p>
  {error&&<div className="register-alert error" role="alert">{error}{registerPath&&<p><Link className="btn outline" href={registerPath}>Open this class register</Link></p>}</div>}{message&&<div className="register-alert success" role="status">{message}</div>}
  {outcome&&<section className={`register-alert ${outcome.tone}`} role="status" aria-live="polite"><strong>{outcome.title}</strong><p>{outcome.detail}</p>
   {outcome.arrivedAt&&<p>Server arrival: {date(outcome.arrivedAt)} · policy revision {result?.policyRevision}.</p>}
   {outcome.receiptId&&<p>Check-in receipt: <span className="mono">{outcome.receiptId}</span></p>}
   {registerPath&&<Link className="btn outline" href={registerPath}>Open this class register</Link>}{outcome.kind!=='saved'&&<Link className="btn outline" href="/verification">Open Face comparison</Link>}
  </section>}
  <button className="btn outline" disabled={busy||starting} onClick={()=>void load().catch(e=>setError(e.message))}>Refresh check-in status</button>{data&&<p className="note">Class clock: {data.clock?.healthy?"running":"not confirmed — keep the Face Recognition Attendance System server running"}. Status refreshes automatically.</p>}
  {!data?<section className="panel camera-notice"><p>Check-in settings have not loaded. If migrations 008/009 are missing, run the supplied setup command, then restart the app.</p></section>:<>
   <section className="panel camera-notice"><h2>{student?'Select your class':'Class check-in controls'}</h2>
    <label htmlFor="checkin-session">Class session<select id="checkin-session" value={sessionId} disabled={busy||starting||camera.promptPending} onChange={e=>select(e.target.value)}>
     <option value="">Select a class</option>{data.sessions.map(s=><option key={s.id} value={s.id}>{s.course_code} · {s.session_code} · {s.state}</option>)}
    </select></label><p className="note">Latest 100 eligible or manageable sessions. Automatic class timing opens attendance at the scheduled start and fills only remaining unmarked entries as Absent after the end and processing allowance. Manual classes can still be opened by staff. Existing marks are preserved.</p>
    {selected&&<><p>{selected.title} · {date(selected.starts_at)} – {date(selected.ends_at)}</p>
     <p className="note">{selected.enabled?`Enabled · policy revision ${selected.revision} · cosine ≥ ${selected.similarity_min} · EACH PAD score ≥ ${selected.pad_min} · late after ${selected.late_after_minutes} minutes.`:'Automatic check-in is disabled for this class.'}</p>
     {!selected.window_open&&<p className="note">The check-in time window is not open.</p>}
     {selected.automation_enabled&&<p className="note">Automatic class timing enabled{!student&&<> · fixed roster: {selected.automation_roster}</>}. {selected.automation_review_reason?`Staff review required: ${selected.automation_review_reason.replace(/_/g,' ')}. Automatic absences are paused.`:selected.state==='closed'?'This register is closed.':'The class clock will open and finalize this class.'}</p>}
     {selected.finalized_at&&<p className="note">Finalized {date(selected.finalized_at)}. Review the saved register and correction history.</p>}
     {!student&&['scheduled','open'].includes(selected.state)&&<PolicyForm key={selected.id+':'+selected.revision} session={selected} busy={busy||starting} onSave={body=>change(body,'The face policy and class timing were saved. The fixed class roster and timing status are shown above.')} />}
    </>}
    {!data.sessions.length&&<p className="note">{student?'No open, enabled class with your active enrollment, frozen roster entry and no existing attendance mark is available.':'Create a session in Class sessions first, using current start/end times, then enable its class timing here before the scheduled start.'}</p>}
   </section>
   {student&&<><section className="panel camera-notice"><h2>Your separate check-in choice</h2>
    {data.noticeText.split('\n\n').map((p,i)=><p key={i}>{p}</p>)}
    <p className="note">Notice: {data.noticeVersion}. {data.student?`${data.student.student_code} · ${data.student.display_name}`:'An active linked student account is required.'}</p>
    <p><span className="pill neutral">{data.choice?.granted&&data.choice.notice_version===data.noticeVersion?'Choice granted':data.choice?.granted?'Review the updated choice':'Choice not granted'}</span>{data.choice?.expires_at&&<> · expires {date(data.choice.expires_at)}</>}</p>
    {!data.template&&<p>No current template. <Link className="text-link" href="/enrollment">Manage face enrollment →</Link></p>}
    {!data.configured&&<p>The existing CPU/encryption setup is unavailable. The server must retain its original enrollment key.</p>}
    <label className="camera-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/><span>I voluntarily choose this experimental feature for my own face. I understand that it can create an attendance mark and that its spoof resistance is unverified.</span></label>
    <div className="camera-choice-buttons"><button className="btn primary" disabled={busy||!ack||!data.template||!data.student?.is_active||!data.configured} onClick={()=>void change({action:'grantCheckin',expectedRevision:data.choice?.revision??0,noticeVersion:CHECKIN_NOTICE,acknowledged:true},'Check-in choice saved. Select your class, then start the camera.')}>Grant check-in choice</button>
     <button className="btn outline" disabled={busy||!data.student} onClick={()=>void change({action:'withdrawCheckin',expectedRevision:data.choice?.revision??0,noticeVersion:CHECKIN_NOTICE,acknowledged:false},'Automatic check-in withdrawn. Saved attendance remains available to review with staff.')}>Withdraw check-in choice</button></div>
   </section>
   <section className="panel camera-notice"><h2>Check in with your camera</h2><p>Check in opens your camera, gives you three seconds to position your face, then sends one frame automatically. A qualifying match saves Present or Late immediately. The camera stops after this single attempt.</p><p>Use your own face only. A clear single-face frame must pass the existing image-quality checks. Both PAD outputs are required.</p>
    <div className={`camera-preview ${camera.mode==='active'?'is-active':''}`}><video ref={video} muted autoPlay playsInline aria-label="Automatic check-in camera preview"/>{camera.mode!=='active'&&<div className="camera-placeholder"><CameraOff size={34}/><span>{busy?'Processing or checking settings':'Camera is off'}</span></div>}</div>
    <p className="camera-state" role="status">{positionSeconds>0?`Automatic capture in ${positionSeconds} seconds. Keep your face centred and this tab visible.`:busy?'Checking the captured frame. Wait for the saved result or rejection reason.':camera.message}</p>
    {outcome&&<div className={`register-alert ${outcome.tone}`} role="status"><strong>{outcome.title}</strong><p>{outcome.detail}</p>{registerPath&&<Link className="btn outline" href={registerPath}>Open this class register</Link>}</div>}
    <div className="camera-choice-buttons">
     <button className="btn primary" disabled={!allowed||!supported||busy||starting||camera.promptPending||['checking','permission','validating'].includes(camera.mode)} onClick={()=>void oneShot.current?.run().catch(e=>{if(mounted.current&&e.name!=='AbortError')setError(e.message);})}><Camera size={16}/> {positionSeconds>0?`Capture in ${positionSeconds}…`:busy?'Checking…':'Check in with camera'}</button>
     <button className="btn outline" disabled={!allowed||!supported||busy||starting||camera.promptPending||['active','checking','permission','validating'].includes(camera.mode)} onClick={()=>void preview.current?.start()}>Preview only</button>
     <button className="btn outline" onClick={()=>{oneShot.current?.cancel();positioning.current?.abort();preview.current?.stop();upload.current?.abort();}}>Stop / cancel</button>
    </div><p className="note">No repeated upload or automatic retry. A failed attempt leaves the entry unmarked now. In an automatically timed class, an entry still unmarked at finalization becomes Absent; ask staff to review a failed check. If the result is uncertain, inspect My attendance before another attempt.</p>
    {result&&<p>Receipt <span className="mono">{result.receiptId}</span> · {result.decision.replace(/_/g,' ')} · policy revision {result.policyRevision}.</p>}
   </section></>}
   <section className="panel camera-notice"><h2>Recent check-in receipts</h2><p className="note">Latest 25 permitted receipts. Images, features and numerical face/PAD scores are not retained by check-in.</p>
    {data.receipts.length?<ul className="receipt-list">{data.receipts.map(r=><li key={r.receipt_id}><strong>{r.session_code} · {receiptDecision(r.decision)}</strong><p>{date(r.created_at)} · policy {r.policy_revision} · {r.attendance_id?'Attendance created':'No attendance created'}</p><small>{r.receipt_id}</small></li>)}</ul>:<p>No check-in receipts yet.</p>}
   </section>
  </>}<Link className="btn outline" href="/">Return to attendance</Link></div>;
}
function PolicyForm({session,busy,onSave}:{session:CheckinSession;busy:boolean;onSave:(body:unknown)=>Promise<boolean>}){
 const [ack,setAck]=useState(false),[automate,setAutomate]=useState(session.automation_enabled??false);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const values=new FormData(e.currentTarget);
  await onSave({action:'configureSession',sessionId:session.id,expectedRevision:session.revision??0,enabled:true,
   similarityMin:Number(values.get('identity')),padMin:Number(values.get('pad')),lateAfterMinutes:Number(values.get('late')),acknowledgement:POLICY_NOTICE,automate,expectedAutomationRevision:session.automation_revision??0,automationAcknowledgement:'class-automation-v1'});}
 return <form className="register-form" onSubmit={submit}><fieldset disabled={busy}><p className="note">Choose a policy for a controlled prototype test. There is no validated cutoff supplied by this update. Higher scores are not probabilities; these fields cannot establish spoof resistance.</p>
  <div className="register-fields"><label>Minimum face cosine<input name="identity" type="number" min="0.000001" max="1" step="any" required defaultValue={session.similarity_min??''}/></label>
   <label>Minimum for EACH PAD model<input name="pad" type="number" min="0.000001" max="1" step="any" required defaultValue={session.pad_min??''}/></label>
   <label>Late after minutes<input name="late" type="number" min="0" max="120" step="1" required defaultValue={session.late_after_minutes??15}/></label></div>
  <label className="camera-ack"><input type="checkbox" checked={automate} onChange={e=>setAutomate(e.target.checked)}/><span>Automatically open this class at its start, then mark remaining unmarked roster entries Absent and close it after its end plus a 30-second processing allowance. Enabling this freezes the class list now. Keep the server running; detected clock gaps pause automatic absences for staff review.</span></label>
  <p className="note">With a 15-minute late cutoff: Present before {new Date(Date.parse(session.starts_at)+15*60000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}; Late at or after it. The server arrival time determines lateness.</p>
  <label className="camera-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/><span>I choose these explicit test cutoffs and understand that automated marks may be wrong. I will review the test register and keep staff correction/manual attendance available.</span></label>
  <div className="camera-choice-buttons"><button className="btn primary" disabled={!ack}>Save face policy & class timing</button>
   {session.enabled&&<button className="btn outline" type="button" onClick={()=>void onSave({action:'configureSession',sessionId:session.id,expectedRevision:session.revision??0,enabled:false,automate:false,expectedAutomationRevision:session.automation_revision??0,
    similarityMin:session.similarity_min,padMin:session.pad_min,lateAfterMinutes:session.late_after_minutes})}>Disable check-in</button>}
  </div></fieldset></form>;
}
