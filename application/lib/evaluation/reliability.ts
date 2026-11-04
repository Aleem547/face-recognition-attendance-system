// Pure, shared score evaluation. No images, features, network, or attendance writes.
export const MODEL_VERSION='sface2021dec-yunet2023mar-v1|attendai-pad-minifas-research-v1';
export const CONDITIONS=['genuine','impostor','printed_photo','phone_photo','video_replay'] as const;
export type Condition=typeof CONDITIONS[number];
export type Observation={schema:'attendai-observation-v1';id:string;split:'development'|'evaluation';
  subjectId:string;referenceSubjectId:string;sessionId:string;referenceSessionId:string;
  cameraId:string;lighting:'normal'|'dim'|'backlit';presentation:Condition;attackInstrumentId:string|null;
  capturedAt:string;modelVersion:string;outcome:'processed'|'quality_failed'|'processing_failed'|'timeout';
  similarity:number|null;padV1:number|null;padV2:number|null};
export type Plan={schema:'attendai-reliability-plan-v1';evidenceKind:'synthetic'|'consented_research'|'licensed_benchmark';
  acknowledged:boolean;modelVersion:string;targets:{maxFalseMatchRate:number;maxAttackAcceptanceRate:number;
  maxGenuineRejectionRate:number;maxFailureRate:number};minimums:{participantsPerSplit:number;presentationsPerCondition:number}};
