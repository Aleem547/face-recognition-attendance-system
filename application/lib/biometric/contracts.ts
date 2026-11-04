import type {CameraNotice,Choice} from "../privacy/contracts";
export type BiometricState={
  notice:CameraNotice;configured:boolean;
  student:{id:string;student_code:string;display_name:string;is_active:boolean}|null;
  preference:Choice|null;
  template:{template_id:string;model_version:string;created_at:string;expires_at:string}|null;
  history:Array<{event_id:string;event_type:string;notice_version:string;choice_revision:number;occurred_at:string}>;
};
