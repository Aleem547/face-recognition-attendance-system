import {boundedFaces,type FaceBox} from './geometry.ts';
export type GuideMode='off'|'loading'|'tracking'|'noface'|'multiple'|'unavailable';
export type GuideState={mode:GuideMode;boxes:FaceBox[]};
type WorkerPort=Pick<Worker,'onmessage'|'onerror'|'postMessage'|'terminate'>;
type Frame={width:number;height:number;pixels:ArrayBuffer};
type Options={worker:()=>WorkerPort;active:()=>boolean;pixels:()=>Frame|null;state:(state:GuideState)=>void;schedule?:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>;cancel?:(id:ReturnType<typeof setTimeout>)=>void};
export class FaceTracker{
 private options:Options;private worker:WorkerPort|null=null;private timer:ReturnType<typeof setTimeout>|undefined;private timeout:ReturnType<typeof setTimeout>|undefined;private generation=0;private frameId=0;private waiting:number|null=null;private ready=false;private disposed=false;
 constructor(options:Options){this.options=options;}
 private schedule(fn:()=>void,ms:number){return (this.options.schedule??setTimeout)(fn,ms);}
 private cancel(id:ReturnType<typeof setTimeout>|undefined){if(id!==undefined)(this.options.cancel??clearTimeout)(id);}
 private publish(mode:GuideMode,boxes:FaceBox[]=[]){this.options.state({mode,boxes});}
 start(){
  if(this.disposed)return;this.stop();const generation=++this.generation;
  if(!this.options.active())return;
  this.publish('loading');
  try{
   const worker=this.options.worker();this.worker=worker;
   this.timeout=this.schedule(()=>this.fail(generation),10000);
   worker.onerror=()=>this.fail(generation);
   worker.onmessage=event=>{
    if(generation!==this.generation||this.worker!==worker)return;
    if(!this.options.active()){this.stop();return;}
    const message=event.data;
    if(message?.type==='ready'&&!this.ready){this.ready=true;this.cancel(this.timeout);this.timeout=undefined;this.next(generation);return;}
    if(message?.type==='error'){this.fail(generation);return;}
    if(message?.type!=='faces'||this.waiting===null||message.id!==this.waiting)return;
    this.waiting=null;this.cancel(this.timeout);this.timeout=undefined;
    const boxes=boundedFaces(message.boxes);this.publish(boxes.length>1?'multiple':boxes.length===1?'tracking':'noface',boxes);
    this.timer=this.schedule(()=>this.next(generation),250);
   };
  }catch{this.fail(generation);}
 }
 private next(generation:number){
  this.timer=undefined;if(generation!==this.generation||!this.worker||this.waiting!==null)return;
  if(!this.options.active()){this.stop();return;}
  try{
   const frame=this.options.pixels();
   if(!frame){this.publish('noface');this.timer=this.schedule(()=>this.next(generation),250);return;}
   if(!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<20||frame.height<20||frame.width>320||frame.height>320||frame.pixels.byteLength!==frame.width*frame.height*4)throw Error('Invalid frame');
   const id=++this.frameId;this.waiting=id;this.timeout=this.schedule(()=>this.fail(generation),5000);
   this.worker.postMessage({type:'frame',id,...frame},[frame.pixels]);
  }catch{this.fail(generation);}
 }
 private fail(generation:number){if(generation!==this.generation)return;this.stop();if(!this.disposed)this.publish('unavailable');}
 stop(){this.generation++;this.cancel(this.timer);this.cancel(this.timeout);this.timer=undefined;this.timeout=undefined;this.waiting=null;this.ready=false;const worker=this.worker;this.worker=null;if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}this.publish('off');}
 dispose(){this.disposed=true;this.stop();}
}
