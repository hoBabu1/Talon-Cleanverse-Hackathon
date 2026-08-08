import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Server-side Supabase client using the service key — this backend is a trusted
 * server, never exposed to the browser, so it bypasses row-level security by design.
 * The frontend gets its own anon-key client with RLS enforced (see frontend/.env.example).
 */
export const supabase =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
    : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env " +
      "(see backend/db/schema.sql for the tables to create first)."
    );
  }
  return supabase;
}
