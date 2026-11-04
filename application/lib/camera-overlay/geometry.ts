export type FaceBox={x:number;y:number;width:number;height:number};
export type StudentLabel={id:string;name:string;code:string};
export function boundedFaces(value:unknown):FaceBox[]{
 if(!Array.isArray(value)||value.length>8)return [];
 return value.filter((v):v is FaceBox=>Boolean(v&&['x','y','width','height'].every(k=>typeof v[k]==='number'&&Number.isFinite(v[k]))&&v.x>=0&&v.y>=0&&v.width>0&&v.height>0&&v.x+v.width<=1.001&&v.y+v.height<=1.001)).map(({x,y,width,height})=>({x,y,width:Math.min(width,1-x),height:Math.min(height,1-y)}));
}
export function projectFace(box:FaceBox,videoWidth:number,videoHeight:number,width:number,height:number,mirrored=true):FaceBox|null{
 if(!boundedFaces([box]).length||![videoWidth,videoHeight,width,height].every(v=>Number.isFinite(v)&&v>0))return null;
 const scale=Math.max(width/videoWidth,height/videoHeight),drawWidth=videoWidth*scale,drawHeight=videoHeight*scale;
 const x=(mirrored?1-box.x-box.width:box.x)*drawWidth+(width-drawWidth)/2,y=box.y*drawHeight+(height-drawHeight)/2;
 const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(width,x+box.width*drawWidth),bottom=Math.min(height,y+box.height*drawHeight);
 return right-left>1&&bottom-top>1?{x:left,y:top,width:right-left,height:bottom-top}:null;
}
export function studentLabel(value:unknown):StudentLabel|null{
 if(!value||typeof value!=='object')return null;
 const state=value as {role?:unknown;student?:{id?:unknown;display_name?:unknown;student_code?:unknown;is_active?:unknown}};
 const s=state.student;if(state.role!=='student'||!s||s.is_active!==true||typeof s.id!=='string'||!s.id||typeof s.display_name!=='string'||typeof s.student_code!=='string')return null;
 const name=s.display_name.trim(),code=s.student_code.trim();
 if(!name||name.length>200||!code||code.length>64||/[\u0000-\u001f\u007f]/.test(name+code))return null;
 return {id:s.id,name,code};
}
