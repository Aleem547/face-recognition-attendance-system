import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {readWorkspace,mutateWorkspace} from '../lib/register/service.ts';
import {createTestDatabase} from './pglite-pool.mjs';
const {db,pool}=await createTestDatabase();let count=0;
async function check(name,fn){await fn();console.log(`PASS ${++count}: ${name}`);}
const users={};for(const [key,role] of [['admin','admin'],['a','teacher'],['b','teacher'],['s','student'],['t','student'],['u','student']])users[key]={id:randomUUID(),role,email:key+'@example.test',displayName:'Synthetic '+key};
const write=(who,action,fields)=>mutateWorkspace(pool,users[who],{action,...fields});
const analytics=(who,cursor=null)=>readWorkspace(pool,users[who],new URLSearchParams({resource:'analytics',...(cursor?{cursor}:{})}));
try{
  for(const name of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'));
  for(const person of Object.values(users))await db.query("INSERT INTO attendai.app_users(id,auth_provider,auth_subject,display_name,email,role) VALUES($1,'better-auth',$2,$3,$4,$5)",[person.id,'auth-'+person.id,person.displayName,person.email,person.role]);
  await db.exec('SET ROLE attendai_app');
  const students={};for(const key of ['s','t','u'])students[key]=(await write('admin','createStudent',{studentCode:'S-'+key,displayName:'Student '+key,accountEmail:users[key].email})).student.id;
  const c1=(await write('admin','createCourse',{courseCode:'C1',title:'Course one',teacherEmail:users.a.email})).course.id;
  const c2=(await write('admin','createCourse',{courseCode:'C2',title:'Course two',teacherEmail:users.b.email})).course.id;
  for(const key of ['s','t','u'])await write('admin','enrollStudent',{courseId:c1,studentCode:'S-'+key});
  await write('admin','enrollStudent',{courseId:c2,studentCode:'S-u'});
  async function session(code,courseId,who,statuses,close=true){
    const id=(await write(who,'createSession',{courseId,sessionCode:code,title:'Test '+code,startsAt:'2026-11-02T02:00:00.000Z',endsAt:'2026-11-02T03:00:00.000Z'})).session.id;
    await write(who,'setSessionState',{sessionId:id,state:'open',expectedState:'scheduled'});
    for(const [key,status] of Object.entries(statuses))await write(who,'markAttendance',{sessionId:id,studentId:students[key],status,reason:'Synthetic test',expectedRevision:0});
    if(close)await write(who,'setSessionState',{sessionId:id,state:'closed',expectedState:'open'});return id;
  }
  await session('C1-1',c1,'a',{s:'present',t:'absent',u:'excused'});
  await write('admin','endEnrollment',{courseId:c1,studentId:students.u});
  await session('C1-2',c1,'a',{s:'late',t:'absent'});
  await session('C1-OPEN',c1,'a',{s:'present'},false);
  await session('C2-1',c2,'b',{u:'excused'});
  await check('closed classes use frozen rosters and correct denominators',async()=>{const row=(await analytics('a')).items[0];assert.equal(row.sessions,2);assert.equal(row.roster_entries,5);assert.equal(row.excused,1);assert.equal(row.denominator,4);assert.equal(row.attendance_rate,50);assert.equal(row.manual,5);});
  await check('teachers cannot aggregate another course',async()=>{assert.deepEqual((await analytics('a')).items.map(row=>row.course_id),[c1]);assert.deepEqual((await analytics('b')).items.map(row=>row.course_id),[c2]);});
  await check('student aggregates include only their own saved entries',async()=>{const row=(await analytics('s')).items[0];assert.equal(row.roster_entries,2);assert.equal(row.present,1);assert.equal(row.late,1);assert.equal(row.absent,0);assert.equal(row.attendance_rate,100);const other=(await analytics('t')).items[0];assert.equal(other.attendance_rate,0);});
  await check('an all-excused denominator is N/A rather than 0 or 100 percent',async()=>{const row=(await analytics('b')).items[0];assert.equal(row.denominator,0);assert.equal(row.attendance_rate,null);});
  await check('admin sees both authorized course aggregates',async()=>assert.equal((await analytics('admin')).items.length,2));
  await check('missing or stale transaction identity cannot read aggregates',async()=>{await db.exec('RESET ROLE');await db.query('UPDATE attendai.app_users SET is_active=false WHERE id=$1',[users.b.id]);await db.exec('SET ROLE attendai_app');await assert.rejects(analytics('b'));});
  await check('cursor pages do not duplicate or truncate the course list',async()=>{
    for(let index=0;index<26;index++){const id=(await write('admin','createCourse',{courseCode:'PAGE-'+index,title:'Paged course'})).course.id;await write('admin','enrollStudent',{courseId:id,studentCode:'S-s'});await session('PAGE-'+index,id,'admin',{s:'present'});}
    const first=await analytics('admin');assert.equal(first.items.length,25);assert.ok(first.nextCursor);const second=await analytics('admin',first.nextCursor);assert.equal(second.items.length,3);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.items,...second.items].map(row=>row.course_id)).size,28);
  });
}finally{await db.close();}
