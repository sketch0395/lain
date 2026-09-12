import { unstable_rethrow } from "next/navigation";
import { configuredProviderIds, signIn } from "@/auth";

async function signInWithProvider(provider) {
  "use server";
  try {
    await signIn(provider, { redirectTo: "/" });
  } catch (err) {
    // signIn() redirects on success by throwing a special Next.js redirect
    // "error" — let that (and any other Next internal control-flow signal)
    // propagate untouched, only handle genuine failures below.
    unstable_rethrow(err);
    console.error(`[Lain] sign-in with ${provider} failed:`, err);
    throw new Error(
      "Sign-in failed. Check that the OAuth app credentials are correct " +
        "and try again."
    );
  }
}

export default async function LoginPage({ searchParams }) {
  const { error } = (await searchParams) || {};
  const hasGitHub = configuredProviderIds.includes("github");
  const hasGoogle = configuredProviderIds.includes("google");

  return (
    <div className="flex h-dvh items-center justify-center bg-[var(--lain-bg)] text-[var(--lain-cream)] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--lain-border)] bg-[var(--lain-panel)] p-6 sm:p-8 text-center shadow-[0_0_40px_-10px_rgba(179,18,46,0.4)]">
        <div className="mb-6 flex items-center justify-center gap-2">
          {/* Text monogram logo — no external image asset. */}
          <span className="w-9 h-9 rounded-md bg-[var(--lain-crimson)] border border-[var(--lain-gold)]/40 flex items-center justify-center text-lg font-bold shrink-0">
            L
          </span>
          <span className="text-3xl font-bold bg-gradient-to-r from-[var(--lain-crimson-light)] to-[var(--lain-gold-soft)] bg-clip-text text-transparent">
            Lain
          </span>
        </div>
        <p className="mb-6 text-sm text-[var(--lain-muted)]">
          Sign in to talk to your personal AI assistant.
        </p>

        {!hasGitHub && !hasGoogle && (
          <p className="mb-4 text-sm text-[var(--lain-gold-soft)]">
            No sign-in providers are configured yet. Set AUTH_GITHUB_ID/
            AUTH_GITHUB_SECRET and/or AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET in
            your .env file (see README.md).
          </p>
        )}

        {hasGitHub && (
          <form action={signInWithProvider.bind(null, "github")}>
            <button
              type="submit"
              className="mb-3 w-full rounded-lg bg-[#1b1210] border border-[var(--lain-gold)]/30 py-2 font-semibold text-[var(--lain-cream)] hover:bg-[#241814] transition-colors"
            >
              Continue with GitHub
            </button>
          </form>
        )}

        {hasGoogle && (
          <form action={signInWithProvider.bind(null, "google")}>
            <button
              type="submit"
              className="w-full rounded-lg bg-[var(--lain-cream)] py-2 font-semibold text-[var(--lain-bg)] hover:brightness-95 transition"
            >
              Continue with Google
            </button>
          </form>
        )}

        {error && (
          <p className="mt-5 text-sm text-[var(--lain-crimson-light)]">
            Access denied. Your account isn&apos;t on the allowlist, or
            sign-in failed. Contact the admin if you believe this is wrong.
          </p>
        )}
      </div>
    </div>
  );
}
