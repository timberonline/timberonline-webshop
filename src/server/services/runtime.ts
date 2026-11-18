import "server-only";
import { env } from "../env";
import { getDb } from "../db";
import { getStorage } from "../storage";
import { createResendMail, createSimulatedMail } from "../integrations/mail";
import { createLiveBol, createSimulatedBol } from "../integrations/bol";
import { createLiveCarriers, createSimulatedCarriers } from "../integrations/carriers";
import { createStripe, type Ctx } from "./context";

let ctx: Ctx | undefined;

export function getCtx(): Ctx {
  if (ctx) return ctx;
  const db = getDb();
  const resendKey = env.resendApiKey();
  const mail =
    env.mailMode() === "resend" && resendKey
      ? createResendMail({ apiKey: resendKey, from: env.mailFrom(), replyTo: env.mailReplyTo(), testRecipient: env.mailTestRecipient() })
      : createSimulatedMail();
  const bolId = env.bolClientId();
  const bolSecret = env.bolClientSecret();
  const bol = env.bolMode() === "live" && bolId && bolSecret ? createLiveBol({ clientId: bolId, clientSecret: bolSecret }) : createSimulatedBol(db);
  ctx = {
    db,
    storage: getStorage(),
    mail,
    bol,
    carriers: env.carrierMode() === "live" ? createLiveCarriers() : createSimulatedCarriers(),
    stripe: createStripe(env.stripeSecretKey(), env.stripeLiveEnabled()),
    appUrl: env.appUrl(),
  };
  return ctx;
}

export function integrationStatus() {
  const key = env.stripeSecretKey() ?? "";
  return {
    data: env.dataDriver(),
    storage: env.storageDriver(),
    stripe: !key ? "niet geconfigureerd" : /^(sk|rk)_test_/.test(key) ? "testmodus" : env.stripeLiveEnabled() ? "LIVE" : "live sleutel geweigerd",
    mail: env.mailMode() === "resend" && env.resendApiKey() ? (env.mailTestRecipient() ? "Resend (testontvanger)" : "Resend") : "gesimuleerd",
    bol: env.bolMode() === "live" && env.bolClientId() ? "live" : "gesimuleerd",
    carriers: env.carrierMode() === "live" ? "live (DHL/PostNL nog niet geactiveerd)" : "gesimuleerd (voorbeeldlabels)",
    ai: env.aiProvider() === "openai" && env.openaiApiKey() ? `OpenAI (${env.openaiModel()})` : "testimplementatie (regelgebaseerd)",
  };
}
