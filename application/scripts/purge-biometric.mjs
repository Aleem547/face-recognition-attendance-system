import {Pool} from 'pg';
let pool;
try{
  const address=new URL(process.env.APP_DATABASE_URL??'');
  if(!['postgres:','postgresql:'].includes(address.protocol)||decodeURIComponent(address.username)!=='attendai_app')throw new Error();
  address.searchParams.set('sslmode','verify-full');pool=new Pool({connectionString:address.toString(),max:1,connectionTimeoutMillis:15000});
  let total=0,removed=0;
  do{removed=(await pool.query('SELECT attendai.purge_biometric_data() AS n')).rows[0].n;total+=removed;}while(removed===500);
  console.log('Expired or invalid active templates removed:',total);
  let comparisonTotal=0;
  do{removed=(await pool.query('SELECT attendai.purge_verification_data() AS n')).rows[0].n;comparisonTotal+=removed;}while(removed>=500);
  console.log('Expired or invalid comparison results and old attempts removed:',comparisonTotal);
  console.log('Choice and deletion receipts are retained. Provider backups have separate retention.');
}catch{console.error('Biometric cleanup failed. Check migrations 005 and 006 and the restricted runtime connection.');process.exitCode=1;}
finally{await pool?.end();}
