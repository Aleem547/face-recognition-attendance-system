import { RegisterError } from '../register/service.ts';
export const PAD_NOTICE = 'paired-pad-research-v1';
export type PadScores = {
 version: string; models: {model:string;class1Score:number}[]; meanClass1Score:number;
 decision:'not_calibrated';readyForAttendance:false;
};
export function pairedChoice(value:string|null):boolean {
 if(value===null)return false;
 if(value!==PAD_NOTICE)throw new RegisterError(400,'Review the optional paired PAD research notice before capturing.');
 return true;
}
export function validatePad(value:unknown):PadScores {
 const p=value as PadScores;
 const score=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
 if(!p||Object.keys(p).sort().join(',')!=='decision,meanClass1Score,models,readyForAttendance,version'||
 p.version!=='attendai-pad-minifas-research-v1'||p.decision!=='not_calibrated'||p.readyForAttendance!==false||
 !Array.isArray(p.models)||p.models.length!==2||!score(p.meanClass1Score))throw new RegisterError(503,'Invalid PAD research output.');
 const names=p.models.map(m=>m?.model).sort().join(',');
 if(names!=='MiniFASNetV1SE.onnx,MiniFASNetV2.onnx'||p.models.some(m=>Object.keys(m).sort().join(',')!=='class1Score,model'||!score(m.class1Score))||
 Math.abs(p.meanClass1Score-p.models.reduce((s,m)=>s+m.class1Score,0)/2)>1e-12)throw new RegisterError(503,'Invalid PAD research output.');
 return p;
}
