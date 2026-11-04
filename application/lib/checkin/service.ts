import type {Pool,PoolClient} from 'pg';
import type {Account} from '../auth/identity';
import {createHash,randomBytes} from 'node:crypto';
import {actorTransaction,identifier,RegisterError,publicRegisterError} from '../register/service.ts';
import {decryptFeature,MODEL_VERSION} from '../biometric/crypto.ts';
import {compareFeature} from '../verification/math.ts';
import {validatePad} from '../verification/paired.ts';
import {CHECKIN_NOTICE,CHECKIN_TEXT,POLICY_NOTICE,type CheckinResult} from './contracts.ts';

const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
async function lock(db:PoolClient,account:Account){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['biometric:'+account.id]);}
function studentOnly(account:Account){if(account.role!=='student')throw new RegisterError(403,'Only your linked student account can check in.');}
function tokenHash(token:string){if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new RegisterError(400,'Invalid check-in token.');return hash(token);}
function exact(body:Record<string,unknown>,keys:string[]){if(Object.keys(body).some(key=>!keys.includes(key)))throw new RegisterError(400,'Unexpected check-in field.');}
function revision(value:unknown){if(typeof value!=='number'||!Number.isInteger(value)||value<0)throw new RegisterError(400,'Invalid revision.');return value;}
function cutoff(value:unknown){if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1)throw new RegisterError(400,'Supply a numeric cutoff above zero and at most one.');return value;}

