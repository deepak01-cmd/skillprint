import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  const has = req.cookies.get("rsip_session")?.value;
  if (!has && !req.nextUrl.pathname.startsWith("/login")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}
export const config = { matcher: ["/((?!api|_next|favicon.ico|manifest.webmanifest|sw.js|icon-192.png|icon-512.png|apple-touch-icon.png|brand/).*)"] };
