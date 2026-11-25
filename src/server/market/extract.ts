/* Job-posting text processing: title normalisation, skill extraction against the library, candidate-skill discovery.
   Rule-based and transparent (works without AI). Matches are evidence of mention, not of required proficiency. */
import { normalizeTitle } from "../modules/roleFallback";
import { canonicalSpelling, spellingsOf, tokenizeVariants } from "../terms";

const QUALIFIERS = [
  /\bpart[- ]?time\b/g, /\bfull[- ]?time\b/g, /\btemporary\b/g, /\btemp\b/g, /\bseasonal\b/g, /\bper diem\b/g, /\bprn\b/g, /\bcontract(or)?\b/g,
  /\bbilingual( [a-z]+)?\b/g, /\b(fully )?remote\b/g, /\bhybrid\b/g, /\bon[- ]?site\b/g, /\bnights?\b/g, /\bweekends?\b/g, /\bovernight\b/g, /\bfloat\b/g,
  /\b(f|m|w|d)\/(m|w|d|f)(\/[a-z])?\b/g, /\bh\/f\b/g, /\bwm\b/g,
];
// Words that say nothing about the job itself
const NOISE = new Set(["fresher", "freshers", "experienced", "coop", "co", "op", "new", "grad", "graduates", "urgent", "hiring", "immediate", "joiner", "joiners", "opening", "openings", "vacancy", "job", "role", "position", "req", "requisition", "ref", "the", "a", "an", "for", "at", "in", "with", "of", "and", "&", "to", "ft", "pt", "hourly", "day", "shift", "days", "evening", "evenings", "early", "late"]);
// "engineers" -> "engineer", "nurses" -> "nurse"; leaves "sales", "operations", "analytics", "systems" alone
const singular = (t: string) => t.length > 4 && t.endsWith("s") && !t.endsWith("ss") && /(er|or|ist|ant|ent|ian|ive|ect|yst|ate|se|ee|ter|ger|ner|her|man)$/.test(t.slice(0, -1)) ? t.slice(0, -1) : t;

/** Normalised market title: qualifiers, seniority, abbreviations, brackets, numbers, plurals and case removed. */
export function normalizeJobTitle(raw: string): { title: string; seniority: string | null } {
  let s = ` ${tokenizeVariants(String(raw || "").toLowerCase())} `.replace(/\(.*?\)|\[.*?\]/g, " ");
  s = s.split(/\s[-–|,]\s|\s\/\s|:\s/)[0];                  // "Title - Team/Location" keeps the title part
  for (const q of QUALIFIERS) s = s.replace(q, " ");
  s = s.replace(/\bco[- ]?op\b/g, " ").replace(/\bnew[- ]grad(uate)?s?\b/g, " ").replace(/(\w)\/(?=\s|$)/g, "$1 ").replace(/\s\/|\/\s/g, " ");
  const n = normalizeTitle(s);
  // "Sales Associate", "Team Lead", "Software Engineering Intern": a seniority word at the end is the job itself
  const last = s.replace(/[^a-z ]+/g, " ").trim().split(/\s+/).pop() || "";
  const core = ["associate", "lead", "intern", "trainee", "apprentice", "principal"].includes(last) && !n.core.endsWith(last) && n.core ? `${n.core} ${last}` : n.core;
  const tokens = core.split(/\s+/).filter(Boolean).filter(t => !/\d/.test(t) && !NOISE.has(t) && !/^[^a-z]+$/.test(t)).map(singular);
  return { title: tokens.join(" ").replace(/\s+/g, " ").trim(), seniority: n.seniority ?? (/\bfreshers?\b|\bnew grad/.test(s) ? "junior" : null) };
}

