import type { PoolClient } from 'pg';

export type CourseAnalytics = {
  course_id: string; course_code: string; title: string; sessions: number;
  roster_entries: number; present: number; late: number; absent: number;
  excused: number; unmarked: number; manual: number; experimental_face: number;
  automatic_absence: number; denominator: number; attendance_rate: number | null;
};

// Execute inside actorTransaction: the existing database RLS remains authoritative.
export async function courseAnalytics(db: PoolClient, cursor: string | null) {
  const rows = (await db.query(`SELECT c.id AS course_id, c.course_code, c.title,
    count(DISTINCT s.id)::int AS sessions, count(*)::int AS roster_entries,
    count(*) FILTER (WHERE a.status='present')::int AS present,
    count(*) FILTER (WHERE a.status='late')::int AS late,
    count(*) FILTER (WHERE a.status='absent')::int AS absent,
    count(*) FILTER (WHERE a.status='excused')::int AS excused,
    count(*) FILTER (WHERE a.id IS NULL)::int AS unmarked,
    count(*) FILTER (WHERE a.method='manual')::int AS manual,
    count(*) FILTER (WHERE a.method='experimental_face')::int AS experimental_face,
    count(*) FILTER (WHERE a.method='automatic_absence')::int AS automatic_absence
    FROM attendai.session_roster r
    JOIN attendai.sessions s ON s.id=r.session_id
    JOIN attendai.courses c ON c.id=s.course_id
    LEFT JOIN attendai.attendance_records a ON a.session_id=r.session_id AND a.student_id=r.student_id
    WHERE s.state='closed' AND ($1::uuid IS NULL OR c.id>$1)
    GROUP BY c.id,c.course_code,c.title ORDER BY c.id LIMIT 26`, [cursor])).rows;
  const items: CourseAnalytics[] = rows.slice(0,25).map(row => {
    const denominator = row.roster_entries-row.excused;
    return {...row,denominator,attendance_rate:row.unmarked===0&&denominator>0
      ? Math.round(10000*(row.present+row.late)/denominator)/100 : null};
  });
  return {items,nextCursor:rows.length>25?items[items.length-1].course_id:null,
    scope:'closed_sessions_visible_to_current_account',
    rule:'(Present + Late) / (frozen roster entries - Excused); incomplete and zero denominators have no rate'};
}
