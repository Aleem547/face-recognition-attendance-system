const known:Record<string,{category:string;hint:string}>={
 '42501':{category:'permissions',hint:'Check the restricted runtime role and migration 009 grants; do not grant owner privileges.'},
 '42883':{category:'migration',hint:'Check that migration 009 and its clock function exist in the configured database.'},
 '42P01':{category:'migration',hint:'Check the configured database and missing migration objects.'},
 '3F000':{category:'migration',hint:'Check the configured database and migration schema.'},
 '28P01':{category:'authentication',hint:'Check the existing runtime database credential privately.'},
 '28000':{category:'authentication',hint:'Check the restricted runtime database login privately.'},
 '3D000':{category:'database',hint:'Check the configured database name privately.'},
 '53300':{category:'capacity',hint:'The database connection limit was reached; inspect connection capacity.'},
 '57014':{category:'timeout',hint:'The bounded database operation timed out; check database wake-up and workload.'},
 '55P03':{category:'lock',hint:'A database lock exceeded the clock allowance; inspect competing transactions.'},
 '40001':{category:'retryable',hint:'A concurrent transaction conflicted; the clock will retry.'},
 '40P01':{category:'retryable',hint:'A database deadlock was detected; the clock will retry.'},
 'ECONNREFUSED':{category:'connection',hint:'Check database availability and the existing connection settings.'},
 'ENOTFOUND':{category:'connection',hint:'Check the database hostname and DNS.'},
 'EAI_AGAIN':{category:'connection',hint:'Database DNS resolution was temporarily unavailable.'},
 'ECONNRESET':{category:'connection',hint:'The database connection was reset; check availability.'},
 'ETIMEDOUT':{category:'timeout',hint:'The database connection timed out; check reachability and wake-up.'},
 'SELF_SIGNED_CERT_IN_CHAIN':{category:'tls',hint:'Check the trusted certificate chain. Keep full certificate verification enabled.'},
 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':{category:'tls',hint:'Check the trusted certificate chain. Keep full certificate verification enabled.'},
 'CERT_HAS_EXPIRED':{category:'tls',hint:'Check the certificate validity and system time. Keep verification enabled.'},
 'ERR_TLS_CERT_ALTNAME_INVALID':{category:'tls',hint:'Check the database hostname against its certificate. Keep hostname verification enabled.'},
 'DEPTH_ZERO_SELF_SIGNED_CERT':{category:'tls',hint:'Configure the correct trusted CA. Keep certificate verification enabled.'},
 'FRAS_BAD_DATABASE_URL':{category:'configuration',hint:'Use a valid restricted PostgreSQL connection with sslmode=verify-full.'},
};
export function clockFailure(error:unknown):{category:string;code:string;hint:string}{
 let current=error;
 for(let i=0;i<4&&current&&typeof current==='object';i++){
  const item=current as {code?:unknown;cause?:unknown};
  if(typeof item.code==='string'&&known[item.code])return {code:item.code,...known[item.code]};
  current=item.cause;
 }
 // No message, detail, stack, query, URL or arbitrary error code is exposed.
 return {category:'unknown',code:'UNCLASSIFIED',hint:'Run the read-only clock diagnostic; inspect the original error only in a private debugging session.'};
}
