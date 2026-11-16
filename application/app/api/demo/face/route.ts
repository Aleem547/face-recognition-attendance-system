import {demoFaceService} from '@/lib/demo/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){try{return await demoFaceService().capture(request);}catch{return Response.json({error:'Camera demo configuration is unavailable. The sample workspace is still accessible.'},{status:503,headers:{'Cache-Control':'no-store'}});}}
