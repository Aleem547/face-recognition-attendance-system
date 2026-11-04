"use client";
import {useCallback,useEffect,useState} from 'react';
import type {CourseAnalytics} from '@/lib/register/analytics';
import {csvCell} from '@/lib/register/csv';
type Result={items:CourseAnalytics[];nextCursor:string|null};
async function read(cursor:string|null):Promise<Result>{
  const response=await fetch('/api/workspace?'+new URLSearchParams({resource:'analytics',...(cursor?{cursor}:{})}),{cache:'no-store'});
  if(!response.ok)throw Error('Analytics could not be loaded. Refresh your signed-in workspace.');
  return response.json();
}
export default function CourseAnalyticsPanel(){
  const [data,setData]=useState<Result>({items:[],nextCursor:null}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{setBusy(true);setError('');try{setData(await read(null));}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[]);
  useEffect(()=>{let active=true;setBusy(true);void read(null).then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError('Analytics unavailable. Refresh to retry.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
  async function more(){if(busy||!data.nextCursor)return;setBusy(true);setError('');try{const value=await read(data.nextCursor);setData(previous=>({items:[...previous.items,...value.items],nextCursor:value.nextCursor}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function exportAll(){
    if(busy)return;setBusy(true);setError('');
    try{
      const rows:CourseAnalytics[]=[];let cursor:string|null=null;const seen=new Set<string>();
      do{const page=await read(cursor);rows.push(...page.items);cursor=page.nextCursor;
        if(cursor&&(seen.has(cursor)||seen.size>=1000))throw Error('Export exceeded its page limit. No partial CSV was downloaded.');if(cursor)seen.add(cursor);
      }while(cursor);
      const keys: (keyof CourseAnalytics)[]=['course_code','title','sessions','roster_entries','present','late','absent','excused','unmarked','denominator','attendance_rate','manual','experimental_face','automatic_absence'];
      const csv=keys.map(csvCell).join(',')+'\r\n'+rows.map(row=>keys.map(key=>csvCell(row[key])).join(',')).join('\r\n')+'\r\n';
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),anchor=document.createElement('a');
      anchor.href=url;anchor.download='Face_Recognition_Attendance_System_Closed_Class_Analytics.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="panel"><h2>Course attendance analytics</h2>
    <p className="note">Closed classes only. Present and Late count as attending; Excused is excluded. Each class uses its frozen roster. Student accounts see only their own entries. Counts describe saved records and do not prove physical presence.</p>
    <div className="buttons"><button className="btn outline" disabled={busy} onClick={()=>void load()}>Refresh analytics</button>{' '}<button className="btn outline" disabled={busy} onClick={()=>void exportAll()}>Export all course analytics</button></div>
    {error&&<p role="alert" className="register-alert error">{error}</p>}
    {busy&&<p role="status">Loading analytics…</p>}
    <div className="table-scroll"><table><thead><tr><th>COURSE</th><th>CLOSED CLASSES</th><th>PRESENT</th><th>LATE</th><th>ABSENT</th><th>EXCUSED</th><th>DENOMINATOR</th><th>RATE</th></tr></thead><tbody>{data.items.map(row=><tr key={row.course_id}><td>{row.course_code}<br/>{row.title}</td><td>{row.sessions}</td><td>{row.present}</td><td>{row.late}</td><td>{row.absent}</td><td>{row.excused}</td><td>{row.denominator}</td><td>{row.attendance_rate===null?'N/A':row.attendance_rate+'%'}</td></tr>)}</tbody></table></div>
    {!busy&&!data.items.length&&<p>No closed-class records are available in your scope.</p>}
    {data.nextCursor&&<button className="btn outline" disabled={busy} onClick={()=>void more()}>Load more courses</button>}
    <p className="note">CSV includes attendance methods. Each export page is current when read; run exports while the register is stable if you need a consistent reporting snapshot.</p>
  </section>;
}
