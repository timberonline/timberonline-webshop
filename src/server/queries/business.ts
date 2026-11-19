import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getDb } from "../db";
import { loadPublicBusiness, type PublicBusiness } from "../services/business";

/** Publieke bedrijfsgegevens, één keer per request (footer, contact, voorwaarden). Null als de database onbereikbaar is. */
export const getPublicBusiness = cache(async (): Promise<PublicBusiness | null> => {
  await connection();
  try {
    return await loadPublicBusiness(getDb());
  } catch (e) {
    console.error("Bedrijfsgegevens niet beschikbaar:", (e as Error).message);
    return null;
  }
});
