# A short, truthful Face Recognition Attendance System demonstration

Use existing synthetic administrator/student accounts in separate browser profiles. Keep older registers intact. If a new class is needed, create one with a fresh unique session code through the normal administrator interface; no demo data is inserted automatically by this package.

1. Sign in as administrator and show the saved workspace totals, students, course and enrollment.
2. Open a prepared synthetic class and explain that opening freezes its roster.
3. Save staff attendance for each student and wait for confirmation. Show that unmarked differs from absent.
4. Correct a status with a reason, then inspect the old/new status, server time and revision receipt.
5. Complete the register, close it and export its CSV. Explain that Present plus Late count as attending and Excused is excluded from the denominator.
6. Sign in as a linked student. Show that the student sees their own record and cannot mark attendance or inspect peers' registers.
7. Open Workspace guide. Explain the separate camera, enrollment and comparison choices. If demonstrating existing scores, describe them as research outputs and keep all documented failures visible.

Do not stage a fake automatic check-in, hide a timed-out genuine-face attempt, or present a texture score as the probability that a person is live. The current implementation does not automatically mark students present after a face scan.

A suitable project description is: “A role-based attendance platform with a persistent manual register, correction audit trail, privacy controls and an experimental consent-based biometric comparison pipeline.” Mention the unresolved anti-spoofing limitation when describing the original automatic-attendance objective.

This release does not promise university admission or claim peer-reviewed validation of the continuation project.
