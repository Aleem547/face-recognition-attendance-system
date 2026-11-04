'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {projectFace,studentLabel,type StudentLabel} from '@/lib/camera-overlay/geometry';
import {FaceTracker,type GuideState} from '@/lib/camera-overlay/tracker';
const previews=new Set(['Automatic check-in camera preview','Face enrollment camera preview','Face comparison camera preview']);
type Target={video:HTMLVideoElement;parent:HTMLElement;active:boolean};
function FaceGuide({target,label}:{target:Target;label:StudentLabel|null}){
 const [guide,setGuide]=useState<GuideState>({mode:'off',boxes:[]}),[size,setSize]=useState({width:0,height:0,videoWidth:0,videoHeight:0});
 useEffect(()=>{
  if(!target.active)return;
  const video=target.video,parent=target.parent,canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  const active=()=>!document.hidden&&video.isConnected&&parent.classList.contains('is-active')&&Boolean(video.srcObject);
  const resize=()=>{setSize({width:parent.clientWidth,height:parent.clientHeight,videoWidth:video.videoWidth,videoHeight:video.videoHeight});};
  const tracker=new FaceTracker({worker:()=>new Worker('/attendai-face-overlay/detector-worker.js'),active,state:setGuide,pixels:()=>{
   if(!context||video.readyState<2||!video.videoWidth||!video.videoHeight)return null;
   resize();const scale=Math.min(1,320/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
   context.drawImage(video,0,0,canvas.width,canvas.height);return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data.buffer as ArrayBuffer};
  }});
  const observer=new ResizeObserver(resize);observer.observe(parent);resize();
  const changed=()=>{if(document.hidden)tracker.stop();else if(active())tracker.start();};
  const stopped=()=>tracker.stop();document.addEventListener('visibilitychange',changed);window.addEventListener('pagehide',stopped);video.addEventListener('loadeddata',changed);video.addEventListener('emptied',stopped);tracker.start();
  return()=>{tracker.dispose();observer.disconnect();document.removeEventListener('visibilitychange',changed);window.removeEventListener('pagehide',stopped);video.removeEventListener('loadeddata',changed);video.removeEventListener('emptied',stopped);canvas.width=0;canvas.height=0;};
 },[target.video,target.parent,target.active]);
 if(!target.active||guide.mode==='off')return null;
 const multiple=guide.mode==='multiple',checkin=target.video.getAttribute('aria-label')==='Automatic check-in camera preview';
 const caption=guide.mode==='loading'?'Finding your face…':guide.mode==='unavailable'?'Face guide unavailable · camera controls remain available':multiple?'More than one face · keep only your face in view':guide.mode==='noface'?'Face guide · look toward the camera':checkin?'Positioning guide · check your saved result after capture':'Face guide · signed-in student preview';
 return createPortal(<div className="face-guide-overlay" aria-label="Camera face positioning guide">
  {guide.boxes.map((box,index)=>{const position=projectFace(box,size.videoWidth,size.videoHeight,size.width,size.height,true);return position&&<div key={index} className={`face-guide-box${multiple?' is-multiple':''}`} style={{left:position.x,top:position.y,width:position.width,height:position.height}}>
   {!multiple&&<span className="face-guide-name" style={{maxWidth:Math.min(260,size.width-16),left:Math.max(8-position.x,Math.min(8,size.width-position.x-Math.min(260,size.width-16)-8)),...(position.y<60?{top:8,bottom:'auto'}:{})}}><i/><span><strong>{label?.name??'Face detected'}</strong><small>{label?`${label.code} · Signed-in student`:'Positioning guide'}</small></span></span>}
  </div>;})}
  <span className={`face-guide-caption${multiple?' is-multiple':''}`} role="status">{caption}</span>
 </div>,target.parent);
}
export default function CameraFaceOverlay(){
 const [targets,setTargets]=useState<Target[]>([]),[label,setLabel]=useState<StudentLabel|null>(null);
 useEffect(()=>{
  const discover=()=>{
   const next=Array.from(document.querySelectorAll<HTMLVideoElement>('.camera-preview video')).filter(video=>previews.has(video.getAttribute('aria-label')??'')).map(video=>({video,parent:video.parentElement!,active:video.parentElement!.classList.contains('is-active')}));
   setTargets(old=>old.length===next.length&&old.every((v,i)=>v.video===next[i].video&&v.parent===next[i].parent&&v.active===next[i].active)?old:next);
  };
  const observer=new MutationObserver(discover);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});discover();return()=>observer.disconnect();
 },[]);
 const present=targets.length>0;
 useEffect(()=>{
  if(!present){setLabel(null);return;}
  let alive=true,request:AbortController|null=null;
  const load=async()=>{
   request?.abort();if(document.hidden){setLabel(null);return;}const controller=new AbortController();request=controller;const timeout=setTimeout(()=>controller.abort(),8000);
   try{const response=await fetch('/api/check-in',{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});const value=response.ok?studentLabel(await response.json()):null;if(alive&&request===controller)setLabel(value);}
   catch{if(alive&&request===controller)setLabel(null);}finally{clearTimeout(timeout);}
  };
  void load();const timer=setInterval(()=>void load(),10000),visibility=()=>void load();document.addEventListener('visibilitychange',visibility);
  return()=>{alive=false;request?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
 },[present]);
 return <>{targets.map((target,index)=><FaceGuide key={index} target={target} label={label}/>)}</>;
}
