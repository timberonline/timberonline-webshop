import { AdminNav } from "./_components/nav";
import { ROLE_LABEL, requireAdminPage } from "@/server/auth/admin";

export default async function AdminLayout({ children }: LayoutProps<"/beheer">) {
  const s = await requireAdminPage();
  return (
    <div className="admin">
      <a href="#beheer-inhoud" className="skip-link">
        Naar de inhoud
      </a>
      <AdminNav who={s.email} role={ROLE_LABEL[s.role]} devBypass={s.devBypass} />
      <main id="beheer-inhoud" className="admin-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
