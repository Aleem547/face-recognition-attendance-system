// Isolated PostgreSQL and synthetic features; owner-only fixture time changes
// simulate class boundaries. Production accepts no client-supplied clock.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {createTestDatabase} from './pglite-pool.mjs';
import {actorTransaction,mutateWorkspace,readWorkspace} from '../lib/register/service.ts';
import {readBiometric,mutateBiometric,consumeAttempt,finishEnrollment} from '../lib/biometric/service.ts';
import {readCheckin,mutateCheckin,consumeCheckin,finishCheckin,checkinError} from '../lib/checkin/service.ts';
import {CHECKIN_NOTICE,POLICY_NOTICE} from '../lib/checkin/contracts.ts';
import {tickClassClock} from '../lib/automation/clock.ts';
const {db,pool}=await createTestDatabase(),key=randomBytes(32),vector=Array(128).fill(1/Math.sqrt(128));
const users={};for(const [name,role] of [['s','student'],['t','student'],['u','student'],['v','student'],['admin','admin'],['teacher','teacher']])users[name]={id:randomUUID(),role,email:name+'@example.test',displayName:'Synthetic '+name};
let n=0,serial=0,course;const students={};
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE attendai_app');}}
const change=(body,who='s')=>mutateCheckin(pool,users[who],body);
const write=(action,fields,who='admin')=>mutateWorkspace(pool,users[who],{action,...fields});
const read=(who='s')=>readCheckin(pool,users[who]);
async function denied(p,status){await assert.rejects(p,e=>{assert.equal(checkinError(e).status,status,checkinError(e).error);return true;});}
async function check(name,fn){await owner(()=>db.exec('UPDATE attendai.session_automation SET enabled=false; DELETE FROM attendai.face_checkin_attempts'));await fn();console.log(`PASS ${++n}: ${name}`);}
const tick=()=>tickClassClock(pool);
const pad=(a=0.95,b=0.96)=>({version:'attendai-pad-minifas-research-v1',models:[{model:'MiniFASNetV1SE.onnx',class1Score:a},{model:'MiniFASNetV2.onnx',class1Score:b}],meanClass1Score:(a+b)/2,decision:'not_calibrated',readyForAttendance:false});
async function data(id){return owner(async()=>({session:(await db.query('SELECT * FROM attendai.sessions WHERE id=$1',[id])).rows[0],
 automation:(await db.query('SELECT * FROM attendai.session_automation WHERE session_id=$1',[id])).rows[0],
 marks:(await db.query('SELECT * FROM attendai.attendance_records WHERE session_id=$1 ORDER BY student_id',[id])).rows,
 events:(await db.query('SELECT * FROM attendai.session_automation_events WHERE session_id=$1 ORDER BY event_id',[id])).rows}));}
async function policy(id,{automate,expectedAutomationRevision,extra={}}={}){
 const s=(await read('admin')).sessions.find(s=>s.id===id);
 return change({action:'configureSession',sessionId:id,expectedRevision:s?.revision??0,enabled:true,
 similarityMin:0.8,padMin:0.8,lateAfterMinutes:15,acknowledgement:POLICY_NOTICE,
 ...(automate!==undefined?{automate,expectedAutomationRevision:expectedAutomationRevision??s?.automation_revision??0,automationAcknowledgement:'class-automation-v1'}:{}),...extra},'admin');
}
async function session({automatic=false,future=true}={}){const now=Date.now(),id=(await write('createSession',{courseId:course,sessionCode:'CLOCK-'+(++serial),title:'Synthetic timed class',
 startsAt:new Date(now+(future?300000:-1800000)).toISOString(),endsAt:new Date(now+3600000).toISOString()})).session.id;
 await policy(id,{automate:automatic});return id;}
