export type CameraNotice = { version: string; purpose: string; title: string; body: string };
export type Choice = { choice: "granted" | "manual" | "withdrawn" | "not_recorded"; revision: number; notice_version: string | null; decided_at: string | null; expires_at: string | null; allowed: boolean };
export type ChoiceEvent = { revision: number; notice_version: string; previous_choice: string | null; new_choice: string; occurred_at: string; expires_at: string | null };
export type PersonalPrivacy = { notice: CameraNotice; student: { id: string; student_code: string; display_name: string; is_active: boolean } | null; preference: Choice | null; history: ChoiceEvent[]; beforeRevision: number | null };
export type StaffPrivacy = { notice: CameraNotice; students: Array<{ id: string; student_code: string; display_name: string; choice: string; allowed: boolean; expires_at: string | null }>; nextCursor: string | null };
