export const ACCEPTANCE_CHECKS=[
  'auth_roles','manual_register','auto_present','auto_late_boundary','auto_absence_preserves_marks',
  'correction_csv','restart_gap_review','camera_denied_manual','withdraw_delete','analytics_scope','backup_restore_drill'
] as const;
export function acceptanceTemplate(){return {schema:'attendai-local-acceptance-v1',environment:'Windows local installation',
  checks:ACCEPTANCE_CHECKS.map(id=>({id,status:'not_run',evidence:''}))};}
export function closeout(software:any,acceptance:any,biometric:any,currentSourceDigest:string){
  if(!software||software.schema!=='attendai-consolidated-validation-v1'||software.release!=='local-completion-2026-11-02')throw Error('Use the software report from this completion release.');
  if(!acceptance||acceptance.schema!=='attendai-local-acceptance-v1'||!Array.isArray(acceptance.checks)||acceptance.checks.length!==ACCEPTANCE_CHECKS.length)throw Error('Use the complete local acceptance template.');
  const seen=new Set<string>();
  for(const check of acceptance.checks){
    if(!check||Object.keys(check).sort().join(',')!=='evidence,id,status'||!ACCEPTANCE_CHECKS.includes(check.id)||seen.has(check.id)||!['pass','fail','not_run'].includes(check.status)||typeof check.evidence!=='string'||check.evidence.length>1000||check.status!=='not_run'&&!check.evidence.trim())throw Error('Each acceptance check needs a unique known ID, valid status and a brief evidence note for pass/fail.');
    seen.add(check.id);
  }
  const required=['auth.integration','register.integration','privacy.integration','biometric.integration','verification.integration','session-research','verification.receipts','biometric.client','biometric.http','camera.lifecycle','verification.client','paired-research','face-evaluation','automatic-checkin','automatic-checkin.http','class-automation','class-clock','course-analytics','reliability','local-closeout'];
  const softwarePassed=['software_checks_passed','software_and_configuration_passed'].includes(software.overall)&&software.preflight==='passed'&&software.build?.status==='passed'&&software.build?.exitCode===0&&software.sourceDigest===currentSourceDigest&&Array.isArray(software.checks)&&software.checks.length===required.length&&required.every(name=>software.checks.filter((c:any)=>c.name===name&&c.status==='passed'&&c.exitCode===0).length===1);
  const remaining=acceptance.checks.filter((check:any)=>check.status!=='pass').map((check:any)=>check.id);
  if(biometric&&(biometric.schema!=='attendai-reliability-report-v1'||biometric.readyForAttendance!==false||biometric.automaticAttendanceApproval!=='not_granted'))throw Error('Use an unmodified research reliability report.');
  const empirical=Boolean(biometric&&['consented_research','licensed_benchmark'].includes(biometric.evidenceKind)&&biometric.status==='empirical_budgets_met_review_required'&&biometric.development?.empiricalBudgetsMet===true&&biometric.evaluation?.empiricalBudgetsMet===true);
  return {schema:'attendai-local-completion-v1',createdAt:new Date().toISOString(),deployment:'excluded_by_user',
    software:softwarePassed?'passed':'failed_or_not_current',
    localAcceptance:{status:remaining.length?'pending_or_failed':'operator_reported_pass',remaining,checks:acceptance.checks},
    biometricEvidence:!biometric?'not_provided':empirical?'empirical_budgets_met_review_required':biometric.status,
    status:!softwarePassed?'software_incomplete':remaining.length?'local_acceptance_pending':empirical?'local_acceptance_complete_with_biometric_limitations':'local_software_accepted_biometric_validation_pending',
    projectComplete:false,automaticAttendanceApproval:'not_granted',
    remainingResearch:'Representative independent face/PAD validation and an approved operating policy are still required before claiming the original reliable automatic-attendance goal complete.',
    evidenceLimits:'Acceptance notes are operator-reported. Report digests detect accidental edits; they are not signatures, proof of execution or independent certification.'};
}
