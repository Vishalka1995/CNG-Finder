import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { STORAGE_KEYS, isSupabaseConfigured } from "@/constants/config";
import { supabase } from "@/lib/supabase";

/**
 * Anonymous identity.
 *
 * Two distinct things, deliberately kept separate:
 *
 *   1. `device_id` -- a UUID we generate and keep in SecureStore. Stable across
 *      app updates, useful for analytics and for linking a reinstall to prior
 *      activity. It is CLIENT-ASSERTED and therefore never used for
 *      authorization: anyone can extract the anon key from the APK and send a
 *      fresh random id per request.
 *
 *   2. `auth.uid()` -- from a Supabase anonymous-auth JWT, signed server-side
 *      and unforgeable. This is what the rate limit and every RLS policy key
 *      on. Enabling anonymous sign-ins in the Supabase dashboard is a
 *      prerequisite for reporting to work at all.
 */

let cachedDeviceId: string | null = null;

/**
 * SecureStore is backed by the Android keystore and can throw on devices with a
 * corrupted keystore or after certain OS restores. A crash on launch here would
 * be fatal to adoption, so every access falls back to AsyncStorage.
 */
async function readStoredId(): Promise<string | null> {
  try {
    const secure = await SecureStore.getItemAsync(STORAGE_KEYS.deviceId);
    if (secure) return secure;
  } catch (error) {
    console.warn("[device] SecureStore read failed, falling back", error);
  }

  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
  } catch (error) {
    console.warn("[device] AsyncStorage read failed", error);
    return null;
  }
}

async function writeStoredId(id: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEYS.deviceId, id);
    return;
  } catch (error) {
    console.warn("[device] SecureStore write failed, falling back", error);
  }

  try {
    await AsyncStorage.setItem(STORAGE_KEYS.deviceId, id);
  } catch (error) {
    console.warn("[device] AsyncStorage write failed; id will not persist", error);
  }
}

/**
 * Generates a v4 UUID, trying three sources in order of preference.
 *
 * `expo-crypto` declares `randomUUID` in its types, but the underlying native
 * module is not always loaded (notably in the browser preview and before a
 * dev-client build), where it is `undefined` at runtime. The type system will
 * not warn you about this, so each source is feature-detected rather than
 * assumed.
 */
function generateUUID(): string {
  // 1. expo-crypto, when the native module is actually present.
  try {
    if (typeof Crypto.randomUUID === "function") return Crypto.randomUUID();
  } catch {
    // fall through
  }

  // 2. The Web Crypto API, available in browsers and modern JS engines.
  try {
    const webCrypto = globalThis.crypto;
    if (webCrypto && typeof webCrypto.randomUUID === "function") {
      return webCrypto.randomUUID();
    }

    // 3. Web Crypto without randomUUID: build a v4 UUID from random bytes.
    if (webCrypto && typeof webCrypto.getRandomValues === "function") {
      const bytes = webCrypto.getRandomValues(new Uint8Array(16));
      return formatUUIDv4(bytes);
    }
  } catch {
    // fall through
  }

  // 4. Last resort: expo-crypto's byte generator, then Math.random.
  try {
    if (typeof Crypto.getRandomBytes === "function") {
      return formatUUIDv4(Crypto.getRandomBytes(16));
    }
  } catch {
    // fall through
  }

  const fallback = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) fallback[i] = Math.floor(Math.random() * 256);
  return formatUUIDv4(fallback);
}

/** Formats 16 random bytes as a v4 UUID string. */
function formatUUIDv4(input: Uint8Array): string {
  const bytes = Uint8Array.from(input);

  // Set the version (4) and variant (RFC 4122) bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    hex.push((bytes[i] ?? 0).toString(16).padStart(2, "0"));
  }

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/** Returns this install's stable anonymous id, generating one on first run. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const existing = await readStoredId();
  if (existing) {
    cachedDeviceId = existing;
    return existing;
  }

  const generated = generateUUID();
  await writeStoredId(generated);
  cachedDeviceId = generated;
  return generated;
}

export interface SessionResult {
  ok: boolean;
  deviceId: string | null;
  userId: string | null;
  error?: string;
}

/**
 * Ensures an anonymous Supabase session exists and that a matching `users` row
 * links it to this device. Safe to call on every cold start.
 */
export async function ensureSession(): Promise<SessionResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      deviceId: null,
      userId: null,
      error: "Supabase env vars are not set. Copy .env.example to .env.",
    };
  }

  const deviceId = await getDeviceId();

  try {
    const { data: existing } = await supabase.auth.getSession();
    let userId = existing.session?.user.id ?? null;

    if (!userId) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        // The most common cause is anonymous sign-ins being disabled in the
        // Supabase dashboard, which is a setup step rather than a code bug.
        return { ok: false, deviceId, userId: null, error: error.message };
      }
      userId = data.user?.id ?? null;
    }

    if (!userId) {
      return { ok: false, deviceId, userId: null, error: "No user id after sign-in." };
    }

    // Link the auth user to this device. onConflict on auth_user_id makes this
    // idempotent across relaunches.
    const { error: upsertError } = await supabase
      .from("users")
      .upsert({ auth_user_id: userId, device_id: deviceId }, { onConflict: "auth_user_id" });

    if (upsertError) {
      // Not fatal: the session is valid and reporting still works. The trigger's
      // reports_count bump is the only thing affected.
      console.warn("[device] users upsert failed", upsertError.message);
    }

    return { ok: true, deviceId, userId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, deviceId, userId: null, error: message };
  }
}
