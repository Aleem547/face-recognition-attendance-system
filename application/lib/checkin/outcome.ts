// A detected face or a completed request is not evidence of saved attendance.
// Only a consistent successful server result may render a Present/Late success.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function selectedSessionId(value:unknown):string{return typeof value==='string'&&uuid.test(value)?value:'';}
export function savedRegisterPath(value:unknown):string|null{
 const id=selectedSessionId(value);return id?'/?session='+encodeURIComponent(id):null;
}
export function receiptDecision(decision:string):string{
 if(decision==='accepted')return 'Attendance saved';
 if(decision==='identity_below_threshold')return 'Face match below class cutoff';
 if(decision==='pad_below_threshold')return 'PAD below class cutoff';
 return 'Result not confirmed';
}
export type CaptureOutcome={kind:'saved'|'identity_rejected'|'pad_rejected'|'unconfirmed';
 tone:'success'|'warning';title:string;detail:string;receiptId:string|null;arrivedAt:string|null};
export function describeCheckinResult(input:unknown):CaptureOutcome{
 const uncertain:CaptureOutcome={kind:'unconfirmed',tone:'warning',title:'Attendance result could not be confirmed.',
  detail:'Open this class register before another attempt. A lost or incomplete response does not prove that nothing was saved.',receiptId:null,arrivedAt:null};
 if(!input||typeof input!=='object')return uncertain;
 const r=input as Record<string,unknown>;
 if(!selectedSessionId(r.receiptId)||r.experimental!==true||!Number.isInteger(r.policyRevision)||Number(r.policyRevision)<1)return uncertain;
 const receiptId=r.receiptId as string;
 const arrivedAt=typeof r.arrivedAt==='string'&&Number.isFinite(Date.parse(r.arrivedAt))?r.arrivedAt:null;
 if(r.decision==='accepted'&&r.attendanceChanged===true&&r.attendance&&typeof r.attendance==='object'){
  const mark=r.attendance as Record<string,unknown>;
  if(selectedSessionId(mark.id)&&['present','late'].includes(String(mark.status))&&mark.method==='experimental_face'&&
   Number.isInteger(mark.revision)&&Number(mark.revision)>0&&typeof mark.updatedAt==='string'&&Number.isFinite(Date.parse(mark.updatedAt))){
   return {kind:'saved',tone:'success',title:'Attendance saved: '+(mark.status==='late'?'Late':'Present'),
    detail:'The server confirmed a saved experimental face check-in. Open this class register to inspect its status, method and receipt.',receiptId,arrivedAt};
  }
 }
 if(r.attendanceChanged===false&&r.attendance===null){
  if(r.decision==='identity_below_threshold')return {kind:'identity_rejected',tone:'warning',title:'Attendance not saved: face match below the class cutoff.',
   detail:'This capture did not match the enrolled reference strongly enough for the selected policy. Use Face comparison to inspect your reference and current scores. No Present or Late mark was created by this attempt.',receiptId,arrivedAt};
  if(r.decision==='pad_below_threshold')return {kind:'pad_rejected',tone:'warning',title:'Attendance not saved: PAD below the class cutoff.',
   detail:'At least one PAD model scored below the selected policy. A genuine face can fail this unvalidated check. Use Face comparison to inspect the scores; this result is not proof of a fake face. No Present or Late mark was created by this attempt.',receiptId,arrivedAt};
 }
 return {...uncertain,receiptId,arrivedAt};
}
