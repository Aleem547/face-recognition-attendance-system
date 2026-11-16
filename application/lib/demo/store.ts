import type {Account, UserRole} from '../auth/identity';
import type {CourseRow,StudentRow,SessionRow,RegisterRow,ReceiptRow,MarkStatus} from '../register/contracts';
import type {CourseAnalytics} from '../register/analytics';

export type DemoAccount=Account&{is_active:boolean};
type Enrollment={courseId:string;studentId:string;active:boolean};
type DemoMark=RegisterRow&{sessionId:string};
export type DemoPolicy={enabled:boolean;similarityMin:number;padMin:number;lateAfterMinutes:number;automation:boolean};
export type DemoData={version:1;now:string;accounts:DemoAccount[];students:StudentRow[];courses:CourseRow[];
 sessions:SessionRow[];enrollments:Enrollment[];rosters:Record<string,StudentRow[]>;marks:DemoMark[];
 receipts:Record<string,ReceiptRow[]>;policy:DemoPolicy;events:string[]};
export type WorkspaceTransport=<T>(params:Record<string,string>,body?:unknown)=>Promise<T>;
export const DEMO_STORAGE='fras-recruiter-demo-v1';
export const demoId=(n:number)=>'d3a00000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
export const DEMO_ADMIN=demoId(1),DEMO_TEACHER=demoId(2),DEMO_STUDENT=demoId(3),DEMO_CLASS=demoId(41);
const statuses:MarkStatus[]=['present','late','absent','excused'];
const uuid=()=>crypto.randomUUID();
export class DemoError extends Error{}
const requireValue=(value:unknown,label:string,max=100)=>{
 if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw new DemoError('Enter a valid '+label+'.');return value.trim();
};
const code=(value:unknown,label:string,max=40)=>{const result=requireValue(value,label,max).toUpperCase();if(!/^[A-Z0-9][A-Z0-9._-]*$/.test(result))throw new DemoError('Use letters, numbers, dots, underscores or hyphens for '+label+'.');return result;};
const email=(value:unknown)=>{const result=requireValue(value,'email address',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))throw new DemoError('Enter a valid email address.');return result;};
const iso=(value:unknown)=>{const ms=typeof value==='string'?Date.parse(value):NaN;if(!Number.isFinite(ms))throw new DemoError('Enter valid class times.');return new Date(ms).toISOString();};
const page=<T,>(items:T[])=>({items,nextCursor:null});

