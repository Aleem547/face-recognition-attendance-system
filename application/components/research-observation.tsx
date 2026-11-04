"use client";
import type {Observation} from '@/lib/evaluation/reliability';
export type ResearchLabels=Pick<Observation,'split'|'subjectId'|'sessionId'|'referenceSessionId'|'cameraId'|'lighting'|'presentation'|'attackInstrumentId'>;
export const initialLabels:ResearchLabels={split:'development',subjectId:'',sessionId:'',referenceSessionId:'',cameraId:'',lighting:'normal',presentation:'genuine',attackInstrumentId:null};
export function ResearchLabelsForm({value,onChange,disabled}:{value:ResearchLabels;onChange:(value:ResearchLabels)=>void;disabled:boolean}){
  const field=(key:'subjectId'|'sessionId'|'referenceSessionId'|'cameraId',label:string)=><label className="register-select-label">{label}<input maxLength={64} pattern="[A-Za-z0-9_-]+" value={value[key]} disabled={disabled} onChange={event=>onChange({...value,[key]:event.target.value})}/></label>;
  return <fieldset disabled={disabled}><legend>Optional labelled reliability export</legend>
    <p className="note">Use anonymous IDs, your own face/images and separate enrollment/probe sessions. Labels describe what you actually present. Select them before capture. No image or embedding is exported. Save every attempted presentation, including failures, once only. Keep evaluation participants separate from development.</p>
    <label className="register-select-label">Split<select value={value.split} onChange={e=>onChange({...value,split:e.target.value as Observation['split']})}><option value="development">Development — calibration only</option><option value="evaluation">Untouched evaluation</option></select></label>
    {field('subjectId','Anonymous participant ID, e.g. P01')}{field('referenceSessionId','Enrollment session ID, e.g. P01_enroll')}{field('sessionId','Probe session ID, e.g. P01_day2')}{field('cameraId','Camera ID, e.g. laptop_cam')}
    <label className="register-select-label">Lighting<select value={value.lighting} onChange={e=>onChange({...value,lighting:e.target.value as Observation['lighting']})}><option value="normal">Normal</option><option value="dim">Dim</option><option value="backlit">Backlit</option></select></label>
    <label className="register-select-label">Actual presentation<select value={value.presentation} onChange={e=>{const presentation=e.target.value as Observation['presentation'];onChange({...value,presentation,attackInstrumentId:presentation==='genuine'?null:value.attackInstrumentId??''});}}><option value="genuine">My genuine face</option><option value="printed_photo">Printed photo of my face</option><option value="phone_photo">Phone photo of my face</option><option value="video_replay">Video replay of my face</option></select></label>
    {value.presentation!=='genuine'&&<label className="register-select-label">Attack instrument ID<input maxLength={64} value={value.attackInstrumentId??''} onChange={e=>onChange({...value,attackInstrumentId:e.target.value})}/></label>}
    <p className="note">Impostor comparisons require a separately consented offline study; this own-account page cannot establish false-match reliability. Exports contain research scores and anonymous labels: keep them private and remove them when your study ends.</p>
  </fieldset>;
}
export function DownloadObservation({row}:{row:Observation|null}){
  if(!row)return null;
  function download(){if(!row)return;const url=URL.createObjectURL(new Blob([JSON.stringify(row,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Face_Recognition_Attendance_System_'+row.split+'_'+row.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="panel camera-notice"><h2>Labelled attempt ready to save</h2><p>{row.presentation} · {row.outcome} · {row.split} · {row.subjectId}</p><button className="btn outline" onClick={download}>Download this attempt JSON</button><p className="note">Download before your next capture or leaving the page. This file is not automatically saved. Preserve failed attempts too. Its labels are operator-reported and cannot prove liveness.</p></section>;
}
