/* Matching role titles typed by people. Used by the Job roles and Framework explorer searches (the server uses the same rule in
   roleFallback.sameRole). */
/* Search: a row matches when the words match its role title, OR its skill name, OR its Pixel ID (never words spread across them).
   Role titles are compared as titles: abbreviations and spellings are expanded (".net dev" = ".NET Developer", "BI lead" =
   "Business Intelligence Lead", "engineer" = "developer") and the level must be the same: "Backend Lead" never shows
   "Backend Developer", and a full title without a level word only shows mid-level roles. */
export const ABBR: Record<string, string> = { dev: "developer", devs: "developer", eng: "engineer", engr: "engineer", sr: "senior", snr: "senior", jr: "junior", mgr: "manager",
  bi: "business intelligence", ml: "machine learning", ai: "ai", sre: "site reliability engineer", ba: "business analyst", fullstack: "full stack", frontend: "frontend", backend: "backend" };
export const LEVEL: Record<string, number> = { intern: 1, trainee: 1, junior: 1, associate: 2, senior: 4, staff: 4, lead: 5, principal: 5 };
export const titleTokens = (x: string) => x.toLowerCase().replace(/\.net\b|dot[ -]?net/g, " dotnet ").replace(/c#|c sharp|csharp/g, " csharp ").replace(/front[ -]end/g, "frontend").replace(/back[ -]end/g, "backend").replace(/full[ -]stack/g, "fullstack")
  .replace(/[^a-z0-9+]+/g, " ").trim().split(" ").filter(Boolean).flatMap(t => (ABBR[t] ?? t).split(" "));
export const same = (t: string) => t === "engineer" || t === "engineering" ? "developer" : t;
export const rankOf = (ts: string[]) => ts.reduce<number | null>((r, t) => LEVEL[t] ?? r, null);
/** Do these query words match this text? Every word must be in it; the last one may be the start of a word (typing). */
export const wordsIn = (qs: string[], text: string[], eq = (x: string) => x) => qs.every((w, i) => text.some(t => eq(t) === eq(w) || (i === qs.length - 1 && w.length >= 2 && t.startsWith(w))));

/** Does a typed query find this role title? Words must be in the title (abbreviations and spellings expanded, engineer =
    developer); for a full title or one with a level word, the level must be the same too. */
export function titleMatches(query: string, title: string) {
  const qt = titleTokens(query); if (!qt.length) return true;
  const qRank = rankOf(qt), words = qt.filter(t => !(t in LEVEL)), rt = titleTokens(title);
  if (words.length && !wordsIn(words, rt.filter(t => !(t in LEVEL)), same)) return false;
  return !(qRank != null || qt.length >= 2) || (rankOf(rt) ?? 3) === (qRank ?? 3);
}
