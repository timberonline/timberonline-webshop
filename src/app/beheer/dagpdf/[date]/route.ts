import { NextResponse } from "next/server";
import { ForbiddenError, requireAdmin, ROLES } from "@/server/auth/admin";
import { getCtx } from "@/server/services/runtime";
import { dayPdf } from "@/server/services/shipping";

/** Eén gecombineerde printbare PDF met alle labels van een verzenddag. */
export async function GET(_req: Request, ctx: RouteContext<"/beheer/dagpdf/[date]">) {
  try {
    await requireAdmin(ROLES.shipping);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Geen toegang", { status: 403 });
    throw e;
  }
  const { date } = await ctx.params;
  const pdf = await dayPdf(getCtx(), date);
  if (!pdf) return new NextResponse("Geen labels voor deze dag", { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.filename}"`, "Cache-Control": "private, no-store" },
  });
}
