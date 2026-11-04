import type {Pool} from 'pg';
// Isolated from env/auth so timing, overlap and cleanup can be fixture-tested.
export async function tickClassClock(pool:Pool){
 const db=await pool.connect();let discard=false;
 try{await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='20s'");await db.query("SET LOCAL lock_timeout='2s'");
  await db.query("SELECT set_config('attendai.actor_id','',true)");
  const result=(await db.query('SELECT attendai.tick_session_automation() AS result')).rows[0].result;
  await db.query('COMMIT');return result;
 }catch(error){try{await db.query('ROLLBACK');}catch{discard=true;}throw error;}
 finally{db.release(discard);}
}
type Timer=ReturnType<typeof setTimeout>;
type ClockDependencies={tick:()=>Promise<unknown>;error:()=>void;schedule?:(fn:()=>void,ms:number)=>Timer;cancel?:(timer:Timer)=>void;intervalMs?:number};
export function createClassClock(deps:ClockDependencies){
 let stopped=false,started=false,timer:Timer|undefined;
 async function run(){
  if(stopped)return;
  let moreDue=false;
  try{const result=await deps.tick();moreDue=Boolean(result&&typeof result==='object'&&'moreDue' in result&&result.moreDue===true);}catch{if(!stopped)deps.error();}
  finally{if(!stopped){timer=(deps.schedule??setTimeout)(()=>void run(),moreDue?250:deps.intervalMs??20000);timer?.unref?.();}}
 }
 return {start(){if(started||stopped)return;started=true;void run();},stop(){stopped=true;if(timer!==undefined)(deps.cancel??clearTimeout)(timer);}};
}
