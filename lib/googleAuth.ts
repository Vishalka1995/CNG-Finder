import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { supabase } from "@/lib/supabase";

/**
 * Signing in with Google, so an account survives a reinstall.
 *
 * Everything the app knows about a driver -- points, badges, leaderboard
 * position -- hangs off their auth account, and until they attach something to
 * it that account exists only on the device. Uninstalling wipes it, and there
 * is then no way for anyone, including us, to prove they were ever that
 * person. Attaching a Google identity is what makes it recoverable.
 *
 * WHY THE BROWSER RATHER THAN THE NATIVE GOOGLE SDK
 * The native SDK returns an id token, which `signInWithIdToken` turns into a
 * session -- but that signs into (or creates) a Google-owned account, and the
 * anonymous account's points are simply left behind. Keeping the same account
 * requires `linkIdentity`, which is a redirect flow. The browser route is also
 * indifferent to the Android package name, which matters here because the dev,
 * preview and production builds each have a different one -- one Google client
 * covers all three, with no SHA-1 fingerprints to register per variant.
 */

/** Finishes the browser round trip in the app rather than leaving it hanging. */
WebBrowser.maybeCompleteAuthSession();

export type GoogleAuthOutcome =
  { ok: true; restored: boolean } | { ok: false; message: string };

/** Deep link the OAuth redirect comes back to. Matches the `cngnow` scheme,
 *  which is shared by every build variant. */
function redirectUrl(): string {
  return Linking.createURL("/auth/callback");
}

/**
 * Polls for a Google identity on the account.
 *
 * The session may be established by the callback screen rather than here, and
 * it lands a moment after the browser closes, so a single check taken straight
 * away can miss it.
 */
async function waitForGoogleIdentity(): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await getLinkedGoogleEmail()) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

/**
 * Runs one leg of the OAuth dance: open the provider URL, wait for the
 * redirect back, and turn the code it carries into a session.
 *
 * The browser's own verdict is not trusted on its own. Android delivers the
 * redirect to the app as a deep link as well, so the callback screen often
 * redeems the code first and the browser then reports a plain dismissal --
 * which looked identical to the driver cancelling, and was reported to them as
 * exactly that despite having worked. So whatever the browser says, the
 * question actually asked is whether the account now carries a Google
 * identity.
 */
type LegResult =
  /** A session now exists on this account. */
  | "ok"
  /** The driver backed out. */
  | "cancelled"
  /** This Google account belongs to a different account already -- the
   *  reinstall case, where signing in is what was wanted all along. */
  | "already-linked"
  /** Rejected for some other reason; the log carries it. */
  | "failed";

async function completeInBrowser(url: string, redirectTo: string): Promise<LegResult> {
  const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);

  if (result.type === "success") {
    const params = Linking.parse(result.url).queryParams ?? {};

    // Names for everything -- the values are credentials -- but the error
    // fields in full, since those are diagnostic text rather than secrets and
    // are the only thing that says WHY a redirect came back empty-handed.
    console.warn("[auth] redirect:", result.type, Object.keys(params));

    if (params["error"] || params["error_description"]) {
      console.warn(
        "[auth] provider rejected it:",
        params["error"],
        params["error_code"],
        params["error_description"],
      );

      // Not a failure so much as an answer: this Google account belongs to an
      // account that already exists, so signing into it is the thing to do.
      if (params["error_code"] === "identity_already_exists") return "already-linked";

      return "failed";
    }

    const code = params["code"];

    if (typeof code === "string") {
      // Harmless if the callback screen got there first: the failure that
      // causes is answered by the check below.
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return "ok";
    }
  }

  return (await waitForGoogleIdentity()) ? "ok" : "cancelled";
}

/**
 * Attaches Google to the account in hand, or signs back into the one it is
 * already attached to.
 *
 * Tries to LINK first, because on a device that has been reporting for weeks
 * the anonymous account holds everything worth keeping and linking preserves
 * it -- same account id, so points, badges and history all stay attached.
 *
 * Falls back to signing IN when that Google account is already linked to
 * another account, which is exactly the reinstall case: the fresh anonymous
 * account holds nothing, and the one worth having is the older one.
 *
 * `restored` says which happened, so the caller can tell the driver whether
 * their old points came back or their current ones were just made safe.
 */
export async function signInWithGoogle(): Promise<GoogleAuthOutcome> {
  const redirectTo = redirectUrl();

  try {
    const { data: linkData, error: linkError } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (!linkError && linkData?.url) {
      const linked = await completeInBrowser(linkData.url, redirectTo);

      if (linked === "ok") return { ok: true, restored: false };
      if (linked === "cancelled") return { ok: false, message: "Sign-in was cancelled." };

      // "already-linked" and "failed" both fall through to signing in. The
      // first is the reinstall case and is expected; the second is logged
      // above, and signing in is still the better answer than giving up.
    }

    // Falling back here abandons whatever the anonymous account held, so why
    // it happened is worth saying out loud. Silently dropping to sign-in is
    // how an account was replaced rather than linked, with nothing on screen
    // or in the log to show for it.
    console.warn(
      "[auth] linkIdentity unavailable, falling back to sign-in:",
      linkError?.message ?? "no url returned",
      linkError,
    );

    // Already attached to a different account, or manual linking is off in the
    // project settings. Either way, signing in is the thing that helps.
    const { data: signInData, error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (signInError || !signInData?.url) {
      return { ok: false, message: "Could not reach Google. Check your connection." };
    }

    const signedIn = await completeInBrowser(signInData.url, redirectTo);

    if (signedIn === "ok") return { ok: true, restored: true };
    if (signedIn === "cancelled") return { ok: false, message: "Sign-in was cancelled." };

    return { ok: false, message: "Could not sign in with Google. Please try again." };
  } catch {
    return { ok: false, message: "Something went wrong signing in." };
  }
}

/** The Google address on this account, or null while it is still anonymous. */
export async function getLinkedGoogleEmail(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    const google = data.user?.identities?.find((entry) => entry.provider === "google");
    if (!google) return null;

    const email = google.identity_data?.["email"];
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}
