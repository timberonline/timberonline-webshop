import Link from "next/link";
import { connection } from "next/server";
import { Flash } from "../../_components/ui";
import { getDb } from "@/server/db";
import { ProductForm } from "../product-form";

export default async function NewBundle({ searchParams }: PageProps<"/beheer/artikelen/nieuwe-bundel">) {
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const [devices, comps] = await Promise.all([
    db.rpc<{ slug: string; name: string; family: string }[]>("api_admin_devices", {}),
    db.rpc<{ components: { id: string; code: string; name: string; kind: string; free: number }[] }>("api_admin_components", { limit: 1 }),
  ]);
  return (
    <>
      <div className="page-head">
        <h1>Nieuwe webshopbundel</h1>
        <Link href="/beheer/artikelen">← Alle artikelen</Link>
      </div>
      <Flash sp={sp} />
      <p className="muted">Een bundel heeft een vaste prijs en krijgt standaard geen extra staffelkorting. Voorbeeld: één passend hoesje met één of twee losse protectors.</p>
      <ProductForm product={null} devices={devices} components={comps.components} imageUrl={null} />
    </>
  );
}
