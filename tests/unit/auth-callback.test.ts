import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  exchangeCodeForSession: vi.fn<(code: string) => Promise<{ error: Error | null }>>(async () => ({ error: null })),
  verifyOtp: vi.fn<(p: { token_hash: string; type: string }) => Promise<{ error: Error | null }>>(async () => ({ error: null })),
};
vi.mock("@/server/auth/supabase", () => ({ createAuthClient: async () => ({ auth }) }));

// eenvoudige cookie-opslag voor de server action
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    delete: (o: { name: string } | string) => jar.delete(typeof o === "string" ? o : o.name),
  }),
}));
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
const { LINK_COOKIE, decodePendingLink, encodePendingLink } = await import("@/app/beheer/auth/link");

const call = (qs: string) => GET(new Request(`https://shop.test/beheer/auth/callback?${qs}`));
const confirm = async () => {
  try {
    await confirmLinkAction();
    return "geen redirect";
  } catch (e) {
    return e instanceof Redirect ? e.to : String(e);
  }
};

beforeEach(() => {
  auth.exchangeCodeForSession.mockClear();
  auth.verifyOtp.mockClear();
  jar.clear();
});

describe("beheer: e-maillink-callback (GET)", () => {
  it("zet de token in een httpOnly-cookie en stuurt naar een bevestigingspagina zonder token in de URL", async () => {
    const res = await call("token_hash=abc&type=invite&next=/beheer/wachtwoord");
    expect(res.headers.get("location")).toBe("https://shop.test/beheer/link-bevestigen");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const c = res.cookies.get(LINK_COOKIE)!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/beheer", maxAge: 600 });
    expect(decodePendingLink(c.value)).toEqual({ tokenHash: "abc", type: "invite", next: "/beheer/wachtwoord" });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("rondt PKCE (code) af zoals voorheen", async () => {
    expect((await call("code=xyz&next=/beheer/wachtwoord")).headers.get("location")).toBe("https://shop.test/beheer/wachtwoord");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("xyz");
  });

  it("weigert andere linktypen en maakt externe doelen intern", async () => {
    const bad = await call("token_hash=abc&type=email_change");
    expect(bad.headers.get("location")).toBe("https://shop.test/beheer/login");
    expect(bad.cookies.get(LINK_COOKIE)).toBeUndefined();
    const ext = await call("token_hash=abc&type=recovery&next=//evil.example");
    expect(decodePendingLink(ext.cookies.get(LINK_COOKIE)!.value)?.next).toBe("/beheer");
  });
});

describe("beheer: link bevestigen (server action)", () => {
  it("verifieert pas na de klik, met de token uit de cookie, en gebruikt de cookie één keer", async () => {
    jar.set(LINK_COOKIE, encodePendingLink({ tokenHash: "abc", type: "invite", next: "/beheer/wachtwoord" }));
    expect(await confirm()).toBe("/beheer/wachtwoord");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "invite" });
    expect(jar.has(LINK_COOKIE)).toBe(false);
    expect(await confirm()).toBe("/beheer/login"); // tweede keer: geen cookie meer
  });

  it("weigert zonder cookie (andere browser) of met gemanipuleerde cookie", async () => {
    expect(await confirm()).toBe("/beheer/login");
    jar.set(LINK_COOKIE, Buffer.from(JSON.stringify({ tokenHash: "abc", type: "signup", next: "/beheer" })).toString("base64url"));
    expect(await confirm()).toBe("/beheer/login");
    jar.set(LINK_COOKIE, "geen-json");
    expect(await confirm()).toBe("/beheer/login");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("stuurt bij een verlopen link naar inloggen", async () => {
    jar.set(LINK_COOKIE, encodePendingLink({ tokenHash: "old", type: "recovery", next: "/beheer/wachtwoord" }));
    auth.verifyOtp.mockResolvedValueOnce({ error: new Error("expired") });
    expect(await confirm()).toBe("/beheer/login");
  });
});
