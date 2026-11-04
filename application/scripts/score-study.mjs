// Private, separately consented offline study. Never reads the app database/templates.
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {extractFace,extractPaired} from '../lib/biometric/worker.ts';
import {featureBytes} from '../lib/biometric/crypto.ts';
import {compareFeature} from '../lib/verification/math.ts';
import {MODEL_VERSION,validateObservation,validateRows} from '../lib/evaluation/reliability.ts';
const usage='Stop the Face Recognition Attendance System server, then use node scripts/score-study.mjs --manifest PRIVATE_STUDY.json --output NEW_OBSERVATION_DIRECTORY';
async function imagePath(root,name){
  if(typeof name!=='string'||isAbsolute(name)||name.includes(':')||name.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))throw Error('Use relative image paths beneath the private study manifest.');
  let path=root;const parts=name.split(/[\\/]/);
  for(let i=0;i<parts.length;i++){path=join(path,parts[i]);const stat=await lstat(path);if(stat.isSymbolicLink()||(i<parts.length-1?!stat.isDirectory():!stat.isFile())||i===parts.length-1&&stat.size>1048576)throw Error('Study image is linked, missing, or above 1 MiB.');}
  return path;
}
try{
  const args=process.argv.slice(2),options={};while(args.length){const key=args.shift();if(!['--manifest','--output'].includes(key)||key in options||!args.length)throw Error(usage);options[key]=resolve(args.shift());}
  if(!options['--manifest']||!options['--output'])throw Error(usage);
  const path=options['--manifest'],info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>5*1024*1024)throw Error('Use a regular study manifest under 5 MiB.');
  const input=JSON.parse(await readFile(path,'utf8'));
  if(Object.keys(input).sort().join(',')!=='consentConfirmed,observations,schema,split'||input.schema!=='attendai-offline-study-v1'||input.consentConfirmed!==true||!['development','evaluation'].includes(input.split)||!Array.isArray(input.observations))throw Error('A separately consented/authorized, labelled offline study manifest is required.');
  const root=await realpath(dirname(path)),prepared=[];
  for(const entry of input.observations){
    const {referenceImage,probeImage,...labels}=entry;
    const row=validateObservation({...labels,schema:'attendai-observation-v1',split:input.split,modelVersion:MODEL_VERSION,outcome:'processing_failed',similarity:null,padV1:null,padV2:null});
    prepared.push({row,reference:await imagePath(root,referenceImage),probe:await imagePath(root,probeImage)});
  }
  validateRows(prepared.map(item=>item.row),input.split);
  // Pre-read bounded inputs to catch image reuse before creating any scored output.
  const probes=new Set(),identities=new Map();
  for(const item of prepared){const bytes=await readFile(item.probe),ref=await readFile(item.reference);
    try{const hash=createHash('sha256').update(bytes).digest('hex'),refHash=createHash('sha256').update(ref).digest('hex');
      if(probes.has(hash)||hash===refHash)throw Error('A probe image was reused or compared with itself. Use separate presentations/captures.');probes.add(hash);
      for(const [fingerprint,subject] of [[hash,item.row.subjectId],[refHash,item.row.referenceSubjectId]]){if(identities.has(fingerprint)&&identities.get(fingerprint)!==subject)throw Error('An image was assigned to different identities.');identities.set(fingerprint,subject);}
    }finally{bytes.fill(0);ref.fill(0);}
  }
  await mkdir(options['--output'],{mode:0o700}); // Refuse an existing output tree.
  let processed=0;
  for(const item of prepared){
    let referenceImage,probeImage,referenceFeature,probeResult,referenceBuffer,row=item.row;
    try{
      referenceImage=await readFile(item.reference);probeImage=await readFile(item.probe);
      referenceFeature=await extractFace(referenceImage,new AbortController().signal);
      probeResult=await extractPaired(probeImage,new AbortController().signal);referenceBuffer=featureBytes(referenceFeature);
      const similarity=compareFeature(referenceBuffer,probeResult.embedding),models=probeResult.pad.models;
      row=validateObservation({...row,outcome:'processed',similarity,padV1:models.find(m=>m.model==='MiniFASNetV1SE.onnx').class1Score,padV2:models.find(m=>m.model==='MiniFASNetV2.onnx').class1Score});processed++;
    }catch(error){row={...row,outcome:error.status===422?'quality_failed':/timed out/.test(error.message)?'timeout':'processing_failed'};}
    finally{referenceImage?.fill(0);probeImage?.fill(0);referenceFeature?.fill(0);probeResult?.embedding?.fill(0);referenceBuffer?.fill(0);}
    await writeFile(join(options['--output'],row.id+'.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log('Recorded anonymous attempt '+row.id+': '+row.outcome);
  }
  console.log('Scored '+processed+' of '+prepared.length+' presentations. Failures are retained with null scores. No attendance or reference template was changed. Offline data do not replace a real browser/camera acceptance test.');
  if(processed!==prepared.length)process.exitCode=2;
}catch(error){console.error(error.message===usage||/^Use |^Study image |^A separately |^A probe |^An image |^Unexpected |^Wrong split|^Duplicate /.test(error.message)?error.message:'Offline study could not be completed. Existing evidence was preserved. Review the private manifest, output path and native face setup.');process.exitCode=1;}
