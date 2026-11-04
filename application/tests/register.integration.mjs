// Isolated PostgreSQL tests: no .env files, external database, or real accounts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readWorkspace, mutateWorkspace, publicRegisterError } from '../lib/register/service.ts';
import { assertMutationRequest, readSmallJson } from '../lib/register/http.ts';
import { csvCell, registerCsv } from '../lib/register/csv.ts';
import { createTestDatabase } from './pglite-pool.mjs';
const {db,pool}=await createTestDatabase();
let count=0;
async function check(name,fn){await fn();console.log(`PASS ${++count}: ${name}`);}
const people={};
for(const [key,role] of [['admin','admin'],['a','teacher'],['b','teacher'],['s','student'],['t','student'],['u','student']]) {
  people[key]={id:randomUUID(),role,email:key+'@example.test',displayName:'Synthetic '+key};
}
const read=(who,resource,params={})=>readWorkspace(pool,people[who],new URLSearchParams({resource,...params}));
const write=(who,action,fields={})=>mutateWorkspace(pool,people[who],{action,...fields});
async function denied(promise,status){await assert.rejects(promise,error=>publicRegisterError(error).status===status);}
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE attendai_app');}}
const studentIds={};let c1,c2,s1,s2,mark;
try {
  for(const file of ['001_initial_schema.sql','002_authentication.sql','003_persistent_register.sql']) {
    await db.exec(await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8'));
  }
  await check('migration 003 records the new schema without demo rows',async()=>{
    assert.equal((await db.query("SELECT count(*)::int AS n FROM attendai.schema_migrations")).rows[0].n,3);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM attendai.students")).rows[0].n,0);
  });
  for(const person of Object.values(people)) await db.query(`INSERT INTO attendai.app_users
    (id,auth_provider,auth_subject,display_name,email,role) VALUES ($1,'better-auth',$2,$3,$4,$5)`,
    [person.id,'auth-'+person.id,person.displayName,person.email,person.role]);
  await db.exec('SET ROLE attendai_app');
  await check('no transaction identity gives no business rows',async()=>{
    assert.equal((await db.query('SELECT * FROM attendai.students')).rows.length,0);
  });
  await check('teacher and student cannot create student records',async()=>{
    for(const role of ['a','s'])await denied(write(role,'createStudent',{studentCode:'FORBIDDEN',displayName:'No'}),403);
  });
  await check('admin creates linked students and an unlinked roster entry',async()=>{
    for(const key of ['s','t','u']) {
      const result=await write('admin','createStudent',{studentCode:'STU-'+key.toUpperCase(),displayName:'Student '+key,accountEmail:people[key].email});
      studentIds[key]=result.student.id;
    }
    studentIds.unlinked=(await write('admin','createStudent',{studentCode:'STU-UNLINKED',displayName:'Unlinked student'})).student.id;
  });
  await check('duplicate student codes and duplicate account links are rejected',async()=>{
    await denied(write('admin','createStudent',{studentCode:'STU-S',displayName:'Duplicate'}),409);
    await denied(write('admin','createStudent',{studentCode:'STU-DUP',displayName:'Duplicate',accountEmail:people.s.email}),409);
    await denied(write('admin','linkStudent',{studentId:studentIds.unlinked,accountEmail:people.a.email}),400);
  });
  await check('active teacher ownership is required for course assignment',async()=>{
    await denied(write('admin','createCourse',{courseCode:'BAD',title:'Bad',teacherEmail:people.s.email}),400);
    c1=(await write('admin','createCourse',{courseCode:'CS-101',title:'Course A',teacherEmail:people.a.email})).course.id;
    c2=(await write('admin','createCourse',{courseCode:'CS-102',title:'Course B',teacherEmail:people.b.email})).course.id;
  });
  await check('enrollment supports reactivation without duplicate memberships',async()=>{
    for(const [courseId,studentCode] of [[c1,'STU-S'],[c1,'STU-T'],[c2,'STU-U'],[c2,'STU-S']])await write('admin','enrollStudent',{courseId,studentCode});
    await write('admin','endEnrollment',{courseId:c1,studentId:studentIds.t});
    await write('admin','enrollStudent',{courseId:c1,studentCode:'STU-T'});
    assert.equal((await read('admin','enrollments',{courseId:c1})).items.length,2);
  });
  await check('teachers see only their courses and linked students see only themselves',async()=>{
    assert.deepEqual((await read('a','courses')).items.map(c=>c.id),[c1]);
    assert.deepEqual((await read('b','courses')).items.map(c=>c.id),[c2]);
    assert.deepEqual((await read('s','students')).items.map(s=>s.id),[studentIds.s]);
    assert.equal((await read('a','students')).items.some(s=>s.id===studentIds.u),false);
    assert.equal((await read('s','enrollments',{courseId:c1})).items.length,1);
    await denied(read('t','enrollments',{courseId:c2}),404);
  });
  const sessionFields={title:'Morning class',startsAt:'2026-10-22T03:30:00.000Z',endsAt:'2026-10-22T04:30:00.000Z'};
  await check('session creation validates dates, ownership, and multiple sessions per day',async()=>{
    await denied(write('a','createSession',{...sessionFields,sessionCode:'BAD-TIME',courseId:c1,endsAt:sessionFields.startsAt}),400);
    await denied(write('b','createSession',{...sessionFields,sessionCode:'BAD-OWNER',courseId:c1}),404);
    s1=(await write('a','createSession',{...sessionFields,sessionCode:'SESSION-1',courseId:c1})).session.id;
    s2=(await write('a','createSession',{...sessionFields,sessionCode:'SESSION-2',courseId:c1})).session.id;
    assert.equal((await read('a','sessions')).items.length,2);
  });
  await check('scheduled attendance is refused and opening captures a roster',async()=>{
    await denied(write('a','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'present',reason:'Manual check',expectedRevision:0}),404);
    await write('a','setSessionState',{sessionId:s1,state:'open',expectedState:'scheduled'});
    assert.equal((await read('a','register',{sessionId:s1})).summary.roster,2);
  });
  await check('opening an empty course fails without a partial snapshot',async()=>{
    const empty=(await write('admin','createCourse',{courseCode:'CS-EMPTY',title:'Empty'})).course.id;
    const session=(await write('admin','createSession',{...sessionFields,sessionCode:'EMPTY-1',courseId:empty})).session.id;
    await denied(write('admin','setSessionState',{sessionId:session,state:'open',expectedState:'scheduled'}),409);
    assert.equal((await read('admin','register',{sessionId:session})).summary.roster,0);
    assert.equal((await read('admin','register',{sessionId:session})).session.state,'scheduled');
  });
  await check('roster membership stays frozen after enrollment ends',async()=>{
    await write('admin','endEnrollment',{courseId:c1,studentId:studentIds.t});
    assert.equal((await read('a','register',{sessionId:s1})).summary.roster,2);
    await write('a','setSessionState',{sessionId:s2,state:'open',expectedState:'scheduled'});
    assert.equal((await read('a','register',{sessionId:s2})).summary.roster,1);
    await denied(read('t','register',{sessionId:s2}),404);
  });
  await check('a session cannot close with unmarked students',async()=>{
    await denied(write('a','setSessionState',{sessionId:s1,state:'closed',expectedState:'open'}),409);
  });
  await check('an initial manual mark is persisted with a server receipt',async()=>{
    mark=(await write('a','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'present',reason:'Manual classroom check',expectedRevision:0})).attendance;
    assert.equal(mark.revision,1);
    const receipt=(await read('a','history',{attendanceId:mark.id})).items[0];
    assert.equal(receipt.actor_name,people.a.displayName);assert.equal(receipt.action,'created');
    assert.equal(receipt.previous_status,null);assert.equal(receipt.new_status,'present');
    assert.equal((await read('a','register',{sessionId:s1})).summary.present,1);
  });
  await check('another teacher and students cannot mark or read a hidden receipt',async()=>{
    await denied(write('b','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'absent',reason:'Forbidden',expectedRevision:1}),404);
    await denied(write('s','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'present',reason:'Forbidden',expectedRevision:1}),403);
    await denied(read('u','history',{attendanceId:mark.id}),404);
  });
  await check('a student sharing courses cannot read a peer record or class totals',async()=>{
    const result=await read('s','register',{sessionId:s1});assert.equal(result.items.length,1);
    assert.equal(result.items[0].student_id,studentIds.s);assert.equal(result.summary.roster,1);
    assert.equal((await read('t','register',{sessionId:s1})).summary.present,0);
  });
  await check('duplicate retries and stale revisions produce conflicts without extra events',async()=>{
    await denied(write('a','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'present',reason:'Retry',expectedRevision:0}),409);
    assert.equal((await read('a','history',{attendanceId:mark.id})).items.length,1);
  });
  await check('unmarked filter preserves totals for the whole authorized roster',async()=>{
    const result=await read('a','register',{sessionId:s1,unmarked:'true'});
    assert.equal(result.items.length,1);assert.equal(result.summary.roster,2);assert.equal(result.summary.unmarked,1);
  });
  await check('out-of-roster marks and forged actor/timestamp fields are refused',async()=>{
    await denied(write('a','markAttendance',{sessionId:s1,studentId:studentIds.u,status:'present',reason:'Not enrolled',expectedRevision:0}),404);
    await denied(write('a','markAttendance',{sessionId:s1,studentId:studentIds.t,status:'present',reason:'Forged',expectedRevision:0,markedBy:people.admin.id}),400);
    await denied(write('a','markAttendance',{sessionId:s1,studentId:studentIds.t,status:'present',reason:'Forged',expectedRevision:0,recordedAt:'2000-01-01'}),400);
  });
  await check('closing a complete register preserves explicit absent and excused statuses',async()=>{
    await write('a','markAttendance',{sessionId:s1,studentId:studentIds.t,status:'excused',reason:'Approved excused absence',expectedRevision:0});
    await write('a','setSessionState',{sessionId:s1,state:'closed',expectedState:'open'});
    const result=await read('a','register',{sessionId:s1});assert.equal(result.summary.excused,1);assert.equal(result.summary.unmarked,0);
    await denied(write('a','setSessionState',{sessionId:s1,state:'open',expectedState:'closed'}),409);
    await denied(write('a','setSessionState',{sessionId:s1,state:'closed',expectedState:'open'}),409);
  });
  await check('closed-register corrections require a reason and increment revision atomically',async()=>{
    await denied(write('a','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'late',reason:' ',expectedRevision:1}),400);
    const result=await write('a','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'late',reason:'Arrival time reviewed',expectedRevision:1});
    assert.equal(result.attendance.revision,2);
    const events=(await read('a','history',{attendanceId:mark.id})).items;
    assert.equal(events.length,2);assert.equal(events[0].previous_status,'present');assert.equal(events[0].new_status,'late');
    await denied(write('a','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'absent',reason:'Stale edit',expectedRevision:1}),409);
  });
  await check('same-status retries do not invent a correction receipt',async()=>{
    const result=await write('a','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'late',reason:'No change',expectedRevision:2});
    assert.equal(result.unchanged,true);assert.equal((await read('a','history',{attendanceId:mark.id})).items.length,2);
  });
  await check('failure to append a receipt rolls back the mark and revision',async()=>{
    await owner(()=>db.exec(`CREATE FUNCTION attendai.test_event_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.reason='Injected receipt failure' THEN RAISE EXCEPTION 'Injected failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_event_failure BEFORE INSERT ON attendai.attendance_events FOR EACH ROW EXECUTE FUNCTION attendai.test_event_failure();`));
    await assert.rejects(write('a','markAttendance',{sessionId:s1,studentId:studentIds.s,status:'absent',reason:'Injected receipt failure',expectedRevision:2}));
    assert.equal((await read('a','history',{attendanceId:mark.id})).items.length,2);
    assert.equal((await read('s','register',{sessionId:s1})).items[0].revision,2);
    await owner(()=>db.exec('DROP TRIGGER test_event_failure ON attendai.attendance_events; DROP FUNCTION attendai.test_event_failure();'));
  });
  await check('runtime cannot forge receipts, modify revisions, change snapshots, or delete marks',async()=>{
    for(const sql of ["DELETE FROM attendai.attendance_records", "UPDATE attendai.attendance_records SET revision=999", "DELETE FROM attendai.session_roster",
      "INSERT INTO attendai.attendance_events DEFAULT VALUES", "TRUNCATE attendai.attendance_events", "UPDATE attendai.app_users SET role='admin'"]) {
      await assert.rejects(db.query(sql),error=>error.code==='42501');
    }
  });
  await check('context clears after successful and failed transactions',async()=>{
    assert.equal((await db.query('SELECT attendai.actor_id() AS id')).rows[0].id,null);
    await denied(read('b','register',{sessionId:s1}),404);
    assert.equal((await db.query('SELECT attendai.actor_id() AS id')).rows[0].id,null);
    assert.equal((await db.query('SELECT * FROM attendai.attendance_records')).rows.length,0);
  });
  await check('inactive accounts fail closed even with a previously verified identity',async()=>{
    await owner(()=>db.query('UPDATE attendai.app_users SET is_active=false WHERE id=$1',[people.a.id]));
    await denied(read('a','summary'),403);
    await owner(()=>db.query('UPDATE attendai.app_users SET is_active=true WHERE id=$1',[people.a.id]));
  });
  await check('paged lists return all records without silently truncating counts',async()=>{
    await owner(async()=>{for(let i=0;i<30;i++)await db.query('INSERT INTO attendai.students(student_code,display_name) VALUES($1,$2)',['PAGE-'+i,'Page student '+i]);});
    const first=await read('admin','students');assert.equal(first.items.length,25);assert.ok(first.nextCursor);
    const second=await read('admin','students',{cursor:first.nextCursor});assert.equal(second.items.length,9);assert.equal(second.nextCursor,null);
    assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,34);
    assert.equal((await read('admin','summary')).students,34);
  });
  await check('malformed identifiers, SQL-like codes, and unknown actions are rejected',async()=>{
    await denied(read('admin','students',{cursor:"x' OR 1=1"}),400);
    await denied(write('admin','createStudent',{studentCode:"A'; DROP TABLE students",displayName:'No'}),400);
    await denied(write('admin','grantAdmin'),400);
  });
  await check('mutation guard requires the configured origin and JSON',async()=>{
    for(const headers of [{Origin:'https://untrusted.example','Content-Type':'application/json'}, {'Content-Type':'application/json'},
      {Origin:'http://localhost:3000','Content-Type':'text/plain'}]) {
      assert.throws(()=>assertMutationRequest(new Request('http://localhost:3000/api/workspace',{method:'POST',headers}),'http://localhost:3000'));
    }
    assertMutationRequest(new Request('http://localhost:3000/api/workspace',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'}}),'http://localhost:3000');
  });
  await check('body limit covers streamed requests and invalid JSON',async()=>{
    await denied(readSmallJson(new Request('http://localhost',{method:'POST',body:'x'.repeat(17000)})),413);
    await denied(readSmallJson(new Request('http://localhost',{method:'POST',body:'{broken'})),400);
    assert.deepEqual(await readSmallJson(new Request('http://localhost',{method:'POST',body:'{"action":"test"}'})),{action:'test'});
  });
  await check('CSV escaping neutralizes formulas and preserves quotes and newlines',async()=>{
    assert.equal(csvCell(' =2+2'),'"\' =2+2"');assert.equal(csvCell('a"b'),'"a""b"');
    assert.ok(registerCsv([{display_name:'@SUM(A1)',status:'present'}]).includes('"\'@SUM(A1)"'));
    assert.equal(csvCell('line\nbreak'),'"line\nbreak"');
  });
  await check('migration rerun refuses existing objects and preserves attendance',async()=>{
    await db.exec('RESET ROLE');
    await assert.rejects(db.exec(await readFile(new URL('../db/migrations/003_persistent_register.sql',import.meta.url),'utf8')));
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai.attendance_records')).rows[0].n,2);
  });
  console.log(`Persistent register checks passed: ${count}.`);
} finally { await db.close(); }