/** Title words used by enough employers to be meaningful. Rare words (team codes, product names, internal labels) are dropped. */
export type TitleVocab = { words: Set<string>; min: number };
export function buildTitleVocab(rows: { norm: string; companies: string[] }[]): { vocab: TitleVocab; stats: { token: string; companies: number; titles: number }[] } {
  const by = new Map<string, { c: Set<string>; t: number }>();
  const allCompanies = new Set<string>();
  for (const r of rows) {
    r.companies.forEach(c => allCompanies.add(c));
    for (const tok of new Set(r.norm.split(" ").filter(Boolean))) { const e = by.get(tok) || { c: new Set<string>(), t: 0 }; r.companies.forEach(c => e.c.add(c)); e.t++; by.set(tok, e); }
  }
  const min = allCompanies.size >= 60 ? 3 : 2;
  const stats = [...by].map(([token, e]) => ({ token, companies: e.c.size, titles: e.t }));
  return { vocab: { words: new Set(stats.filter(x => x.companies >= min).map(x => x.token)), min }, stats };
}
/** Canonical market title: the meaningful words of the normalised title. Falls back to the last word (the job noun). */
export function canonicalTitle(norm: string, vocab: TitleVocab): string {
  const toks = norm.split(" ").filter(Boolean);
  if (!toks.length) return "";
  const kept = toks.filter(t => vocab.words.has(t));
  return (kept.length ? kept : [toks[toks.length - 1]]).join(" ");
}

/** Extra phrases used only for finding library skills in posting text (library records are not changed). */
export const EXTRACTION_SYNONYMS: Record<string, string[]> = {
  S001: ["sql", "t-sql", "pl/sql", "postgresql", "mysql"], S002: ["python"], S003: ["microsoft excel", "ms excel", "excel"], S004: ["power bi", "powerbi"], S005: ["tableau"],
  S006: ["statistical analysis", "statistics", "statistical modeling", "statistical modelling"], S007: ["data modeling", "data modelling", "dimensional modeling"], S008: ["etl", "elt", "data pipelines"],
  S009: ["generative ai", "genai", "gen ai", "large language model", "llm", "llms"], S010: ["credit risk"], S011: ["anti-money laundering", "aml", "transaction monitoring"], S012: ["regulatory reporting"],
  S013: ["java"], S014: ["javascript"], S015: ["typescript"], S016: ["react", "react.js", "reactjs"], S017: ["node.js", "nodejs"], S018: ["rest api", "restful", "rest apis"],
  S019: ["automated testing", "test automation", "selenium", "unit testing"], S020: ["git", "github", "gitlab"], S021: ["docker", "containers", "containerization"], S022: ["kubernetes", "k8s"],
  S023: ["aws", "amazon web services"], S024: ["ci/cd", "continuous integration", "continuous delivery", "jenkins"], S025: ["linux", "unix"], S026: ["observability", "monitoring tools", "prometheus", "grafana", "splunk"],
  S027: ["hl7", "fhir"], S028: ["electronic health record", "electronic health records", "electronic medical record", "electronic medical records", "ehr", "epic"], S029: ["clinical data standards", "cdisc", "sdtm", "snomed", "loinc"],
  S030: ["hipaa", "patient privacy", "phi"], S031: ["clinical data quality"], S032: ["interoperability"], S033: ["revenue cycle"], S034: ["clinical workflow"],
  S035: ["machine learning", "deep learning"], S036: ["spark", "pyspark", "databricks"], S037: ["snowflake", "bigquery", "redshift", "data warehouse", "data warehousing"],
  S038: ["product analytics"], S039: ["requirements gathering", "requirements analysis", "business requirements"], S040: ["agile", "scrum", "kanban"], S041: ["project management", "project planning"],
  S042: ["api integration", "api integrations"], S043: ["data governance"], S044: ["information security", "cybersecurity", "cyber security"], S045: ["sas"], S046: ["vba"], S047: ["qlikview"],
  S048: ["crystal reports"], S049: ["jquery"], S050: ["soap"], S051: ["puppet"], S052: ["informatica"], S053: ["python 2"], S054: ["angularjs"], S055: ["mapreduce", "hadoop"],
  S056: ["icd-9"], S057: ["libor"], S058: ["dbt"], S059: ["retrieval-augmented", "retrieval augmented", "rag"], S060: ["iceberg", "delta lake", "lakehouse"], S061: ["opentelemetry"],
  S062: ["finops", "cloud cost"], S063: ["iso 20022"], S064: ["model risk"], S065: ["clinical documentation"],
};
/** Library aliases that are ambiguous in job postings (e.g. "EMR" is also Amazon Elastic MapReduce): ignored when extracting. */
export const EXTRACTION_EXCLUDE: Record<string, string[]> = { S028: ["emr"], S031: ["data quality"], S040: ["agile delivery"] };
// Short terms that are also common words: match only in their exact case (e.g. "SAS", not "sas" inside other words)
const CASE_SENSITIVE = new Set(["sas", "rag", "aml", "phi", "soap", "epic", "react", "spark", "excel", "git", "etl", "elt", "dbt", "java", "agile", "puppet", "integrations"]);
const CASED: Record<string, string[]> = { sas: ["SAS"], rag: ["RAG"], aml: ["AML"], phi: ["PHI"], soap: ["SOAP"], epic: ["Epic"], react: ["React"], spark: ["Spark", "Apache Spark"],
  excel: ["Excel"], git: ["Git"], etl: ["ETL"], elt: ["ELT"], dbt: ["dbt"], java: ["Java"], agile: ["Agile", "agile"], puppet: ["Puppet"], integrations: [] };

