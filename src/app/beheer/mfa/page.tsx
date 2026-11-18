import { AuthShell } from "../auth-shell";
import { MfaForm } from "./mfa-form";

export default function MfaPage() {
  return (
    <AuthShell title="Tweestapsverificatie">
      <MfaForm />
    </AuthShell>
  );
}
