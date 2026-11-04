'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {captureFrame} from '@/lib/verification/capture';
import {LiveLoop,LiveFrameError,type LiveBegin,type LiveScore,type LiveView} from '@/lib/live-comparison/client';
const NOTICE='own-live-comparison-2026-11-04';
type Target={video:HTMLVideoElement;preview:HTMLElement;anchor:HTMLElement;active:boolean};
async function request<T>(body:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch('/api/live-comparison',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(8000),keepalive:!signal});
 const value=await response.json();if(!response.ok)throw Error(value.error??'Live comparison could not start.');return value;
}
function Controls({target}:{target:Target}){
 const [ack,setAck]=useState(false),[view,setView]=useState<LiveView>({mode:'idle',score:null,message:'Start the camera preview, then choose live comparison.'}),loop=useRef<LiveLoop|null>(null);
 useEffect(()=>{
  const video=target.video,preview=target.preview;
  const allowed=()=>document.visibilityState==='visible'&&video.isConnected&&preview.classList.contains('is-active')&&Boolean(video.srcObject)&&video.readyState>=2;
  const runner=new LiveLoop({allowed,changed:setView,
   begin:signal=>request<LiveBegin>({action:'start',acknowledged:true,noticeVersion:NOTICE},signal),
   capture:signal=>captureFrame(video,signal),
   frame:async(token,blob,signal)=>{
    const response=await fetch('/api/live-comparison',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'image/jpeg','X-AttendAI-Live-Token':token},body:blob,signal:AbortSignal.any([signal,AbortSignal.timeout(35000)])});
    const result=await response.json();if(!response.ok)throw new LiveFrameError(result.error??'Live comparison stopped.',result.retryable===true);return result as LiveScore;
   },end:token=>request({action:'stop',token})
  });loop.current=runner;
  const hidden=()=>{if(document.hidden)runner.stop('Live comparison stopped because the page was hidden.');};
  const leaving=()=>runner.stop('Live comparison stopped.');
  const manual=(event:MouseEvent)=>{const button=(event.target as Element|null)?.closest('button');if(button&&!target.anchor.contains(button)&&/^(Stop camera|Capture and compare|Grant comparison consent|Use manual attendance|Withdraw comparison and delete results|Delete comparison results)$/.test(button.textContent?.trim()??''))runner.stop('Live comparison stopped for your selected action.');};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leaving);document.addEventListener('click',manual,true);video.addEventListener('emptied',leaving);
  return()=>{runner.dispose();loop.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leaving);document.removeEventListener('click',manual,true);video.removeEventListener('emptied',leaving);};
 },[target.video,target.preview,target.anchor]);
 useEffect(()=>{if(!target.active)loop.current?.stop('Camera is off. Start the preview before live comparison.');},[target.active]);
 const running=view.mode==='starting'||view.mode==='live';
 return <section className={`live-comparison-card${running?' is-running':''}`} aria-label="Live own-face comparison">
  <div className="live-comparison-heading"><div><h3>Live comparison</h3><p>Compare with your own saved template while the camera stays on.</p></div><span className="live-comparison-pill">{running?'LIVE':'Optional'}</span></div>
  <div className="live-comparison-score"><output aria-label="Live similarity score">{view.score?view.score.similarity.toFixed(4):'—'}</output><div><strong>Experimental similarity</strong><small>{view.score?`Updated ${new Date(view.score.processedAt).toLocaleTimeString()} · frame ${view.score.frame}`:'Waiting for a live frame'}</small></div></div>
  <p className="live-comparison-status" role="status">{view.message}</p>
  <label className="camera-ack live-comparison-ack"><input type="checkbox" checked={ack} disabled={running} onChange={event=>setAck(event.target.checked)}/><span>For this run, I choose to send repeated frames of my own face to Face Recognition Attendance System for up to 60 seconds. Live scores stay on this page and are not saved. No PAD or attendance decision is made.</span></label>
  <div className="camera-choice-buttons"><button className="btn primary" disabled={!ack||!target.active||running} onClick={()=>{setAck(false);void loop.current?.start();}}>Start live comparison</button><button className="btn outline" disabled={!running} onClick={()=>loop.current?.stop()}>Stop live comparison</button></div>
  <p className="live-comparison-footnote">Start camera opens the preview. Start live comparison begins repeated comparison. Capture and compare still saves one manual result. Up to five live or manual runs are available per ten minutes.</p>
 </section>;
}
export default function CameraLiveComparison(){
 const [target,setTarget]=useState<Target|null>(null);
 useEffect(()=>{
  let current:Target|null=null;
  const discover=()=>{
   const video=document.querySelector<HTMLVideoElement>('.camera-preview video[aria-label="Face comparison camera preview"]');
   if(!video||!video.parentElement){if(current){current.anchor.remove();current=null;setTarget(null);}return;}
   const preview=video.parentElement,active=preview.classList.contains('is-active');
   if(current?.video===video&&current.anchor.isConnected){if(current.active!==active){current={...current,active};setTarget(current);}return;}
   current?.anchor.remove();const anchor=document.createElement('div');anchor.className='live-comparison-anchor';preview.insertAdjacentElement('afterend',anchor);current={video,preview,anchor,active};setTarget(current);
  };
  const observer=new MutationObserver(discover);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});discover();return()=>{observer.disconnect();current?.anchor.remove();};
 },[]);
 return target?createPortal(<Controls target={target}/>,target.anchor):null;
}
