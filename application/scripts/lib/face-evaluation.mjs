// Score-only research evaluation, not a biometric capture or live decision tool.
export const MODEL_VERSION='sface2021dec-yunet2023mar-v1';
export const MINIMUMS={genuinePairs:20,impostorPairs:100,subjects:5}; // Engineering warnings, not a standard.
function fail(message){throw new Error(message);}
function fields(value,expected){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!expected.includes(k))||expected.some(k=>!(k in value)))fail('Unexpected or missing evaluation field.');}
function id(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);}
export function validateDataset(data){
 fields(data,['modelVersion','datasetKind','development','evaluation']);
 if(data.modelVersion!==MODEL_VERSION)fail('The evaluation model version does not match this engine.');
 if(!['synthetic','consented_research','licensed_benchmark'].includes(data.datasetKind))fail('Declare a supported dataset kind.');
 const pairIds=new Set(),capturePairs=new Set(),captures=new Map(),splitSubjects=[];
 for(const split of ['development','evaluation']){
  const rows=data[split],subjects=new Set();splitSubjects.push(subjects);
  if(!Array.isArray(rows)||rows.length===0||rows.length>100000)fail('Each split needs 1 to 100000 labelled score pairs.');
  let genuine=0,impostor=0;
  for(const row of rows){
   fields(row,['pairId','subjectA','subjectB','captureA','captureB','label','score']);
   if(![row.pairId,row.subjectA,row.subjectB,row.captureA,row.captureB].every(id))fail('Use anonymous alphanumeric identifiers, underscores or hyphens.');
   if(pairIds.has(row.pairId))fail('Duplicate pair identifier.');pairIds.add(row.pairId);
   if(row.captureA===row.captureB)fail('A capture cannot be compared with itself.');
   if(!['genuine','impostor'].includes(row.label)||(row.label==='genuine')!==(row.subjectA===row.subjectB))fail('Pair labels must agree with subject identities.');
   if(typeof row.score!=='number'||!Number.isFinite(row.score)||row.score< -1||row.score>1)fail('Scores must be finite numbers between -1 and 1.');
   const pair=[row.captureA,row.captureB].sort().join(':');if(capturePairs.has(pair))fail('Duplicate capture pair, including reversed pairs.');capturePairs.add(pair);
   for(const [capture,subject] of [[row.captureA,row.subjectA],[row.captureB,row.subjectB]]){
    const before=captures.get(capture);if(before&&(before.subject!==subject||before.split!==split))fail('A capture was reused with another subject or split.');
    captures.set(capture,{subject,split});subjects.add(subject);
   }
   if(row.label==='genuine')genuine++;else impostor++;
  }
  if(!genuine||!impostor)fail('Each split requires both genuine and impostor pairs.');
 }
 if([...splitSubjects[0]].some(subject=>splitSubjects[1].has(subject)))fail('Development and evaluation subjects must be disjoint.');
 return data;
}
export function rates(rows,threshold){
 let genuinePairs=0,impostorPairs=0,falseMatches=0,falseNonMatches=0;
 for(const row of rows){if(row.label==='genuine'){genuinePairs++;if(row.score<threshold)falseNonMatches++;}else{impostorPairs++;if(row.score>=threshold)falseMatches++;}}
 return {genuinePairs,impostorPairs,falseMatches,falseNonMatches,fmr:falseMatches/impostorPairs,fnmr:falseNonMatches/genuinePairs,subjects:new Set(rows.flatMap(r=>[r.subjectA,r.subjectB])).size};
}
function selectThreshold(rows,targetFmr){
 const groups=new Map([[-1,{g:0,i:0}],[1,{g:0,i:0}]]);let genuine=0,impostor=0;
 for(const row of rows){if(!groups.has(row.score))groups.set(row.score,{g:0,i:0});groups.get(row.score)[row.label==='genuine'?'g':'i']++;if(row.label==='genuine')genuine++;else impostor++;}
 let acceptedG=0,acceptedI=0,best=null;
 for(const score of [...groups.keys()].sort((a,b)=>b-a)){
  const group=groups.get(score);acceptedG+=group.g;acceptedI+=group.i;
  const fmr=acceptedI/impostor,fnmr=(genuine-acceptedG)/genuine;
  if(fmr<=targetFmr&&(!best||fnmr<best.fnmr||(fnmr===best.fnmr&&fmr<best.fmr)))best={threshold:score,fmr,fnmr};
 }
 return best?.threshold??null;
}
export function evaluateDataset(input,targetFmr=0.01){
 const data=validateDataset(input);
 if(typeof targetFmr!=='number'||!Number.isFinite(targetFmr)||targetFmr<0||targetFmr>=1)fail('The development target FMR must be between 0 inclusive and 1 exclusive.');
 const threshold=selectThreshold(data.development,targetFmr);
 const adequacy=rows=>{const totals=rates(rows,0);return totals.genuinePairs>=MINIMUMS.genuinePairs&&totals.impostorPairs>=MINIMUMS.impostorPairs&&totals.subjects>=MINIMUMS.subjects;};
 const warnings=[
  'This is empirical pair error measurement, not a population accuracy guarantee or a liveness test.',
  'Pairs may share captures or subjects within a split and are not necessarily independent. No confidence interval is claimed.',
  'The sample minimums are project engineering warnings, not NIST requirements or deployment approval.',
  'Representativeness, capture failures, lighting, devices, demographic variation and spoof resistance need separate evaluation.',
  'The candidate is chosen using development scores only. Keep evaluation subjects separate and do not retune using their results.'
 ];
 if(data.datasetKind==='synthetic')warnings.push('Synthetic scores test the evaluator only and provide no evidence of face recognition accuracy.');
 if(!adequacy(data.development)||!adequacy(data.evaluation))warnings.push('One or both splits fall below the project sample minimums. Treat the result as an insufficient-data demonstration.');
 if(threshold===null)warnings.push('No threshold within [-1,1] meets the development target. No candidate was selected.');
 return {modelVersion:data.modelVersion,datasetKind:data.datasetKind,developmentTargetFmr:targetFmr,
  candidateThreshold:threshold,thresholdUse:'research candidate only; never applied by Face Recognition Attendance System',
  minimums:MINIMUMS,sampleMinimumsMet:{development:adequacy(data.development),evaluation:adequacy(data.evaluation)},
  development:threshold===null?null:rates(data.development,threshold),evaluation:threshold===null?null:rates(data.evaluation,threshold),
  readyForAttendance:false,warnings,metricDefinitions:'https://pages.nist.gov/frvt/html/frvt11.html'};
}
