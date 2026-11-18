export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "var(--to-anthracite)" }}>
      <div className="card" style={{ width: "100%", maxWidth: 420 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/compact-light.svg" alt="Timber Online" width="163" height="36" style={{ marginBottom: 16 }} />
        <h1 style={{ fontSize: "1.5rem" }}>{title}</h1>
        {children}
      </div>
    </main>
  );
}
