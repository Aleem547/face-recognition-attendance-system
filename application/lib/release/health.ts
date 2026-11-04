// Process liveness is separate from dependency readiness and biometric validation.
// This response deliberately does not inspect environment values or user records.
export function processHealth() {
  return {
    status: "ok",
    app: "Face Recognition Attendance System",
    mode: "persistent_register",
    faceInference: "experimental_comparison",
    attendanceMode: "staff_and_scheduled_experimental_attendance",
    automaticAttendance: "experimental_per_session_opt_in",
    classClock: "per_class_opt_in_readiness_not_checked",
    biometricValidation: "unverified",
    readiness: "not_checked",
  } as const;
}
