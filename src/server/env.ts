import "server-only";

/** Centrale serverconfiguratie. Geen geheime waarden in de code; alles via omgevingsvariabelen. */
function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  appUrl: () => str("APP_URL") ?? (str("VERCEL_URL") ? `https://${str("VERCEL_URL")}` : "http://localhost:3000"),
  dataDriver: () => (str("DATA_DRIVER") ?? (str("DATABASE_URL") ? "pg" : "supabase")) as "pg" | "supabase",
  databaseUrl: () => str("DATABASE_URL"),
  supabaseUrl: () => str("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => str("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => str("SUPABASE_SERVICE_ROLE_KEY"),
  storageDriver: () => (str("STORAGE_DRIVER") ?? (str("SUPABASE_SERVICE_ROLE_KEY") ? "supabase" : "local")) as "local" | "supabase",
  stripeSecretKey: () => str("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => str("STRIPE_WEBHOOK_SECRET"),
  stripeLiveEnabled: () => str("STRIPE_LIVE_ENABLED") === "true",
  stripePaymentMethodTypes: () => str("STRIPE_PAYMENT_METHOD_TYPES")?.split(",").map((s) => s.trim()).filter(Boolean),
  mailMode: () => (str("MAIL_MODE") ?? (str("RESEND_API_KEY") ? "resend" : "simulated")) as "resend" | "simulated",
  resendApiKey: () => str("RESEND_API_KEY"),
  mailFrom: () => str("MAIL_FROM") ?? "Timber Online <bestellingen@timberonline.timberservices.nl>",
  mailReplyTo: () => str("MAIL_REPLY_TO"),
  mailTestRecipient: () => str("MAIL_TEST_RECIPIENT"),
  bolMode: () => (str("BOL_MODE") ?? "simulated") as "simulated" | "live",
  bolClientId: () => str("BOL_CLIENT_ID"),
  bolClientSecret: () => str("BOL_CLIENT_SECRET"),
  carrierMode: () => (str("CARRIER_MODE") ?? "simulated") as "simulated" | "live",
  aiProvider: () => (str("AI_PROVIDER") ?? "rule-based") as "rule-based" | "openai",
  openaiApiKey: () => str("OPENAI_API_KEY"),
  openaiModel: () => str("OPENAI_MODEL") ?? "gpt-4.1-mini",
  cronSecret: () => str("CRON_SECRET"),
  /** Alleen lokaal: beheer zonder login. Kan nooit actief zijn in een productiebuild. */
  adminDevBypass: () =>
    process.env.NODE_ENV === "development" &&
    str("ADMIN_DEV_BYPASS") === "1" &&
    /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(str("DATABASE_URL") ?? ""),
};
