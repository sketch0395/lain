import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

/**
 * Only these emails (Google) or GitHub usernames (GitHub) may sign in.
 * Configure via the ALLOWED_USERS env var, comma-separated, case-insensitive.
 */
function isAllowed({ email, githubLogin }) {
  const allowList = (process.env.ALLOWED_USERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowList.length === 0) return false; // fail closed if misconfigured

  if (email && allowList.includes(email.toLowerCase())) return true;
  if (githubLogin && allowList.includes(githubLogin.toLowerCase()))
    return true;
  return false;
}

// Only register a provider if its credentials are actually configured.
// Without this, next-auth throws a raw config error the moment signIn() is
// called for a provider with a missing client id/secret, which surfaces to
// the browser as an opaque "unexpected response from the server" crash
// instead of a clear message.
const providers = [];
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(GitHub);
}
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

export const configuredProviderIds = providers.map((p) =>
  typeof p === "function" ? p({}).id : p.id
);

if (providers.length === 0) {
  console.warn(
    "[Lain] No OAuth providers are configured. Set AUTH_GITHUB_ID/" +
      "AUTH_GITHUB_SECRET and/or AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET so " +
      "sign-in works. See README.md section 2."
  );
}

if (!process.env.AUTH_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[Lain] AUTH_SECRET is not set. Generate one with `npx auth secret` " +
        "and add it to your .env file — sign-in will fail without it."
    );
  } else {
    // Avoid hard-crashing local `npm run dev` before the developer has
    // created .env.local; production must still set a real secret.
    process.env.AUTH_SECRET = "dev-only-insecure-secret-do-not-use-in-prod";
    console.warn(
      "[Lain] AUTH_SECRET is not set — using an insecure development " +
        "default. Set a real AUTH_SECRET before deploying."
    );
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Required when running behind a reverse proxy (e.g. Caddy/Nginx/Traefik).
  trustHost: true,
  providers,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      const email = user?.email;
      const githubLogin =
        account?.provider === "github" ? profile?.login : null;
      return isAllowed({ email, githubLogin });
    },
  },
});
