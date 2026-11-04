import type {Pool} from 'pg';
import type {Account} from '../auth/identity.ts';
import {actorTransaction,RegisterError} from '../register/service.ts';
import {decryptFeature,MODEL_VERSION} from '../biometric/crypto.ts';
import {compareFeature} from '../verification/math.ts';
import type {LiveAttempt} from './leases.ts';
export async function assertLiveReference(pool:Pool,account:Account,attempt:LiveAttempt){
 if(account.role!=='student')throw new RegisterError(403,'Use your own linked student account.');
 return actorTransaction(pool,account,async db=>{const row=(await db.query('SELECT student_id,template_id FROM attendai.verification_reference($1)',[attempt.tokenHash])).rows[0];
  if(!row||row.student_id!==attempt.studentId||row.template_id!==attempt.referenceTemplateId)throw new RegisterError(409,'Your comparison choice or enrollment changed. Live comparison stopped.');});
}
export async function liveSimilarity(pool:Pool,account:Account,attempt:LiveAttempt,probe:number[],key:Buffer){
 if(account.role!=='student')throw new RegisterError(403,'Use your own linked student account.');
 return actorTransaction(pool,account,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['biometric:'+account.id]);
  const row=(await db.query('SELECT * FROM attendai.verification_reference($1)',[attempt.tokenHash])).rows[0];let plain:Buffer|undefined;
  try{
   if(!row||row.student_id!==attempt.studentId||row.template_id!==attempt.referenceTemplateId)throw new RegisterError(409,'Your comparison choice or enrollment changed. Live comparison stopped.');
   if(row.model_version!==MODEL_VERSION)throw new RegisterError(503,'Your saved template uses another face model.');
   plain=decryptFeature(row.ciphertext,row.iv,key,{studentId:row.student_id,templateId:row.template_id,noticeVersion:row.notice_version,choiceRevision:row.choice_revision,modelVersion:row.model_version,keyId:row.key_id});
   return compareFeature(plain,probe);
  }finally{plain?.fill(0);row?.iv?.fill(0);row?.ciphertext?.fill(0);}
 });
}
export async function cancelLiveAttempt(pool:Pool,account:Account,attempt:LiveAttempt){
 return actorTransaction(pool,account,async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['biometric:'+account.id]);await db.query('UPDATE attendai.verification_attempts SET cancelled_at=clock_timestamp() WHERE token_hash=$1 AND completed_at IS NULL AND cancelled_at IS NULL',[attempt.tokenHash]);});
}
