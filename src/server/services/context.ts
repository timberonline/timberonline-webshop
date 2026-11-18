import Stripe from "stripe";
import type { Db } from "../db/types";
import type { Storage } from "../storage";
import type { MailDriver } from "../integrations/mail";
import type { BolDriver } from "../integrations/bol";
import type { CarrierDriver } from "../integrations/carriers";

export type Ctx = {
  db: Db;
  storage: Storage;
  mail: MailDriver;
  bol: BolDriver;
  carriers: CarrierDriver;
  stripe: Stripe | null;
  appUrl: string;
};

export function isLiveStripeKey(key: string) {
  return /^(sk|rk)_live_/.test(key);
}

/** Stripe-client; live sleutels worden geweigerd tot STRIPE_LIVE_ENABLED=true (na bevestiging livegangseisen). */
export function createStripe(key: string | undefined, liveEnabled: boolean): Stripe | null {
  if (!key) return null;
  if (isLiveStripeKey(key) && !liveEnabled) {
    console.error("Live Stripe-sleutel geweigerd: STRIPE_LIVE_ENABLED staat niet aan");
    return null;
  }
  return new Stripe(key, { appInfo: { name: "Timber Online" }, maxNetworkRetries: 2 });
}
