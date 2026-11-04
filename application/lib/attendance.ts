export type Student = {
  id: string;
  label: string;
  consentToBiometrics: boolean;
};
export type AttendanceRecord = {
  studentId: string;
  sessionId: string;
  recordedAt: string;
  method: "manual";
};

export function markOnce(records: AttendanceRecord[], record: AttendanceRecord): AttendanceRecord[] {
  if (records.some(r => r.studentId === record.studentId && r.sessionId === record.sessionId)) {
    return records;
  }
  return [...records, record];
}

export function attendanceForSession(records: AttendanceRecord[], sessionId: string): AttendanceRecord[] {
  return records.filter(record => record.sessionId === sessionId);
}

export function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function makeCsv(students: Student[], records: AttendanceRecord[], sessionId: string): string {
  const studentLookup = new Map(students.map(student => [student.id, student.label]));
  const header = ["Student ID", "Student", "Session", "Time (UTC)", "Method"].join(",");
  const lines = attendanceForSession(records, sessionId).map(record => [
    record.studentId,
    studentLookup.get(record.studentId) ?? "Unknown",
    record.sessionId,
    record.recordedAt,
    record.method,
  ].map(escapeCsv).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
