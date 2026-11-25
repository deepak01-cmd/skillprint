import { NextRequest, NextResponse } from "next/server";
import { ensureRoutes } from "@/server/routes";
import { dispatch } from "@/server/http/router";
import { SESSION_COOKIE, SESSION_HOURS, userFromToken } from "@/server/auth";

export const dynamic = "force-dynamic";

const MAX_JSON = 2 * 1024 * 1024;
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 120) * 1024 * 1024;

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  return res;
}

/** Requests that change data must come from this site (blocks cross-site form posts and scripted requests from other origins). */
function sameOrigin(req: NextRequest) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (scripts with a bearer token) send no Origin
  try {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    return new URL(origin).host === host;
  } catch { return false; }
}

async function handle(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    ensureRoutes();
    const path = "/" + params.path.join("/");
    if (path.length > 500) return json({ error: "not_found", message: "No such route" }, 404);
    const write = req.method !== "GET" && req.method !== "HEAD";
    if (write && !sameOrigin(req)) return json({ error: "forbidden_origin", message: "Request blocked: it did not come from this site" }, 403);

    const cookieToken = req.cookies.get(SESSION_COOKIE)?.value;
    const token = cookieToken || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const user = await userFromToken(token);

    let body: any = {};
    if (write && req.method !== "DELETE") {
      const type = req.headers.get("content-type") || "";
      const size = Number(req.headers.get("content-length") || 0);
      if (type.startsWith("multipart/form-data")) {
        if (size > MAX_UPLOAD) return json({ error: "too_large", message: `Files are limited to ${Math.round(MAX_UPLOAD / 1048576)} MB` }, 413);
        const form = await req.formData();
        for (const [k, v] of form.entries()) {
          const val = typeof v === "string" ? v.slice(0, 100_000) : { name: (v as File).name.slice(0, 200), buffer: Buffer.from(await (v as File).arrayBuffer()) };
          // a field sent more than once (several files) becomes a list
          body[k] = k in body ? [...(Array.isArray(body[k]) ? body[k] : [body[k]]), val] : val;
        }
      } else {
        if (size > MAX_JSON) return json({ error: "too_large", message: "The request is too large" }, 413);
        const text = await req.text();
        if (text.length > MAX_JSON) return json({ error: "too_large", message: "The request is too large" }, 413);
        if (text.trim()) { try { body = JSON.parse(text); } catch { return json({ error: "invalid_json", message: "The request body is not valid JSON" }, 400); } }
      }
    }

    const meta = { ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.ip || "local", ua: req.headers.get("user-agent") || "" };
    const out = await dispatch(req.method, path, user, { query: req.nextUrl.searchParams, body, meta });
    const secure = process.env.COOKIE_SECURE === "true";
    if (path === "/auth/login" && out.status === 200) {
      const { token: t, ...rest } = out.body as any; // the token travels only in the httpOnly cookie
      const res = json(rest, 200);
      res.cookies.set(SESSION_COOKIE, t, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * SESSION_HOURS, secure });
      return res;
    }
    const file = (out.body as any)?.__file;
    if (out.status === 200 && file) {
      // files are always downloaded, never rendered by the browser on this site
      const res = new NextResponse(new Uint8Array(file.data), { status: 200 });
      res.headers.set("content-type", file.mime || "application/octet-stream");
      res.headers.set("content-disposition", `attachment; filename="${String(file.name).replace(/[^\w.\- ]+/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      res.headers.set("x-content-type-options", "nosniff"); res.headers.set("content-security-policy", "sandbox; default-src 'none'"); res.headers.set("cache-control", "no-store");
      return res;
    }
    const res = json(out.body, out.status);
    if (path === "/auth/logout" || out.status === 401 && cookieToken) res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    console.error(e);
    return json({ error: "server_error", message: "Something went wrong. The error was logged." }, 500);
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
