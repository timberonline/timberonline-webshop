import { NextResponse } from "next/server";
import { ForbiddenError, requireAdmin, ROLES } from "@/server/auth/admin";
import { getCtx } from "@/server/services/runtime";
import { labelPdf } from "@/server/services/shipping";

/** Labeldownload per bestelling. Hergebruikt het opgeslagen label (geen nieuwe aanvraag bij herdruk). */
export async function GET(_req: Request, ctx: RouteContext<"/beheer/label/[id]">) {
  try {
    await requireAdmin(ROLES.shipping);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Geen toegang", { status: 403 });
    throw e;
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Niet gevonden", { status: 404 });
  const pdf = await labelPdf(getCtx(), id);
  if (!pdf) return new NextResponse("Geen label", { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.filename}"`, "Cache-Control": "private, no-store" },
  });
}
