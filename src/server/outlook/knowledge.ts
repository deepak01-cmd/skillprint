/* Built-in industry knowledge used by the skill outlook when job-posting history is thin. Each entry is a pattern on the skill name,
   a direction (+1 rising, -1 falling) with strength, and the reason shown to people. It is one signal among several and is labelled
   "industry knowledge" wherever it is used. Companies refine it with their own evidence (Skill evolution) and job-posting data. */

export interface KnowledgeEntry { re: RegExp; value: number; reason: string }

export const RISING: KnowledgeEntry[] = [
  { re: /\b(generative ai|genai|large language model|llm|prompt engineering|retrieval[- ]augmented|rag\b|ai agents?|agentic)/i, value: 0.9, reason: "Generative AI adoption is spreading across most functions" },
  { re: /\b(vector (database|search)|embeddings?|langchain|llamaindex)\b/i, value: 0.8, reason: "Needed to build generative AI applications" },
  { re: /\b(mlops|llmops|model deployment|ml engineering|feature store)\b/i, value: 0.7, reason: "Companies are moving AI from pilots into production" },
  { re: /\b(machine learning|deep learning|pytorch|tensorflow|computer vision|nlp|natural language processing)\b/i, value: 0.5, reason: "Sustained growth in AI and machine-learning work" },
  { re: /\b(ai governance|responsible ai|ai ethics|ai risk|model risk)\b/i, value: 0.7, reason: "Regulation (for example the EU AI Act) creates demand for AI governance" },
  { re: /\b(kubernetes|k8s|platform engineering|service mesh|istio|helm)\b/i, value: 0.5, reason: "Cloud-native platforms keep expanding" },
  { re: /\b(terraform|infrastructure as code|pulumi|gitops|argo ?cd)\b/i, value: 0.5, reason: "Infrastructure is increasingly managed as code" },
  { re: /\b(finops|cloud cost)\b/i, value: 0.6, reason: "Cloud cost management is a growing discipline" },
  { re: /\b(zero trust|cloud security|devsecops|threat detection|incident response|siem|soc analyst)\b/i, value: 0.6, reason: "Security threats and regulation keep rising" },
  { re: /\b(data mesh|dbt|snowflake|databricks|lakehouse|data contracts?|data observability)\b/i, value: 0.6, reason: "Modern data platforms are replacing older warehouses" },
  { re: /\b(rust|go|golang)\b/i, value: 0.4, reason: "Growing use for safe, fast systems and cloud services" },
  { re: /\b(typescript|next\.?js)\b/i, value: 0.35, reason: "Widely adopted in modern web development" },
  { re: /\biso 20022\b/i, value: 0.6, reason: "Payment systems migrated to ISO 20022 (SWIFT's coexistence period ended in November 2025)" },
  { re: /\b(ai-assisted|ai assisted|clinical documentation ai|ambient documentation)\b/i, value: 0.6, reason: "AI is being adopted to draft and review clinical documentation" },
  { re: /\b(esg|sustainability reporting|carbon accounting|climate risk)\b/i, value: 0.6, reason: "Sustainability disclosure rules are expanding" },
  { re: /\b(automation|rpa|power automate|workflow automation|low[- ]code|no[- ]code)\b/i, value: 0.4, reason: "Process automation is spreading" },
  { re: /\b(product analytics|experimentation|a\/b testing|growth analytics)\b/i, value: 0.35, reason: "Data-driven product decisions are expected" },
  { re: /\b(digital health|telehealth|health informatics|fhir|interoperability)\b/i, value: 0.5, reason: "Healthcare is digitising records and care" },
  { re: /\b(edge computing|iot|internet of things)\b/i, value: 0.35, reason: "More processing moves to devices and the edge" },
  { re: /\b(change management|data literacy|ai literacy|critical thinking|adaptability)\b/i, value: 0.3, reason: "Valued as work changes with automation" },
];

