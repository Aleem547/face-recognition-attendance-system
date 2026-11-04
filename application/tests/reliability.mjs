import assert from 'node:assert/strict';
import {MODEL_VERSION,CONDITIONS,validateObservation,validateRows,validatePlan,calibrate,evaluate,summarize} from '../lib/evaluation/reliability.ts';
let count=0;const check=(name,fn)=>{fn();console.log(`PASS ${++count}: ${name}`);};
export function fixtureRows(split='development'){
  const p=split==='development'?'D':'E';
  return CONDITIONS.map((presentation,index)=>({schema:'attendai-observation-v1',id:p+'_'+index,split,subjectId:p+'1',referenceSubjectId:presentation==='impostor'?p+'2':p+'1',sessionId:p+'_probe',referenceSessionId:p+'_enrollment',cameraId:'camera_1',lighting:'normal',presentation,attackInstrumentId:['genuine','impostor'].includes(presentation)?null:p+'_instrument_'+index,capturedAt:'2026-11-02T00:00:00.000Z',modelVersion:MODEL_VERSION,outcome:'processed',similarity:presentation==='impostor'?0.1:0.8,padV1:['genuine','impostor'].includes(presentation)?0.9:0.2,padV2:['genuine','impostor'].includes(presentation)?0.85:0.15}));
}
export const plan={schema:'attendai-reliability-plan-v1',evidenceKind:'synthetic',acknowledged:true,modelVersion:MODEL_VERSION,targets:{maxFalseMatchRate:0,maxAttackAcceptanceRate:0,maxGenuineRejectionRate:0,maxFailureRate:0},minimums:{participantsPerSplit:1,presentationsPerCondition:1}};
const dev=fixtureRows(),holdout=fixtureRows('evaluation');
check('valid same-frame labelled scores preserve original values',()=>assert.equal(validateObservation(dev[0]).padV1,0.9));
check('draft/unacknowledged budgets cannot run',()=>{assert.throws(()=>validatePlan({...plan,acknowledged:false}));assert.throws(()=>validatePlan({...plan,targets:{...plan.targets,maxFalseMatchRate:null}}));});
check('nonfinite, missing, out-of-range and unexpected scores are rejected',()=>{for(const value of [NaN,Infinity,2,null])assert.throws(()=>validateObservation({...dev[0],padV1:value}));assert.throws(()=>validateObservation({...dev[0],accepted:true}));});
check('incorrect identity labels and same enrollment/probe session are rejected',()=>{assert.throws(()=>validateObservation({...dev[0],referenceSubjectId:'someone_else'}));assert.throws(()=>validateObservation({...dev[0],sessionId:dev[0].referenceSessionId}));});
check('duplicate observations and split mixing are rejected',()=>{assert.throws(()=>validateRows([...dev,dev[0]],'development'));assert.throws(()=>validateRows(holdout,'development'));});
check('both PAD scores must pass and exact threshold equality is accepted',()=>{
  const good=summarize([{...dev[0],similarity:0.5,padV1:0.6,padV2:0.6}],{faceMinimum:0.5,padMinimumEachModel:0.6});assert.equal(good.genuine.jointAccepted,1);
  const bad=summarize([{...dev[0],padV1:1,padV2:0.59}],{faceMinimum:0.5,padMinimumEachModel:0.6});assert.equal(bad.genuine.jointAccepted,0);
});
const candidate=calibrate(dev,plan);
check('development-only calibration produces a research candidate',()=>{assert.equal(candidate.status,'development_budgets_met');assert.equal(candidate.readyForAttendance,false);assert.deepEqual(candidate.developmentCoverage.subjects,['D1','D2']);});
check('evaluation never changes a frozen candidate',()=>{const before=JSON.stringify(candidate);evaluate(holdout,candidate);assert.equal(JSON.stringify(candidate),before);});
check('synthetic success cannot approve attendance',()=>{const result=evaluate(holdout,candidate);assert.equal(result.status,'synthetic_demonstration');assert.equal(result.automaticAttendanceApproval,'not_granted');});
check('reference-identity, capture-session and observation leakage are rejected',()=>{
  assert.throws(()=>evaluate(holdout.map(r=>({...r,subjectId:'D1',referenceSubjectId:r.presentation==='impostor'?'E2':'D1'})),candidate),/disjoint/);
  assert.throws(()=>evaluate(holdout.map(r=>({...r,sessionId:'D_probe'})),candidate),/sessions/);
  assert.throws(()=>evaluate(holdout.map((r,i)=>({...r,id:i===0?'D_0':r.id})),candidate),/reuse/);
});
check('unscored failures remain in end-to-end denominators and cannot count as successful attacks',()=>{
  const rows=holdout.map(r=>r.presentation==='genuine'?{...r,outcome:'timeout',similarity:null,padV1:null,padV2:null}:r);
  const result=evaluate(rows,candidate);assert.equal(result.evaluation.metrics.genuine.failureRate,1);assert.equal(result.evaluation.metrics.genuine.endToEndRejectionOrFailureRate,1);assert.equal(result.evaluation.empiricalBudgetsMet,false);
});
check('failures cannot hide under fabricated zero scores',()=>assert.throws(()=>validateObservation({...dev[0],outcome:'quality_failed',similarity:0,padV1:0,padV2:0})));
check('missing impostor or attack conditions prevent calibration',()=>{for(const condition of CONDITIONS)assert.throws(()=>calibrate(dev.filter(r=>r.presentation!==condition),plan));});
check('a high-scoring replay fails its own PAD budget despite low print scores',()=>{const rows=holdout.map(r=>r.presentation==='video_replay'?{...r,padV1:1,padV2:1}:r);const result=evaluate(rows,{...candidate,plan:{...plan,evidenceKind:'consented_research'}});assert.equal(result.status,'budgets_not_met');assert.equal(result.evaluation.metrics.video_replay.padApcer,1);});
check('poor genuine separation cannot be reported as a successful calibrated policy',()=>{const result=calibrate(dev.map(r=>r.presentation==='phone_photo'?{...r,padV1:1,padV2:1}:r),plan);assert.equal(result.status,'no_candidate');});
check('small samples remain explicitly below declared project minimums',()=>{const result=calibrate(dev,{...plan,minimums:{participantsPerSplit:5,presentationsPerCondition:20}});assert.equal(result.development.coverage.enough,false);assert.equal(result.status,'development_budgets_not_met');});
check('real but empirical success still requires review and never grants biometric approval',()=>{const result=evaluate(holdout,{...candidate,plan:{...plan,evidenceKind:'consented_research'}});assert.equal(result.status,'empirical_budgets_met_review_required');assert.equal(result.readyForAttendance,false);});
