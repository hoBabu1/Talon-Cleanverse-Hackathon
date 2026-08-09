import { z } from "zod";
import "dotenv/config";

/// Fail fast and loud if config is missing — better than a confusing runtime error
/// three layers deep during a live demo.
const EnvSchema = z.object({
  CLEANVERSE_SANDBOX_API_ID: z.string().min(1),
  CLEANVERSE_SANDBOX_API_KEY: z.string().min(1),
  CLEANVERSE_BASE_URL: z.string().url().default("https://uatapi.cleanverse.com/api/cooperate"),

  // Empty string in .env means "not configured yet" — treat the same as unset,
  // rather than failing validation, since Supabase is optional until a project exists.
  SUPABASE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  SUPABASE_SERVICE_KEY: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),

  MONAD_TESTNET_RPC_URL: z.string().url().default("https://testnet-rpc.monad.xyz"),

  /// Comma-separated allowed origins for the browser. Defaults to local dev; set the
  /// deployed frontend origin in production. Without CORS every browser fetch is blocked
  /// and the backend looks broken even though it is answering correctly.
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  /// Optional shared secret for the identity freeze/unfreeze route. When set, that route
  /// requires an `x-talon-admin` header matching it; when unset the route is open, which
  /// is fine locally. Not authentication — the browser has to send it — just a guard so a
  /// publicly deployed backend doesn't expose "freeze any holder" to a bare curl.
  ADMIN_TOKEN: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),

  PORT: z.coerce.number().default(4000),
});

export const env = EnvSchema.parse(process.env);
