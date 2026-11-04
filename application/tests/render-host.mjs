import assert from 'node:assert/strict';
import {deploymentEnvironment,validateContainer} from '../scripts/container-start.mjs';
let n=0;
const check=(name,fn)=>{fn();console.log(`PASS ${++n}: ${name}`);};
const fixture={
 APP_DATABASE_URL:'postgresql://'+'attendai_app:fixture@db.example/fixture?sslmode=verify-full',
 BETTER_AUTH_SECRET:'fixture-private-value-'.repeat(3),
 ATTENDAI_BIOMETRICS_ENABLED:'false',ATTENDAI_VERIFICATION_TRIAL_ENABLED:'false',
 RENDER:'true',RENDER_EXTERNAL_URL:'https://fixture.onrender.com',PORT:'10000',
};
check('Render HTTPS address reaches the server environment without changing the input',()=>{
 const env=deploymentEnvironment(fixture);
 assert.equal(env.BETTER_AUTH_URL,fixture.RENDER_EXTERNAL_URL);
 assert.equal(fixture.BETTER_AUTH_URL,undefined);
 assert.equal(validateContainer(env).port,'10000');
});
check('explicit deployment origins and existing secrets remain unchanged',()=>{
 const key=Buffer.alloc(32,7).toString('base64');
 const input={...fixture,BETTER_AUTH_URL:'https://custom.example',ATTENDAI_BIOMETRICS_ENABLED:'true',ATTENDAI_BIOMETRIC_KEY:key};
 const env=deploymentEnvironment(input);validateContainer(env);
 assert.deepEqual(env,input);
});
check('Render does not accidentally retain the old localhost preview address',()=>{
 const env=deploymentEnvironment({...fixture,BETTER_AUTH_URL:'http://localhost:3001',FRAS_LOCAL_PREVIEW:'true'});
 assert.throws(()=>validateContainer(env));
});
check('missing, forged, insecure or non-origin Render addresses fail closed',()=>{
 for(const address of [undefined,'http://fixture.onrender.com','https://fixture.onrender.com.evil.example','https://user:pass@fixture.onrender.com','https://fixture.onrender.com/path','https://fixture.onrender.com?query=yes','https://fixture.onrender.com#hash','https://fixture.onrender.com:444','https://onrender.com'])assert.throws(()=>deploymentEnvironment({...fixture,RENDER_EXTERNAL_URL:address}));
});
check('non-Render hosts still require an explicitly configured origin',()=>{
 assert.throws(()=>validateContainer(deploymentEnvironment({...fixture,RENDER:undefined})));
 const env=deploymentEnvironment({...fixture,RENDER:undefined,BETTER_AUTH_URL:'http://localhost:3001',FRAS_LOCAL_PREVIEW:'true'});
 assert.equal(env.BETTER_AUTH_URL,'http://localhost:3001');validateContainer(env);
});
console.log(`Render origin checks passed: ${n}. No live database or host was used.`);
