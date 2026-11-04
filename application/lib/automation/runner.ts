import 'server-only';
import {getAppPool} from '../server/database';
import {createClassClock,tickClassClock} from './clock';
import {clockFailure} from './failure';
const globalClock=globalThis as unknown as {attendaiClassClock?:ReturnType<typeof createClassClock>};
export function startClassClock(){
 if(globalClock.attendaiClassClock)return;
 let lastWarning=0;
 const clock=createClassClock({tick:()=>tickClassClock(getAppPool()),error:error=>{
  if(Date.now()-lastWarning>300000){lastWarning=Date.now();const safe=clockFailure(error);console.error('Face Recognition Attendance System class clock failed ['+safe.code+']. '+safe.hint+' Automatic absences may need staff review.');}
 }});
 globalClock.attendaiClassClock=clock;clock.start();
 process.once('SIGINT',()=>clock.stop());process.once('SIGTERM',()=>clock.stop());
}
