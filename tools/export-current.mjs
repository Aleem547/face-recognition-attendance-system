// Optional export of this exact reviewed source version from a configured installation.
// Reads only the source allowlist, never the installation's environment or data.
import {lstat,realpath,mkdir,writeFile,rm} from 'node:fs/promises';
import {dirname,resolve,relative,join,basename,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileMap,readRegular,sha256} from './release-utils.mjs';
import {verifyRelease} from './verify-release.mjs';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const inside=(parent,child)=>{const part=relative(parent,child);return !part||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};
async function exportCurrent(project,output){
  const files=await verifyRelease(repository);
  const requested=resolve(project),info=await lstat(requested);
  if(!info.isDirectory()||info.isSymbolicLink())throw Error('Select a real application directory, not a linked path.');
  const source=await realpath(requested),out=resolve(await realpath(dirname(resolve(output))),basename(resolve(output)));
  if(inside(source,out)||inside(out,source)||inside(repository,out)||inside(out,repository))throw Error('The new output must be separate from both source and release directories.');
  try{await lstat(out);throw Error('Output already exists. Choose a new directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const sources=fileMap(await readRegular(repository,'source-files.json')),verified=new Map();
  // Verify everything before creating any output. CRLF and a UTF-8 BOM may
  // be normalized only when the result matches the recorded source hash.
  for(const [name,hash] of Object.entries(sources)){
    let bytes=await readRegular(source,name);
    if(sha256(bytes)!==hash)bytes=Buffer.from(bytes.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'));
    if(sha256(bytes)!==hash)throw Error('Source differs from this release; original preserved: '+name);
    verified.set('application/'+name,bytes);
  }
  let created=false;
  try{
    await mkdir(out,{mode:0o700});created=true;
    for(const name of [...Object.keys(files),'release-files.json']){
      const bytes=verified.get(name)??await readRegular(repository,name),dest=join(out,name);
      await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:'wx',mode:0o644});
    }
    await verifyRelease(out);
    console.log('Export complete: '+out);
    console.log('Only matching release source files were copied. Environment, data, backups, dependencies and unlisted files were not read or exported.');
  }catch(error){if(created)await rm(out,{recursive:true,force:true});throw error;}
}
try{
  const args=process.argv.slice(2),options={};
  while(args.length){const key=args.shift();if(!['--project','--output'].includes(key)||key in options||!args.length)throw Error('Use --project APPLICATION_DIRECTORY --output NEW_DIRECTORY.');options[key]=args.shift();}
  if(!options['--project']||!options['--output'])throw Error('Use --project APPLICATION_DIRECTORY --output NEW_DIRECTORY.');
  await exportCurrent(options['--project'],options['--output']);
}catch(error){console.error(error.message);process.exitCode=1;}