export const FALLING: KnowledgeEntry[] = [
  { re: /\b(jquery|angularjs|backbone\.?js|knockout\.?js)\b/i, value: -0.7, reason: "Replaced by modern front-end frameworks" },
  { re: /\b(flash|silverlight|actionscript|vb6|visual basic 6|classic asp|asp classic)\b/i, value: -0.9, reason: "Retired or end-of-life technology" },
  { re: /\b(web ?forms|wcf|soap|struts|ejb|j2ee)\b/i, value: -0.5, reason: "Being replaced by newer frameworks and REST/GraphQL APIs" },
  { re: /\b(svn|subversion|cvs|clearcase)\b/i, value: -0.6, reason: "Teams have moved to Git" },
  { re: /\b(perl|objective-c|coffeescript)\b/i, value: -0.5, reason: "Use is shrinking in favour of newer languages" },
  { re: /\b(hadoop|mapreduce|pig|hive)\b/i, value: -0.5, reason: "Replaced by cloud data platforms" },
  { re: /\b(on[- ]premise exchange|lotus notes|sharepoint 2010)\b/i, value: -0.6, reason: "Moved to cloud services" },
  { re: /\b(waterfall|prince2)\b/i, value: -0.3, reason: "Delivery has shifted to agile and product ways of working" },
  { re: /\b(excel vba|vba|macros?)\b/i, value: -0.4, reason: "Being replaced by Power Query, Python and automation tools" },
  { re: /\b(manual testing|manual test execution)\b/i, value: -0.5, reason: "Being replaced by automated testing" },
  { re: /\blibor\b/i, value: -0.9, reason: "LIBOR was discontinued in 2023; benchmarks moved to SOFR, SONIA and other risk-free rates" },
  { re: /\bicd-?9\b/i, value: -0.8, reason: "ICD-9 was replaced by ICD-10 (and ICD-11 is being adopted)" },
  { re: /\bpython 2\b/i, value: -0.9, reason: "Python 2 reached end of life in January 2020" },
  { re: /\b(crystal reports|qlikview)\b/i, value: -0.5, reason: "Being replaced by modern self-service BI tools such as Power BI and Tableau" },
  { re: /\b(puppet|chef|cfengine)\b/i, value: -0.45, reason: "Configuration management is moving to infrastructure as code, containers and Kubernetes" },
  { re: /\b(informatica powercenter|ssis|datastage)\b/i, value: -0.45, reason: "On-premise ETL tools are being replaced by cloud ELT and dbt" },
  { re: /\bsas\b/i, value: -0.3, reason: "Analytics teams are shifting from SAS to open-source Python and R" },
];

/** Tasks that AI and automation are taking over: a negative signal of how exposed the skill is. */
export const AUTOMATION: KnowledgeEntry[] = [
  { re: /\b(data entry|keying|typing|transcription)\b/i, value: -0.8, reason: "Highly exposed to automation" },
  { re: /\b(bookkeeping|invoice processing|accounts payable processing|reconciliation)\b/i, value: -0.5, reason: "Routine finance processing is being automated" },
  { re: /\b(basic reporting|report generation|static reports?)\b/i, value: -0.4, reason: "Routine reports are increasingly generated automatically" },
  { re: /\b(first[- ]line support|l1 support|helpdesk ticket|call handling)\b/i, value: -0.45, reason: "Chatbots and self-service handle more first-line work" },
  { re: /\b(document review|proofreading|translation|copywriting)\b/i, value: -0.35, reason: "Generative AI now drafts and reviews text" },
  { re: /\b(manual testing)\b/i, value: -0.4, reason: "Test automation and AI testing tools reduce manual work" },
  { re: /\b(scheduling|appointment booking|claims processing|medical coding)\b/i, value: -0.35, reason: "Rule-based work moving to automation" },
];

export function knowledgeFor(name: string) {
  const hits = [...RISING, ...FALLING].filter(k => k.re.test(name));
  const auto = AUTOMATION.filter(k => k.re.test(name));
  const pick = (list: KnowledgeEntry[]) => list.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0] ?? null;
  return { industry: pick(hits), automation: pick(auto) };
}
