import { Db, q } from "./db";
import { User } from "./permissions";

export async function audit(db: Db, u: User | { id: string | null; name: string; org_id: string | null }, e: {
  entity_type: string; entity_id: string; action: string; before?: unknown; after?: unknown; reason?: string | null; org_id?: string | null;
}) {
  await q(db, `INSERT INTO audit_log (org_id, entity_type, entity_id, action, actor_id, actor_name, before, after, reason)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.org_id ?? u.org_id, e.entity_type, e.entity_id, e.action, u.id, u.name,
     e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after), e.reason ?? null]);
}
