import { AdminNav } from "./_components/nav";
import { navItemsFor } from "./_sections";
import { ROLE_LABEL, requireAdminPage } from "@/server/auth/admin";

/**
 * Gedeelde schil. De controle hier is niet de enige poort: layouts renderen niet opnieuw bij client-navigatie,
 * dus elke page.tsx roept zelf requireAdminPage(ROLES.<onderdeel>) aan.
 */
export default async function AdminLayout({ children }: LayoutProps<"/beheer">) {
  const s = await requireAdminPage();
  return (
    <div className="admin">
      <a href="#beheer-inhoud" className="skip-link">
        Naar de inhoud
      </a>
      <AdminNav items={navItemsFor(s.role)} who={s.email} role={ROLE_LABEL[s.role]} devBypass={s.devBypass} />
      <main id="beheer-inhoud" className="admin-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
