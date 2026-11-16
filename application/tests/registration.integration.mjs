// Real auth handlers and PostgreSQL rules in isolated PGlite. No .env or live DB.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {PostgresDialect} from 'kysely';
import {createAttendAuth} from '../lib/auth/core.ts';
import {resolveIdentity,permissionStatus} from '../lib/auth/identity.ts';
import {studentRegistrationHandler,registrationInput,registrationError,
  ownRegistrationStatus,pendingRegistrations,reviewRegistration} from '../lib/auth/registration.ts';
import {actorTransaction,readWorkspace} from '../lib/register/service.ts';
import {createTestDatabase} from './pglite-pool.mjs';
import {registrationAddresses,applyStudentRegistration} from '../scripts/apply-student-registration.mjs';

const {db,pool}=await createTestDatabase();
const origin='http://localhost:3000',secret=randomBytes(48).toString('base64url');
const password='Synthetic-'+randomBytes(24).toString('hex');
const database=()=>({dialect:new PostgresDialect({pool}),type:'postgres',schemaName:'attendai_auth'});
let auth,signupAuth,bootstrap;
const register=studentRegistrationHandler({pool,configuredOrigin:origin,signup:r=>signupAuth.handler(r)});
const cookies=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
let count=0,sequence=0;
async function check(name,fn){await fn();console.log(`PASS ${++count}: ${name}`);}
function input(studentCode='NEW-'+(++sequence)){
  return {name:'Synthetic Student '+sequence,email:'registration-'+sequence+'@example.test',password,studentCode};
}
function request(body,extra={}){
  const headers=new Headers({'Origin':origin,'Content-Type':'application/json','X-Forwarded-For':'192.0.2.'+(++sequence)});
  for(const [k,v]of Object.entries(extra))v===null?headers.delete(k):headers.set(k,v);
  return new Request(origin+'/api/registration',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
}
async function owner(work){await db.exec('RESET ROLE');try{return await work();}finally{await db.exec('SET ROLE attendai_app');}}
async function identity(cookie){return resolveIdentity(new Headers(cookie?{Cookie:cookie}:{}),{
  session:headers=>auth.api.getSession({headers}),profile:async id=>(await db.query(`SELECT id,display_name,email,role,is_active,auth_subject
    FROM attendai.app_users WHERE auth_provider='better-auth' AND auth_subject=$1`,[id])).rows[0]??null});}
async function signIn(email,instance=auth,base=origin){return instance.handler(new Request(base+'/api/auth/sign-in/email',{
  method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Forwarded-For':'203.0.113.'+(++sequence)},
  body:JSON.stringify({email,password,rememberMe:false})}));}
async function record(email){return (await owner(()=>db.query(`SELECT u.id,u.auth_subject,u.role,u.is_active,r.id AS request_id,r.status,r.student_code
  FROM attendai.app_users u LEFT JOIN attendai.student_registrations r ON r.app_user_id=u.id WHERE u.email=$1`,[email]))).rows[0];}
const people={};let first,second,existingStudentId,courseId,firstCookie;
try{
  for(const file of ['001_initial_schema.sql','002_authentication.sql','003_persistent_register.sql'])
    await db.exec(await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8'));
  auth=createAttendAuth({database:database(),baseURL:origin,secret});
  signupAuth=createAttendAuth({database:database(),baseURL:origin,secret,studentRegistration:true});
  bootstrap=createAttendAuth({database:database(),baseURL:origin,secret,bootstrap:true});
  for(const role of ['admin','teacher','student']){
    const created=await bootstrap.api.signUpEmail({body:{email:'existing-'+role+'@example.test',password,name:'Existing '+role}});
    const p=(await db.query(`INSERT INTO attendai.app_users(auth_provider,auth_subject,display_name,email,role)
      VALUES('better-auth',$1,$2,$3,$4) RETURNING id`,[created.user.id,'Existing '+role,created.user.email,role])).rows[0];
    people[role]={id:p.id,role,email:created.user.email,displayName:'Existing '+role,authId:created.user.id};
  }
  await db.exec('SET ROLE attendai_app');
  await check('missing migration fails before any authentication account is created',async()=>{
    const before=(await db.query('SELECT count(*)::int AS n FROM attendai_auth.users')).rows[0].n;
    const result=await register(request(input()));assert.equal(result.status,503);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai_auth.users')).rows[0].n,before);
  });
  await check('migration 010 is additive and grants no direct profile-writing privileges',async()=>{
    const client={query:sql=>sql.includes('CREATE TABLE')?db.exec(sql):db.query(sql)};
    assert.equal(await owner(()=>applyStudentRegistration(client)),'applied');
    assert.equal(await owner(()=>applyStudentRegistration(client)),'already_applied');
  });
}catch(error){
  // Setup continues below only when migration completed successfully.
  throw error;
}

try{
  await check('owner migration settings enforce matching databases, restricted runtime identity and verified TLS',async()=>{
    const ownerURL=new URL('postgresql://db.example.test/fras');ownerURL.username='owner';ownerURL.password=password;
    const appURL=new URL(ownerURL);appURL.username='attendai_app';appURL.hostname='db-pooler.example.test';
    const env={DATABASE_URL:ownerURL.toString(),APP_DATABASE_URL:appURL.toString()};
    const addresses=registrationAddresses(env);
    assert.equal(new URL(addresses.owner).searchParams.get('sslmode'),'verify-full');
    assert.equal(new URL(addresses.app).searchParams.get('sslmode'),'verify-full');
    assert.throws(()=>registrationAddresses({...env,APP_DATABASE_URL:ownerURL.toString()}),/attendai_app/);
    const other=new URL(appURL);other.pathname='/other';
    assert.throws(()=>registrationAddresses({...env,APP_DATABASE_URL:other.toString()}),/same database/);
    assert.throws(()=>registrationAddresses({}),/private owner/);
  });
  await check('student registration table starts empty and existing profiles remain unchanged',async()=>{
    assert.equal((await owner(()=>db.query('SELECT count(*)::int AS n FROM attendai.student_registrations'))).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai.app_users')).rows[0].n,3);
    for(const action of ['INSERT','UPDATE'])assert.equal((await db.query(`SELECT has_table_privilege(current_user,'attendai.app_users',$1) AS allowed`,[action])).rows[0].allowed,false);
  });
  await check('registration normalizes names, emails and student numbers',async()=>{
    assert.deepEqual(registrationInput({name:'  Synthetic Person  ',email:'  STUDENT@EXAMPLE.TEST ',password,studentCode:' stu-001 '}),
      {name:'Synthetic Person',email:'student@example.test',password,studentCode:'STU-001'});
  });
  await check('role and record-link injection is rejected before auth writes',async()=>{
    const before=(await db.query('SELECT count(*)::int AS n FROM attendai_auth.users')).rows[0].n;
    for(const field of ['role','is_active','studentId','auth_subject','approved']){
      const result=await register(request({...input(),[field]:'admin'}));assert.equal(result.status,400);
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai_auth.users')).rows[0].n,before);
  });
  await check('same-origin and JSON guards reject cross-site and malformed input',async()=>{
    for(const headers of [{Origin:null},{Origin:'https://untrusted.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await register(request(input(),headers))).status,403);
    assert.equal((await register(request(input(),{'Content-Type':'text/plain'}))).status,415);
    assert.equal((await register(request('{invalid'))).status,400);
    assert.equal((await register(request(input(),{'Content-Length':'20000'}))).status,413);
  });
  await check('password, name, email and student number rules are enforced',async()=>{
    for(const value of [{...input(),password:'short'},{...input(),name:'\u0000bad'},{...input(),email:'bad'},{...input(),studentCode:'<bad>'}])assert.equal((await register(request(value))).status,400);
  });
  await check('raw public signup remains disabled even for a requested admin role',async()=>{
    const result=await auth.handler(new Request(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({...input(),role:'admin'})}));
    assert.ok(result.status>=400&&result.status<500);
  });
  await check('registration creates a pending student account and a secure session cookie',async()=>{
    first=input();const result=await register(request(first));assert.equal(result.status,201);
    assert.deepEqual(await result.json(),{status:'pending',redirect:'/access-denied'});
    firstCookie=cookies(result);assert.ok(firstCookie.includes('session_token='));
    assert.match(result.headers.getSetCookie().join(';'),/HttpOnly/i);assert.match(result.headers.getSetCookie().join(';'),/SameSite=Lax/i);
    const row=await record(first.email);assert.equal(row.role,'student');assert.equal(row.is_active,false);assert.equal(row.status,'pending');
    assert.equal(permissionStatus(await identity(firstCookie)),403);
  });
  await check('pending users can sign in and read their own approval status',async()=>{
    const result=await signIn(first.email);assert.equal(result.status,200);
    const session=await auth.api.getSession({headers:new Headers({Cookie:cookies(result)})});
    const status=await ownRegistrationStatus(pool,session.user.id);
    assert.equal(status.status,'pending');assert.equal(status.studentCode,first.studentCode);
  });
  await check('pending registration does not create or claim a roster entry',async()=>{
    assert.equal((await owner(()=>db.query('SELECT count(*)::int AS n FROM attendai.students'))).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai.student_registrations')).rows[0].n,0);
  });
  await check('duplicate signup cannot replace an existing account or password',async()=>{
    const before=await record(first.email);const result=await register(request({...first,password:password+'different'}));
    assert.equal(result.status,409);assert.deepEqual(await record(first.email),before);
    assert.equal((await signIn(first.email)).status,200);
  });
  await check('admin and staff roles still authenticate through the ordinary login handler',async()=>{
    for(const role of ['admin','teacher']){
      const response=await signIn(people[role].email);assert.equal(response.status,200);
      assert.equal((await identity(cookies(response))).account.role,role);
    }
  });
  await check('only admins may list pending registrations',async()=>{
    assert.equal((await pendingRegistrations(pool,people.admin)).requests.length,1);
    for(const who of ['teacher','student'])await assert.rejects(pendingRegistrations(pool,people[who]),e=>e.status===403);
  });
  await check('teacher, student and forged admin objects cannot approve requests',async()=>{
    const row=await record(first.email),body={requestId:row.request_id,decision:'approve'};
    for(const who of ['teacher','student'])await assert.rejects(reviewRegistration(pool,people[who],body),e=>e.status===403);
    await assert.rejects(reviewRegistration(pool,{...people.student,role:'admin'},body),e=>e.status===403);
    await assert.rejects(actorTransaction(pool,people.teacher,connection=>connection.query('SELECT attendai.review_student_registration($1,$2,NULL)',[row.request_id,'approve'])),e=>e.code==='42501');
  });
  await check('admin approval creates exactly one student link and activates only the student role',async()=>{
    const row=await record(first.email);const result=await reviewRegistration(pool,people.admin,{requestId:row.request_id,decision:'approve'});
    assert.equal(result.status,'approved');assert.ok(result.studentId);
    const after=await record(first.email);assert.equal(after.role,'student');assert.equal(after.is_active,true);
    assert.equal((await identity(firstCookie)).account.role,'student');
    const student=(await owner(()=>db.query('SELECT user_id,student_code FROM attendai.students WHERE id=$1',[result.studentId]))).rows[0];
    assert.equal(student.user_id,row.id);assert.equal(student.student_code,first.studentCode);
  });
  await check('replaying an approval cannot create another student or grant another role',async()=>{
    const row=await record(first.email);
    await assert.rejects(reviewRegistration(pool,people.admin,{requestId:row.request_id,decision:'approve'}),e=>e.code==='40001');
    await assert.rejects(reviewRegistration(pool,people.admin,{requestId:row.request_id,decision:'approve',role:'admin'}),e=>e.status===400);
    assert.equal((await owner(()=>db.query('SELECT count(*)::int AS n FROM attendai.students WHERE user_id=$1',[row.id]))).rows[0].n,1);
  });
  await check('claiming an existing student number still requires explicit admin linking',async()=>{
    await owner(async()=>{
      existingStudentId=(await db.query("INSERT INTO attendai.students(student_code,display_name) VALUES('EXIST-001','Existing Roster Student') RETURNING id")).rows[0].id;
      courseId=(await db.query("INSERT INTO attendai.courses(course_code,title,teacher_id) VALUES('REG-101','Registration Test Course',$1) RETURNING id",[people.teacher.id])).rows[0].id;
      await db.query('INSERT INTO attendai.enrollments(course_id,student_id) VALUES($1,$2)',[courseId,existingStudentId]);
    });
    second=input('EXIST-001');assert.equal((await register(request(second))).status,201);
    assert.equal((await owner(()=>db.query('SELECT user_id FROM attendai.students WHERE id=$1',[existingStudentId]))).rows[0].user_id,null);
    const row=await record(second.email);
    await assert.rejects(reviewRegistration(pool,people.admin,{requestId:row.request_id,decision:'approve'}),e=>e.code==='23505');
    assert.equal((await record(second.email)).is_active,false);assert.equal((await record(second.email)).status,'pending');
  });
  await check('admin linking preserves existing enrollment history and enables the right student workspace',async()=>{
    const row=await record(second.email);await reviewRegistration(pool,people.admin,{requestId:row.request_id,decision:'approve',studentId:existingStudentId});
    const response=await signIn(second.email),resolved=await identity(cookies(response));assert.equal(resolved.kind,'authenticated');
    const workspace=await readWorkspace(pool,resolved.account,new URLSearchParams({resource:'courses'}));
    assert.equal(workspace.items.length,1);assert.equal(workspace.items[0].id,courseId);
    assert.equal((await owner(()=>db.query('SELECT count(*)::int AS n FROM attendai.enrollments WHERE student_id=$1',[existingStudentId]))).rows[0].n,1);
  });
  await check('an already-linked student cannot be reassigned by a second registration',async()=>{
    const third=input('EXIST-001');await register(request(third));const row=await record(third.email);
    await assert.rejects(reviewRegistration(pool,people.admin,{requestId:row.request_id,decision:'approve',studentId:existingStudentId}),e=>e.code==='23514');
    assert.equal((await record(third.email)).is_active,false);
    assert.equal((await owner(()=>db.query('SELECT user_id FROM attendai.students WHERE id=$1',[existingStudentId]))).rows[0].user_id,(await record(second.email)).id);
  });
  await check('rejected registrations remain inactive and retain a review status',async()=>{
    const value=input();await register(request(value));const row=await record(value.email);
    assert.equal((await reviewRegistration(pool,people.admin,{requestId:row.request_id,decision:'reject'})).status,'rejected');
    assert.equal((await record(value.email)).is_active,false);
    assert.equal((await ownRegistrationStatus(pool,row.auth_subject)).status,'rejected');
  });
  await check('invalid review payloads fail without changing requests',async()=>{
    for(const body of [{requestId:'bad',decision:'approve'},{requestId:(await record(first.email)).request_id,decision:'admin'},
      {requestId:(await record(first.email)).request_id,decision:'reject',studentId:existingStudentId}])await assert.rejects(reviewRegistration(pool,people.admin,body),e=>e.status===400);
  });
  await check('failed profile creation cleans up only the newly-created orphan auth account',async()=>{
    const value=input();const failingPool={...pool,query:async(sql,args)=>{
      if(typeof sql==='string'&&sql.startsWith('SELECT attendai.register_student_account'))throw Error('synthetic private database failure');
      return pool.query(sql,args);
    }};
    const failed=studentRegistrationHandler({pool:failingPool,configuredOrigin:origin,signup:r=>signupAuth.handler(r)});
    const response=await failed(request(value));assert.equal(response.status,503);
    assert.doesNotMatch(await response.text(),/synthetic private/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai_auth.users WHERE email=$1',[value.email])).rows[0].n,0);
    assert.equal((await signIn(people.admin.email)).status,200);
  });
  await check('an uncertain response after commit cannot delete a committed student account',async()=>{
    const value=input();const uncertainPool={...pool,query:async(sql,args)=>{
      const result=await pool.query(sql,args);
      if(typeof sql==='string'&&sql.startsWith('SELECT attendai.register_student_account'))throw Error('synthetic response interrupted after commit');
      return result;
    }};
    const handler=studentRegistrationHandler({pool:uncertainPool,configuredOrigin:origin,signup:r=>signupAuth.handler(r)});
    assert.equal((await handler(request(value))).status,503);
    assert.equal((await record(value.email)).status,'pending');
    assert.equal((await signIn(value.email)).status,200);
  });
  await check('public signup is rate-limited in database storage',async()=>{
    for(let i=0;i<5;i++)assert.equal((await register(request(input(),{'X-Forwarded-For':'198.51.100.99'}))).status,201);
    assert.equal((await register(request(input(),{'X-Forwarded-For':'198.51.100.99'}))).status,429);
  });
  await check('unknown status lookups and database errors do not reveal internal details',async()=>{
    assert.equal(await ownRegistrationStatus(pool,'unknown-subject'),null);
    const result=registrationError({code:'42P01',message:'private table and connection information'});
    assert.equal(result.status,503);assert.doesNotMatch(result.error,/private table|connection information/);
  });
  console.log(`Student registration and approval checks passed: ${count}. No live database, emails or real accounts were used.`);
}finally{await db.close();}
