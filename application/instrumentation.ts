export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build'&&process.env.APP_DATABASE_URL){
  const {startClassClock}=await import('./lib/automation/runner');startClassClock();
 }
}
