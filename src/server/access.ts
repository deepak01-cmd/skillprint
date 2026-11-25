/* "Who saw whom": every time someone opens another person's personal data, one row goes into the append-only access log.
   Repeats by the same person, for the same subject and resource, within 10 minutes are not logged again. */
import { Db, q } from "./db";
import { User } from "./permissions";

export async function logAccess(db: Db, u: User, subjectId: string | null, resource: string, detail?: string | null, ip?: string) {
  if (!u.org_id || (subjectId && u.employee_id === subjectId)) return;
  await q(db, `INSERT INTO access_log (org_id, actor_id, actor_name, actor_role, subject_id, resource, detail, ip)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM access_log WHERE actor_id = $2 AND subject_id IS NOT DISTINCT FROM $5 AND resource = $6
      AND detail IS NOT DISTINCT FROM $7 AND at > now() - interval '10 minutes')`,
    [u.org_id, u.id, u.name, u.role, subjectId, resource, detail?.slice(0, 300) ?? null, ip?.slice(0, 64) ?? null]).catch(e => console.error("access log", e.message));
}
