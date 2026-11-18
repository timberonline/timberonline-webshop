import { AuthShell } from "../auth-shell";
import { PasswordForm } from "./password-form";

export default function PasswordPage() {
  return (
    <AuthShell title="Wachtwoord instellen">
      <PasswordForm />
    </AuthShell>
  );
}
