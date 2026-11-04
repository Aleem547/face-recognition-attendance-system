import "server-only";
import { readKey } from "./crypto";
import { RegisterError } from "../register/service";
export function enrollmentKey() {
  if(process.env.ATTENDAI_BIOMETRICS_ENABLED!=="true")throw new RegisterError(503,"Biometric enrollment is disabled. Complete face:configure first.");
  return readKey(process.env.ATTENDAI_BIOMETRIC_KEY);
}
export function enrollmentConfigured() {try{const key=enrollmentKey();key.fill(0);return true;}catch{return false;}}
