import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {MODEL_VERSION,calibrate,evaluate,validateObservation} from '../lib/evaluation/reliability.ts';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const usage='node scripts/reliability.mjs init --output DIRECTORY | calibrate --plan PLAN --observations DEV_DIRECTORY --output NEW_CANDIDATE.json | evaluate --candidate CANDIDATE --observations EVAL_DIRECTORY --output NEW_REPORT.json';
async function json(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>5*1024*1024)throw Error('Use regular JSON files under 5 MiB.');return JSON.parse(await readFile(path,'utf8'));}
async function observations(directory){
  const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Use a regular observations directory.');
  const names=(await readdir(directory)).filter(name=>name.endsWith('.json')).sort();
  if(!names.length||names.length>10000)throw Error('Observation directory needs 1–10000 JSON files.');
  const rows=[];for(const name of names){const value=await json(join(directory,name));rows.push(...(Array.isArray(value)?value:[value]));if(rows.length>10000)throw Error('At most 10000 observations are supported.');}
  return rows;
}
async function save(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Saved: '+path);}
try{
  const [command,...args]=process.argv.slice(2),options={};
  while(args.length){const key=args.shift();if(!['--plan','--observations','--output','--candidate'].includes(key)||key in options||!args.length)throw Error(usage);options[key]=resolve(args.shift());}
  if(command==='init'){
    if(Object.keys(options).join(',')!=='--output')throw Error(usage);
    const out=options['--output'];await mkdir(out,{recursive:true});
    for(const split of ['development','evaluation'])await mkdir(join(out,split),{recursive:true});
    await save(join(out,'research-plan.json'),{schema:'attendai-reliability-plan-v1',evidenceKind:'consented_research',acknowledged:false,modelVersion:MODEL_VERSION,
      targets:{maxFalseMatchRate:null,maxAttackAcceptanceRate:null,maxGenuineRejectionRate:null,maxFailureRate:null},minimums:{participantsPerSplit:5,presentationsPerCondition:20}});
    console.log('Draft created. Select explicit error budgets and acknowledge the plan before collecting evaluation data. Minimums are project coverage checks, not statistical approval.');
  }else if(command==='calibrate'){
    if(Object.keys(options).sort().join(',')!=='--observations,--output,--plan')throw Error(usage);
    const rows=await observations(options['--observations']),result=calibrate(rows,await json(options['--plan']));
    result.developmentDataHash=digest(rows);result.integrityHash=digest(result);await save(options['--output'],result);
    console.log('Result: '+result.status+'. Candidate is research only; no app policy changed.');
    if(!result.thresholds)process.exitCode=2;
  }else if(command==='evaluate'){
    if(Object.keys(options).sort().join(',')!=='--candidate,--observations,--output')throw Error(usage);
    const stored=await json(options['--candidate']),{integrityHash,...candidate}=stored;
    if(typeof integrityHash!=='string'||integrityHash!==digest(candidate))throw Error('Candidate was edited or is incomplete. Preserve it and start a new study.');
    const rows=await observations(options['--observations']),result=evaluate(rows,candidate);
    result.candidateHash=integrityHash;result.evaluationDataHash=digest(rows);result.integrityHash=digest(result);await save(options['--output'],result);
    console.log('Result: '+result.status+'. Biometric approval remains not granted.');
    if(result.status!=='empirical_budgets_met_review_required')process.exitCode=2;
  }else throw Error(usage);
}catch(error){console.error(error.message);process.exitCode=1;}
