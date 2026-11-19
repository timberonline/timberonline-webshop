import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  exchangeCodeForSession: vi.fn<(code: string) => Promise<{ error: Error | null }>>(async () => ({ error: null })),
  verifyOtp: vi.fn<(p: { token_hash: string; type: string }) => Promise<{ error: Error | null }>>(async () => ({ error: null })),
};
vi.mock("@/server/auth/supabase", () => ({ createAuthClient: async () => ({ auth }) }));
// redirect() van Next gooit; in de test vangen we het doel af
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const { GET } = await import("@/app/beheer/auth/callback/route");
const { confirmLinkAction } = await import("@/app/beheer/link-bevestigen/actions");

const call = async (qs: string) => (await GET(new Request(`https://shop.test/beheer/auth/callback?${qs}`))).headers.get("location");
const confirm = async (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  try {
    await confirmLinkAction(fd);
    return "geen redirect";
  } catch (e) {
    return e instanceof Redirect ? e.to : String(e);
  }
};

beforeEach(() => {
  auth.exchangeCodeForSession.mockClear();
  auth.verifyOtp.mockClear();
});

describe("beheer: e-maillink-callback (GET)", () => {
  it("rondt een token-hashlink NIET af op GET maar stuurt naar de bevestigingspagina", async () => {
    const to = new URL(String(await call("token_hash=abc&type=invite&next=/beheer/wachtwoord")));
    expect(to.pathname).toBe("/beheer/link-bevestigen");
    expect(Object.fromEntries(to.searchParams)).toEqual({ token_hash: "abc", type: "invite", next: "/beheer/wachtwoord" });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("rondt PKCE (code) af zoals voorheen", async () => {
    expect(await call("code=xyz&next=/beheer/wachtwoord")).toBe("https://shop.test/beheer/wachtwoord");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("xyz");
  });

  it("weigert andere linktypen en maakt externe doorverwijzingen intern", async () => {
    expect(await call("token_hash=abc&type=email_change")).toBe("https://shop.test/beheer/login");
    const to = new URL(String(await call("token_hash=abc&type=recovery&next=//evil.example")));
    expect(to.searchParams.get("next")).toBe("/beheer");
  });
});

describe("beheer: link bevestigen (server action)", () => {
  it("verifieert pas na de klik en stuurt door naar het interne doel", async () => {
    expect(await confirm({ token_hash: "abc", type: "invite", next: "/beheer/wachtwoord" })).toBe("/beheer/wachtwoord");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "invite" });
  });

  it("weigert onbekende typen, lege tokens en externe doelen", async () => {
    expect(await confirm({ token_hash: "abc", type: "signup", next: "/beheer" })).toBe("/beheer/login");
    expect(await confirm({ token_hash: "", type: "invite", next: "/beheer" })).toBe("/beheer/login");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(await confirm({ token_hash: "abc", type: "recovery", next: "https://evil.example" })).toBe("/beheer");
  });

  it("stuurt bij een verlopen link naar inloggen", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ error: new Error("expired") });
    expect(await confirm({ token_hash: "old", type: "invite", next: "/beheer/wachtwoord" })).toBe("/beheer/login");
  });
});
