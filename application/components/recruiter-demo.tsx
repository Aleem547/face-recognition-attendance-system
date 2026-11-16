'use client';
import {useEffect,useMemo,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {ArrowUpRight,FlaskConical,RotateCcw,ShieldCheck,Users,BookOpen,ClipboardCheck,Camera,Clock3,FileDown,Settings2} from 'lucide-react';
import Workspace,{type Section} from './workspace';
import {DemoStore,DEMO_STORAGE,DEMO_ADMIN,DEMO_STUDENT,DEMO_CLASS,seedDemo,type DemoAccount,type DemoPolicy} from '@/lib/demo/store';
import type {UserRole} from '@/lib/auth/identity';
import DemoCamera from './recruiter-demo-camera';

const coreViews:Section[]=['overview','students','courses','sessions','attendance','privacy'];
export default function RecruiterDemo(){
 const search=useSearchParams(),view=search.get('view')??'overview';
 const [store,setStore]=useState<DemoStore|null>(null),[accountId,setAccountId]=useState(DEMO_ADMIN),[,setRevision]=useState(0),[generation,setGeneration]=useState(0),[message,setMessage]=useState('');
 function makeStore(data=seedDemo()){return new DemoStore(data,snapshot=>{try{sessionStorage.setItem(DEMO_STORAGE,JSON.stringify(snapshot));}catch{/* The current tab still works when storage is unavailable. */}setRevision(v=>v+1);});}
 useEffect(()=>{let data;try{const raw=sessionStorage.getItem(DEMO_STORAGE);if(raw&&raw.length<=524288){const restored=requireRestored(raw);if(restored)data=restored;}}catch{}setStore(makeStore(data));},[]);
 const account=store?.data.accounts.find(a=>a.id===accountId&&a.is_active)??store?.data.accounts[0];
 const transport=useMemo(()=>store&&account?store.transport(account):undefined,[store,account?.id,account?.role]);
 function role(value:UserRole){const next=store?.data.accounts.find(a=>a.role===value&&a.is_active);if(next){setAccountId(next.id);setMessage('Exploring the '+value+' view with sample records.');}}
 function reset(){try{sessionStorage.removeItem(DEMO_STORAGE);}catch{}setStore(makeStore());setAccountId(DEMO_ADMIN);setGeneration(v=>v+1);setMessage('Your sample workspace has been reset.');}
 if(!store||!account||!transport)return <main className="demo-loading"><FlaskConical size={32}/><h1>Opening your recruiter demo</h1><p>Preparing a private sample workspace. No account or approval is needed.</p></main>;
 const feature=['camera','enrollment','verification'].includes(view)?'camera':view;
 return <div className="recruiter-demo" data-demo-workspace="true">
  <header className="demo-toolbar"><div className="demo-identity"><span className="demo-logo"><FlaskConical size={21}/></span><div><strong>Recruiter demo</strong><small>Sample data · edits stay in this browser tab</small></div><span className="demo-no-approval">No approval needed</span></div>
   <div className="demo-toolbar-actions"><label>Explore as <select aria-label="Explore demo role" value={account.role} onChange={e=>role(e.target.value as UserRole)}><option value="admin">Administrator</option><option value="teacher">Teacher</option><option value="student">Student</option></select></label><Link className="demo-link" href="/demo?view=guide">Feature tour <ArrowUpRight size={14}/></Link><button className="demo-reset" onClick={reset}><RotateCcw size={14}/>Reset demo</button><Link className="demo-link" href="/login">Exit</Link></div>
  </header>
  {message&&<div className="demo-toast" role="status">{message}<button aria-label="Dismiss demo notice" onClick={()=>setMessage('')}>×</button></div>}
  {coreViews.includes(view as Section)?<Workspace key={account.id+view+generation} account={account} demo initialSection={view as Section} transport={transport}/>:
   <main className="demo-feature-shell"><nav className="demo-feature-nav" aria-label="Demo feature navigation"><Link href="/demo">← Attendance workspace</Link>{[['guide','Feature tour'],['check-in','Automatic check-in'],['camera','Camera & comparison'],['admin','Administration']].map(([id,title])=><Link key={id} href={'/demo?view='+id} aria-current={view===id?'page':undefined}>{title}</Link>)}</nav>
    {feature==='camera'?<DemoCamera key={account.id+generation} store={store} account={account} changed={()=>setRevision(v=>v+1)}/>:feature==='check-in'?<DemoScenarios store={store} account={account}/>:feature==='admin'?<DemoAdministration store={store} account={account} preview={setAccountId}/>:<DemoTour account={account} chooseRole={role}/>}
   </main>}
 </div>;
}
// A bad or old tab snapshot falls back to the original sample data.
import {restoreDemo} from '@/lib/demo/store';
function requireRestored(raw:string){try{return restoreDemo(raw);}catch{return null;}}

function DemoTour({account,chooseRole}:{account:DemoAccount;chooseRole:(role:UserRole)=>void}){
 const cards=[{Icon:Users,title:'Students & accounts',text:'Add a sample student, create a sample account and link the two.',view:'students',role:'admin'},
 {Icon:BookOpen,title:'Courses & enrollment',text:'Create a course, assign a teacher, enroll students and end enrollment.',view:'courses',role:'admin'},
 {Icon:Clock3,title:'Classes & frozen rosters',text:'Schedule and open a class. Later enrollment changes preserve its captured roster.',view:'sessions',role:'teacher'},
 {Icon:ClipboardCheck,title:'Attendance & receipts',text:'Record Present, Late, Absent or Excused, then correct a mark with a reason.',view:'attendance',role:'teacher'},
 {Icon:Settings2,title:'Automatic attendance',text:'Explore sample face-policy outcomes and advance the demo clock to fill absences.',view:'check-in',role:'admin'},
 {Icon:Camera,title:'Camera, enrollment & comparison',text:'Optionally use your camera with a temporary encrypted reference and real SFace comparison.',view:'camera',role:'student'},
 {Icon:FileDown,title:'Analytics & CSV exports',text:'Inspect closed-class rates and download real CSV files from your current sample records.',view:'overview',role:'admin'},
 {Icon:ShieldCheck,title:'Student access & privacy',text:'Switch to a student view to inspect only that sample student’s own class records.',view:'privacy',role:'student'}];
 return <><div className="demo-feature-heading"><p className="eyebrow">AN INTERACTIVE PROJECT WALKTHROUGH</p><h1>Explore the complete workflow.</h1><p>Use the same attendance screens as the application, with a personal set of synthetic records. Change a role, try an action, and reset whenever you like.</p><span className="demo-context">Currently exploring as {account.role}</span></div>
  <div className="demo-tour-grid">{cards.map(({Icon,title,text,view,role})=><Link key={title} href={'/demo?view='+view} className="demo-tour-card" onClick={()=>chooseRole(role as UserRole)}><Icon size={24}/><h2>{title}</h2><p>{text}</p><span>Try this feature <ArrowUpRight size={15}/></span></Link>)}</div>
  <section className="panel demo-explanation"><h2>What this demo does</h2><p>The attendance forms, correction history and CSV export components are shared with the real application. This tab’s sample records use an isolated browser store; roles here cannot grant access to real accounts or records. Demo form changes are not saved to the hosted database.</p><p>Camera preview is optional. Real camera trials use the existing YuNet/SFace engine, with optional two-model PAD scores, and a temporary reference sealed with AES-GCM. Camera frames and references are not saved as permanent enrollments. The sample timing scenarios use explicitly simulated scores; they are separate from real camera measurements.</p></section>
 </>;
}
function describeDemoAction(value:unknown){
 const result=value as {decision?:string;status?:string;arrivedAt?:string;absent?:number;now?:string};
 if(result.decision==='accepted')return 'Sample check-in accepted: '+result.status+' at '+new Date(result.arrivedAt!).toLocaleTimeString()+'. The demo register was updated.';
 if(result.decision==='already_recorded')return 'This student already has a recorded status. The existing demo mark was preserved.';
 if(result.decision==='identity_below_threshold')return 'Sample face score was below the class cutoff. No attendance mark was added.';
 if(result.decision==='pad_below_threshold')return 'Sample PAD score was below the class cutoff. No attendance mark was added.';
 if(typeof result.absent==='number')return 'Demo clock advanced to '+new Date(result.now!).toLocaleTimeString()+'. '+result.absent+' unmarked entries became Absent; earlier marks were preserved.';
 return 'Demo settings saved.';
}
function DemoScenarios({store,account}:{store:DemoStore;account:DemoAccount}){
 const [sessionId,setSessionId]=useState(DEMO_CLASS),[studentId,setStudentId]=useState(store.data.students.find(s=>s.user_id===DEMO_STUDENT)?.id??''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[policy,setPolicy]=useState<DemoPolicy>({...store.data.policy});
 const visible=store.read(account,{resource:'sessions'}) as {items:typeof store.data.sessions};
 const students=account.role==='student'?store.data.students.filter(s=>s.user_id===account.id):store.data.students;
 function run(work:()=>unknown,success?:string){setError('');try{const result=work();setNotice(success??describeDemoAction(result));}catch(e){setError((e as Error).message);}}
 function scenario(type:'present'|'late'|'face'|'pad'){
  run(()=>{const result=store.checkin(account,sessionId,account.role==='student'?students[0]?.id:studentId,{sample:true,arrivalMinutes:type==='late'?store.data.policy.lateAfterMinutes:0,similarity:type==='face'?0:0.95,pad:type==='pad'?[0,0]:[0.95,0.95]});return result;});
 }
 return <><div className="demo-feature-heading"><p className="eyebrow">AUTOMATIC ATTENDANCE LAB</p><h1>A class, from arrival to close.</h1><p>These buttons run labelled sample scenarios. They do not process a face image. Use the camera feature for real measurements.</p></div>
 {error&&<p className="register-alert error" role="alert">{error}</p>}{notice&&<p className="register-alert success" role="status">{notice}</p>}
 <div className="demo-two-column"><section className="panel demo-controls"><h2>Try a check-in scenario</h2><label>Class<select aria-label="Demo check-in class" value={sessionId} onChange={e=>setSessionId(e.target.value)}>{visible.items.map(s=><option key={s.id} value={s.id}>{s.session_code} · {s.state}</option>)}</select></label>
 <label>Demo student<select aria-label="Demo check-in student" value={account.role==='student'?students[0]?.id:studentId} onChange={e=>setStudentId(e.target.value)}>{students.map(s=><option key={s.id} value={s.id}>{s.student_code} · {s.display_name}</option>)}</select></label>
 <div className="demo-action-grid"><button className="btn primary" onClick={()=>scenario('present')}>Sample: arrive at class start</button><button className="btn outline" onClick={()=>scenario('late')}>Sample: arrive after late cutoff</button><button className="btn outline" onClick={()=>scenario('face')}>Sample: face below cutoff</button><button className="btn outline" onClick={()=>scenario('pad')}>Sample: PAD below cutoff</button></div><p className="note">An accepted first check-in creates one demo mark. A rejected or repeated attempt preserves the existing register. Choose a different unmarked student to compare scenarios.</p><Link href="/demo?view=attendance" className="demo-link">Review attendance and receipts →</Link></section>
 <section className="panel demo-controls"><h2>Advance the demo clock</h2><p className="demo-clock">{new Date(store.data.now).toLocaleString()}</p><p className="note">The sample live class starts at 08:30 and ends at 09:30 in the time zone used when you opened the demo. Only this browser tab’s clock changes.</p><div className="buttons"><button className="btn outline" disabled={account.role==='student'} onClick={()=>run(()=>store.advance(15,account))}>Advance 15 minutes</button><button className="btn primary" disabled={account.role==='student'} onClick={()=>run(()=>store.advance(61,account))}>Advance past class end</button></div><p className="note">When sample automation is enabled, remaining unmarked entries become Absent after class end plus 30 seconds. Earlier manual and face-demo marks are preserved.</p><h3>Recent demo actions</h3><ul className="demo-event-list">{store.data.events.slice(0,5).map((s,i)=><li key={i}>{s}</li>)}</ul></section></div>
 <section className="panel demo-controls"><h2>Class policy settings</h2><p className="note">These are experimental demonstration cutoffs, not validated biometric operating thresholds.</p><form onSubmit={e=>{e.preventDefault();run(()=>store.setPolicy(account,policy),'Demo policy saved.');}}><div className="demo-policy-grid"><label>Similarity cutoff<input type="number" min={0} max={1} step={0.01} value={policy.similarityMin} onChange={e=>setPolicy({...policy,similarityMin:Number(e.target.value)})}/></label><label>PAD cutoff for both models<input type="number" min={0} max={1} step={0.01} value={policy.padMin} onChange={e=>setPolicy({...policy,padMin:Number(e.target.value)})}/></label><label>Late after (minutes)<input type="number" min={1} max={120} step={1} value={policy.lateAfterMinutes} onChange={e=>setPolicy({...policy,lateAfterMinutes:Number(e.target.value)})}/></label></div><label className="demo-check"><input type="checkbox" checked={policy.enabled} onChange={e=>setPolicy({...policy,enabled:e.target.checked})}/>Enable demo check-in policy</label><label className="demo-check"><input type="checkbox" checked={policy.automation} onChange={e=>setPolicy({...policy,automation:e.target.checked})}/>Enable sample class timing and automatic absence</label><button className="btn primary" disabled={account.role==='student'}>Save demo policy</button>{account.role==='student'&&<p className="note">Switch to a staff role to change policy settings.</p>}</form></section>
 </>;
}
function DemoAdministration({store,account,preview}:{store:DemoStore;account:DemoAccount;preview:(id:string)=>void}){
 const [message,setMessage]=useState(''),[error,setError]=useState('');
 return <><div className="demo-feature-heading"><p className="eyebrow">DEMO ADMINISTRATION</p><h1>Explore accounts and roles.</h1><p>All names and emails below are synthetic. These accounts need no approval and have no real passwords or live access.</p></div>{error&&<p className="register-alert error" role="alert">{error}</p>}{message&&<p className="register-alert success" role="status">{message}</p>}
 {account.role==='admin'&&<section className="panel"><h2>Create a sample account</h2><form className="demo-account-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form);try{store.addAccount(account,String(data.get('name')),String(data.get('email')),String(data.get('role')) as UserRole);setMessage('Sample account created and immediately active.');setError('');form.reset();}catch(error){setError((error as Error).message);}}}><label>Display name<input name="name" required maxLength={100} placeholder="Demo visitor"/></label><label>Sample email<input name="email" type="email" required maxLength={254} placeholder="visitor@example.test"/></label><label>Role<select name="role"><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Administrator</option></select></label><button className="btn primary">Create sample account</button></form><p className="note">To link a new student account, open Students and use its sample email on an unlinked roster record.</p></section>}
 <section className="panel"><h2>Workspace accounts</h2><div className="table-scroll"><table><thead><tr><th>NAME</th><th>SAMPLE EMAIL</th><th>ROLE</th><th>STATE</th><th>PREVIEW</th></tr></thead><tbody>{store.data.accounts.map(a=><tr key={a.id}><td>{a.displayName}</td><td>{a.email}</td><td>{a.role}</td><td>Active</td><td><Link className="small-button" href="/demo" onClick={()=>preview(a.id)}>Explore this view</Link></td></tr>)}</tbody></table></div></section></>;
}
