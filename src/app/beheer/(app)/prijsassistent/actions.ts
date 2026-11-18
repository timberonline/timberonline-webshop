"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { env } from "@/server/env";
import { getCtx } from "@/server/services/runtime";
import { processBolQueue } from "@/server/services/bol-sync";
import { parsePricePrompt, parseWithOpenAI, type AdminProduct } from "@/server/ai/price-assistant";
import { back, errText, str } from "../_lib";

export async function proposeAction(fd: FormData) {
  let msg: { ok?: string; fout?: string } = {};
  let target = "/beheer/prijsassistent";
  try {
    const s = await requireAdmin(ROLES.catalog);
    const prompt = str(fd, "prompt").slice(0, 500);
    const ctx = getCtx();
    const products = await ctx.db.rpc<AdminProduct[]>("api_admin_products", {});
    const useAi = env.aiProvider() === "openai" && env.openaiApiKey();
    const parsed = useAi
      ? await parseWithOpenAI(prompt, products, { apiKey: env.openaiApiKey()!, model: env.openaiModel() })
      : parsePricePrompt(prompt, products);
    if (!parsed.ok) {
      msg = { fout: parsed.error };
    } else {
      const res = await ctx.db.rpc<{ id: string }>("api_ai_proposal_create", {
        actor: s.actor,
        prompt,
        provider: useAi ? `openai:${env.openaiModel()}` : "rule-based-test",
        items: parsed.items,
      });
      target = `/beheer/prijsassistent?voorstel=${res.id}${parsed.interpretation.length ? `&uitleg=${encodeURIComponent(parsed.interpretation.join(" "))}` : ""}`;
      msg = { ok: "Controleer het voorstel en bevestig de wijzigingen die je wilt doorvoeren." };
    }
  } catch (e) {
    msg = { fout: errText(e) };
  }
  back(target, msg);
}

export async function applyAction(fd: FormData) {
  const id = str(fd, "id");
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    const selected = fd.getAll("sel").map(String);
    if (selected.length === 0) throw new Error("Selecteer minimaal één wijziging");
    const ctx = getCtx();
    const res = await ctx.db.rpc<{ ok: boolean; error?: string; result: { applied: boolean }[] }>("api_ai_proposal_apply", { actor: s.actor, id, selected });
    await processBolQueue(ctx).catch(() => undefined);
    msg = res.ok ? { ok: `${res.result.filter((r) => r.applied).length} prijswijziging(en) toegepast` } : { fout: res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/prijsassistent");
  back(`/beheer/prijsassistent?voorstel=${id}`, msg);
}

export async function cancelProposalAction(fd: FormData) {
  try {
    const s = await requireAdmin(ROLES.catalog);
    await getCtx().db.rpc("api_ai_proposal_cancel", { actor: s.actor, id: str(fd, "id") });
  } catch (e) {
    back("/beheer/prijsassistent", { fout: errText(e) });
  }
  back("/beheer/prijsassistent", { ok: "Voorstel geannuleerd; er is niets gewijzigd" });
}
