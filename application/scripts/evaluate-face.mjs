import {lstat,readFile,writeFile} from 'node:fs/promises';
import {evaluateDataset} from './lib/face-evaluation.mjs';
try{
 const [input,output,...extra]=process.argv.slice(2);if(!input||extra.length)throw new Error('Usage: npm run face:evaluate -- labelled-scores.json [new-report.json]');
 const info=await lstat(input);if(!info.isFile()||info.isSymbolicLink()||info.size>10*1024*1024)throw new Error('Use a regular score-only JSON file of at most 10 MiB.');
 let data;try{data=JSON.parse((await readFile(input,'utf8')).replace(/^\uFEFF/,''));}catch{throw new Error('The input must be valid score-only JSON.');}
 const result=JSON.stringify(evaluateDataset(data),null,2)+'\n';
 if(output){await writeFile(output,result,{flag:'wx',mode:0o600});console.log('Score evaluation report written. Research only; attendance integration remains disabled.');}
 else process.stdout.write(result);
}catch(error){
 const known=error.code==='EEXIST'?'Output already exists. Choose a new report filename.':error.code?'The evaluation file could not be read or written.':error.message;
 console.error(known);process.exitCode=1;
}
