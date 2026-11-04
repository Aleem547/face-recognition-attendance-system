// Quote cells and neutralize spreadsheet formulas even after leading whitespace.
export function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function registerCsv(rows: Record<string, unknown>[]) {
  const keys = ["session_code", "course_code", "student_code", "display_name", "status", "method", "revision", "updated_at", "change_reason"];
  return keys.map(csvCell).join(",") + "\r\n" + rows.map(row => keys.map(key => csvCell(row[key])).join(",")).join("\r\n") + "\r\n";
}
