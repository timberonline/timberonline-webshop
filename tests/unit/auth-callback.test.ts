import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  exchangeCodeForSession: vi.fn<(code: string) => Promise<{ error: Error | null }>>(async () => ({ error: null })),
  verifyOtp: vi.fn<(p: { token_hash: string; type: string }) => Promise<{ error: Error | null }>>(async () => ({ error: null })),
};
vi.mock("@/server/auth/supabase", () => ({ createAuthClient: async () => ({ auth }) }));

const { GET } = await import("@/app/beheer/auth/callback/route");
const call = async (qs: string) => {
  const res = await GET(new Request(`https://shop.test/beheer/auth/callback?${qs}`));
  return res.headers.get("location");
};

beforeEach(() => {
  auth.exchangeCodeForSession.mockClear();
  auth.verifyOtp.mockClear();
});

describe("beheer: e-maillink-callback", () => {
  it("rondt een uitnodiging (token_hash) af en stuurt door naar wachtwoord instellen", async () => {
    expect(await call("token_hash=abc&type=invite&next=/beheer/wachtwoord")).toBe("https://shop.test/beheer/wachtwoord");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "invite" });
  });

  it("rondt PKCE (code) af zoals voorheen", async () => {
    expect(await call("code=xyz&next=/beheer/wachtwoord")).toBe("https://shop.test/beheer/wachtwoord");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("xyz");
  });

  it("weigert andere linktypen en externe doorverwijzingen", async () => {
    expect(await call("token_hash=abc&type=email_change")).toBe("https://shop.test/beheer/login");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(await call("token_hash=abc&type=invite&next=//evil.example")).toBe("https://shop.test/beheer");
    expect(await call("token_hash=abc&type=invite&next=https://evil.example")).toBe("https://shop.test/beheer");
  });

  it("stuurt bij een ongeldige of verlopen link naar inloggen", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ error: new Error("expired") });
    expect(await call("token_hash=old&type=invite&next=/beheer/wachtwoord")).toBe("https://shop.test/beheer/login");
  });
});
