import 'server-only';
import {DemoFaceService} from './face';
import {extractFace,extractPaired,reserveEngine} from '../biometric/worker';
const globals=globalThis as unknown as {frasDemoFace?:DemoFaceService};
export function demoFaceService(){
 if(!globals.frasDemoFace)globals.frasDemoFace=new DemoFaceService({secret:process.env.BETTER_AUTH_SECRET??'',origin:process.env.BETTER_AUTH_URL??'',enabled:process.env.ATTENDAI_BIOMETRICS_ENABLED==='true'&&process.env.ATTENDAI_VERIFICATION_TRIAL_ENABLED==='true',reserve:reserveEngine,
  extract:async(image,signal,paired)=>paired?extractPaired(image,signal):{embedding:await extractFace(image,signal)}});
 return globals.frasDemoFace;
}
