import type { Pool, PoolClient } from "pg";
import type { Account } from "../auth/identity";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { actorTransaction, RegisterError, publicRegisterError } from "../register/service.ts";
import { encryptFeature, keyId, MODEL_VERSION } from "./crypto.ts";
function studentOnly(account: Account) { if(account.role!=="student")throw new RegisterError(403,"Only your linked student account can manage enrollment."); }
async function lock(db: PoolClient,account: Account) { await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["biometric:"+account.id]); }
async function state(db: PoolClient,account: Account) {
  const notice=(await db.query("SELECT version,purpose,title,body FROM attendai.biometric_notices WHERE is_current")).rows[0];
  if(!notice)throw new RegisterError(503,"The biometric notice is unavailable. Enrollment stays disabled.");
  const student=(await db.query("SELECT id,student_code,display_name,is_active FROM attendai.students WHERE user_id=$1",[account.id])).rows[0]??null;
  if(!student)return {notice,student:null,preference:null,template:null};
  const preference=(await db.query(`SELECT choice,revision,notice_version,decided_at,expires_at,
    attendai.biometric_allowed(student_id,notice_version,revision) AS allowed FROM attendai.biometric_choices WHERE student_id=$1`,[student.id])).rows[0]
    ??{choice:"not_recorded",revision:0,notice_version:null,decided_at:null,expires_at:null,allowed:false};
  const template=(await db.query(`SELECT template_id,model_version,created_at,expires_at FROM attendai.biometric_templates
    WHERE student_id=$1 AND expires_at>clock_timestamp() AND attendai.biometric_allowed(student_id,notice_version,choice_revision)`,[student.id])).rows[0]??null;
  return {notice,student,preference,template};
}
export async function readBiometric(pool: Pool,account: Account) {
  studentOnly(account);
  return actorTransaction(pool,account,async db=>{
    await db.query("SELECT attendai.purge_biometric_data()");
    const current=await state(db,account);
    const history=current.student?(await db.query(`SELECT event_id::text,event_type,notice_version,choice_revision,occurred_at
      FROM attendai.biometric_events WHERE student_id=$1 ORDER BY event_id DESC LIMIT 25`,[current.student.id])).rows:[];
    return {...current,history};
  });
}
function object(input: unknown) { if(!input||typeof input!=="object"||Array.isArray(input))throw new RegisterError(400,"Use a JSON object.");return input as Record<string,unknown>; }
function fields(body: Record<string,unknown>,allowed: string[]) { if(Object.keys(body).some(k=>!allowed.includes(k)))throw new RegisterError(400,"Unexpected enrollment field."); }
const hash=(token: string)=>createHash("sha256").update(token).digest("hex");
export async function mutateBiometric(pool: Pool,account: Account,input: unknown) {
  studentOnly(account);const body=object(input),action=body.action;
  if(!["grantEnrollment","chooseManual","withdraw","deleteTemplate","beginEnrollment"].includes(String(action)))throw new RegisterError(400,"Unknown enrollment action.");
  fields(body,action==="grantEnrollment"?["action","acknowledged","noticeVersion","expectedRevision"]:["action"]);
  return actorTransaction(pool,account,async db=>{
    await lock(db,account);await db.query("SELECT attendai.purge_biometric_data()");
    const current=await state(db,account),{student,preference,notice}=current;
    if(!student||!preference)throw new RegisterError(403,"A linked student account is required.");
    if(action==="beginEnrollment") {
      if(!preference.allowed)throw new RegisterError(403,"Grant the current biometric enrollment choice first.");
      if(current.template)throw new RegisterError(409,"Delete your existing template before enrolling again.");
      const token=randomBytes(32).toString("base64url");
      const row=(await db.query(`INSERT INTO attendai.biometric_challenges(token_hash,student_id,notice_version,choice_revision)
        VALUES($1,$2,$3,$4) RETURNING expires_at`,[hash(token),student.id,notice.version,preference.revision])).rows[0];
      return {token,expiresAt:row.expires_at};
    }
    if(action==="deleteTemplate") {
      await db.query("UPDATE attendai.biometric_challenges SET cancelled_at=clock_timestamp() WHERE student_id=$1 AND cancelled_at IS NULL",[student.id]);
      const removed=await db.query("DELETE FROM attendai.biometric_templates WHERE student_id=$1",[student.id]);
      return {deleted:removed.rowCount!==0};
    }
    const choice=action==="grantEnrollment"?"granted":action==="withdraw"?"withdrawn":"manual";
    if(choice==="granted") {
      if(!student.is_active)throw new RegisterError(403,"An active student link is required.");
      if(body.acknowledged!==true)throw new RegisterError(400,"Read and acknowledge the separate biometric notice.");
      if(body.noticeVersion!==notice.version)throw new RegisterError(409,"The biometric notice changed. Review it again.");
      if(typeof body.expectedRevision!=="number"||!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)throw new RegisterError(400,"Invalid choice revision.");
      if(body.expectedRevision!==preference.revision)throw new RegisterError(409,"Your biometric choice changed. Refresh first.");
    }
    if(preference.choice===choice&&preference.notice_version===notice.version&&(choice!=="granted"||preference.allowed))return {unchanged:true};
    if(!preference.revision)await db.query("INSERT INTO attendai.biometric_choices(student_id,notice_version,choice) VALUES($1,$2,$3)",[student.id,notice.version,choice]);
    else await db.query("UPDATE attendai.biometric_choices SET notice_version=$2,choice=$3 WHERE student_id=$1",[student.id,notice.version,choice]);
    return {unchanged:false};
  });
}
type Attempt={studentId:string;noticeVersion:string;choiceRevision:number;tokenHash:string};
export async function consumeAttempt(pool: Pool,account: Account,token: string):Promise<Attempt> {
  studentOnly(account);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new RegisterError(400,"Invalid enrollment token.");
  return actorTransaction(pool,account,async db=>{
    await lock(db,account);const current=await state(db,account);
    if(!current.student||!current.preference?.allowed)throw new RegisterError(403,"A current biometric grant is required.");
    const row=(await db.query(`UPDATE attendai.biometric_challenges SET consumed_at=clock_timestamp()
      WHERE token_hash=$1 AND student_id=$2 AND notice_version=$3 AND choice_revision=$4
      AND consumed_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL AND expires_at>clock_timestamp() RETURNING token_hash`,
      [hash(token),current.student.id,current.notice.version,current.preference.revision])).rows[0];
    if(!row)throw new RegisterError(409,"Enrollment token expired, was cancelled, or was already used. Start a new capture.");
    return {studentId:current.student.id,noticeVersion:current.notice.version,choiceRevision:current.preference.revision,tokenHash:row.token_hash};
  });
}
export async function finishEnrollment(pool: Pool,account: Account,attempt: Attempt,embedding: unknown,key: Buffer) {
  studentOnly(account);
  return actorTransaction(pool,account,async db=>{
    await lock(db,account);const current=await state(db,account);
    if(!current.student||!current.preference?.allowed||current.student.id!==attempt.studentId||current.notice.version!==attempt.noticeVersion||current.preference.revision!==attempt.choiceRevision)
      throw new RegisterError(409,"Your biometric choice changed during processing. No template was saved.");
    const completed=await db.query(`UPDATE attendai.biometric_challenges SET completed_at=clock_timestamp() WHERE token_hash=$1 AND student_id=$2
      AND consumed_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL AND expires_at>clock_timestamp() RETURNING token_hash`,[attempt.tokenHash,attempt.studentId]);
    if(!completed.rowCount)throw new RegisterError(409,"Enrollment was cancelled or expired. No template was saved.");
    if(current.template)throw new RegisterError(409,"A template already exists. Delete it before enrolling again.");
    const identity={studentId:attempt.studentId,templateId:randomUUID(),noticeVersion:attempt.noticeVersion,choiceRevision:attempt.choiceRevision,modelVersion:MODEL_VERSION,keyId:keyId(key)};
    const encrypted=encryptFeature(embedding,key,identity);
    try {await db.query(`INSERT INTO attendai.biometric_templates(student_id,template_id,notice_version,choice_revision,model_version,key_id,iv,ciphertext)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[identity.studentId,identity.templateId,identity.noticeVersion,identity.choiceRevision,identity.modelVersion,identity.keyId,encrypted.iv,encrypted.ciphertext]);}
    finally {encrypted.ciphertext.fill(0);}
    return {enrolled:true};
  });
}
export function biometricError(error: unknown) {
  if(error instanceof RegisterError)return {status:error.status,error:error.message};
  const db=error as {code?:string;message?:string};
  if(db?.code==="P0001"&&db.message==="Biometric attempt limit reached.")return {status:429,error:"Five enrollment attempts are allowed per ten minutes. Wait before trying again."};
  const safe=publicRegisterError(error);
  return safe.status===503?{status:503,error:"Enrollment is temporarily unavailable. Check face setup, migration 005, and encryption configuration."}:safe;
}
