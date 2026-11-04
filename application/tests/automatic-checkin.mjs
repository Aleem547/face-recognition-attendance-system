// Isolated PostgreSQL fixtures and synthetic normalized vectors. These tests
// validate software behavior, not face accuracy, liveness or live contention.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {createTestDatabase} from './pglite-pool.mjs';
import {actorTransaction,mutateWorkspace,readWorkspace} from '../lib/register/service.ts';
import {readBiometric,mutateBiometric,consumeAttempt,finishEnrollment} from '../lib/biometric/service.ts';
import {readCheckin,mutateCheckin,consumeCheckin,finishCheckin,checkinError} from '../lib/checkin/service.ts';
import {CHECKIN_NOTICE,POLICY_NOTICE} from '../lib/checkin/contracts.ts';
import {registerCsv} from '../lib/register/csv.ts';
const {db,pool}=await createTestDatabase(),key=randomBytes(32),vector=Array(128).fill(1/Math.sqrt(128));
const people={};for(const [name,role] of [['s','student'],['t','student'],['unlinked','student'],['admin','admin'],['teacher','teacher']])people[name]={id:randomUUID(),role,email:name+'@example.test',displayName:'Synthetic '+name};
let n=0,serial=0,sid,tid,course;
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE attendai_app');}}
const as=(who,fn)=>actorTransaction(pool,people[who],fn);
const change=(body,who='s')=>mutateCheckin(pool,people[who],body);
const write=(action,fields,who='admin')=>mutateWorkspace(pool,people[who],{action,...fields});
const read=(who='s')=>readCheckin(pool,people[who]);
const bio=(body,who='s')=>mutateBiometric(pool,people[who],body);
const pad=(one=0.95,two=0.96)=>({version:'attendai-pad-minifas-research-v1',models:[{model:'MiniFASNetV1SE.onnx',class1Score:one},{model:'MiniFASNetV2.onnx',class1Score:two}],meanClass1Score:(one+two)/2,decision:'not_calibrated',readyForAttendance:false});
const denied=(promise,status)=>assert.rejects(promise,e=>{const actual=checkinError(e);assert.equal(actual.status,status,actual.error);return true;});
async function check(name,fn){await owner(()=>db.exec('DELETE FROM attendai.face_checkin_attempts'));await fn();console.log(`PASS ${++n}: ${name}`);}
async function enroll(who='s'){
 await bio({action:'deleteTemplate'},who);await owner(()=>db.query('DELETE FROM attendai.biometric_challenges WHERE student_id=$1',[who==='s'?sid:tid]));
 const current=await readBiometric(pool,people[who]);await bio({action:'grantEnrollment',acknowledged:true,noticeVersion:current.notice.version,expectedRevision:current.preference.revision},who);
 const issued=await bio({action:'beginEnrollment'},who);await finishEnrollment(pool,people[who],await consumeAttempt(pool,people[who],issued.token),vector,key);
}
async function choice(active=true,who='s'){
 const state=await read(who);return change({action:active?'grantCheckin':'withdrawCheckin',expectedRevision:state.choice?.revision??0,noticeVersion:CHECKIN_NOTICE,acknowledged:active},who);
}
async function policy(id,extra={},who='admin'){
 const state=await read(who),s=state.sessions.find(s=>s.id===id);
 return change({action:'configureSession',sessionId:id,expectedRevision:s?.revision??0,enabled:true,similarityMin:0.8,padMin:0.8,lateAfterMinutes:15,acknowledgement:POLICY_NOTICE,...extra},who);
}
async function session({open=true,startOffset=-60000,endOffset=3600000,cid=course,configure=true}={}){
 const now=Date.now(),id=(await write('createSession',{courseId:cid,sessionCode:'AUTO-'+(++serial),title:'Synthetic automatic check-in',startsAt:new Date(now+startOffset).toISOString(),endsAt:new Date(now+endOffset).toISOString()})).session.id;
 if(open)await write('setSessionState',{sessionId:id,state:'open',expectedState:'scheduled'});
 if(configure)await policy(id);return id;
}
const issue=(id,who='s')=>change({action:'beginCheckin',sessionId:id},who);
const consume=(issued,who='s')=>consumeCheckin(pool,people[who],issued.token);
const finish=(attempt,probe=vector,p=pad(),k=key)=>finishCheckin(pool,people.s,attempt,probe,p,k);
async function begin(id){return consume(await issue(id));}
async function marks(id){return owner(async()=>(await db.query('SELECT * FROM attendai.attendance_records WHERE session_id=$1',[id])).rows);}
try{
 for(const f of ['001_initial_schema.sql','002_authentication.sql','003_persistent_register.sql','004_camera_choice.sql','005_biometric_enrollment.sql','006_controlled_verification.sql','007_session_research.sql'])await db.exec(await readFile(new URL('../db/migrations/'+f,import.meta.url),'utf8'));
 for(const p of Object.values(people))await db.query("INSERT INTO attendai.app_users(id,auth_provider,auth_subject,display_name,email,role) VALUES($1,'better-auth',$2,$3,$4,$5)",[p.id,'auth-'+p.id,p.displayName,p.email,p.role]);
 sid=(await db.query("INSERT INTO attendai.students(student_code,display_name,user_id) VALUES('AUTO-S','Synthetic S',$1) RETURNING id",[people.s.id])).rows[0].id;
 tid=(await db.query("INSERT INTO attendai.students(student_code,display_name,user_id) VALUES('AUTO-T','Synthetic T',$1) RETURNING id",[people.t.id])).rows[0].id;
 await db.exec('SET ROLE attendai_app');
 course=(await write('createCourse',{courseCode:'AUTO',title:'Synthetic course'})).course.id;
 await write('enrollStudent',{courseId:course,studentCode:'AUTO-S'});
 const old=await session({configure:false});await write('markAttendance',{sessionId:old,studentId:sid,status:'late',expectedRevision:0,reason:'Original synthetic manual mark'});
 const baseline=await marks(old);
 await owner(async()=>db.exec(await readFile(new URL('../db/migrations/008_automatic_checkin.sql',import.meta.url),'utf8')));
 await owner(async()=>db.exec(await readFile(new URL('../db/migrations/009_class_automation.sql',import.meta.url),'utf8')));
 await check('migration preserves existing attendance and leaves every session disabled',async()=>{assert.deepEqual(await marks(old),baseline);assert.equal((await read('admin')).sessions.filter(s=>s.enabled).length,0);});
 await check('automatic consent cannot be granted without a valid enrollment template',async()=>{await denied(choice(),403);await denied(choice(true,'unlinked'),403);});
 await enroll();await enroll('t');
 await check('a saved template alone never authorizes automatic attendance',async()=>{const id=await session();await denied(issue(id),409);assert.equal((await marks(id)).length,0);});
 await check('consent requires its own notice, explicit acknowledgement and revision',async()=>{
  for(const extra of [{acknowledged:false},{noticeVersion:'paired-pad-research-v1'},{expectedRevision:-1},{accepted:true}])await denied(change({action:'grantCheckin',expectedRevision:0,noticeVersion:CHECKIN_NOTICE,acknowledged:true,...extra}),400);
  await choice();assert((await read()).ready);await denied(change({action:'grantCheckin',expectedRevision:0,noticeVersion:CHECKIN_NOTICE,acknowledged:true}),409);
 });
 await check('only course staff can enable a policy; check-in is student-only',async()=>{const id=await session({configure:false});await denied(policy(id,{},'s'),403);await denied(policy(id,{},'teacher'),403);await denied(issue(id,'admin'),403);await denied(issue(id,'unlinked'),403);});
 await check('policy fields are explicit bounded finite values and optimistic revisions',async()=>{
  const id=await session({configure:false});
  for(const extra of [{acknowledgement:'old'},{similarityMin:0},{similarityMin:NaN},{similarityMin:Infinity},{padMin:1.1},{lateAfterMinutes:1.2},{expectedRevision:-1},{studentId:sid}])await denied(policy(id,extra),400);
  await policy(id);await denied(policy(id,{expectedRevision:0}),409);
 });
 await check('disabled, scheduled, future and ended classes refuse token issuance',async()=>{
  const disabled=await session({configure:false});await denied(issue(disabled),409);
  for(const options of [{open:false},{startOffset:3600000,endOffset:7200000},{startOffset:-7200000,endOffset:-3600000}])await denied(issue(await session(options)),409);
 });
 await check('one native-equivalent feature/PAD result creates an audited Present mark',async()=>{
  const id=await session(),result=await finish(await begin(id));assert.equal(result.attendanceChanged,true);assert.equal(result.decision,'accepted');assert.equal(result.attendance.status,'present');
  const rows=await marks(id);assert.equal(rows.length,1);assert.equal(rows[0].method,'experimental_face');assert.equal(rows[0].marked_by,people.s.id);assert.equal(rows[0].revision,1);assert(rows[0].change_reason.includes(result.receiptId));
  const history=await readWorkspace(pool,people.s,new URLSearchParams({resource:'history',attendanceId:rows[0].id}));assert.equal(history.items[0].method,'experimental_face');
  const receipts=(await read()).receipts;assert(receipts.some(r=>r.receipt_id===result.receiptId&&r.attendance_id===rows[0].id));
 });
 await check('low identity is rejected and never writes Absent',async()=>{const id=await session(),result=await finish(await begin(id),vector.map(v=>-v));assert.equal(result.decision,'identity_below_threshold');assert.equal(result.attendanceChanged,false);assert.equal(result.attendance,null);assert.equal((await marks(id)).length,0);});
 await check('each PAD model must meet cutoff even if the mean meets it',async()=>{const id=await session(),result=await finish(await begin(id),vector,pad(0.6,1));assert.equal(result.decision,'pad_below_threshold');assert.equal((await marks(id)).length,0);});
 await check('PAD output must contain both original model names and valid scores',async()=>{
  const id=await session(),a=await begin(id);
  for(const bad of [null,{...pad(),decision:'live'},{...pad(),models:[pad().models[0]]},{...pad(),meanClass1Score:NaN}])await denied(finish(a,vector,bad),503);
  assert.equal((await marks(id)).length,0);
 });
 await check('the same token cannot be consumed or committed twice',async()=>{const id=await session(),issued=await issue(id),a=await consume(issued);await denied(consume(issued),409);await finish(a);await denied(finish(a),409);assert.equal((await marks(id)).length,1);});
 await check('another student cannot consume a token or retrieve its encrypted reference',async()=>{const id=await session(),issued=await issue(id),a=await consume(issued);await denied(consume(issued,'t'),409);await denied(as('t',d=>d.query('SELECT attendai.face_checkin_reference($1)',[a.tokenHash])),409);assert.equal((await read('t')).receipts.length,0);});
 await check('browser fields cannot inject identity, scores, result or status',async()=>{const id=await session();for(const field of ['studentId','similarity','pad','accepted','status','method','tokenHash'])await denied(change({action:'beginCheckin',sessionId:id,[field]:'forged'}),400);});
 await check('expired tokens fail at consumption and commit',async()=>{
  for(const consumed of [false,true]){const id=await session(),issued=await issue(id),a=consumed?await consume(issued):null;
   await owner(()=>db.exec("UPDATE attendai.face_checkin_attempts SET expires_at=clock_timestamp()-interval '1 second'"));
   await denied(consumed?finish(a):consume(issued),409);assert.equal((await marks(id)).length,0);}
 });
 await check('policy changes while the worker runs invalidate the attempt',async()=>{const id=await session(),a=await begin(id);await policy(id,{padMin:0.9});await denied(finish(a),409);assert.equal((await marks(id)).length,0);});
 await check('disabling policy before consumption prevents CPU admission',async()=>{const id=await session(),issued=await issue(id);await policy(id,{enabled:false});await denied(consume(issued),409);});
 await check('withdrawal during processing cancels the attempt',async()=>{const id=await session(),a=await begin(id);await choice(false);await denied(finish(a),409);assert.equal((await marks(id)).length,0);await choice();});
 await check('template deletion during processing prevents attendance',async()=>{const id=await session(),a=await begin(id);await bio({action:'deleteTemplate'});await denied(finish(a),409);assert.equal((await marks(id)).length,0);await enroll();});
 await check('template replacement cannot authorize an older attempt',async()=>{const id=await session(),a=await begin(id);await enroll();await denied(finish(a),409);assert.equal((await marks(id)).length,0);});
 await check('enrollment ending while processing prevents attendance',async()=>{const id=await session(),a=await begin(id);await write('endEnrollment',{courseId:course,studentId:sid});await denied(finish(a),409);await write('enrollStudent',{courseId:course,studentCode:'AUTO-S'});});
 await check('late course enrollment cannot bypass its frozen class roster',async()=>{const cid=(await write('createCourse',{courseCode:'AFTER',title:'Synthetic'})).course.id;await write('enrollStudent',{courseId:cid,studentCode:'AUTO-T'});const id=await session({cid});await write('enrollStudent',{courseId:cid,studentCode:'AUTO-S'});await denied(issue(id),409);});
 await check('course or student deactivation during processing prevents attendance',async()=>{
  for(const [table,id] of [['courses',course],['students',sid]]){const sessionId=await session(),a=await begin(sessionId);await owner(()=>db.query(`UPDATE attendai.${table} SET is_active=false WHERE id=$1`,[id]));await denied(finish(a),table==='students'?403:409);assert.equal((await marks(sessionId)).length,0);await owner(()=>db.query(`UPDATE attendai.${table} SET is_active=true WHERE id=$1`,[id]));}
 });
 await check('inactive linked students can still withdraw check-in consent',async()=>{await owner(()=>db.query('UPDATE attendai.students SET is_active=false WHERE id=$1',[sid]));await choice(false);assert.equal((await read()).choice.granted,false);await owner(()=>db.query('UPDATE attendai.students SET is_active=true WHERE id=$1',[sid]));await enroll();await choice();});
 await check('an account deactivated during processing cannot commit',async()=>{const id=await session(),a=await begin(id);await owner(()=>db.query('UPDATE attendai.app_users SET is_active=false WHERE id=$1',[people.s.id]));await denied(finish(a),403);await owner(()=>db.query('UPDATE attendai.app_users SET is_active=true WHERE id=$1',[people.s.id]));});
 await check('a manual mark made while processing is preserved without a duplicate',async()=>{const id=await session(),a=await begin(id);await write('markAttendance',{sessionId:id,studentId:sid,status:'absent',reason:'Synthetic manual result wins',expectedRevision:0});const before=await marks(id);await denied(finish(a),409);await denied(issue(id),409);assert.deepEqual(await marks(id),before);});
 await check('session closure during processing prevents automatic marking',async()=>{const id=await session(),a=await begin(id);await write('markAttendance',{sessionId:id,studentId:sid,status:'present',reason:'Synthetic closing prerequisite',expectedRevision:0});await write('setSessionState',{sessionId:id,state:'closed',expectedState:'open'});await denied(finish(a),409);});
 await check('end time reached during processing prevents automatic marking',async()=>{const id=await session(),a=await begin(id);await owner(()=>db.query("UPDATE attendai.sessions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]));await denied(finish(a),409);assert.equal((await marks(id)).length,0);});
 await check('late status uses server time and staff corrections retain original provenance',async()=>{
  const id=await session({startOffset:-1200000}),result=await finish(await begin(id));assert.equal(result.attendance.status,'late');
  await write('markAttendance',{sessionId:id,studentId:sid,status:'present',reason:'Synthetic staff review of automatic mark',expectedRevision:1});
  const mark=(await marks(id))[0];assert.equal(mark.status,'present');assert.equal(mark.method,'manual');assert.equal(mark.revision,2);
  const history=await readWorkspace(pool,people.s,new URLSearchParams({resource:'history',attendanceId:mark.id}));assert.equal(history.items[0].method,'manual');assert.equal(history.items[1].method,'experimental_face');
 });
 await check('mismatched encryption key fails without marking',async()=>{const id=await session(),wrong=randomBytes(32);try{await denied(finish(await begin(id),vector,pad(),wrong),503);}finally{wrong.fill(0);}assert.equal((await marks(id)).length,0);});
 await check('bad features fail without marking',async()=>{const id=await session(),a=await begin(id);for(const bad of [[],Array(128).fill(NaN),Array(128).fill(1)])await denied(finish(a,bad),503);assert.equal((await marks(id)).length,0);});
 await check('five issued attempts limit applies across classes, including unsuccessful attempts',async()=>{const id=await session();for(let i=0;i<5;i++)await issue(id);await denied(issue(await session()),429);});
 await check('runtime cannot forge method, choice, policy, receipt or read ciphertext directly',async()=>{
  for(const sql of ["INSERT INTO attendai.face_checkin_receipts(receipt_id) VALUES(gen_random_uuid())","UPDATE attendai.face_checkin_choices SET granted=true","DELETE FROM attendai.face_checkin_policies","UPDATE attendai.face_checkin_policy_events SET enabled=true","SELECT ciphertext FROM attendai.biometric_templates","INSERT INTO attendai.attendance_records(method) VALUES('experimental_face')","SELECT attendai.face_checkin_context(NULL,NULL,NULL,NULL,NULL)"])
   await as('s',d=>assert.rejects(d.query(sql),e=>e.code==='42501'));
 });
 await check('minimal receipts store no image, feature or numeric model score columns',async()=>{
  const columns=await owner(async()=>(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='attendai' AND table_name LIKE 'face_checkin_%'")).rows.map(x=>x.column_name));
  assert(!columns.some(x=>/ciphertext|embedding|image|identity_score|class1|pad_one|pad_two/.test(x)));
  assert((await read()).receipts.every(x=>!('similarity' in x)));
 });
 await check('CSV and register expose automatic provenance without changing student scope',async()=>{
  const id=await session(),result=await finish(await begin(id));const view=await readWorkspace(pool,people.s,new URLSearchParams({resource:'register',sessionId:id}));assert.equal(view.items.length,1);assert.equal(view.items[0].method,'experimental_face');assert(registerCsv(view.items).includes('experimental_face'));assert.equal(view.items[0].attendance_id,result.attendance.id);
 });
 await check('receipt failure rolls back the mark and completion atomically',async()=>{
  const id=await session(),a=await begin(id);
  await owner(()=>db.exec("CREATE FUNCTION attendai.test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$; CREATE TRIGGER test_receipt_failure BEFORE INSERT ON attendai.face_checkin_receipts FOR EACH ROW EXECUTE FUNCTION attendai.test_receipt_failure()"));
  await denied(finish(a),503);assert.equal((await marks(id)).length,0);
  const pending=await owner(async()=>(await db.query('SELECT completed_at FROM attendai.face_checkin_attempts WHERE token_hash=$1',[a.tokenHash])).rows[0]);assert.equal(pending.completed_at,null);
  await owner(()=>db.exec('DROP TRIGGER test_receipt_failure ON attendai.face_checkin_receipts; DROP FUNCTION attendai.test_receipt_failure()'));
 });
 await check('cancellation before persistence prevents a mark',async()=>{const id=await session(),a=await begin(id),controller=new AbortController();controller.abort();await denied(finishCheckin(pool,people.s,a,vector,pad(),key,controller.signal),409);assert.equal((await marks(id)).length,0);});
 await check('cancellation observed after the SQL write rolls back mark and receipt',async()=>{
  const id=await session(),a=await begin(id),controller=new AbortController();
  const wrapped={connect:async()=>{const client=await pool.connect();return {release:()=>client.release(),query:async(sql,values)=>{
   const result=await client.query(sql,values);if(typeof sql==='string'&&sql.startsWith('SELECT attendai.finish_face_checkin('))controller.abort();return result;
  }};}};
  await denied(finishCheckin(wrapped,people.s,a,vector,pad(),key,controller.signal),409);assert.equal((await marks(id)).length,0);
  const receipts=await owner(async()=>(await db.query('SELECT count(*)::integer AS n FROM attendai.face_checkin_receipts WHERE session_id=$1',[id])).rows[0].n);assert.equal(receipts,0);
 });
 await check('owner DML cannot rewrite minimal receipt and policy history',async()=>{
  for(const table of ['face_checkin_receipts','face_checkin_policy_events','face_checkin_choice_events'])await owner(()=>assert.rejects(db.exec(`DELETE FROM attendai.${table}`),e=>e.code==='55000'));
 });
 await check('migration rerun refuses without altering existing records',async()=>{await db.exec('RESET ROLE');await assert.rejects(db.exec(await readFile(new URL('../db/migrations/008_automatic_checkin.sql',import.meta.url),'utf8')));await db.exec('ROLLBACK');await db.exec('SET ROLE attendai_app');assert.deepEqual(await marks(old),baseline);});
 console.log(`Automatic check-in software checks passed: ${n}. No biometric performance or production approval is claimed.`);
}finally{key.fill(0);await db.close();}
