import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileMap,readRegular,sha256,publicFile} from './release-utils.mjs';

export async function verifyRelease(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')){
  const files=fileMap(await readRegular(root,'release-files.json'));
  for(const [name,expected] of Object.entries(files)){
    const bytes=await readRegular(root,name);
    if(sha256(bytes)!==expected)throw Error('Missing or changed release file: '+name);
    publicFile(name,bytes);
  }
  return files;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)throw Error('Run node tools/verify-release.mjs from the extracted release.');
    const files=await verifyRelease();
    console.log('Release verified: '+Object.keys(files).length+' allowlisted files; checksums and credential-pattern scan passed.');
    console.log('Local unlisted files are not part of this release. The publishing helper stages only this list.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
