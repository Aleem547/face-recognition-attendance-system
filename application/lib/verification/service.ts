import type {Pool,PoolClient} from "pg";
import type {Account} from "../auth/identity";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {actorTransaction,identifier,RegisterError,publicRegisterError} from "../register/service.ts";
import {decryptFeature,MODEL_VERSION} from "../biometric/crypto.ts";
import {compareFeature} from "./math.ts";
function studentOnly(account:Account){if(account.role!=="student")throw new RegisterError(403,"Only your linked student account can use this comparison trial.");}
async function lock(db:PoolClient,account:Account){await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["biometric:"+account.id]);}
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
async function purge(db:PoolClient){await db.query("SELECT attendai.purge_biometric_data()");await db.query("SELECT attendai.purge_verification_data()");}
async function state(db:PoolClient,account:Account){
  const notice=(await db.query("SELECT version,purpose,title,body FROM attendai.verification_notices WHERE is_current")).rows[0];
  if(!notice)throw new RegisterError(503,"The comparison notice is unavailable. The camera stays disabled.");
  const student=(await db.query("SELECT id,student_code,display_name,is_active FROM attendai.students WHERE user_id=$1",[account.id])).rows[0]??null;
  if(!student)return {notice,student:null,preference:null,template:null,ready:false};
  const preference=(await db.query(`SELECT choice,revision,notice_version,decided_at,expires_at,
    attendai.verification_allowed(student_id,notice_version,revision) AS allowed FROM attendai.verification_choices WHERE student_id=$1`,[student.id])).rows[0]
    ??{choice:"not_recorded",revision:0,notice_version:null,decided_at:null,expires_at:null,allowed:false};
  const template=(await db.query(`SELECT template_id,model_version,created_at,expires_at FROM attendai.biometric_templates
    WHERE student_id=$1 AND expires_at>clock_timestamp() AND attendai.biometric_allowed(student_id,notice_version,choice_revision)`,[student.id])).rows[0]??null;
  return {notice,student,preference,template,ready:Boolean(preference.allowed&&template&&student.is_active)};
}
export async function readVerification(pool:Pool,account:Account){
  studentOnly(account);
  return actorTransaction(pool,account,async db=>{
    await purge(db);const current=await state(db,account);
    const trials=current.student?(await db.query(`SELECT trial_id,similarity,model_version,created_at,expires_at,session_id FROM attendai.verification_trials
      WHERE student_id=$1 ORDER BY created_at DESC,trial_id DESC LIMIT 25`,[current.student.id])).rows:[];
    const history=current.student?(await db.query(`SELECT event_id::text,event_type,notice_version,choice_revision,occurred_at,session_id,session_notice_version
      FROM attendai.verification_events v WHERE v.student_id=$1 ORDER BY v.event_id DESC LIMIT 25`,[current.student.id])).rows:[];
    const sessions=current.student?(await db.query(`SELECT s.id,s.session_code,s.title,c.course_code FROM attendai.sessions s
      JOIN attendai.courses c ON c.id=s.course_id JOIN attendai.enrollments e ON e.course_id=c.id
      JOIN attendai.session_roster r ON r.session_id=s.id AND r.student_id=e.student_id
      WHERE e.student_id=$1 AND e.is_active AND c.is_active AND s.state='open' AND $2::boolean
      AND NOT EXISTS(SELECT 1 FROM attendai.attendance_records a WHERE a.session_id=s.id AND a.student_id=e.student_id)
      ORDER BY s.starts_at DESC,s.id LIMIT 100`,[current.student.id,current.student.is_active])).rows:[];
    return {...current,trials,history,sessions};
  });
}
export async function mutateVerification(pool:Pool,account:Account,input:unknown){
  studentOnly(account);
  if(!input||typeof input!=="object"||Array.isArray(input))throw new RegisterError(400,"Use a JSON object.");
  const body=input as Record<string,unknown>,action=body.action;
  if(typeof action!=="string"||!["grantComparison","chooseManual","withdraw","clearTrials","beginComparison","beginSessionComparison"].includes(action))throw new RegisterError(400,"Unknown comparison action.");
  const fields=action==="grantComparison"?["action","acknowledged","noticeVersion","expectedRevision"]:action==="beginSessionComparison"?["action","sessionId","acknowledged","sessionNoticeVersion"]:["action"];
  if(Object.keys(body).some(k=>!fields.includes(k)))throw new RegisterError(400,"Unexpected comparison field.");
  const sessionId=action==="beginSessionComparison"?identifier(body.sessionId,"session"):null;
  if(sessionId&&(body.acknowledged!==true||body.sessionNoticeVersion!=="session-research-v1"))throw new RegisterError(400,"Read and acknowledge the current session research notice.");
  return actorTransaction(pool,account,async db=>{
    await lock(db,account);await purge(db);const current=await state(db,account),{student,preference,notice}=current;
    if(!student||!preference)throw new RegisterError(403,"A linked student account is required.");
    if(action==="beginComparison"||action==="beginSessionComparison"){
      if(!current.ready)throw new RegisterError(403,"Current enrollment, a saved template, and separate comparison consent are required.");
      const token=randomBytes(32).toString("base64url");
      const row=(await db.query(`INSERT INTO attendai.verification_attempts(token_hash,student_id,notice_version,choice_revision,reference_template_id,session_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING expires_at,session_id`,[hash(token),student.id,notice.version,preference.revision,current.template.template_id,sessionId])).rows[0];
      return {token,expiresAt:row.expires_at,sessionId:row.session_id};
    }
    if(action==="clearTrials"){
      await db.query("UPDATE attendai.verification_attempts SET cancelled_at=clock_timestamp() WHERE student_id=$1 AND cancelled_at IS NULL",[student.id]);
      const removed=await db.query("DELETE FROM attendai.verification_trials WHERE student_id=$1",[student.id]);return {deleted:removed.rowCount??0};
    }
    const choice=action==="grantComparison"?"granted":action==="withdraw"?"withdrawn":"manual";
    if(choice==="granted"){
      if(!student.is_active||!current.template)throw new RegisterError(403,"Save your own template under current enrollment consent first.");
      if(body.acknowledged!==true)throw new RegisterError(400,"Read and acknowledge the separate comparison notice.");
      if(body.noticeVersion!==notice.version)throw new RegisterError(409,"The comparison notice changed. Review it again.");
      if(typeof body.expectedRevision!=="number"||!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)throw new RegisterError(400,"Invalid comparison choice revision.");
      if(body.expectedRevision!==preference.revision)throw new RegisterError(409,"Your comparison choice changed. Refresh first.");
    }
    if(preference.choice===choice&&preference.notice_version===notice.version&&(choice!=="granted"||preference.allowed))return {unchanged:true};
    if(!preference.revision)await db.query("INSERT INTO attendai.verification_choices(student_id,notice_version,choice) VALUES($1,$2,$3)",[student.id,notice.version,choice]);
    else await db.query("UPDATE attendai.verification_choices SET notice_version=$2,choice=$3 WHERE student_id=$1",[student.id,notice.version,choice]);
    return {unchanged:false};
  });
}
type ComparisonAttempt={studentId:string;noticeVersion:string;choiceRevision:number;referenceTemplateId:string;tokenHash:string};
export async function consumeComparison(pool:Pool,account:Account,token:string):Promise<ComparisonAttempt>{
  studentOnly(account);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new RegisterError(400,"Invalid comparison token.");
  return actorTransaction(pool,account,async db=>{
    await lock(db,account);const current=await state(db,account);
    if(!current.ready)throw new RegisterError(403,"Current enrollment, a saved template, and separate comparison consent are required.");
    const row=(await db.query(`UPDATE attendai.verification_attempts SET consumed_at=clock_timestamp()
      WHERE token_hash=$1 AND student_id=$2 AND notice_version=$3 AND choice_revision=$4 AND reference_template_id=$5
      AND consumed_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL AND expires_at>clock_timestamp() RETURNING token_hash`,
      [hash(token),current.student.id,current.notice.version,current.preference.revision,current.template.template_id])).rows[0];
    if(!row)throw new RegisterError(409,"Comparison token expired, was cancelled, or was already used. Start a new capture.");
    return {studentId:current.student.id,noticeVersion:current.notice.version,choiceRevision:current.preference.revision,referenceTemplateId:current.template.template_id,tokenHash:row.token_hash};
  });
}
export async function finishComparison(pool:Pool,account:Account,attempt:ComparisonAttempt,probe:unknown,key:Buffer){
  studentOnly(account);
  return actorTransaction(pool,account,async db=>{
    await lock(db,account);const current=await state(db,account);
    if(!current.ready||current.student.id!==attempt.studentId||current.preference.revision!==attempt.choiceRevision||current.notice.version!==attempt.noticeVersion||current.template.template_id!==attempt.referenceTemplateId)
      throw new RegisterError(409,"Your consent or reference changed during processing. No result was saved.");
    const row=(await db.query("SELECT * FROM attendai.verification_reference($1)",[attempt.tokenHash])).rows[0];
    if(!row)throw new RegisterError(409,"The comparison was cancelled or expired. No result was saved.");
    let plaintext:Buffer|undefined;
    try{
      if(row.model_version!==MODEL_VERSION)throw new RegisterError(503,"The saved template uses another model. No comparison was saved.");
      plaintext=decryptFeature(Buffer.from(row.ciphertext),Buffer.from(row.iv),key,{studentId:row.student_id,templateId:row.template_id,noticeVersion:row.notice_version,choiceRevision:row.choice_revision,modelVersion:row.model_version,keyId:row.key_id});
      const similarity=compareFeature(plaintext,probe);
      const completed=await db.query(`UPDATE attendai.verification_attempts SET completed_at=clock_timestamp()
        WHERE token_hash=$1 AND student_id=$2 AND consumed_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL AND expires_at>clock_timestamp() RETURNING token_hash`,[attempt.tokenHash,attempt.studentId]);
      if(!completed.rowCount)throw new RegisterError(409,"The comparison was cancelled or expired. No result was saved.");
      const trial=(await db.query(`INSERT INTO attendai.verification_trials(trial_id,student_id,token_hash,notice_version,choice_revision,reference_template_id,model_version,similarity)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING trial_id,similarity,model_version,created_at,expires_at,session_id`,
        [randomUUID(),attempt.studentId,attempt.tokenHash,attempt.noticeVersion,attempt.choiceRevision,attempt.referenceTemplateId,MODEL_VERSION,similarity])).rows[0];
      return {trial,evaluationOnly:true,attendanceChanged:false};
    }finally{plaintext?.fill(0);row.ciphertext.fill(0);row.iv.fill(0);}
  });
}
export function verificationError(error:unknown){
  if(error instanceof RegisterError)return {status:error.status,error:error.message};
  const db=error as {code?:string;message?:string};
  if(db?.code==="P0001"&&db.message==="Comparison attempt limit reached.")return {status:429,error:"Five comparison attempts are allowed per ten minutes. Wait before trying again."};
  if(db?.code==="P0001"&&db.message==="Session research unavailable.")return {status:409,error:"This session is no longer eligible: check its open state, your active enrollment, roster membership and existing attendance. No research result was saved."};
  const safe=publicRegisterError(error);
  return safe.status===503?{status:503,error:"Comparison is unavailable. Check migrations 006 and 007, the CPU engine, and the original server encryption key. No result was confirmed."}:safe;
}
