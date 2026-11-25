import { register } from "./http/router";
import { pool } from "./db";
import * as mapping from "./modules/mapping";
import * as governance from "./modules/governance";
import * as structure from "./modules/structure";
import * as skills from "./modules/skills";
import * as people from "./modules/people";
import * as mobility from "./modules/mobility";
import * as insights from "./modules/insights";
import * as roleFallback from "./modules/roleFallback";
import * as market from "./modules/market";
import * as imports from "./modules/imports";
import * as scale from "./modules/scale";
import * as library from "./modules/library";
import * as company from "./modules/company";
import * as ai from "./modules/ai";
import * as account from "./modules/account";
import * as learning from "./modules/learning";
import * as ijp from "./modules/ijp";
import * as frameworkImport from "./modules/frameworkImport";
import * as requests from "./modules/requests";
import * as mentoring from "./modules/mentoring";
import * as succession from "./modules/succession";
import * as reports from "./modules/reports";
import * as reference from "./modules/reference";
import * as outlook from "./modules/outlook";

let done = false;
export function ensureRoutes() {
  if (done) return;
  register([...account.routes, ...learning.routes, ...ijp.routes, ...frameworkImport.routes, ...requests.routes, ...mentoring.routes, ...succession.routes, ...reports.routes, ...outlook.routes, ...reference.routes, ...imports.routes, ...scale.routes, ...library.routes, ...company.routes, ...ai.routes, ...roleFallback.routes, ...mapping.routes, ...governance.routes, ...structure.routes, ...skills.routes, ...people.routes, ...mobility.routes, ...insights.routes, ...market.routes]);
  done = true;
}
export { pool };