/** Tools, standards and certifications that are not in the library yet: candidates for review, never added automatically. */
export const CANDIDATE_TERMS: string[] = [
  "SAP", "Salesforce", "Oracle", "ServiceNow", "Workday", "Microsoft Azure", "Google Cloud", "GCP", "Terraform", "Ansible", "Jira", "Confluence", "MATLAB", "Simulink", "AutoCAD",
  "SolidWorks", "CATIA", "Creo", "Siemens NX", "ANSYS", "LabVIEW", "PLC", "SCADA", "Verilog", "SystemVerilog", "VHDL", "FPGA", "ASIC", "RTL", "UVM", "Cadence Virtuoso", "SPICE",
  "C++", "C#", ".NET", "Go", "Rust", "Scala", "Kotlin", "Swift", "Angular", "Vue", "Django", "Spring Boot", "Kafka", "MongoDB", "Elasticsearch", "PyTorch", "TensorFlow", "Computer Vision",
  "NLP", "Embedded C", "AUTOSAR", "Microsoft Office", "PowerPoint", "Outlook", "CRM", "ERP", "Six Sigma", "Lean", "Kaizen", "5S", "GD&T", "FMEA", "ISO 9001", "ISO 13485", "IATF 16949",
  "GMP", "FDA", "PMP", "ITIL", "CISSP", "CompTIA", "Security Clearance", "CPR", "BLS", "ACLS", "PALS", "Registered Nurse", "OSHA", "Forklift", "Customer Service", "Negotiation", "Cold Calling",
];

export interface SkillTerm { skill_id: string; name: string; aliases: string[] }
type Matcher = { id: string; re: RegExp };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bounded = (t: string, flags: string) => new RegExp(`(?<![A-Za-z0-9])${esc(t)}(?![A-Za-z0-9])`, flags);

// Acronyms written in capitals in the library (SAP, PLC, BLS, RN, C#) only match in capitals in posting text
const ACRONYM = /^[A-Z]{2,6}$/;
/** A pattern that accepts the usual ways of writing a name: with or without spaces, hyphens and dots between its parts
    (TensorFlow = Tensor Flow = tensor-flow, Spring Boot = SpringBoot), singular or plural, UK or US spelling
    (visualisation = visualization, modelling = modeling). Names with symbols (C#, .NET, CI/CD) stay exact. */
