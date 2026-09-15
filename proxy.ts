import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  const isPublic =
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.match(/\.[a-z]+$/i) !== null;

  if (isPublic) return response;

  // Public API routes handle their own 401 (keys or session)
  if (pathname.startsWith("/api/")) return response;

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return Response.redirect(url);
  }
  return response;
}

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
