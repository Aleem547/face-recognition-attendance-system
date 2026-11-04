import {lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function safeName(name){
  if(typeof name!=='string'||name.length>500||name.includes('\\')||name.includes(':')||name.includes('\0')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid release path.');
  return name;
}
export async function readRegular(root,name){
  safeName(name);let current=root;const parts=name.split('/');
  for(let i=0;i<parts.length;i++){
    current=join(current,parts[i]);const info=await lstat(current);
    if(info.isSymbolicLink()||(i<parts.length-1?!info.isDirectory():!info.isFile())||info.size>12*1024*1024)throw Error('Linked, oversized or invalid release path: '+name);
  }
  return readFile(current);
}
export function fileMap(bytes){
  const result=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  if(!result||typeof result!=='object'||Array.isArray(result)||!result.files||typeof result.files!=='object'||Array.isArray(result.files)||!Object.keys(result.files).length||Object.keys(result.files).length>2000)throw Error('Invalid file manifest.');
  for(const [name,hash] of Object.entries(result.files)){safeName(name);if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid file hash.');}
  return result.files;
}
export function publicFile(name,bytes){
  if(name.split('/').some(p=>['.git','node_modules','.next','.next-dev','.venv-face','__pycache__'].includes(p))||/(?:^|\/)\.env(?:$|\.)/.test(name)&&name!=='application/.env.example'||/\.(?:dump|backup|pem|key|p12|pfx|onnx|sqlite|npy|npz|enc|mp4|jpg|jpeg)$/i.test(name))throw Error('Private or generated file in release list: '+name);
  if(name.endsWith('.png')){
    if(!['assets/overview.png','assets/register.png'].includes(name))throw Error('Unreviewed image: '+name);
    return;
  }
  const text=bytes.toString('utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}|\bAKIA[A-Z0-9]{16}\b/.test(text))throw Error('Possible credential in release file: '+name);
  if(/postgres(?:ql)?:\/\/[^\s\x22\x27/:]+:[^\s\x22\x27@]+@/i.test(text)&&!(name==='application/.env.example'&&text.includes('OWNER:CHANGE_ME@DB_HOST/DB_NAME')))throw Error('Database credential URL in release file: '+name);
}
