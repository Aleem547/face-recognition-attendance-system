export const CHECKIN_NOTICE = 'automatic-checkin-v2';
export const POLICY_NOTICE = 'experimental-policy-v1';
export const CHECKIN_TEXT = `This optional experimental feature can save Present or Late in your own class register after a face check. It uses your existing encrypted enrollment template, one fresh JPEG and both texture PAD models. Your enrollment and comparison choices alone do not authorize attendance marking.

The face and PAD cutoffs are selected by staff for the class. They are not independently validated. A matching score does not prove identity or liveness; photos, replay or camera injection may pass, and a genuine face may fail. Use this prototype only with voluntary, controlled test data. Staff can review and correct every saved mark with a reason. Manual attendance remains available on equal terms. A rejected capture does not immediately create Absent. When staff enable automatic class timing, any roster entry still unmarked after class end and the 30-second processing allowance becomes Absent. This includes a failed or missing check-in unless staff record attendance manually. Ask staff to review any capture failure; choosing manual attendance must remain available on equal terms.

Granting this choice does not start the camera. Preview only opens a preview. Check in with camera opens the camera and sends one JPEG automatically when it is ready, then stops the preview. There is no continuous scanning or automatic retry. The server derives the feature and PAD scores in temporary memory; this feature does not store the image, feature or scores. The minimal outcome receipt, server arrival time, session policy, consent revision and any resulting attendance mark remain in the development database, including after withdrawal. Your existing encrypted reference template follows its separate enrollment deletion and expiry rules.

This choice expires after 30 days. Withdrawal invalidates unfinished check-ins; it does not erase a saved attendance mark. Delete your template on Face enrollment to remove the active reference. If a request times out, refresh My attendance before trying again: a response can be lost after the server commits. Browser cancellation cannot undo a completed mark. Camera preview stops on leaving or hiding the page and within 60 seconds.`;
export type Policy = {session_id:string;enabled:boolean;revision:number;similarity_min:number;pad_min:number;late_after_minutes:number};
export type CheckinSession = {id:string;session_code:string;course_code:string;title:string;state:string;starts_at:string;ends_at:string;
  automation_enabled:boolean|null;automation_revision:number|null;automation_review_reason:string|null;finalized_at:string|null;automation_roster:number;
  revision:number|null;enabled:boolean|null;similarity_min:number|null;pad_min:number|null;late_after_minutes:number|null;window_open:boolean};
export type CheckinResult = {receiptId:string;decision:'accepted'|'identity_below_threshold'|'pad_below_threshold';attendanceChanged:boolean;
  arrivedAt?:string;
  experimental:true;policyRevision:number;attendance:{id:string;status:'present'|'late';revision:number;updatedAt:string;method:'experimental_face'}|null};
export type CheckinState = {role:string;configured:boolean;experimental:true;noticeVersion:string;noticeText:string;
 clock:{last_tick_at:string;healthy:boolean}|null;
 student:{id:string;student_code:string;display_name:string;is_active:boolean}|null;
 choice:{granted:boolean;notice_version:string;revision:number;expires_at:string|null}|null;
 template:{template_id:string;expires_at:string}|null;ready:boolean;sessions:CheckinSession[];
 receipts:Array<{receipt_id:string;session_code:string;decision:string;policy_revision:number;created_at:string;attendance_id:string|null}>};
