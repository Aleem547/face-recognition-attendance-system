// Isolated PostgreSQL. Does not read .env files or connect to Neon.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './pglite-pool.mjs';
import { readPrivacy, mutatePrivacy, privacyError } from '../lib/privacy/service.ts';
import { actorTransaction, mutateWorkspace } from '../lib/register/service.ts';
const {db,pool}=await createTestDatabase();let checks=0;
async function check(name,fn){await fn();console.log(`PASS ${++checks}: ${name}`);}
async function denied(promise,status){await assert.rejects(promise,e=>privacyError(e).status===status);}
const people={};for(const [key,role] of [['admin','admin'],['teacher','teacher'],['otherTeacher','teacher'],['s','student'],['t','student'],['unlinked','student']])people[key]={id:randomUUID(),role,displayName:'Synthetic '+key,email:key+'@example.test'};
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE attendai_app');}}
const read=(who,params)=>readPrivacy(pool,people[who],new URLSearchParams(params));
const choose=(who,body)=>mutatePrivacy(pool,people[who],body);
let s,t,course,version,attendance;
async function grant(who='s',overrides={}){const state=await read(who);return choose(who,{action:'grantPreview',noticeVersion:state.notice.version,expectedRevision:state.preference?.revision??0,acknowledged:true,...overrides});}
try {
  for(const file of ['001_initial_schema.sql','002_authentication.sql','003_persistent_register.sql','004_camera_choice.sql'])await db.exec(await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8'));
  await check('migration 004 adds a current local-preview notice and no student choices',async()=>{
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai.camera_notices WHERE is_current')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai.camera_choices')).rows[0].n,0);
  });
  for(const p of Object.values(people))await db.query(`INSERT INTO attendai.app_users(id,auth_provider,auth_subject,display_name,email,role)
    VALUES($1,'better-auth',$2,$3,$4,$5)`,[p.id,'auth-'+p.id,p.displayName,p.email,p.role]);
  s=(await db.query("INSERT INTO attendai.students(student_code,display_name,user_id) VALUES('STU-S','Synthetic S',$1) RETURNING id",[people.s.id])).rows[0].id;
  t=(await db.query("INSERT INTO attendai.students(student_code,display_name,user_id) VALUES('STU-T','Synthetic T',$1) RETURNING id",[people.t.id])).rows[0].id;
  course=(await db.query("INSERT INTO attendai.courses(course_code,title,teacher_id) VALUES('CS-101','Synthetic course',$1) RETURNING id",[people.teacher.id])).rows[0].id;
  await db.query('INSERT INTO attendai.enrollments(course_id,student_id) VALUES($1,$2)',[course,s]);
  await db.exec('SET ROLE attendai_app');
  const session=(await mutateWorkspace(pool,people.teacher,{action:'createSession',courseId:course,sessionCode:'CLASS-1',title:'Class',startsAt:'2026-10-22T10:00:00Z',endsAt:'2026-10-22T11:00:00Z'})).session.id;
  await mutateWorkspace(pool,people.teacher,{action:'setSessionState',sessionId:session,state:'open',expectedState:'scheduled'});
  attendance=(await mutateWorkspace(pool,people.teacher,{action:'markAttendance',sessionId:session,studentId:s,status:'present',reason:'Manual check',expectedRevision:0})).attendance.id;
  await check('unrecorded choice defaults to manual with preview disabled',async()=>{
    const state=await read('s');version=state.notice.version;assert.equal(state.notice.purpose,'local_camera_preview');assert.equal(state.preference.choice,'not_recorded');assert.equal(state.preference.allowed,false);assert.equal(state.preference.revision,0);
  });
  await check('unlinked student can read the notice but cannot enable preview',async()=>{
    assert.equal((await read('unlinked')).student,null);await denied(grant('unlinked'),403);
  });
  await check('staff cannot grant student consent through the API service',async()=>{
    for(const who of ['admin','teacher'])await denied(choose(who,{action:'grantPreview',noticeVersion:version,expectedRevision:0,acknowledged:true}),403);
  });
  await check('a grant requires affirmative acknowledgment and the current notice',async()=>{
    await denied(grant('s',{acknowledged:false}),400);await denied(grant('s',{noticeVersion:'stale'}),409);
  });
  await check('forged identities, expiry, role, and revision metadata are rejected',async()=>{
    for(const extra of [{studentId:t},{actorId:people.admin.id},{expiresAt:'2099-01-01'},{role:'admin'}])await denied(grant('s',extra),400);
  });
  await check('grant records server timestamps, a 30-day expiry, and an atomic receipt',async()=>{
    const result=await grant();assert.equal(result.preference.revision,1);assert.equal(result.preference.allowed,true);
    assert.equal(Date.parse(result.preference.expires_at)-Date.parse(result.preference.decided_at),30*24*60*60*1000);
    const state=await read('s');assert.equal(state.history.length,1);assert.equal(state.history[0].previous_choice,null);assert.equal(state.history[0].new_choice,'granted');
  });
  await check('same-choice retry does not renew expiry or invent an event',async()=>{
    const before=await read('s');const result=await grant();assert.equal(result.unchanged,true);assert.equal(String(result.preference.expires_at),String(before.preference.expires_at));assert.equal((await read('s')).history.length,1);
  });
  await check('stale grant revisions conflict',async()=>{await denied(grant('s',{expectedRevision:0}),409);});
  await check('a peer cannot read another student choice or history',async()=>{
    assert.equal((await read('t')).preference.choice,'not_recorded');assert.equal((await read('t')).history.length,0);
    const rows=await actorTransaction(pool,people.t,client=>client.query('SELECT * FROM attendai.camera_choices WHERE student_id=$1',[s]),true);assert.equal(rows.rowCount,0);
  });
  await check('staff views respect course scope and do not allow history access',async()=>{
    assert.equal((await read('admin')).students.length,2);assert.equal((await read('teacher')).students.length,1);assert.equal((await read('otherTeacher')).students.length,0);
    assert.equal((await actorTransaction(pool,people.teacher,c=>c.query('SELECT * FROM attendai.camera_choice_events'),true)).rowCount,0);
  });
  await check('withdrawal succeeds without stale screen revision or renewed notice acceptance',async()=>{
    const result=await choose('s',{action:'withdraw'});assert.equal(result.preference.choice,'withdrawn');assert.equal(result.preference.revision,2);assert.equal(result.preference.allowed,false);assert.equal(result.preference.expires_at,null);
    await denied(grant('s',{expectedRevision:1}),409);
  });
  await check('choosing manual preserves manual attendance and adds a choice receipt',async()=>{
    await grant();const result=await choose('s',{action:'chooseManual'});assert.equal(result.preference.choice,'manual');assert.equal(result.preference.allowed,false);
    const row=(await actorTransaction(pool,people.s,c=>c.query('SELECT status,revision FROM attendai.attendance_records WHERE id=$1',[attendance]),true)).rows[0];assert.deepEqual(row,{status:'present',revision:1});
  });
  await check('a new notice invalidates an old grant and preserves published notice content',async()=>{
    await grant();await owner(async()=>{
      await assert.rejects(db.query("UPDATE attendai.camera_notices SET body='rewritten' WHERE is_current"),e=>e.code==='55000');
      await db.exec(`UPDATE attendai.camera_notices SET is_current=false; INSERT INTO attendai.camera_notices(version,purpose,title,body,is_current) VALUES('camera-preview-next','local_camera_preview','New notice','Updated local preview notice',true);`);
    });
    assert.equal((await read('s')).preference.allowed,false);await denied(grant('s',{noticeVersion:version}),409);
    await choose('s',{action:'withdraw'});assert.equal((await read('s')).preference.choice,'withdrawn');
  });
  await check('expired grant is disabled and explicit renewal gets a new revision',async()=>{
    await grant();const before=(await read('s')).preference.revision;
    // Synthetic time-travel fixture only: no connection to the user's database.
    await owner(()=>db.exec(`ALTER TABLE attendai.camera_choices DISABLE TRIGGER USER;
      UPDATE attendai.camera_choices SET expires_at=clock_timestamp()-interval '1 day' WHERE student_id='${s}';
      ALTER TABLE attendai.camera_choices ENABLE TRIGGER USER;`));
    assert.equal((await read('s')).preference.allowed,false);assert.equal((await grant()).preference.revision,before+1);
  });
  await check('inactive roster entries cannot preview but can still withdraw',async()=>{
    await owner(()=>db.query('UPDATE attendai.students SET is_active=false WHERE id=$1',[s]));
    assert.equal((await read('s')).preference.allowed,false);await denied(grant(),403);
    assert.equal((await choose('s',{action:'withdraw'})).preference.choice,'withdrawn');
    await owner(()=>db.query('UPDATE attendai.students SET is_active=true WHERE id=$1',[s]));
  });
  await check('receipt failure rolls back a preference change',async()=>{
    const before=await read('s');await owner(()=>db.exec(`CREATE FUNCTION attendai.test_camera_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END $$;
      CREATE TRIGGER test_camera_failure BEFORE INSERT ON attendai.camera_choice_events FOR EACH ROW EXECUTE FUNCTION attendai.test_camera_failure();`));
    await assert.rejects(grant());const after=await read('s');assert.equal(after.preference.revision,before.preference.revision);assert.equal(after.history.length,before.history.length);
    await owner(()=>db.exec('DROP TRIGGER test_camera_failure ON attendai.camera_choice_events; DROP FUNCTION attendai.test_camera_failure();'));
  });
  await check('runtime cannot forge events, modify timestamps, publish notices, or delete choices',async()=>{
    for(const sql of ['DELETE FROM attendai.camera_choices','UPDATE attendai.camera_choices SET expires_at=current_timestamp','INSERT INTO attendai.camera_choice_events DEFAULT VALUES',"UPDATE attendai.camera_notices SET body='fake'",'TRUNCATE attendai.camera_choice_events'])await assert.rejects(db.query(sql),e=>e.code==='42501');
  });
  await check('inactive account fails closed and actor context clears',async()=>{
    await owner(()=>db.query('UPDATE attendai.app_users SET is_active=false WHERE id=$1',[people.s.id]));await denied(read('s'),403);
    assert.equal((await db.query('SELECT attendai.actor_id() AS id')).rows[0].id,null);
  });
  await check('migration rerun refuses existing objects without removing history',async()=>{
    await db.exec('RESET ROLE');await assert.rejects(db.exec(await readFile(new URL('../db/migrations/004_camera_choice.sql',import.meta.url),'utf8')));await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM attendai.schema_migrations WHERE version='004'")).rows[0].n,1);
  });
  console.log(`Camera choice database checks passed: ${checks}.`);
}finally{await db.close();}
