// Builds db/pglite-base.tar.gz: an empty, freshly initialised portable database. The app unpacks it on first start, so the
// database never has to be initialised on the user's PC (that step has failed silently on some Windows/Node versions).
// Run again after upgrading @electric-sql/pglite:  node scripts/make-pglite-base.mjs
import { writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
const db = await PGlite.create({ extensions: { pg_trgm } });
await db.query("select 1");
const file = await db.dumpDataDir("gzip");
writeFileSync("db/pglite-base.tar.gz", Buffer.from(await file.arrayBuffer()));
await db.close();
console.log("db/pglite-base.tar.gz written");
