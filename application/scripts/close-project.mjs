import {readFile,writeFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {acceptanceTemplate,closeout} from '../lib/evaluation/closeout.ts';
const usage='node scripts/close-project.mjs init --output NEW_ACCEPTANCE.json | report --software SOFTWARE_REPORT --acceptance ACCEPTANCE.json [--biometric RELIABILITY_REPORT] --output NEW_FINAL_REPORT.json';
async function json(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>5*1024*1024)throw Error('Use regular JSON files under 5 MiB.');return JSON.parse(await readFile(path,'utf8'));}
async function save(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Saved: '+path);}
try{
  const [command,...args]=process.argv.slice(2),options={};while(args.length){const key=args.shift();if(!['--software','--acceptance','--biometric','--output'].includes(key)||key in options||!args.length)throw Error(usage);options[key]=resolve(args.shift());}
  if(command==='init'&&Object.keys(options).join(',')==='--output')await save(options['--output'],acceptanceTemplate());
  else if(command==='report'&&options['--software']&&options['--acceptance']&&options['--output']){
    const software=await json(options['--software']),acceptance=await json(options['--acceptance']);let biometric=null;
    if(options['--biometric']){const stored=await json(options['--biometric']),{integrityHash,...data}=stored;
      if(typeof integrityHash!=='string'||integrityHash!==createHash('sha256').update(JSON.stringify(data)).digest('hex'))throw Error('Reliability report was edited. Preserve the original report.');biometric=data;}
    const source=Buffer.from((await readFile(new URL('../lib/release/check-source.json',import.meta.url),'utf8')).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'));
    const digest=createHash('sha256').update(source).digest('hex');
    // Recheck every source path before correlating a previous software run.
    for(const [name,hash] of Object.entries(JSON.parse(source))){
      if(name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid source manifest.');
      const parts=name.split('/');
      for(let index=0;index<parts.length;index++){
        const stat=await lstat(new URL('../'+parts.slice(0,index+1).join('/'),import.meta.url));
        if(stat.isSymbolicLink()||(index<parts.length-1?!stat.isDirectory():!stat.isFile())||index===parts.length-1&&stat.size>5*1024*1024)throw Error('Invalid source path.');
      }
      const bytes=Buffer.from((await readFile(new URL('../'+name,import.meta.url),'utf8')).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'));
      if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Source changed since this release. Rerun the appropriate reviewed validation before closing.');
    }
    const result=closeout(software,acceptance,biometric,digest);await save(options['--output'],result);console.log('Result: '+result.status+'. Deployment excluded.');
    if(result.status==='software_incomplete'||result.status==='local_acceptance_pending')process.exitCode=2;
  }else throw Error(usage);
}catch(error){console.error(error.message);process.exitCode=1;}