export function seedDemo(now=new Date()):DemoData{
 const start=new Date(now);start.setHours(8,30,0,0);
 const time=(day:number,minutes=0)=>new Date(start.getTime()+day*86400000+minutes*60000).toISOString();
 const accounts:DemoAccount[]=[{id:DEMO_ADMIN,displayName:'Demo administrator',email:'admin@example.test',role:'admin',is_active:true},
 {id:DEMO_TEACHER,displayName:'Dr. Taylor Reed',email:'teacher@example.test',role:'teacher',is_active:true},
 ...['Alex Morgan','Sam Rivera','Jordan Lee','Casey Patel','Riley Chen','Avery Singh'].map((name,i)=>({id:demoId(3+i),displayName:name,email:'student'+(i+1)+'@example.test',role:'student' as const,is_active:true}))];
 const students=accounts.filter(a=>a.role==='student').map((a,i)=>({id:demoId(20+i),student_code:'DEMO-'+String(i+1).padStart(3,'0'),display_name:a.displayName,user_id:a.id,is_active:true}));
 const courses:CourseRow[]=[{id:demoId(30),course_code:'CS-101',title:'Introduction to Computer Science',teacher_id:DEMO_TEACHER,teacher_name:accounts[1].displayName,is_active:true},
 {id:demoId(31),course_code:'AI-201',title:'Applied Artificial Intelligence',teacher_id:DEMO_ADMIN,teacher_name:accounts[0].displayName,is_active:true}];
 const session=(id:number,index:number,day:number,state:SessionRow['state']):SessionRow=>({id:demoId(id),session_code:['CS-PREVIOUS','CS-LIVE-LAB','AI-PREVIOUS','CS-NEXT'][index],course_id:courses[index===2?1:0].id,course_code:courses[index===2?1:0].course_code,title:courses[index===2?1:0].title,starts_at:time(day),ends_at:time(day,60),state});
 const sessions=[session(41,1,0,'open'),session(40,0,-1,'closed'),session(42,2,-1,'closed'),session(43,3,1,'scheduled')];
 const rosters:Record<string,StudentRow[]>={};for(const s of sessions.filter(s=>s.state!=='scheduled'))rosters[s.id]=structuredClone(s.course_id===courses[0].id?students:students.slice(0,4));
 const marks:DemoMark[]=[],receipts:Record<string,ReceiptRow[]>={};
 for(const [sessionId,list]of Object.entries(rosters)){if(sessionId===DEMO_CLASS)continue;
  list.forEach((student,i)=>{const status:MarkStatus=sessionId===demoId(40)?(['present','present','present','late','absent','excused'] as MarkStatus[])[i]:(['present','present','late','absent'] as MarkStatus[])[i];
   const attendance_id=uuid(),updated_at=time(-1,10+i);marks.push({sessionId,student_id:student.id,student_code:student.student_code,display_name:student.display_name,attendance_id,status,method:'manual',revision:1,updated_at,change_reason:'Synthetic sample attendance'});
   receipts[attendance_id]=[{event_id:uuid(),revision:1,action:'record',previous_status:null,new_status:status,method:'manual',actor_name:'Demo teacher',reason:'Synthetic sample attendance',occurred_at:updated_at}];
  });
 }
 return {version:1,now:time(0,5),accounts,students,courses,sessions,enrollments:courses.flatMap((c,i)=>(i?students.slice(0,4):students).map(s=>({courseId:c.id,studentId:s.id,active:true}))),rosters,marks,receipts,
  policy:{enabled:true,similarityMin:0.55,padMin:0.7,lateAfterMinutes:15,automation:true},events:['Sample workspace created. All names and class records are synthetic.']};
}
export function restoreDemo(text:string|null):DemoData|null{
 try{
  if(!text||text.length>1000000)return null;const d=JSON.parse(text) as DemoData;
  const id=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const str=(value:unknown,max=500)=>typeof value==='string'&&value.length<=max;
  const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const validStudent=(s:StudentRow)=>s&&id(s.id)&&str(s.student_code,40)&&str(s.display_name,100)&&(s.user_id===null||id(s.user_id))&&typeof s.is_active==='boolean';
  if(!d||d.version!==1||!date(d.now)||!Array.isArray(d.accounts)||!Array.isArray(d.students)||!Array.isArray(d.courses)||!Array.isArray(d.sessions)||!Array.isArray(d.marks)||!Array.isArray(d.enrollments)||!d.rosters||!d.receipts||!d.policy||!Array.isArray(d.events))return null;
  if(d.accounts.length>100||d.students.length>100||d.courses.length>50||d.sessions.length>100||d.marks.length>2000||d.enrollments.length>5000||d.events.length>40)return null;
  if(d.accounts.some(a=>!a||!id(a.id)||!str(a.displayName,100)||!str(a.email,254)||!['admin','teacher','student'].includes(a.role)||typeof a.is_active!=='boolean')||!d.accounts.some(a=>a.id===DEMO_ADMIN&&a.role==='admin'&&a.is_active))return null;
  if(d.students.some(s=>!validStudent(s))||d.courses.some(c=>!c||!id(c.id)||!id(c.teacher_id)||!str(c.title,160)||!str(c.course_code,40)||!str(c.teacher_name,100)||typeof c.is_active!=='boolean'))return null;
  if(d.sessions.some(s=>!s||!id(s.id)||!id(s.course_id)||!str(s.session_code,60)||!str(s.course_code,40)||!str(s.title,160)||!date(s.starts_at)||!date(s.ends_at)||!['scheduled','open','closed','cancelled'].includes(s.state)))return null;
  if(d.enrollments.some(e=>!e||!id(e.courseId)||!id(e.studentId)||typeof e.active!=='boolean')||Object.entries(d.rosters).some(([key,rows])=>!id(key)||!Array.isArray(rows)||rows.length>100||rows.some(s=>!validStudent(s))))return null;
  if(d.marks.some(m=>!m||!id(m.sessionId)||!id(m.student_id)||!id(m.attendance_id)||!str(m.student_code,40)||!str(m.display_name,100)||!statuses.includes(m.status as MarkStatus)||!['manual','experimental_face','automatic_absence'].includes(m.method??'')||!Number.isInteger(m.revision)||!date(m.updated_at)||!str(m.change_reason)))return null;
  if(Object.entries(d.receipts).some(([key,rows])=>!id(key)||!Array.isArray(rows)||rows.length>500||rows.some(r=>!r||!id(r.event_id)||!Number.isInteger(r.revision)||!str(r.reason)||!str(r.actor_name,100)||!date(r.occurred_at)||!statuses.includes(r.new_status as MarkStatus))))return null;
  if(typeof d.policy.enabled!=='boolean'||typeof d.policy.automation!=='boolean'||![d.policy.similarityMin,d.policy.padMin].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)||!Number.isInteger(d.policy.lateAfterMinutes)||d.policy.lateAfterMinutes<1||d.policy.lateAfterMinutes>120||d.events.some(e=>!str(e)))return null;
  return d;
 }catch{return null;}
}

