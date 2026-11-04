import {RegisterError} from "../register/service.ts";
import {featureBytes} from "../biometric/crypto.ts";
// No threshold or identity decision belongs in this trial.
export function compareFeature(reference:Buffer,probe:unknown):number {
  const checked=featureBytes(probe);checked.fill(0);
  if(reference.length!==512)throw new RegisterError(503,"The saved reference is invalid. No comparison was saved.");
  let dot=0,left=0,right=0;
  for(let i=0;i<128;i++){
    const a=reference.readFloatLE(i*4),b=(probe as number[])[i];
    if(!Number.isFinite(a))throw new RegisterError(503,"The saved reference is invalid. No comparison was saved.");
    dot+=a*b;left+=a*a;right+=b*b;
  }
  if(!Number.isFinite(left)||Math.abs(Math.sqrt(left)-1)>0.001)throw new RegisterError(503,"The saved reference is invalid. No comparison was saved.");
  const score=dot/Math.sqrt(left*right);
  if(!Number.isFinite(score))throw new RegisterError(503,"The comparison could not be calculated.");
  return Math.max(-1,Math.min(1,score));
}
