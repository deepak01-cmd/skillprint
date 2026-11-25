/* Spelling variants people use for the same technology or term. One list, used wherever titles and skills are compared:
   role search and resolution, uploads, market title grouping, skill detection in postings and candidate discovery.
   To teach the system a new variant, add a spelling to the list. */
export interface Variant { canonical: string; token: string; spellings: string[]; re: RegExp; whole: RegExp }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function make(canonical: string, token: string, spellings: string[]): Variant {
  // spaces may be missing or doubled, and dots may have spaces around them ("node . js", "dot net", "dotnet")
  const alts = [...new Set([canonical, ...spellings])].sort((a, b) => b.length - a.length)
    .map(s => esc(s.toLowerCase()).replace(/\\\./g, "\\s?\\.\\s?").replace(/ /g, "[\\s-]*"));
  return { canonical, token, spellings, re: new RegExp(`(?<![a-z0-9])(?:${alts.join("|")})(?![a-z0-9#+])`, "gi"), whole: new RegExp(`^\\s*(?:${alts.join("|")})\\s*$`, "i") };
}
export const VARIANTS: Variant[] = [
  make("ASP.NET", "aspnet", ["asp net", "asp dot net", "aspnet", "asp.net core"]),
  make(".NET", "dotnet", ["dot net", "dotnet", ".net core", "dotnet core", "dot net core", ".net framework"]),
  make("Node.js", "nodejs", ["node js", "nodejs"]),
  make("React", "react", ["react js", "reactjs", "react.js"]),
  make("Vue.js", "vuejs", ["vue js", "vuejs", "vue"]),
  make("Next.js", "nextjs", ["next js", "nextjs"]),
  make("JavaScript", "javascript", ["java script", "javascript", "js"]),
  make("TypeScript", "typescript", ["type script", "typescript"]),
  make("C#", "csharp", ["c sharp", "csharp", "c #"]),
  make("C++", "cpp", ["cpp", "c plus plus", "c ++"]),
  make("PostgreSQL", "postgresql", ["postgres", "postgre sql", "postgresql"]),
  make("Kubernetes", "kubernetes", ["k8s"]),
  make("Golang", "golang", ["go lang", "golang"]),
  make("Power BI", "powerbi", ["powerbi", "power-bi", "ms power bi", "microsoft power bi"]),
  make("Microsoft Excel", "excel", ["ms excel", "ms-excel", "msexcel", "excel"]),
  make("Microsoft Project", "msproject", ["ms project"]),
  make("Microsoft Office", "msoffice", ["ms office", "office 365", "microsoft 365"]),
  make("Microsoft Word", "msword", ["ms word"]),
  make("DevOps", "devops", ["dev ops", "dev-ops"]),
  make("DevSecOps", "devsecops", ["dev sec ops"]),
  make("MLOps", "mlops", ["ml ops"]),
  make("CI/CD", "cicd", ["ci cd", "ci-cd", "cicd", "ci / cd"]),
  make("Full stack", "fullstack", ["full-stack", "fullstack", "full stack"]),
  make("Front end", "frontend", ["front-end", "frontend", "front end"]),
  make("Back end", "backend", ["back-end", "backend", "back end"]),
  make("Machine learning", "ml", ["machine learning", "ml"]),
  make("Artificial intelligence", "ai", ["artificial intelligence"]),
  make("UI/UX", "uiux", ["ui ux", "ux/ui", "ux ui", "ui/ux"]),
  make("SQL Server", "sqlserver", ["ms sql", "mssql", "ms sql server", "microsoft sql server"]),
  make("Google Cloud", "gcp", ["google cloud platform", "gcp"]),
  make("Amazon Web Services", "aws", ["aws"]),
  make("Quality assurance", "qa", ["quality assurance", "qa"]),
  make("Human resources", "hr", ["human resources", "hr"]),
  // enterprise software and data
  make("Salesforce", "salesforce", ["sfdc", "salesforce crm"]),
  make("SAP S/4HANA", "s4hana", ["s/4hana", "s4hana", "s/4 hana", "s4 hana", "sap s4hana", "sap s4 hana"]),
  make("Microsoft Dynamics 365", "d365", ["dynamics 365", "d365", "ms dynamics", "microsoft dynamics", "dynamics365", "dynamics crm"]),
  make("Microsoft Azure", "azure", ["ms azure", "azure cloud", "azure"]),
  make("MongoDB", "mongodb", ["mongo db", "mongo"]),
  make("MySQL", "mysql", ["my sql"]),
  make("T-SQL", "tsql", ["tsql", "transact-sql", "transact sql"]),
  make("PL/SQL", "plsql", ["plsql", "pl sql", "pl-sql"]),
  make("NoSQL", "nosql", ["no sql", "no-sql"]),
  make("Ruby on Rails", "rails", ["ror", "ruby-on-rails", "rails framework"]),
  make("scikit-learn", "sklearn", ["sklearn", "scikit learn", "sci-kit learn"]),
  make("Google Analytics", "googleanalytics", ["ga4", "google analytics 4", "ga 4"]),
  make("Tally ERP", "tally", ["tally prime", "tallyprime", "tally erp 9"]),
  make("Excel VBA", "vba", ["vba", "visual basic for applications", "excel macros"]),
  // methods, standards and AI
  make("Six Sigma", "sixsigma", ["6 sigma", "6sigma", "6-sigma"]),
  make("Generative AI", "genai", ["genai", "gen ai", "gen-ai", "generative artificial intelligence"]),
  make("Large language models", "llm", ["llm", "llms", "large language model"]),
  make("Natural language processing", "nlp", ["nlp"]),
  make("Retrieval-augmented generation", "rag", ["retrieval augmented generation"]),
  make("Agile", "agile", ["agile methodology", "agile methodologies", "agile scrum"]),
  make("Electronic health records", "ehr", ["electronic medical records", "emr systems"]),
  make("Basic Life Support", "bls", ["bls certification", "bls certified"]),
  make("Occupational safety", "osha", ["osha 10", "osha 30", "osha-10", "osha-30"]),
];

/** Replace variants with their single-word token: for normalised titles ("Sr Dot Net Developer" -> "sr dotnet developer"). */
export function tokenizeVariants(text: string): string {
  let s = text;
  for (const v of VARIANTS) s = s.replace(v.re, ` ${v.token} `);
  return s.replace(/\s+/g, " ");
}
/** Replace variants with their canonical spelling: for skill terms ("NodeJS" -> "Node.js", "MS Excel" -> "Microsoft Excel"). */
export function canonicalSpelling(term: string): string {
  // only a whole-term match is renamed: "MS Excel" -> "Microsoft Excel", but "Azure Functions" stays as written
  const t = term.replace(/\s+/g, " ").trim();
  for (const v of VARIANTS) if (v.whole.test(t)) return v.canonical;
  return t;
}
/** Every spelling of a term, so a skill called ".NET" is also found as "dotnet", "Dot Net" or ".Net". */
export function spellingsOf(term: string): string[] {
  const out = new Set<string>([term]);
  for (const v of VARIANTS) {
    v.re.lastIndex = 0;
    if (!v.re.test(term)) continue;
    v.re.lastIndex = 0;
    for (const sp of [v.canonical, ...v.spellings]) out.add(term.replace(v.re, sp));
  }
  for (const x of [...out]) if (x.trim().length < 2) out.delete(x);
  return [...out];
}
