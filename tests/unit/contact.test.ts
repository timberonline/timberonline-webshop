import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimulatedMail, type MailDriver, type MailMessage } from "@/server/integrations/mail";
import {
  contactInputFromFormData,
  contactRecipient,
  createRateLimiter,
  publicContactEmail,
  submitContact,
  validateContact,
  type ContactInput,
} from "@/server/services/contact";

const valid: ContactInput = {
  name: "Jan Jansen",
  email: "jan@example.com",
  order: "TO100001",
  subject: "bestelling",
  message: "Waar blijft mijn bestelling? Alvast bedankt.",
  website: "",
};

function sinkMail() {
  const sink: MailMessage[] = [];
  return { sink, mail: createSimulatedMail(sink) };
}

/** Elke test een eigen limiter, zodat de standaardlimiet niet tussen tests lekt. */
const freshLimiter = () => createRateLimiter({ limit: 5, windowMs: 60_000 });

describe("contactformulier: validatie", () => {
  it("accepteert een geldig bericht en maakt tekst eenregelig waar nodig", () => {
    const r = validateContact({ ...valid, name: "  Jan\r\nJansen  ", order: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe("Jan Jansen");
      expect(r.data.order).toBe("");
    }
  });

  it("geeft per veld één Nederlandse foutmelding", () => {
    const r = validateContact({ name: "", email: "geen-adres", order: "x", subject: "spam", message: "kort" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual({
        name: "Vul je naam in.",
        email: "Vul een geldig e-mailadres in, bijvoorbeeld naam@voorbeeld.nl.",
        order: "Een bestelnummer bestaat uit letters en cijfers, bijvoorbeeld TO100001.",
        subject: "Kies een onderwerp.",
        message: "Je bericht is te kort: gebruik minimaal 10 tekens.",
      });
    }
  });

  it("meldt lege verplichte velden als ontbrekend", () => {
    const r = validateContact({ name: " ", email: "", order: "", subject: "", message: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.email).toBe("Vul je e-mailadres in.");
      expect(r.errors.message).toBe("Schrijf je bericht.");
      expect(r.errors.order).toBeUndefined();
    }
  });

  it("leest FormData veilig (bestanden en ontbrekende velden worden lege tekst)", () => {
    const fd = new FormData();
    fd.set("name", "Jan");
    fd.set("message", new Blob(["x"]), "bestand.txt");
    const input = contactInputFromFormData(fd);
    expect(input).toEqual({ name: "Jan", email: "", order: "", subject: "", message: "", website: "" });
  });
});

describe("contactformulier: verzenden", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("verstuurt via de maildriver naar de ingestelde ontvanger, met ge-escapete inhoud", async () => {
    const { sink, mail } = sinkMail();
    const r = await submitContact(
      { ...valid, message: "Hallo <script>alert(1)</script> bestelling" },
      { mail, recipient: "service@example.com", clientKey: "1.2.3.4", limiter: freshLimiter() },
    );
    expect(r).toEqual({ status: "sent", delivery: "simulated" });
    expect(sink).toHaveLength(1);
    expect(sink[0].to).toBe("service@example.com");
    expect(sink[0].subject).toBe("Contactformulier: Vraag over mijn bestelling (TO100001)");
    expect(sink[0].subject).not.toContain("Jan");
    expect(sink[0].html).toContain("&lt;script&gt;");
    expect(sink[0].html).not.toContain("<script>");
    expect(sink[0].text).toContain("jan@example.com");
    expect(sink[0].idempotencyKey).toMatch(/^contact:[0-9a-f]{40}$/);
  });

  it("honeypot ingevuld: niets versturen, wel 'ignored' (bot ziet een gewone bevestiging)", async () => {
    const { sink, mail } = sinkMail();
    const r = await submitContact({ ...valid, website: "https://spam.example" }, { mail, recipient: "service@example.com", clientKey: "k", limiter: freshLimiter() });
    expect(r).toEqual({ status: "ignored" });
    expect(sink).toHaveLength(0);
  });

  it("valideert ook als het formulier nog niet actief is, en verstuurt dan niets", async () => {
    const { sink, mail } = sinkMail();
    const invalid = await submitContact({ ...valid, email: "fout" }, { mail, recipient: null, clientKey: "k", limiter: freshLimiter() });
    expect(invalid.status).toBe("invalid");
    const inactive = await submitContact(valid, { mail, recipient: null, clientKey: "k", limiter: freshLimiter() });
    expect(inactive).toEqual({ status: "inactive" });
    expect(sink).toHaveLength(0);
  });

  it("valt terug op MAIL_REPLY_TO als CONTACT_TO ontbreekt", async () => {
    vi.stubEnv("CONTACT_TO", "");
    vi.stubEnv("MAIL_REPLY_TO", "antwoord@example.com");
    expect(contactRecipient()).toBe("antwoord@example.com");
    const { sink, mail } = sinkMail();
    await submitContact(valid, { mail, clientKey: "k", limiter: freshLimiter() });
    expect(sink[0].to).toBe("antwoord@example.com");

    vi.stubEnv("CONTACT_TO", "contact@example.com");
    expect(contactRecipient()).toBe("contact@example.com");

    vi.stubEnv("CONTACT_TO", " ");
    vi.stubEnv("MAIL_REPLY_TO", "");
    expect(contactRecipient()).toBeNull();
  });

  it("toont alleen een geldig publiek contactadres", () => {
    expect(publicContactEmail({})).toBeNull();
    expect(publicContactEmail({ NEXT_PUBLIC_CONTACT_EMAIL: "geen adres" })).toBeNull();
    expect(publicContactEmail({ NEXT_PUBLIC_CONTACT_EMAIL: " info@example.com " })).toBe("info@example.com");
  });

  it("meldt een mislukte verzending zonder de inhoud te loggen", async () => {
    const failing: MailDriver = {
      mode: "resend",
      send: vi.fn(async () => {
        throw new Error("Resend: netwerkfout");
      }),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await submitContact(valid, { mail: failing, recipient: "service@example.com", clientKey: "k", limiter: freshLimiter() });
    expect(r).toEqual({ status: "failed" });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("netwerkfout");
    expect(logged).not.toContain(valid.message);
    expect(logged).not.toContain(valid.email);
    spy.mockRestore();
  });

  it("begrenst het aantal berichten per IP binnen het venster", async () => {
    const { sink, mail } = sinkMail();
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const send = (key: string, now: number) => submitContact(valid, { mail, recipient: "s@example.com", clientKey: key, limiter, now });
    expect((await send("a", 0)).status).toBe("sent");
    expect((await send("a", 1_000)).status).toBe("sent");
    expect((await send("a", 2_000)).status).toBe("rate_limited");
    expect((await send("b", 2_000)).status).toBe("sent");
    expect((await send("a", 61_000)).status).toBe("sent");
    expect(sink).toHaveLength(4);
  });

  it("telt ongeldige inzendingen niet mee voor de limiet", async () => {
    const { mail } = sinkMail();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      expect((await submitContact({ ...valid, name: "" }, { mail, recipient: "s@example.com", clientKey: "a", limiter })).status).toBe("invalid");
    }
    expect((await submitContact(valid, { mail, recipient: "s@example.com", clientKey: "a", limiter })).status).toBe("sent");
  });
});