export async function readCheckin(pool:Pool,account:Account){
 return actorTransaction(pool,account,async db=>{
  if(account.role==='student')await db.query('SELECT attendai.purge_biometric_data()');
  const student=account.role==='student'?(await db.query('SELECT id,student_code,display_name,is_active FROM attendai.students WHERE user_id=$1',[account.id])).rows[0]??null:null;
  const choice=student?(await db.query('SELECT granted,notice_version,revision,expires_at FROM attendai.face_checkin_choices WHERE student_id=$1',[student.id])).rows[0]??null:null;
  const template=student?(await db.query(`SELECT template_id,expires_at FROM attendai.biometric_templates t WHERE student_id=$1
   AND expires_at>clock_timestamp() AND attendai.biometric_allowed(student_id,notice_version,choice_revision)`,[student.id])).rows[0]??null:null;
  const ready=Boolean(student?.is_active&&choice?.granted&&choice.notice_version===CHECKIN_NOTICE&&Date.parse(choice.expires_at)>Date.now()&&template);
  const sessions=(await db.query(`SELECT s.id,s.session_code,c.course_code,s.title,s.state,s.starts_at,s.ends_at,
   timing.enabled AS automation_enabled,timing.revision AS automation_revision,timing.review_reason AS automation_review_reason,timing.finalized_at,
   (SELECT count(*)::integer FROM attendai.session_automation_roster ar WHERE ar.session_id=s.id) AS automation_roster,
   p.revision,p.enabled,p.similarity_min,p.pad_min,p.late_after_minutes,
   (s.state='open' AND clock_timestamp()>=s.starts_at AND clock_timestamp()<s.ends_at) AS window_open
   FROM attendai.sessions s JOIN attendai.courses c ON c.id=s.course_id
   LEFT JOIN attendai.face_checkin_policies p ON p.session_id=s.id
   LEFT JOIN attendai.session_automation timing ON timing.session_id=s.id
   WHERE c.is_active AND (s.state IN ('scheduled','open') OR ($1::boolean AND timing.session_id IS NOT NULL)) AND
   ($1::boolean OR (p.enabled AND s.state='open' AND clock_timestamp()>=s.starts_at AND clock_timestamp()<s.ends_at
    AND EXISTS(SELECT 1 FROM attendai.enrollments e WHERE e.course_id=s.course_id AND e.student_id=$2 AND e.is_active)
    AND EXISTS(SELECT 1 FROM attendai.session_roster r WHERE r.session_id=s.id AND r.student_id=$2)
    AND NOT EXISTS(SELECT 1 FROM attendai.attendance_records a WHERE a.session_id=s.id AND a.student_id=$2)))
   ORDER BY s.starts_at DESC,s.id LIMIT 100`,[account.role!=='student',student?.id??null])).rows;
  const receipts=(await db.query(`SELECT r.receipt_id,s.session_code,r.decision,r.policy_revision,r.created_at,r.attendance_id
   FROM attendai.face_checkin_receipts r JOIN attendai.sessions s ON s.id=r.session_id
   ORDER BY r.created_at DESC,r.receipt_id DESC LIMIT 25`)).rows;
  const clock=(await db.query("SELECT last_tick_at,last_tick_at>clock_timestamp()-interval '60 seconds' AS healthy FROM attendai.class_clock_state WHERE singleton")).rows[0]??null;
  return {role:account.role,experimental:true as const,noticeVersion:CHECKIN_NOTICE,noticeText:CHECKIN_TEXT,student,choice,template,ready,sessions,receipts,clock};
 });
}
export async function mutateCheckin(pool:Pool,account:Account,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new RegisterError(400,'Use a JSON object.');
 const b=input as Record<string,unknown>;
 if(b.action==='configureSession'){
  if(!['admin','teacher'].includes(account.role))throw new RegisterError(403,'Staff manage the check-in policy.');
  exact(b,['action','sessionId','expectedRevision','enabled','similarityMin','padMin','lateAfterMinutes','acknowledgement','automate','expectedAutomationRevision','automationAcknowledgement']);
  const sessionId=identifier(b.sessionId,'session'),expected=revision(b.expectedRevision);
  if(typeof b.enabled!=='boolean'||!Number.isInteger(b.lateAfterMinutes)||Number(b.lateAfterMinutes)<0||Number(b.lateAfterMinutes)>120||
   b.enabled&&b.acknowledgement!==POLICY_NOTICE)throw new RegisterError(400,'Acknowledge the experimental policy and supply late minutes from zero to 120.');
  const identity=cutoff(b.similarityMin),pad=cutoff(b.padMin);
  if(b.automate!==undefined&&typeof b.automate!=='boolean')throw new RegisterError(400,'Choose whether to automate class timing.');
  if(b.automate===true&&(!b.enabled||b.automationAcknowledgement!=='class-automation-v1'))throw new RegisterError(400,'Acknowledge automatic class timing before enabling it.');
  const automationRevision=b.automate!==undefined?revision(b.expectedAutomationRevision):null;
  return actorTransaction(pool,account,async db=>{const result=(await db.query('SELECT attendai.set_face_checkin_policy($1,$2,$3,$4,$5,$6,$7) AS policy',
   [sessionId,expected,b.enabled,identity,pad,b.lateAfterMinutes,b.acknowledgement??null])).rows[0];
   if(b.automate!==undefined)result.automation=(await db.query('SELECT attendai.configure_session_automation($1,$2,$3,$4) AS automation',
    [sessionId,automationRevision,b.automate,b.automationAcknowledgement??null])).rows[0].automation;
   return result;});
 }
 studentOnly(account);
 if(b.action==='grantCheckin'||b.action==='withdrawCheckin'){
  exact(b,['action','expectedRevision','noticeVersion','acknowledged']);
  const expected=revision(b.expectedRevision),grant=b.action==='grantCheckin';
  if(b.noticeVersion!==CHECKIN_NOTICE||grant&&b.acknowledged!==true)throw new RegisterError(400,'Read and acknowledge the separate automatic check-in notice.');
  return actorTransaction(pool,account,async db=>(await db.query('SELECT attendai.choose_face_checkin($1,$2,$3,$4) AS choice',[grant,expected,CHECKIN_NOTICE,b.acknowledged===true])).rows[0]);
 }
 if(b.action==='beginCheckin'){
  exact(b,['action','sessionId']);const sessionId=identifier(b.sessionId,'session'),token=randomBytes(32).toString('base64url');
  return actorTransaction(pool,account,async db=>{const result=(await db.query('SELECT attendai.issue_face_checkin($1,$2) AS attempt',[hash(token),sessionId])).rows[0].attempt;
   return {token,...result};});
 }
 throw new RegisterError(400,'Unknown check-in action.');
}
export async function consumeCheckin(pool:Pool,account:Account,token:string){
 studentOnly(account);const tokenHashValue=tokenHash(token);
 await actorTransaction(pool,account,async db=>{await lock(db,account);await db.query('SELECT attendai.consume_face_checkin($1)',[tokenHashValue]);});
 return {tokenHash:tokenHashValue};
}
// Only the authenticated JPEG route calls this with output from the native
// engine. HTTP clients cannot supply a feature, a score or an accepted flag.
export async function finishCheckin(pool:Pool,account:Account,attempt:{tokenHash:string},probe:unknown,pad:unknown,key:Buffer,signal?:AbortSignal):Promise<CheckinResult>{
 studentOnly(account);const scores=validatePad(pad);
 const active=()=>{if(signal?.aborted)throw new RegisterError(409,'Check-in request cancelled. Refresh your attendance.');};active();
 return actorTransaction(pool,account,async db=>{
  await lock(db,account);active();
  const row=(await db.query('SELECT attendai.face_checkin_reference($1) AS reference',[attempt.tokenHash])).rows[0].reference;
  let plaintext:Buffer|undefined,ciphertext:Buffer|undefined,iv:Buffer|undefined;
  try{
   if(row.modelVersion!==MODEL_VERSION)throw new RegisterError(503,'The template model is incompatible. Attendance was not changed.');
   ciphertext=Buffer.from(row.ciphertext,'hex');iv=Buffer.from(row.iv,'hex');
   plaintext=decryptFeature(ciphertext,iv,key,{studentId:row.studentId,templateId:row.templateId,noticeVersion:row.noticeVersion,
    choiceRevision:row.templateChoiceRevision,modelVersion:row.modelVersion,keyId:row.keyId});
   const similarity=compareFeature(plaintext,probe);
   const first=scores.models.find(m=>m.model==='MiniFASNetV1SE.onnx')!.class1Score;
   const second=scores.models.find(m=>m.model==='MiniFASNetV2.onnx')!.class1Score;
   active();const result=(await db.query('SELECT attendai.finish_face_checkin($1,$2,$3,$4,$5) AS result',[attempt.tokenHash,similarity,first,second,MODEL_VERSION])).rows[0].result;
   active();return result;
  }finally{plaintext?.fill(0);ciphertext?.fill(0);iv?.fill(0);row.ciphertext='';row.iv='';}
 });
}
export function checkinError(error:unknown){
 if(error instanceof RegisterError)return {status:error.status,error:error.message};
 const db=error as {code?:string;message?:string};
 const safeMessages=['Check-in policy requires a scheduled or open session.','Check-in policy changed. Refresh first.',
  'Check-in choice changed. Refresh first.','Check-in unavailable: the class must be open and within its scheduled time.',
  'Automatic check-in is disabled or its policy changed.','Active course required.','Active class enrollment required.',
  'Frozen class roster membership required.','Attendance already exists. Ask staff for a correction.',
  'Current automatic check-in consent and enrollment template are required.','Five automatic check-in attempts are allowed per ten minutes.',
  'Check-in token expired, was cancelled or was already used.','Check-in token expired, was cancelled or was already completed.',
  'The check-in window has ended.'];
 safeMessages.push('Only scheduled or open classes can change automatic timing.','Class timing changed. Refresh first.',
  'Enable a face policy for a class whose end time is still ahead.','Enroll students before arming automatic class timing.','New check-ins require the class time window.');
 if(db?.code==='P0001'&&safeMessages.includes(db.message??''))return {status:db.message!.startsWith('Five automatic')?429:409,error:db.message!};
 if(db?.code==='22023')return {status:400,error:'Invalid check-in policy or server engine result.'};
 const safe=publicRegisterError(error);
 return safe.status===503?{status:503,error:'Automatic check-in is unavailable. Check migration 008, the dedicated CPU engine and the original encryption key. Refresh attendance before retrying.'}:safe;
}
