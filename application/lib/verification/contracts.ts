import type {CameraNotice,Choice} from "../privacy/contracts";
export type Trial={trial_id:string;similarity:number;model_version:string;created_at:string;expires_at:string;session_id?:string|null};
export type VerificationState={
  notice:CameraNotice;configured:boolean;
  student:{id:string;student_code:string;display_name:string;is_active:boolean}|null;
  preference:Choice|null;
  template:{template_id:string;model_version:string;created_at:string;expires_at:string}|null;
  ready:boolean;
  sessions:Array<{id:string;session_code:string;title:string;course_code:string}>;
  trials:Trial[];
  history:Array<{event_id:string;event_type:string;notice_version:string;choice_revision:number;occurred_at:string;session_id?:string|null;session_notice_version?:string|null}>;
};
