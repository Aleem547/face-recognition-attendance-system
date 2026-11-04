'use strict';
// The upstream library uses window for its global export. Here it is the worker.
self.window=self;
try{
 importScripts('./jsfeat-min.js','./frontalface.js');
 self.onmessage=function(event){
  const message=event.data;if(message?.type!=='frame')return;
  let rgba,gray,sum,squared,tilted;
  try{
   const {width,height,pixels,id}=message;
   if(!Number.isInteger(width)||!Number.isInteger(height)||width<20||height<20||width>320||height>320||!(pixels instanceof ArrayBuffer)||pixels.byteLength!==width*height*4)throw Error('Invalid frame');
   rgba=new Uint8ClampedArray(pixels);gray=new jsfeat.matrix_t(width,height,jsfeat.U8_t|jsfeat.C1_t);
   jsfeat.imgproc.grayscale(rgba,width,height,gray);jsfeat.imgproc.equalize_histogram(gray,gray);
   const size=(width+1)*(height+1);sum=new Int32Array(size);squared=new Float64Array(size);tilted=new Int32Array(size);
   jsfeat.imgproc.compute_integral_image(gray,sum,squared,tilted);
   const candidates=jsfeat.haar.detect_multi_scale(sum,squared,tilted,null,width,height,jsfeat.haar.frontalface,1.2,1.5);
   const grouped=jsfeat.haar.group_rectangles(candidates,3).sort((a,b)=>b.neighbors-a.neighbors).slice(0,8);
   const boxes=grouped.map(rect=>({x:Math.max(0,rect.x/width),y:Math.max(0,rect.y/height),width:Math.min(rect.width,width-rect.x)/width,height:Math.min(rect.height,height-rect.y)/height}));
   self.postMessage({type:'faces',id,boxes});
  }catch{self.postMessage({type:'error'});}
  finally{rgba?.fill(0);gray?.data.fill(0);sum?.fill(0);squared?.fill(0);tilted?.fill(0);}
 };
 self.postMessage({type:'ready'});
}catch{self.postMessage({type:'error'});}
