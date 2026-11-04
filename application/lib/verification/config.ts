import "server-only";
import {enrollmentKey} from "../biometric/config";
import {RegisterError} from "../register/service";
export function verificationKey(){
  if(process.env.ATTENDAI_VERIFICATION_TRIAL_ENABLED!=="true")throw new RegisterError(503,"Comparison trials are disabled. Complete face:configure-verification first.");
  return enrollmentKey();
}
export function verificationConfigured(){try{const key=verificationKey();key.fill(0);return true;}catch{return false;}}