export type Thresholds={faceMinimum:number;padMinimumEachModel:number};
function fail(message:string):never{throw Error(message);}
function exact(value:unknown,keys:string[]){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail('Unexpected or missing fields.');
}
const anonymous=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const finite=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export function validateObservation(input:unknown):Observation{
  exact(input,['schema','id','split','subjectId','referenceSubjectId','sessionId','referenceSessionId','cameraId','lighting','presentation','attackInstrumentId','capturedAt','modelVersion','outcome','similarity','padV1','padV2']);
  const row=input as Observation;
  if(row.schema!=='attendai-observation-v1'||row.modelVersion!==MODEL_VERSION)fail('Observation schema or model differs.');
  if(![row.id,row.subjectId,row.referenceSubjectId,row.sessionId,row.referenceSessionId,row.cameraId].every(anonymous))fail('Use anonymous letters, digits, underscores or hyphens, at most 64 characters.');
  if(!['development','evaluation'].includes(row.split)||!CONDITIONS.includes(row.presentation)||!['normal','dim','backlit'].includes(row.lighting))fail('Invalid split, presentation or lighting.');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(row.capturedAt)||!Number.isFinite(Date.parse(row.capturedAt)))fail('Use a valid UTC capture timestamp.');
  if(row.sessionId===row.referenceSessionId)fail('Enrollment and probe must be from separate capture sessions.');
  if((row.presentation==='impostor')===(row.subjectId===row.referenceSubjectId))fail('Presentation label and reference identity disagree.');
  const attack=!['genuine','impostor'].includes(row.presentation);
  if(attack?!anonymous(row.attackInstrumentId):row.attackInstrumentId!==null)fail('Attacks require an anonymous instrument ID; genuine/impostor attempts use null.');
  if(!['processed','quality_failed','processing_failed','timeout'].includes(row.outcome))fail('Invalid processing outcome.');
  if(row.outcome==='processed'){
    if(!finite(row.similarity,-1,1)||!finite(row.padV1,0,1)||!finite(row.padV2,0,1))fail('Processed attempts require the same-frame cosine and both PAD scores.');
  }else if(row.similarity!==null||row.padV1!==null||row.padV2!==null)fail('Unscored failures must contain null scores; never substitute zero.');
  return row;
}
export function validateRows(input:unknown,split:'development'|'evaluation'){
  if(!Array.isArray(input)||input.length===0||input.length>10000)fail('Use 1 to 10000 observations.');
  const ids=new Set<string>(),rows=input.map(validateObservation);
  for(const row of rows){if(row.split!==split)fail('Wrong split for this command.');if(ids.has(row.id))fail('Duplicate observation ID.');ids.add(row.id);}
  return rows;
}
export function validatePlan(input:unknown):Plan{
  exact(input,['schema','evidenceKind','acknowledged','modelVersion','targets','minimums']);const plan=input as Plan;
  if(plan.schema!=='attendai-reliability-plan-v1'||plan.modelVersion!==MODEL_VERSION||plan.acknowledged!==true||!['synthetic','consented_research','licensed_benchmark'].includes(plan.evidenceKind))fail('Review the plan, evidence kind and models, then explicitly acknowledge it before calibration.');
  exact(plan.targets,['maxFalseMatchRate','maxAttackAcceptanceRate','maxGenuineRejectionRate','maxFailureRate']);
  if(Object.values(plan.targets).some(value=>!finite(value,0,0.999999)))fail('Select explicit error budgets from 0 inclusive to 1 exclusive. Draft null budgets cannot run.');
  exact(plan.minimums,['participantsPerSplit','presentationsPerCondition']);
  if(Object.values(plan.minimums).some(value=>!Number.isInteger(value)||value<1||value>10000))fail('Choose positive integer project sample minimums, at most 10000.');
  return plan;
}
const ratio=(n:number,d:number)=>d?n/d:null;
export function summarize(rows:Observation[],thresholds:Thresholds){
  if(!finite(thresholds.faceMinimum,-1,1)||!finite(thresholds.padMinimumEachModel,0,1))fail('Invalid thresholds.');
  return Object.fromEntries(CONDITIONS.map(condition=>{
    const all=rows.filter(row=>row.presentation===condition),scored=all.filter(row=>row.outcome==='processed');
    const face=scored.filter(row=>row.similarity!>=thresholds.faceMinimum),pad=scored.filter(row=>row.padV1!>=thresholds.padMinimumEachModel&&row.padV2!>=thresholds.padMinimumEachModel);
    const joint=face.filter(row=>row.padV1!>=thresholds.padMinimumEachModel&&row.padV2!>=thresholds.padMinimumEachModel);
    const failures=all.length-scored.length;
    return [condition,{attempts:all.length,scored:scored.length,failures,faceAccepted:face.length,padAccepted:pad.length,jointAccepted:joint.length,
      failureRate:ratio(failures,all.length),faceAcceptanceRate:ratio(face.length,scored.length),padAcceptanceRate:ratio(pad.length,scored.length),
      jointAcceptanceRate:ratio(joint.length,scored.length),endToEndAcceptanceRate:ratio(joint.length,all.length),
      endToEndRejectionOrFailureRate:ratio(all.length-joint.length,all.length),
      padBpcer:condition==='genuine'?ratio(scored.length-pad.length,scored.length):null,
      padApcer:!['genuine','impostor'].includes(condition)?ratio(pad.length,scored.length):null,
      outcomes:Object.fromEntries(['processed','quality_failed','processing_failed','timeout'].map(outcome=>[outcome,all.filter(row=>row.outcome===outcome).length]))}];
  })) as Record<Condition,{attempts:number;scored:number;failures:number;faceAccepted:number;padAccepted:number;jointAccepted:number;failureRate:number|null;faceAcceptanceRate:number|null;padAcceptanceRate:number|null;jointAcceptanceRate:number|null;endToEndAcceptanceRate:number|null;endToEndRejectionOrFailureRate:number|null;padBpcer:number|null;padApcer:number|null;outcomes:Record<string,number>}>;
}
export function adequacy(rows:Observation[],plan:Plan){
  const subjects=[...new Set(rows.flatMap(row=>[row.subjectId,row.referenceSubjectId]))].sort();
  const genuineSubjects=new Set(rows.filter(row=>row.presentation==='genuine').map(row=>row.subjectId));
  const perCondition=Object.fromEntries(CONDITIONS.map(condition=>[condition,rows.filter(row=>row.presentation===condition).length]));
  const missing=CONDITIONS.filter(condition=>perCondition[condition]<plan.minimums.presentationsPerCondition);
  const enough=genuineSubjects.size>=plan.minimums.participantsPerSplit&&missing.length===0;
  return {enough,subjects,genuineParticipants:genuineSubjects.size,perCondition,missingConditions:missing,
    sessions:[...new Set(rows.flatMap(row=>[row.sessionId,row.referenceSessionId]))].sort(),observationIds:rows.map(row=>row.id).sort()};
}
export function assess(rows:Observation[],thresholds:Thresholds,plan:Plan){
  const metrics=summarize(rows,thresholds),coverage=adequacy(rows,plan),reasons:string[]=[];
  if(!coverage.enough)reasons.push('Project sample minimums or required conditions are missing.');
  for(const condition of CONDITIONS){const m=metrics[condition];
    if(!m.scored)reasons.push(condition+': no scored presentations.');
    if(m.failureRate===null||m.failureRate>plan.targets.maxFailureRate)reasons.push(condition+': acquisition/processing failure budget exceeded or unavailable.');
  }
  if(metrics.impostor.faceAcceptanceRate===null||metrics.impostor.faceAcceptanceRate>plan.targets.maxFalseMatchRate)reasons.push('Face false-match budget exceeded or unavailable.');
  for(const condition of ['printed_photo','phone_photo','video_replay'] as const){
    if(metrics[condition].padApcer===null||metrics[condition].padApcer!>plan.targets.maxAttackAcceptanceRate)reasons.push(condition+': PAD attack-acceptance budget exceeded or unavailable.');
  }
  if(metrics.genuine.endToEndRejectionOrFailureRate===null||metrics.genuine.endToEndRejectionOrFailureRate>plan.targets.maxGenuineRejectionRate)reasons.push('Genuine end-to-end rejection/failure budget exceeded or unavailable.');
  return {metrics,coverage,empiricalBudgetsMet:reasons.length===0,reasons,
    interpretation:'Observed presentation-level rates only. Repeated participants/sessions are correlated; no population confidence bound or deployment approval is claimed.'};
}
export function calibrate(input:unknown,rawPlan:unknown){
  const plan=validatePlan(rawPlan),rows=validateRows(input,'development'),scored=rows.filter(row=>row.outcome==='processed');
  const genuine=scored.filter(row=>row.presentation==='genuine'),impostor=scored.filter(row=>row.presentation==='impostor');
  if(!genuine.length||!impostor.length||CONDITIONS.some(c=>!scored.some(r=>r.presentation===c)))fail('Development needs scored genuine, impostor, print, phone-photo and replay observations.');
  // Calibrate components separately using development only. Evaluation is never an input.
  const faceOptions=[...new Set([-1,1,...genuine.map(r=>r.similarity!),...impostor.map(r=>r.similarity!)])].sort((a,b)=>a-b);
  const face=faceOptions.map(threshold=>({threshold,fnmr:genuine.filter(r=>r.similarity!<threshold).length/genuine.length,fmr:impostor.filter(r=>r.similarity!>=threshold).length/impostor.length}))
    .filter(item=>item.fmr<=plan.targets.maxFalseMatchRate).sort((a,b)=>a.fnmr-b.fnmr||a.fmr-b.fmr||a.threshold-b.threshold)[0];
  const attacks=scored.filter(row=>!['genuine','impostor'].includes(row.presentation));
  const padOptions=[...new Set([0,1,...genuine.map(r=>Math.min(r.padV1!,r.padV2!)),...attacks.map(r=>Math.min(r.padV1!,r.padV2!))])].sort((a,b)=>a-b);
  const pad=padOptions.map(threshold=>({threshold,bpcer:genuine.filter(r=>Math.min(r.padV1!,r.padV2!)<threshold).length/genuine.length,
    worst:Math.max(...(['printed_photo','phone_photo','video_replay'] as const).map(c=>{const group=attacks.filter(r=>r.presentation===c);return group.filter(r=>Math.min(r.padV1!,r.padV2!)>=threshold).length/group.length;}))}))
    .filter(item=>item.worst<=plan.targets.maxAttackAcceptanceRate).sort((a,b)=>a.bpcer-b.bpcer||a.worst-b.worst||a.threshold-b.threshold)[0];
  const thresholds=face&&pad?{faceMinimum:face.threshold,padMinimumEachModel:pad.threshold}:null;
  const development=thresholds?assess(rows,thresholds,plan):null;
  return {schema:'attendai-reliability-candidate-v1',createdAt:new Date().toISOString(),plan,thresholds,
    development,developmentCoverage:adequacy(rows,plan),
    status:!thresholds?'no_candidate':development!.empiricalBudgetsMet?'development_budgets_met':'development_budgets_not_met',
    readyForAttendance:false,automaticAttendanceApproval:'not_granted',
    thresholdUse:'Frozen research candidate; never automatically installed into attendance policies.'};
}
export type Candidate=ReturnType<typeof calibrate>;
export function evaluate(input:unknown,candidate:Candidate){
  if(!candidate||candidate.schema!=='attendai-reliability-candidate-v1')fail('Use a frozen development candidate.');
  const plan=validatePlan(candidate.plan),rows=validateRows(input,'evaluation');
  if(!candidate.thresholds)fail('No development candidate exists. Improve the model/capture protocol and start a new study.');
  const coverage=adequacy(rows,plan),dev=candidate.developmentCoverage;
  if(coverage.subjects.some(id=>dev.subjects.includes(id)))fail('Development and evaluation participants/reference identities must be disjoint.');
  if(coverage.sessions.some(id=>dev.sessions.includes(id)))fail('Capture sessions must not cross development and evaluation.');
  if(coverage.observationIds.some(id=>dev.observationIds.includes(id)))fail('Development and evaluation reuse an observation.');
  const assessment=assess(rows,candidate.thresholds,plan);
  return {schema:'attendai-reliability-report-v1',createdAt:new Date().toISOString(),evidenceKind:plan.evidenceKind,
    thresholds:candidate.thresholds,plan,development:candidate.development,evaluation:assessment,
    status:plan.evidenceKind==='synthetic'?'synthetic_demonstration':!candidate.development?.empiricalBudgetsMet||!assessment.empiricalBudgetsMet?'budgets_not_met':'empirical_budgets_met_review_required',
    readyForAttendance:false,automaticAttendanceApproval:'not_granted',
    limitations:['Labels and physical presentations are operator-reported, not independently verified.',
      'Camera injection, unseen attacks, model pretraining overlap, device/population generalization and correlated trials remain limitations.',
      'Do not retune on evaluation results. A changed model, cutoff or capture protocol requires a new untouched evaluation.',
      'Impostor testing requires separately consented/authorized references outside the own-account browser workflow. Missing impostor data keeps validation incomplete.',
      'The score export never changes an attendance policy or grants biometric approval.']};
}
