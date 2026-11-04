import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateContainer} from './container-start.mjs';
import {runtimeAddress} from './clock-diagnostics.mjs';
export async function exportContainerEnv(env,origin,output){
 const selected={};
 for(const key of ['APP_DATABASE_URL','BETTER_AUTH_SECRET','ATTENDAI_BIOMETRIC_KEY','ATTENDAI_BIOMETRICS_ENABLED','ATTENDAI_VERIFICATION_TRIAL_ENABLED'])if(env[key]!==undefined)selected[key]=env[key];
 selected.APP_DATABASE_URL=runtimeAddress(env.APP_DATABASE_URL);
 selected.BETTER_AUTH_URL=origin;
 if(/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(origin))selected.FRAS_LOCAL_PREVIEW='true';
 validateContainer(selected);
 for(const value of Object.values(selected))if(/[\r\n\0]/.test(value))throw Error('Multiline environment values are unsupported; use the host secret manager.');
 await writeFile(output,Object.entries(selected).map(([key,value])=>key+'='+value).join('\n')+'\n',{flag:'wx',mode:0o600});
 return {status:'written',ownerCredentialExported:false,biometricKey:'original_value_preserved_when_present'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--origin'||args[2]!=='--output')throw Error('Use --origin ORIGIN --output NEW_PRIVATE_FILE.');
  console.log(JSON.stringify(await exportContainerEnv(process.env,args[1],resolve(args[3]))));
 }catch(error){console.error(error.code==='EEXIST'?'Private output already exists; choose a new filename.':error.message);process.exitCode=1;}
}
