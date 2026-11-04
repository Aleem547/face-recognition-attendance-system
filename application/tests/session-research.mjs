// Synthetic isolated PostgreSQL and features. No .env, real images or Neon connection.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {createTestDatabase} from './pglite-pool.mjs';
import {actorTransaction,mutateWorkspace} from '../lib/register/service.ts';
import {readBiometric,mutateBiometric,consumeAttempt,finishEnrollment} from '../lib/biometric/service.ts';
import {readVerification,mutateVerification,consumeComparison,finishComparison,verificationError} from '../lib/verification/service.ts';
import {compareFeature} from '../lib/verification/math.ts';
import {featureBytes,MODEL_VERSION} from '../lib/biometric/crypto.ts';
const {db,pool}=await createTestDatabase(),key=randomBytes(32),vector=Array(128).fill(1/Math.sqrt(128));
const people={};for(const [name,role] of [['s','student'],['t','student'],['unlinked','student'],['admin','admin'],['teacher','teacher']])people[name]={id:randomUUID(),role,email:name+'@example.test',displayName:'Synthetic '+name};
let count=0,sid,tid,baseline;
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE attendai_app');}}
const read=(who='s')=>readVerification(pool,people[who]);
const change=(body,who='s')=>mutateVerification(pool,people[who],body);
const bio=(body,who='s')=>mutateBiometric(pool,people[who],body);
const as=(who,fn)=>actorTransaction(pool,people[who],fn);
async function check(name,fn){await owner(()=>db.exec('DELETE FROM attendai.verification_attempts a WHERE NOT EXISTS(SELECT 1 FROM attendai.verification_trials t WHERE t.token_hash=a.token_hash)'));await fn();console.log(`PASS ${++count}: ${name}`);}
async function denied(promise,status){await assert.rejects(promise,error=>verificationError(error).status===status);}
async function enroll(who='s'){
 await bio({action:'deleteTemplate'},who);await owner(()=>db.query('DELETE FROM attendai.biometric_challenges WHERE student_id=$1',[who==='s'?sid:tid]));
 const current=await readBiometric(pool,people[who]);await bio({action:'grantEnrollment',acknowledged:true,noticeVersion:current.notice.version,expectedRevision:current.preference.revision},who);
 const issued=await bio({action:'beginEnrollment'},who),attempt=await consumeAttempt(pool,people[who],issued.token);await finishEnrollment(pool,people[who],attempt,vector,key);
}
async function grant(who='s',extra={}){const x=await read(who);return change({action:'grantComparison',acknowledged:true,noticeVersion:x.notice.version,expectedRevision:x.preference?.revision??0,...extra},who);}
async function begin(who='s'){const issued=await change({action:'beginComparison'},who);return {issued,attempt:await consumeComparison(pool,people[who],issued.token)};}
async function compare(){const {attempt}=await begin();return finishComparison(pool,people.s,attempt,vector,key);}
async function attendance(){return owner(async()=>({records:(await db.query('SELECT * FROM attendai.attendance_records ORDER BY id')).rows,events:(await db.query('SELECT * FROM attendai.attendance_events ORDER BY event_id')).rows}));}
try{
 for(const file of ['001_initial_schema.sql','002_authentication.sql','003_persistent_register.sql','004_camera_choice.sql','005_biometric_enrollment.sql','006_controlled_verification.sql','007_session_research.sql'])await db.exec((await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8')).replace(/^\uFEFF/,''));
 for(const p of Object.values(people))await db.query("INSERT INTO attendai.app_users(id,auth_provider,auth_subject,display_name,email,role) VALUES($1,'better-auth',$2,$3,$4,$5)",[p.id,'auth-'+p.id,p.displayName,p.email,p.role]);
 sid=(await db.query("INSERT INTO attendai.students(student_code,display_name,user_id) VALUES('VERIFY-S','Synthetic S',$1) RETURNING id",[people.s.id])).rows[0].id;
 tid=(await db.query("INSERT INTO attendai.students(student_code,display_name,user_id) VALUES('VERIFY-T','Synthetic T',$1) RETURNING id",[people.t.id])).rows[0].id;
 await db.exec('SET ROLE attendai_app');
 const write=(action,fields)=>mutateWorkspace(pool,people.admin,{action,...fields});
 const course=(await write('createCourse',{courseCode:'SYNTHETIC',title:'Synthetic course'})).course.id;
 await write('enrollStudent',{courseId:course,studentCode:'VERIFY-S'});
 const session=(await write('createSession',{courseId:course,sessionCode:'SYNTHETIC',title:'Synthetic session',startsAt:'2026-10-25T08:00:00Z',endsAt:'2026-10-25T09:00:00Z'})).session.id;
 await write('setSessionState',{sessionId:session,state:'open',expectedState:'scheduled'});
 await enroll();await grant();await enroll('t');await grant('t');
 let serial=0;
 async function freshSession(open=true,cid=course){
  const x=(await write('createSession',{courseId:cid,sessionCode:'RESEARCH-'+(++serial),title:'Synthetic session',startsAt:'2026-10-25T08:00:00Z',endsAt:'2026-10-25T09:00:00Z'})).session.id;
  if(open)await write('setSessionState',{sessionId:x,state:'open',expectedState:'scheduled'});
  return x;
 }
 const issue=(id,extra={},who='s')=>change({action:'beginSessionComparison',sessionId:id,acknowledged:true,sessionNoticeVersion:'session-research-v1',...extra},who);
 const consume=(x,who='s')=>consumeComparison(pool,people[who],x.token);
 const finish=a=>finishComparison(pool,people.s,a,vector,key);
 const close=async id=>{await write('markAttendance',{sessionId:id,studentId:sid,status:'absent',reason:'Synthetic close prerequisite',expectedRevision:0});await write('setSessionState',{sessionId:id,state:'closed',expectedState:'open'});baseline=await attendance();};
 const reset=async()=>{await change({action:'clearTrials'});await owner(()=>db.query('DELETE FROM attendai.verification_attempts WHERE student_id=$1',[sid]));};
 baseline=await attendance();
 await check('only eligible own open unmarked sessions are listed',async()=>{assert((await read()).sessions.some(s=>s.id===session));assert.equal((await read('t')).sessions.length,0);});
 await check('session linkage requires exact explicit notice and rejects injected fields',async()=>{for(const extra of [{acknowledged:false},{sessionNoticeVersion:'old'},{studentId:tid},{similarity:1},{sessionId:'bad-id'}])await denied(issue(session,extra),400);});
 await check('wrong student, missing session, scheduled and closed sessions are refused',async()=>{await denied(issue(session,{},'t'),409);await denied(issue(randomUUID()),409);const x=await freshSession(false);await denied(issue(x),409);await write('setSessionState',{sessionId:x,state:'cancelled',expectedState:'scheduled'});await denied(issue(x),409);const y=await freshSession();await close(y);await denied(issue(y),409);});
 await check('token is immutably session bound and context is retained in result and receipt',async()=>{const x=await issue(session);assert.equal(x.sessionId,session);const a=await consume(x);const result=await finish(a);assert.equal(result.trial.session_id,session);assert.equal(result.attendanceChanged,false);const r=await read();assert.equal(r.trials[0].session_id,session);const e=r.history.find(e=>e.event_type==='compared');assert.equal(e.session_id,session);assert.equal(e.session_notice_version,'session-research-v1');assert.equal((await read('t')).trials.length,0);await denied(consume(x),409);await denied(finish(a),409);await as('s',async db=>{await assert.rejects(db.query('UPDATE attendai.verification_attempts SET session_id=$1 WHERE token_hash=$2',[randomUUID(),a.tokenHash]),e=>e.code==='42501');});await reset();});
 await check('session closure after issuance blocks CPU admission',async()=>{const id=await freshSession(),x=await issue(id);await close(id);await denied(consume(x),409);});
 await check('session closure during processing blocks saving',async()=>{const id=await freshSession(),a=await consume(await issue(id));await close(id);await denied(finish(a),409);assert.equal((await read()).trials.length,0);});
 await check('enrollment ending during processing blocks saving',async()=>{const id=await freshSession(),a=await consume(await issue(id));await write('endEnrollment',{courseId:course,studentId:sid});assert.equal((await read()).sessions.length,0);await denied(finish(a),409);await write('enrollStudent',{courseId:course,studentCode:'VERIFY-S'});});
 await check('late enrollment cannot bypass the frozen session roster',async()=>{const cid=(await write('createCourse',{courseCode:'AFTER-OPEN',title:'Synthetic'})).course.id;await write('enrollStudent',{courseId:cid,studentCode:'VERIFY-T'});const id=await freshSession(true,cid);await write('enrollStudent',{courseId:cid,studentCode:'VERIFY-S'});await denied(issue(id),409);assert(!(await read()).sessions.some(s=>s.id===id));});
 await check('course deactivation during processing blocks saving',async()=>{const id=await freshSession(),a=await consume(await issue(id));await owner(()=>db.query('UPDATE attendai.courses SET is_active=false WHERE id=$1',[course]));await denied(finish(a),409);await owner(()=>db.query('UPDATE attendai.courses SET is_active=true WHERE id=$1',[course]));});
 await check('manual mark added during processing wins without being changed',async()=>{const id=await freshSession(),a=await consume(await issue(id));await write('markAttendance',{sessionId:id,studentId:sid,status:'present',reason:'Synthetic manual mark wins',expectedRevision:0});const before=await attendance();await denied(finish(a),409);await denied(issue(id),409);assert(!(await read()).sessions.some(s=>s.id===id));assert.deepEqual(await attendance(),before);baseline=before;});
 await check('withdrawal removes session scores and preserves contextual deletion receipt',async()=>{const id=await freshSession(),a=await consume(await issue(id));await finish(a);await change({action:'withdraw'});const r=await read();assert.equal(r.trials.length,0);assert(r.template);const e=r.history.find(e=>e.event_type==='result_deleted');assert.equal(e.session_id,id);await grant();await reset();});
 await check('comparison-only trials stay available without session context',async()=>{const r=await compare();assert.equal(r.trial.session_id,null);await reset();});
 await check('runtime cannot forge session receipts, notice versions or contextual trial columns',async()=>{for(const sql of ["UPDATE attendai.verification_events SET session_id=NULL","UPDATE attendai.verification_attempts SET session_notice_version='session-research-v1'",'INSERT INTO attendai.verification_trials(session_id) VALUES(NULL)',"SELECT attendai.assert_session_research('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000')"])await as('s',async db=>{await assert.rejects(db.query(sql),e=>e.code==='42501');});});
 await check('all research actions preserve attendance and attendance history',async()=>assert.deepEqual(await attendance(),baseline));
 await check('migration rerun refuses safely with prior results intact',async()=>{await db.exec('RESET ROLE');await assert.rejects(db.exec(await readFile(new URL('../db/migrations/007_session_research.sql',import.meta.url),'utf8')));await db.exec('ROLLBACK');assert.equal((await db.query("SELECT count(*)::int AS n FROM attendai.schema_migrations WHERE version='007'")).rows[0].n,1);});
 console.log(`Session research database checks passed: ${count}. Attendance marking remains disabled.`);
}finally{key.fill(0);await db.close();}
