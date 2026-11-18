import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { getStorage } from "@/server/storage";

/** Alleen lokaal: serveert productfoto's uit lokale opslag. Labels worden hier nooit geserveerd. */
export async function GET(_req: Request, ctx: RouteContext<"/api/dev-storage/[...path]">) {
  if (env.storageDriver() !== "local" || process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const { path } = await ctx.params;
  if (path[0] !== "product-images") return new NextResponse(null, { status: 404 });
  try {
    const bytes = await getStorage().get("product-images", path.slice(1).join("/"));
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