export function flexPattern(term: string): string {
  if (/^[.]|[#+/&]/.test(term) || term.replace(/\W/g, "").length < 4) return esc(term.toLowerCase());
  const parts = term.split(/[\s\-_.]+/).flatMap(p => p.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/)).filter(Boolean).map(p => p.toLowerCase());
  // a short part ("In" in InDesign, "DB" in MongoDB) would let ordinary phrases match ("in design"): keep such names whole
  if (!parts.length || parts.some(p => p.length < 3)) return esc(term.toLowerCase()) + (/[a-z]{3}$/i.test(term) && !/s$/i.test(term) ? "(?:e?s)?" : "");
  const word = (p: string) => esc(p).replace(/is(?=e|ation|ing|ed|er)/g, "i[sz]").replace(/yse/g, "y[sz]e").replace(/ll(?=ing|ed|er)/g, "ll?").replace(/our$/g, "o(?:u)?r");
  const body = parts.map(word).join("[\\s._-]*");
  const last = parts[parts.length - 1];
  return last.length >= 3 && !/s$/.test(last) && /[a-z]$/.test(last) ? `${body}(?:e?s)?` : body;
}
export function buildSkillMatchers(skills: SkillTerm[]): Matcher[] {
  const out: Matcher[] = [];
  for (const s of skills) {
    const excl = EXTRACTION_EXCLUDE[s.skill_id] || [];
    const raw = [s.name.replace(/\s*\(.*?\)\s*/g, " ").trim(), ...s.aliases, ...(EXTRACTION_SYNONYMS[s.skill_id] || [])].flatMap(t => spellingsOf(t)).filter(t => t.trim().length >= 2);
    const insensitive = new Set<string>(), sensitive = new Set<string>();
    for (const t of raw) {
      const lo = t.toLowerCase().trim();
      if (excl.includes(lo)) continue;
      if (CASE_SENSITIVE.has(lo)) (CASED[lo] || []).forEach(x => sensitive.add(x));
      else if (ACRONYM.test(t.trim()) || (lo.length <= 2 && !/[#+.]/.test(lo))) sensitive.add(t.trim());
      else insensitive.add(flexPattern(t.trim()));
    }
    if (insensitive.size) out.push({ id: s.skill_id, re: new RegExp([...insensitive].map(src => `(?<![A-Za-z0-9])(?:${src})(?![A-Za-z0-9])`).join("|"), "i") });
    if (sensitive.size) out.push({ id: s.skill_id, re: new RegExp([...sensitive].map(t => bounded(t, "").source).join("|")) });
  }
  return out;
}
export function extractSkills(text: string, matchers: Matcher[]): string[] {
  const found = new Set<string>();
  for (const m of matchers) if (!found.has(m.id) && m.re.test(text)) found.add(m.id);
  return [...found].sort();
}
const candidateMatchers = CANDIDATE_TERMS.map(t => ({ term: t, re: t.length <= 4 || /[A-Z]{2}/.test(t) ? bounded(t, "") : bounded(t, "i") }));
export function extractCandidates(text: string): string[] {
  return candidateMatchers.filter(c => c.re.test(text)).map(c => c.term);
}

/* Skill discovery from free text: items listed after phrases such as "experience with", "knowledge of", "tools such as".
   Only terms that many employers use become candidates, and a person decides whether each is a skill. */
const TRIGGER = /(?:experience (?:with|in|using|of)|hands[- ]on (?:experience )?(?:with|in)|knowledge (?:of|in)|proficien(?:t|cy) (?:in|with)|familiar(?:ity)? with|expertise (?:in|with)|skilled in|exposure to|working knowledge of|competen(?:t|ce|cy) (?:in|with)|understanding of|tools? (?:such as|like|including)|technologies (?:such as|like|including)|platforms? (?:such as|like|including)|certifications? (?:such as|like|including|in)|software (?:such as|like|including)|(?:technical )?skills?\s*:|tools?\s*:|tech(?:nology)? stack\s*:)\s*/gi;
const GENERIC = new Set(["tool", "tools", "system", "systems", "software", "technology", "technologies", "experience", "skill", "skills", "environment", "environments", "application", "applications", "platform", "platforms", "process", "processes", "methodology", "methodologies", "framework", "frameworks", "language", "languages", "year", "years", "degree", "similar", "related", "other", "others", "relevant", "equivalent", "good", "strong", "excellent", "plus", "etc", "various", "multiple", "different", "modern", "standard", "standards", "best", "practice", "practices", "concept", "concepts", "principle", "principles", "the", "a", "an", "and", "or", "of", "in", "with", "to", "for", "on", "using", "use", "ability", "knowledge", "understanding", "basic", "advanced", "working", "proven", "solid", "deep", "good", "including", "such", "as", "like", "e.g", "eg", "i.e", "ie", "is", "are", "be", "work", "team", "teams", "business", "customer", "customers", "client", "clients", "data", "it", "field", "area", "areas", "least", "minimum", "preferred", "required", "desired", "nice", "have", "must", "should", "will", "can", "our", "your", "their", "this", "that", "these", "those", "you", "we", "they", "e.g.", "e.g", "i.e.", "u.s", "u.s.", "us", "uk", "eu", "usa", "english", "spanish", "french", "german", "mandarin", "chinese", "japanese", "hindi", "portuguese", "italian", "word", "finance", "engineering", "marketing", "hr", "cloud", "power", "sales", "operations", "ai", "ml", "it", "office", "windows", "computer", "computers", "internet", "email", "microsoft", "google", "apple", "amazon", "meta", "management", "leadership", "communication", "development", "design", "testing", "security", "support", "analysis", "research", "quality", "safety", "health", "service", "services", "product", "products", "project", "projects", "program", "programs", "industry", "company", "organization", "organisation", "bachelor", "master", "compliance", "manufacturing", "planning", "saas", "bi", "budget", "budgeting", "reporting", "documentation", "automation", "integration", "networking", "infrastructure", "architecture", "governance", "strategy", "innovation", "excel", "powerpoint", "phd", "mba", "certification", "certifications", "certified", "license", "licence"]);
export function discoverTerms(text: string): string[] {
  const out = new Set<string>();
  TRIGGER.lastIndex = 0; let m: RegExpExecArray | null;
  while ((m = TRIGGER.exec(text))) {
    const span = text.slice(m.index + m[0].length, m.index + m[0].length + 180).split(/[.;:!?](?=\s|$)|\n|•|·|\s-\s|\s–\s/)[0];
    for (let item of span.split(/,|\band\b|\bor\b|\s&\s|\s\/\s|\(|\)/)) {
      item = item.replace(/^\s*(?:the|a|an|any|one|some|such as|including|e\.g\.?|eg|like|tools like|other|particularly|especially|ideally|preferably|mainly|primarily|strong|proven|solid|modern|advanced|basic|good|excellent|using|use of|related)\s+/i, "").replace(/\s+(?:etc\.?|tools?|software|platforms?|systems?|technologies|frameworks?|experience|skills?|knowledge|environment|environments|pipelines?|practices|methodolog(?:y|ies)|principles|fundamentals|concepts|development|operating(?: systems?)?|applications?|suite|ecosystem|stack|services|is a plus|a plus|preferred|required|highly desirable|desirable|or similar|or equivalent)\s*$/i, "").trim();
      if (item.length < 2 || item.length > 40 || /^\d/.test(item)) continue;
      const words = item.split(/\s+/);
      if (words.length > 4) continue;
      if (words.every(w => GENERIC.has(w.toLowerCase().replace(/[^a-z.]/g, "")))) continue;
      if (GENERIC.has(words[0].toLowerCase()) && words.length === 1) continue;
      // keep names of tools, standards and methods: capitalised words, acronyms, or symbols such as C#, S/4HANA, .NET
      if (!/[A-Z]|[#+./]\w|\w[#+]/.test(item)) continue;
      if (GENERIC.has(item.toLowerCase())) continue;
      if (/^[A-Z][a-z]+(?:\s[a-z]+)+$/.test(item)) continue;   // ordinary sentence fragments: "Strong communication skills"
      out.add(canonicalSpelling(item.replace(/\s+/g, " ")));
    }
  }
  return [...out];
}

/** Every phrase that already finds a library skill (name, aliases, extraction synonyms, spelling variants), lower-case, singular. */
export function coveredTerms(skills: SkillTerm[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of skills) for (const t of [s.name, s.name.replace(/\s*\(.*?\)\s*/g, " ").trim(), ...s.aliases, ...(EXTRACTION_SYNONYMS[s.skill_id] || [])].flatMap(x => spellingsOf(x)))
    { const k = termKey(t); if (k.length >= 2 && !m.has(k)) m.set(k, s.skill_id); }
  return m;
}
/** Grouping key for a term: lower case, canonical spelling, last word singular ("REST APIs" and "REST API" are one term). */
export const termKey = (t: string) => canonicalSpelling(t).toLowerCase().replace(/\s+/g, " ").trim().replace(/([a-z]{3,})s$/, "$1");