/** A browser-tab sandbox. No network, authentication session or live database. */
export class DemoStore{
 data:DemoData;
 private persist:(data:DemoData)=>void;
 constructor(data=seedDemo(),persist:(data:DemoData)=>void=()=>{}){this.data=data;this.persist=persist;}
 account(id:string):DemoAccount{const a=this.data.accounts.find(a=>a.id===id&&a.is_active);if(!a)throw new DemoError('Choose an active demo account.');return structuredClone(a);}
 private actor(account:Account){const current=this.account(account.id);if(current.role!==account.role)throw new DemoError('This demo role has changed. Choose the account again.');return current;}
 private visibleCourses(account:Account){return this.data.courses.filter(c=>account.role==='admin'||account.role==='teacher'&&c.teacher_id===account.id||account.role==='student'&&this.data.enrollments.some(e=>e.courseId===c.id&&this.data.students.some(s=>s.id===e.studentId&&s.user_id===account.id)));}
 private ownRows(account:Account,rows:StudentRow[]){return account.role==='student'?rows.filter(s=>s.user_id===account.id):rows;}
 private session(account:Account,id:string){const s=this.data.sessions.find(s=>s.id===id&&this.visibleCourses(account).some(c=>c.id===s.course_id));if(!s)throw new DemoError('Class session unavailable in this demo role.');return s;}
 private event(message:string){this.data.events.unshift(message);this.data.events=this.data.events.slice(0,40);}
 private save(){this.persist(structuredClone(this.data));}
 private transaction<T>(work:()=>T):T{const before=this.data;this.data=structuredClone(before);try{const result=work();this.save();return structuredClone(result);}catch(error){this.data=before;throw error;}}
 private register(account:Account,id:string,unmarked=false){const session=this.session(account,id),roster=this.ownRows(account,this.data.rosters[id]??[]);
  const items=roster.map(s=>this.data.marks.find(m=>m.sessionId===id&&m.student_id===s.id)??{student_id:s.id,student_code:s.student_code,display_name:s.display_name,attendance_id:null,status:null,method:null,revision:null,updated_at:null,change_reason:null});
  const summary={roster:items.length,present:0,late:0,absent:0,excused:0,unmarked:0};for(const row of items)summary[row.status??'unmarked']++;
  return {...page(unmarked?items.filter(r=>!r.status):items),session,summary};
 }
 private putMark(sessionId:string,studentId:string,status:MarkStatus,reason:string,actor:string,method:DemoMark['method']='manual',at=this.data.now){
  const roster=this.data.rosters[sessionId]??[],student=roster.find(s=>s.id===studentId);if(!student)throw new DemoError('The student is not in the frozen class roster.');
  const previous=this.data.marks.find(m=>m.sessionId===sessionId&&m.student_id===studentId),attendance_id=previous?.attendance_id??uuid();
  if(previous?.status===status&&previous.method===method)return {attendance:{id:previous.attendance_id,revision:previous.revision},unchanged:true};
  const row:DemoMark={sessionId,student_id:studentId,student_code:student.student_code,display_name:student.display_name,attendance_id,status,method,revision:(previous?.revision??0)+1,updated_at:at,change_reason:reason};
  this.data.marks=this.data.marks.filter(m=>!(m.sessionId===sessionId&&m.student_id===studentId));this.data.marks.push(row);
  (this.data.receipts[attendance_id]??=[]).unshift({event_id:uuid(),revision:row.revision!,action:previous?'correct':'record',previous_status:previous?.status??null,new_status:status,method:method!,actor_name:actor,reason,occurred_at:at});
  return {attendance:{id:attendance_id,revision:row.revision},unchanged:false};
 }
 private analytics(account:Account){const rows:CourseAnalytics[]=[];
  for(const c of this.visibleCourses(account)){const sessions=this.data.sessions.filter(s=>s.course_id===c.id&&s.state==='closed'),entries=sessions.flatMap(s=>this.register(account,s.id).items);
   if(!entries.length)continue;const count=(status:string)=>entries.filter(r=>r.status===status).length,denominator=entries.length-count('excused'),unmarked=entries.filter(r=>!r.status).length;
   rows.push({course_id:c.id,course_code:c.course_code,title:c.title,sessions:sessions.filter(s=>this.register(account,s.id).items.length>0).length,roster_entries:entries.length,present:count('present'),late:count('late'),absent:count('absent'),excused:count('excused'),unmarked,
    manual:entries.filter(r=>r.method==='manual').length,experimental_face:entries.filter(r=>r.method==='experimental_face').length,automatic_absence:entries.filter(r=>r.method==='automatic_absence').length,denominator,attendance_rate:!unmarked&&denominator>0?Math.round(10000*(count('present')+count('late'))/denominator)/100:null});
  }return page(rows);
 }
 read(account:Account,params:Record<string,string>){this.actor(account);const courses=this.visibleCourses(account),sessions=this.data.sessions.filter(s=>courses.some(c=>c.id===s.course_id));
  const students=account.role==='admin'?this.data.students:this.ownRows(account,this.data.students.filter(s=>this.data.enrollments.some(e=>e.studentId===s.id&&courses.some(c=>c.id===e.courseId))));
  switch(params.resource??'summary'){
   case 'summary':return {students:students.length,courses:courses.filter(c=>c.is_active).length,sessions:sessions.filter(s=>s.state!=='cancelled').length,marks:this.data.marks.filter(m=>sessions.some(s=>s.id===m.sessionId)&&students.some(s=>s.id===m.student_id)).length};
   case 'students':return page(students);
   case 'courses':return page(courses);
   case 'sessions':return page(sessions);
   case 'analytics':return this.analytics(account);
   case 'enrollments':if(!courses.some(c=>c.id===params.courseId))throw new DemoError('Course unavailable.');return page(this.data.enrollments.filter(e=>e.courseId===params.courseId).flatMap(e=>{const s=students.find(s=>s.id===e.studentId);return s?[{student_id:s.id,student_code:s.student_code,display_name:s.display_name,is_active:e.active}]:[];}));
   case 'register':return this.register(account,params.sessionId,params.unmarked==='true');
   case 'history':{const m=this.data.marks.find(m=>m.attendance_id===params.attendanceId);if(!m||!this.register(account,m.sessionId).items.some(r=>r.attendance_id===m.attendance_id))throw new DemoError('Receipt unavailable.');return {items:this.data.receipts[params.attendanceId]??[],beforeRevision:null};}
   default:throw new DemoError('Unsupported demo feature.');
  }
 }
 mutate(account:Account,input:unknown){this.actor(account);if(!input||typeof input!=='object'||Array.isArray(input))throw new DemoError('Invalid demo action.');const b=input as Record<string,unknown>,action=String(b.action);
  if(account.role==='student')throw new DemoError('Switch to administrator or teacher to edit demo class records.');
  return this.transaction(()=>{
   const admin=()=>{if(account.role!=='admin')throw new DemoError('This demo action requires the administrator role.');};
   if(action==='createStudent'){admin();if(this.data.students.length>=100)throw new DemoError('Reset the demo to add more sample students.');const studentCode=code(b.studentCode,'student code'),displayName=requireValue(b.displayName,'student name');if(this.data.students.some(s=>s.student_code===studentCode))throw new DemoError('That student code already exists.');
    const linked=b.accountEmail?this.data.accounts.find(a=>a.email===email(b.accountEmail)&&a.role==='student'&&a.is_active):null;if(b.accountEmail&&!linked)throw new DemoError('Create this sample student account in Demo administration first, or leave email empty.');if(linked&&this.data.students.some(s=>s.user_id===linked.id))throw new DemoError('That account is already linked.');
    const student={id:uuid(),student_code:studentCode,display_name:displayName,user_id:linked?.id??null,is_active:true};this.data.students.push(student);this.event('Created demo student '+studentCode);return {student};
   }
   if(action==='linkStudent'){admin();const s=this.data.students.find(s=>s.id===b.studentId),a=this.data.accounts.find(a=>a.email===email(b.accountEmail)&&a.role==='student'&&a.is_active);if(!s||s.user_id||!a||this.data.students.some(s=>s.user_id===a.id))throw new DemoError('Choose an unlinked demo student and an available demo student account.');s.user_id=a.id;return {student:s};}
   if(action==='createCourse'){admin();if(this.data.courses.length>=50)throw new DemoError('Reset the demo to add more courses.');const courseCode=code(b.courseCode,'course code'),title=requireValue(b.title,'course title',160);if(this.data.courses.some(c=>c.course_code===courseCode))throw new DemoError('That course code already exists.');const teacher=b.teacherEmail?this.data.accounts.find(a=>a.email===email(b.teacherEmail)&&a.role!=='student'&&a.is_active):account;if(!teacher)throw new DemoError('Use an active demo teacher email, such as teacher@example.test.');const course={id:uuid(),course_code:courseCode,title,teacher_id:teacher.id,teacher_name:teacher.displayName,is_active:true};this.data.courses.push(course);return {course};}
   if(action==='enrollStudent'||action==='endEnrollment'){admin();if(!this.data.courses.some(c=>c.id===b.courseId))throw new DemoError('Choose a course.');const student=action==='enrollStudent'?this.data.students.find(s=>s.student_code===code(b.studentCode,'student code')):this.data.students.find(s=>s.id===b.studentId);if(!student)throw new DemoError('Student unavailable.');const e=this.data.enrollments.find(e=>e.courseId===b.courseId&&e.studentId===student.id);if(e)e.active=action==='enrollStudent';else if(action==='enrollStudent')this.data.enrollments.push({courseId:String(b.courseId),studentId:student.id,active:true});return {saved:true};}
   if(action==='createSession'){if(this.data.sessions.length>=100)throw new DemoError('Reset the demo to add more classes.');const c=this.visibleCourses(account).find(c=>c.id===b.courseId);if(!c)throw new DemoError('Choose a course in your scope.');const sessionCode=code(b.sessionCode,'session code',60),title=requireValue(b.title,'session title',160),starts_at=iso(b.startsAt),ends_at=iso(b.endsAt);if(ends_at<=starts_at)throw new DemoError('Class end must be after its start.');if(this.data.sessions.some(s=>s.session_code===sessionCode))throw new DemoError('That session code already exists.');const session={id:uuid(),session_code:sessionCode,course_id:c.id,course_code:c.course_code,title,starts_at,ends_at,state:'scheduled' as const};this.data.sessions.unshift(session);return {session};}
   const session=this.session(account,String(b.sessionId));
   if(action==='openSession'){if(session.state!=='scheduled')throw new DemoError('Only a scheduled session can be opened.');this.data.rosters[session.id]=structuredClone(this.data.students.filter(s=>s.is_active&&this.data.enrollments.some(e=>e.courseId===session.course_id&&e.studentId===s.id&&e.active)));session.state='open';return {session};}
   if(action==='reopenSession'){if(session.state!=='closed')throw new DemoError('Only a closed session can be reopened.');session.state='open';return {session};}
   if(action==='closeSession'){if(session.state!=='open'||this.register(account,session.id).summary.unmarked)throw new DemoError('Record all roster statuses before closing the class.');session.state='closed';return {session};}
   if(action==='cancelSession'){if(session.state!=='scheduled')throw new DemoError('Only an unopened class can be cancelled.');session.state='cancelled';return {session};}
   if(action==='markAttendance'){if(session.state!=='open')throw new DemoError('Open or reopen attendance before changing a status.');if(!statuses.includes(b.status as MarkStatus))throw new DemoError('Choose a valid attendance status.');const previous=this.data.marks.find(m=>m.sessionId===session.id&&m.student_id===b.studentId);if((previous?.revision??0)!==Number(b.expectedRevision))throw new DemoError('This record changed. Refresh the workspace before correcting it.');const reason=previous?requireValue(b.reason,'correction reason',500):'Initial attendance recorded in recruiter demo';return this.putMark(session.id,String(b.studentId),b.status as MarkStatus,reason,account.displayName);}
   throw new DemoError('Unsupported demo action.');
  });
 }
 transport(account:Account):WorkspaceTransport{return async<T>(params:Record<string,string>,body?:unknown)=>structuredClone(body?this.mutate(account,body):this.read(account,params)) as T;}
 addAccount(account:Account,name:string,address:string,role:UserRole){this.actor(account);if(account.role!=='admin')throw new DemoError('Use the administrator demo role.');return this.transaction(()=>{if(this.data.accounts.length>=100)throw new DemoError('Reset the sample workspace to create more accounts.');const value=email(address);if(this.data.accounts.some(a=>a.email===value))throw new DemoError('That sample email is already used.');const created={id:uuid(),displayName:requireValue(name,'name'),email:value,role,is_active:true};if(!['admin','teacher','student'].includes(role))throw new DemoError('Choose a valid role.');this.data.accounts.push(created);this.event('Created a sample '+role+' account without approval.');return created;});}
 setPolicy(account:Account,policy:DemoPolicy){this.actor(account);if(account.role==='student')throw new DemoError('Use a staff demo role to change the sample policy.');return this.transaction(()=>{if(typeof policy.enabled!=='boolean'||typeof policy.automation!=='boolean'||![policy.similarityMin,policy.padMin].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||!Number.isInteger(policy.lateAfterMinutes)||policy.lateAfterMinutes<1||policy.lateAfterMinutes>120)throw new DemoError('Enter valid demo policy values.');this.data.policy=structuredClone(policy);return policy;});}
 checkin(account:Account,sessionId:string,studentId:string,values:{similarity:number;pad:number[];sample:boolean;arrivalMinutes?:number}){this.actor(account);return this.transaction(()=>{const s=this.session(account,sessionId),student=this.data.students.find(s=>s.id===studentId),p=this.data.policy;if(!student||account.role==='student'&&student.user_id!==account.id)throw new DemoError('Choose your own sample student record.');if(s.state!=='open'||!p.enabled)throw new DemoError('Open the class and enable the demo policy before check-in.');if(!Number.isFinite(values.similarity)||values.similarity< -1||values.similarity>1||values.pad.length!==2||!values.pad.every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw new DemoError('Valid face and both PAD scores are required.');
  const at=values.sample?new Date(Date.parse(s.starts_at)+(values.arrivalMinutes??0)*60000).toISOString():this.data.now;
  if(Date.parse(at)<Date.parse(s.starts_at)||Date.parse(at)>Date.parse(s.ends_at)+30000)throw new DemoError('The sample class check-in window is closed.');
  if(values.similarity<p.similarityMin)return {decision:'identity_below_threshold',attendanceChanged:false,arrivedAt:at};
  if(values.pad.some(x=>x<p.padMin))return {decision:'pad_below_threshold',attendanceChanged:false,arrivedAt:at};
  const previous=this.data.marks.find(m=>m.sessionId===s.id&&m.student_id===studentId);if(previous)return {decision:'already_recorded',attendanceChanged:false,arrivedAt:at};
  const status:MarkStatus=Date.parse(at)>=Date.parse(s.starts_at)+p.lateAfterMinutes*60000?'late':'present';
  this.putMark(s.id,studentId,status,values.sample?'Sample scenario: simulated face-policy acceptance, not measured biometric output':'Recruiter camera demo: experimental face and PAD policy accepted; demo records only',account.displayName,'experimental_face',at);
  this.event((values.sample?'Sample scenario':'Camera trial')+': '+student.student_code+' marked '+status+' in the demo register.');return {decision:'accepted',attendanceChanged:true,status,arrivedAt:at};
 });}
 advance(minutes:number,account?:Account){if(account){this.actor(account);if(account.role==='student')throw new DemoError('Use a staff demo role to advance the sample class clock.');}return this.transaction(()=>{if(!Number.isFinite(minutes)||minutes<0||minutes>1500)throw new DemoError('Choose a bounded forward demo-clock interval.');this.data.now=new Date(Date.parse(this.data.now)+minutes*60000).toISOString();let absent=0;
  if(this.data.policy.automation)for(const s of this.data.sessions){if(s.state==='scheduled'&&Date.parse(s.starts_at)<=Date.parse(this.data.now)){s.state='open';this.data.rosters[s.id]=structuredClone(this.data.students.filter(student=>student.is_active&&this.data.enrollments.some(e=>e.active&&e.courseId===s.course_id&&e.studentId===student.id)));}
   if(s.state==='open'&&Date.parse(s.ends_at)+30000<=Date.parse(this.data.now)){for(const student of this.data.rosters[s.id]??[])if(!this.data.marks.some(m=>m.sessionId===s.id&&m.student_id===student.id)){this.putMark(s.id,student.id,'absent','Demo clock reached class end plus the 30-second allowance.','Demo class clock','automatic_absence');absent++;}s.state='closed';}}
  this.event('Advanced the demo clock '+minutes+' minutes; '+absent+' unmarked roster entries became Absent.');return {absent,now:this.data.now};});}
}
