// Exercise the actual receipt SELECT extracted from the service against isolated
// PostgreSQL/PGlite. No .env, production DB, camera, keys or biometric features.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const source=await readFile(new URL('../lib/verification/service.ts',import.meta.url),'utf8');
const query=source.match(/`(SELECT event_id::text,event_type,notice_version,choice_revision,occurred_at,session_id,session_notice_version\s+FROM attendai\.verification_events[^`]+)`/)?.[1];
assert(query,'Current receipt query was not found; review this test when the query changes.');
const db=new PGlite();let n=0;
async function check(name,fn){await fn();console.log(`PASS ${++n}: ${name}`);}
const me='00000000-0000-0000-0000-000000000001',peer='00000000-0000-0000-0000-000000000002',session='00000000-0000-0000-0000-000000000003';
try{
 await db.exec(`CREATE SCHEMA attendai;CREATE TABLE attendai.verification_events(
 event_id bigint PRIMARY KEY,student_id uuid NOT NULL,event_type text NOT NULL,notice_version text,
 choice_revision integer,occurred_at timestamptz,session_id uuid,session_notice_version text);`);
 for(let id=1;id<=40;id++)await db.query(`INSERT INTO attendai.verification_events VALUES($1,$2,'compared','synthetic-notice',3,'2026-10-28T18:00:00Z',$3,$4)`,[id,me,id>=12?session:null,id>=12?'session-research-v1':null]);
 await check('regression reproduced: text alias sorting puts 9 before 40',async()=>{const legacy=query.replace('ORDER BY v.event_id DESC','ORDER BY event_id DESC');const r=(await db.query(legacy,[me])).rows;assert.equal(r[0].event_id,'9');});
 await check('fixed actual query returns 40 first, descending numerically, limited to 25',async()=>{const r=(await db.query(query,[me])).rows;assert.deepEqual(r.map(x=>x.event_id),Array.from({length:25},(_,i)=>String(40-i)));});
 await check('newer receipts preserve their session and notice metadata',async()=>{const r=(await db.query(query,[me])).rows;assert(r.every(x=>x.session_id===session&&x.session_notice_version==='session-research-v1'));});
 await check('another student receipt never appears in the requested student results',async()=>{await db.query(`INSERT INTO attendai.verification_events VALUES(100,$1,'compared','synthetic-notice',3,now(),NULL,NULL)`,[peer]);const r=(await db.query(query,[me])).rows;assert(!r.some(x=>x.event_id==='100'));assert.equal((await db.query(query,[peer])).rows[0].event_id,'100');});
 await check('IDs beyond JS safe integer range stay exact strings and sort correctly',async()=>{for(const id of ['9007199254740992','9007199254740993'])await db.query(`INSERT INTO attendai.verification_events VALUES($1,$2,'compared','synthetic-notice',3,now(),$3,'session-research-v1')`,[id,me,session]);const r=(await db.query(query,[me])).rows;assert.deepEqual(r.slice(0,2).map(x=>x.event_id),['9007199254740993','9007199254740992']);assert(r.every(x=>typeof x.event_id==='string'));});
 await check('receipt output retains only its expected metadata fields',async()=>{const r=(await db.query(query,[me])).rows[0];assert.deepEqual(Object.keys(r).sort(),['event_id','event_type','notice_version','choice_revision','occurred_at','session_id','session_notice_version'].sort());});
 console.log(`Verification receipt ordering checks passed: ${n}. No attendance data was changed.`);
}finally{await db.close();}
