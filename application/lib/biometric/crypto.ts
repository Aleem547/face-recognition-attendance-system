import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { RegisterError } from "../register/service.ts";
export const MODEL_VERSION = "sface2021dec-yunet2023mar-v1";
export type TemplateIdentity = { studentId: string; templateId: string; noticeVersion: string; choiceRevision: number; modelVersion: string; keyId: string };
export function readKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new RegisterError(503,"Biometric encryption is not configured. Run face:configure on the server.");
  const key=Buffer.from(value,"base64");
  if(key.length!==32 || key.toString("base64")!==value) throw new RegisterError(503,"Biometric encryption configuration is invalid.");
  return key;
}
export function keyId(key: Buffer) { return createHash("sha256").update(key).digest("hex").slice(0,16); }
function aad(identity: TemplateIdentity) { return Buffer.from(JSON.stringify(["attendai-face-template",1,identity.studentId,identity.templateId,identity.noticeVersion,identity.choiceRevision,identity.modelVersion,identity.keyId])); }
export function featureBytes(values: unknown): Buffer {
  if(!Array.isArray(values)||values.length!==128||values.some(x=>typeof x!=="number"||!Number.isFinite(x))) throw new RegisterError(503,"The face engine returned an invalid template.");
  const norm=Math.sqrt(values.reduce((sum,x)=>sum+x*x,0));
  if(!Number.isFinite(norm)||Math.abs(norm-1)>0.001) throw new RegisterError(503,"The face engine returned an invalid template.");
  const bytes=Buffer.alloc(512);values.forEach((x,i)=>bytes.writeFloatLE(x,i*4));return bytes;
}
export function encryptFeature(values: unknown,key: Buffer,identity: TemplateIdentity) {
  if(key.length!==32||identity.keyId!==keyId(key)||identity.modelVersion!==MODEL_VERSION) throw new RegisterError(503,"Biometric encryption configuration is invalid.");
  const bytes=featureBytes(values),iv=randomBytes(12);
  try { const cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(aad(identity));
    return {iv,ciphertext:Buffer.concat([cipher.update(bytes),cipher.final(),cipher.getAuthTag()])};
  } finally {bytes.fill(0);}
}
// Server-only reference decryption. Never return its output through a route.
export function decryptFeature(ciphertext: Buffer,iv: Buffer,key: Buffer,identity: TemplateIdentity): Buffer {
  if(ciphertext.length!==528||iv.length!==12||identity.keyId!==keyId(key))throw new Error("Invalid encrypted template.");
  const cipher=createDecipheriv("aes-256-gcm",key,iv);cipher.setAAD(aad(identity));cipher.setAuthTag(ciphertext.subarray(512));
  return Buffer.concat([cipher.update(ciphertext.subarray(0,512)),cipher.final()]);
}