async function open(id){await write('setSessionState',{sessionId:id,expectedState:'scheduled',state:'open'});}
async function nowStart(id){await owner(()=>db.query("UPDATE attendai.sessions SET starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[id]));}
async function ended(id,seconds=31){await owner(async()=>{await db.query("UPDATE attendai.sessions SET ends_at=clock_timestamp()-make_interval(secs=>$2) WHERE id=$1",[id,seconds]);await db.query('UPDATE attendai.session_automation SET last_tick_at=clock_timestamp() WHERE session_id=$1',[id]);});}
async function begin(id){const issued=await change({action:'beginCheckin',sessionId:id});return {issued,attempt:await consumeCheckin(pool,users.s,issued.token)};}
const finish=(attempt,p=pad())=>finishCheckin(pool,users.s,attempt,vector,p,key);
try{
 for(const f of ['001_initial_schema.sql','002_authentication.sql','003_persistent_register.sql','004_camera_choice.sql','005_biometric_enrollment.sql','006_controlled_verification.sql','007_session_research.sql','008_automatic_checkin.sql','009_class_automation.sql'])await db.exec(await readFile(new URL('../db/migrations/'+f,import.meta.url),'utf8'));
 for(const p of Object.values(users))await db.query("INSERT INTO attendai.app_users(id,auth_provider,auth_subject,display_name,email,role) VALUES($1,'better-auth',$2,$3,$4,$5)",[p.id,'auth-'+p.id,p.displayName,p.email,p.role]);
 for(const who of ['s','t','u','v'])students[who]=(await db.query('INSERT INTO attendai.students(student_code,display_name,user_id) VALUES($1,$2,$3) RETURNING id',['CLOCK-'+who.toUpperCase(),'Synthetic '+who,users[who].id])).rows[0].id;
 await db.exec('SET ROLE attendai_app');
 course=(await write('createCourse',{courseCode:'CLOCK',title:'Synthetic timed attendance'})).course.id;
 for(const who of ['s','t','u','v'])await write('enrollStudent',{courseId:course,studentCode:'CLOCK-'+who.toUpperCase()});
 const bio=await readBiometric(pool,users.s);await mutateBiometric(pool,users.s,{action:'grantEnrollment',noticeVersion:bio.notice.version,expectedRevision:bio.preference.revision,acknowledged:true});
 const token=await mutateBiometric(pool,users.s,{action:'beginEnrollment'});await finishEnrollment(pool,users.s,await consumeAttempt(pool,users.s,token.token),vector,key);
 await change({action:'grantCheckin',noticeVersion:CHECKIN_NOTICE,expectedRevision:0,acknowledged:true});
 await check('an older check-in choice needs renewed acknowledgement while its encrypted template is preserved',async()=>{const id=await session({future:false});await open(id);const before=await owner(async()=>(await db.query('SELECT ciphertext,iv,template_id FROM attendai.biometric_templates WHERE student_id=$1',[students.s])).rows[0]);await owner(()=>db.query("UPDATE attendai.face_checkin_choices SET notice_version='automatic-checkin-v1' WHERE student_id=$1",[students.s]));assert.equal((await read()).ready,false);await denied(change({action:'beginCheckin',sessionId:id}),409);const current=await read();await change({action:'grantCheckin',noticeVersion:CHECKIN_NOTICE,expectedRevision:current.choice.revision,acknowledged:true});assert.deepEqual(await owner(async()=>(await db.query('SELECT ciphertext,iv,template_id FROM attendai.biometric_templates WHERE student_id=$1',[students.s])).rows[0]),before);});
 await check('migration opts in no class and the clock changes no manual session',async()=>{const id=await session();await nowStart(id);await tick();assert.equal((await data(id)).session.state,'scheduled');assert.equal((await data(id)).marks.length,0);});
 await check('automatic timing requires staff scope, acknowledgement and an enabled face policy',async()=>{
  const id=await session();await denied(change({action:'configureSession',sessionId:id,expectedRevision:1,enabled:true,similarityMin:0.8,padMin:0.8,lateAfterMinutes:15,automate:true,expectedAutomationRevision:0,acknowledgement:POLICY_NOTICE,automationAcknowledgement:'old'},'admin'),400);
  await denied(actorTransaction(pool,users.s,d=>d.query('SELECT attendai.configure_session_automation($1,0,true,$2)',[id,'class-automation-v1'])),403);
  await denied(actorTransaction(pool,users.teacher,d=>d.query('SELECT attendai.configure_session_automation($1,0,true,$2)',[id,'class-automation-v1'])),403);
 });
 await check('stale timing revision rolls back the whole policy update',async()=>{const id=await session(),before=(await read('admin')).sessions.find(s=>s.id===id);await denied(policy(id,{automate:true,expectedAutomationRevision:99}),409);const after=(await read('admin')).sessions.find(s=>s.id===id);assert.equal(after.revision,before.revision);assert.equal(after.automation_enabled,false);});
 await check('arming freezes the roster without opening a future class',async()=>{const id=await session({automatic:true}),a=await data(id);assert.equal(a.session.state,'scheduled');assert.equal(a.automation.enabled,true);assert.equal((await read('admin')).sessions.find(s=>s.id===id).automation_roster,4);await tick();assert.equal((await data(id)).session.state,'scheduled');});
 await check('the clock opens a due class from its frozen roster exactly once',async()=>{const id=await session({automatic:true});await nowStart(id);const first=await tick(),a=await data(id);assert.equal(first.opened,1);assert.equal(a.session.state,'open');const roster=await owner(async()=>(await db.query('SELECT student_id FROM attendai.session_roster WHERE session_id=$1',[id])).rows);assert.equal(roster.length,4);await tick();assert.equal((await data(id)).events.filter(e=>e.event_type==='opened').length,1);});
 await check('later membership changes do not rewrite the armed class list',async()=>{const id=await session({automatic:true});await write('endEnrollment',{courseId:course,studentId:students.t});await nowStart(id);await tick();const roster=await owner(async()=>(await db.query('SELECT student_id FROM attendai.session_roster WHERE session_id=$1',[id])).rows);assert(roster.some(x=>x.student_id===students.t));await write('enrollStudent',{courseId:course,studentCode:'CLOCK-T'});});
 await check('08:30 class: arrival before 08:45 is Present even if processing is later',async()=>{
  const id=await session({future:false});await open(id);const {attempt}=await begin(id);let arrival;
  await owner(async()=>{const s=(await db.query('SELECT starts_at FROM attendai.sessions WHERE id=$1',[id])).rows[0];arrival=new Date(new Date(s.starts_at).getTime()+14*60000+59000);await db.query('UPDATE attendai.face_checkin_attempts SET consumed_at=$2 WHERE token_hash=$1',[attempt.tokenHash,arrival.toISOString()]);});
  const result=await finish(attempt);assert.equal(result.attendance.status,'present');assert.equal(Date.parse(result.arrivedAt),arrival.getTime());
 });
 await check('08:30 class: arrival at exactly 08:45 is Late',async()=>{const id=await session({future:false});await open(id);const {attempt}=await begin(id);
  await owner(()=>db.query("UPDATE attendai.face_checkin_attempts SET consumed_at=(SELECT starts_at+interval '15 minutes' FROM attendai.sessions WHERE id=$2) WHERE token_hash=$1",[attempt.tokenHash,id]));
  assert.equal((await finish(attempt)).attendance.status,'late');
 });
 await check('an admitted upload can finish within the bounded end-of-class allowance',async()=>{const id=await session({future:false});await open(id);const {attempt}=await begin(id);
  await owner(async()=>{await db.query("UPDATE attendai.face_checkin_attempts SET consumed_at=clock_timestamp()-interval '2 seconds' WHERE token_hash=$1",[attempt.tokenHash]);await db.query("UPDATE attendai.sessions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);});
  assert.equal((await finish(attempt)).attendanceChanged,true);
 });
 await check('the processing allowance cannot admit a new arrival after class end',async()=>{const id=await session({future:false});await open(id);const first=await begin(id),other=await change({action:'beginCheckin',sessionId:id});await owner(async()=>{await db.query("UPDATE attendai.face_checkin_attempts SET consumed_at=clock_timestamp()-interval '2 seconds' WHERE token_hash=$1",[first.attempt.tokenHash]);await db.query("UPDATE attendai.sessions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);});await denied(consumeCheckin(pool,users.s,other.token),409);await denied(change({action:'beginCheckin',sessionId:id}),409);});
 await check('no Absents are created before the class or processing allowance ends',async()=>{const id=await session({automatic:true});await nowStart(id);await tick();assert.equal((await data(id)).marks.length,0);await ended(id,5);await tick();assert.equal((await data(id)).session.state,'open');assert.equal((await data(id)).marks.length,0);});
 await check('class end fills only unmarked entries as Absent and closes atomically',async()=>{
  const id=await session({automatic:true});await nowStart(id);await tick();await finish((await begin(id)).attempt);
  await write('markAttendance',{sessionId:id,studentId:students.t,status:'late',expectedRevision:0,reason:'Synthetic staff late'});
  await write('markAttendance',{sessionId:id,studentId:students.u,status:'excused',expectedRevision:0,reason:'Synthetic staff excuse'});
  const saved=(await data(id)).marks;await ended(id);const outcome=await tick(),after=await data(id);
  assert.equal(outcome.absent,1);assert.equal(after.session.state,'closed');assert.equal(after.marks.length,4);
  for(const old of saved)assert.deepEqual(after.marks.find(x=>x.id===old.id),old);
  const absent=after.marks.find(x=>x.student_id===students.v);assert.equal(absent.status,'absent');assert.equal(absent.method,'automatic_absence');assert.equal(absent.revision,1);
  assert(after.events.some(e=>e.event_type==='finalized'&&e.absent_count===1));
  const own=await readWorkspace(pool,users.v,new URLSearchParams({resource:'register',sessionId:id}));assert.equal(own.items.length,1);assert.equal(own.items[0].method,'automatic_absence');
 });
 await check('students cannot read peer aggregate finalization events',async()=>{const id=await session({automatic:true});await nowStart(id);await tick();await ended(id);await tick();const own=await actorTransaction(pool,users.s,d=>d.query('SELECT * FROM attendai.session_automation_events WHERE session_id=$1',[id]));assert.equal(own.rows.length,0);const staff=await actorTransaction(pool,users.admin,d=>d.query('SELECT * FROM attendai.session_automation_events WHERE session_id=$1',[id]));assert(staff.rows.some(e=>e.event_type==='finalized'&&e.absent_count===4));});
 await check('repeated clock ticks do not duplicate marks, receipts or revisions',async()=>{const id=await session({automatic:true});await nowStart(id);await tick();await ended(id);await tick();const before=await data(id);const result=await tick();assert.equal(result.absent,0);assert.deepEqual(await data(id),before);});
 await check('a rejected face stays unmarked now and becomes Absent only at class finalization',async()=>{const id=await session({automatic:true});await nowStart(id);await tick();const rejected=await finish((await begin(id)).attempt,pad(0.1,0.1));assert.equal(rejected.attendanceChanged,false);assert.equal((await data(id)).marks.length,0);await ended(id);await tick();assert.equal((await data(id)).marks.find(x=>x.student_id===students.s).status,'absent');});
 await check('staff can correct automatic absence with original provenance retained',async()=>{const id=await session({automatic:true});await nowStart(id);await tick();await ended(id);await tick();const a=(await data(id)).marks.find(x=>x.student_id===students.s);await write('markAttendance',{sessionId:id,studentId:students.s,status:'present',expectedRevision:1,reason:'Synthetic review: student attended manually'});const h=await readWorkspace(pool,users.s,new URLSearchParams({resource:'history',attendanceId:a.id}));assert.equal(h.items[0].method,'manual');assert.equal(h.items[1].method,'automatic_absence');assert.equal(h.items[0].revision,2);});
 await check('a clock gap pauses automatic absences and records review',async()=>{const id=await session({automatic:true});await nowStart(id);await tick();await owner(async()=>{await db.query("UPDATE attendai.session_automation SET last_tick_at=clock_timestamp()-interval '5 minutes' WHERE session_id=$1",[id]);await db.exec("UPDATE attendai.class_clock_state SET last_tick_at=clock_timestamp()-interval '5 minutes'");});await owner(()=>db.query("UPDATE attendai.sessions SET starts_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",[id]));await tick();assert.equal((await data(id)).automation.review_reason,'clock_gap');await ended(id);await tick();assert.equal((await data(id)).session.state,'open');assert.equal((await data(id)).marks.length,0);});
 await check('a fully missed class is left for review rather than fabricating absences',async()=>{const id=await session({automatic:true});await nowStart(id);await ended(id);await tick();const a=await data(id);assert.equal(a.session.state,'scheduled');assert.equal(a.marks.length,0);assert(a.automation.review_reason);});
 await check('manual cancellation and timing disable prevent automatic marks',async()=>{
  const id=await session({automatic:true});await policy(id,{automate:false});await nowStart(id);await tick();assert.equal((await data(id)).session.state,'scheduled');
  const cancelled=await session({automatic:true});await write('setSessionState',{sessionId:cancelled,expectedState:'scheduled',state:'cancelled'});await nowStart(cancelled);await ended(cancelled);await tick();assert.equal((await data(cancelled)).marks.length,0);
 });
 await check('disabled face policy or inactive responsible staff pauses timing',async()=>{
  const id=await session({automatic:true});await nowStart(id);await tick();await owner(()=>db.query('UPDATE attendai.face_checkin_policies SET enabled=false WHERE session_id=$1',[id]));await tick();assert.equal((await data(id)).automation.review_reason,'face_policy_disabled');
  const other=await session({automatic:true});await nowStart(other);await owner(()=>db.query('UPDATE attendai.app_users SET is_active=false WHERE id=$1',[users.admin.id]));await tick();assert.equal((await data(other)).session.state,'scheduled');assert.equal((await data(other)).automation.review_reason,'class_or_staff_unavailable');await owner(()=>db.query('UPDATE attendai.app_users SET is_active=true WHERE id=$1',[users.admin.id]));
 });
 await check('runtime cannot forge automation state, snapshots, events or execute the clock as a student',async()=>{
  for(const sql of ['UPDATE attendai.session_automation SET enabled=true','INSERT INTO attendai.class_clock_state(singleton,last_tick_at) VALUES(true,clock_timestamp())','DELETE FROM attendai.session_automation_roster','UPDATE attendai.session_automation_events SET reason=\'forged\'','SELECT attendai.tick_session_automation()'])await actorTransaction(pool,users.s,d=>assert.rejects(d.query(sql),e=>e.code==='42501'));
 });
 await check('a failure writing attendance history rolls back all automatic absences and closure',async()=>{const id=await session({automatic:true});await nowStart(id);await tick();await ended(id);
  await owner(()=>db.exec("CREATE FUNCTION attendai.test_clock_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic clock receipt failure'; END $$; CREATE TRIGGER test_clock_failure BEFORE INSERT ON attendai.attendance_events FOR EACH ROW EXECUTE FUNCTION attendai.test_clock_failure()"));
  const result=await tick(),a=await data(id);assert.equal(result.absent,0);assert.equal(a.marks.length,0);assert.equal(a.session.state,'open');assert.equal(a.automation.review_reason,'clock_processing_failed');
  await owner(()=>db.exec('DROP TRIGGER test_clock_failure ON attendai.attendance_events; DROP FUNCTION attendai.test_clock_failure()'));
 });
 await check('bounded clock batches rotate rather than starving class 26',async()=>{const ids=[];for(let i=0;i<26;i++){const id=await session({automatic:true});await nowStart(id);ids.push(id);}const first=await tick();assert.equal(first.opened,25);await tick();for(const id of ids)assert.equal((await data(id)).session.state,'open');});
 await check('migration rerun refuses without changing saved attendance',async()=>{const count=await owner(async()=>(await db.query('SELECT count(*)::int AS n FROM attendai.attendance_records')).rows[0].n);await owner(async()=>{await assert.rejects(db.exec(await readFile(new URL('../db/migrations/009_class_automation.sql',import.meta.url),'utf8')));await db.exec('ROLLBACK');});assert.equal(await owner(async()=>(await db.query('SELECT count(*)::int AS n FROM attendai.attendance_records')).rows[0].n),count);});
 console.log(`Class automation software checks passed: ${n}. Fixtures are not live deployment or biometric validation.`);
}finally{key.fill(0);await db.close();}
