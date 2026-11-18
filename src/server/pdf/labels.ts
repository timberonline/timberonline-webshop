import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** A6-label (100 × 150 mm), het gangbare formaat voor thuisprinters en labelprinters. */
const MM = 72 / 25.4;
export const LABEL_W = 100 * MM;
export const LABEL_H = 150 * MM;

export type Address = {
  name?: string | null;
  street?: string | null;
  house_number?: string | null;
  address_extra?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
};

export type LabelInput = {
  carrier: "dhl" | "postnl" | "letter";
  orderNumber: string;
  trackingCode?: string | null;
  weightG?: number | null;
  shipDate: string;
  to: Address;
  from: Address | null;
  lines?: { sku: string; qty: number }[];
  simulated: boolean;
};

const ANTHRACITE = rgb(15 / 255, 41 / 255, 55 / 255);
const BLUE = rgb(0, 102 / 255, 1);

function addressLines(a: Address | null): string[] {
  if (!a) return [];
  return [
    a.name ?? "",
    [a.street, a.house_number].filter(Boolean).join(" "),
    a.address_extra ?? "",
    [a.postal_code, a.city].filter(Boolean).join("  "),
    a.country && a.country !== "NL" ? a.country : "",
  ].filter((l) => l.trim() !== "");
}

function senderComplete(a: Address | null) {
  return !!(a && a.name && a.street && a.house_number && a.postal_code && a.city);
}

/** pdf-lib's standaardfonts gebruiken WinAnsi; vervang tekens die daarbuiten vallen. */
function safe(text: string) {
  return text.replace(/[–—]/g, "-").replace(/[^\x20-\x7E -ÿ]/g, "?");
}

function draw(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color = ANTHRACITE) {
  page.drawText(safe(text), { x, y, size, font, color });
}

function barcode(page: PDFPage, code: string, x: number, y: number, w: number, h: number) {
  // Pseudo-streepjescode voor voorbeeldlabels: deterministisch uit de code, niet scanbaar als vervoerderscode.
  let seed = 0;
  for (const ch of code) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  let cx = x;
  while (cx < x + w) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const bw = 0.8 + (seed % 4) * 0.7;
    if ((seed >> 3) % 2 === 0) page.drawRectangle({ x: cx, y, width: bw, height: h, color: ANTHRACITE });
    cx += bw + 0.9;
  }
}

export async function renderLabel(input: LabelInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Label ${input.orderNumber}`);
  pdf.setProducer("Timber Online");
  const page = pdf.addPage([LABEL_W, LABEL_H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const m = 8 * MM;
  let y = LABEL_H - m;

  page.drawRectangle({ x: 3 * MM, y: 3 * MM, width: LABEL_W - 6 * MM, height: LABEL_H - 6 * MM, borderColor: ANTHRACITE, borderWidth: 1 });

  if (input.carrier === "letter") {
    draw(page, "BRIEFPOST", m, y - 14, 16, bold);
    draw(page, "Handmatig frankeren", m, y - 28, 9, regular);
    page.drawRectangle({ x: LABEL_W - m - 22 * MM, y: y - 26 * MM, width: 22 * MM, height: 26 * MM, borderColor: ANTHRACITE, borderWidth: 0.8, borderDashArray: [3, 2] });
    draw(page, "Postzegel", LABEL_W - m - 19 * MM, y - 14 * MM, 7, regular);
    y -= 34 * MM;
  } else {
    const name = input.carrier === "dhl" ? "DHL" : "PostNL";
    draw(page, name, m, y - 18, 20, bold);
    draw(page, input.carrier === "dhl" ? "Parcel NL - brievenbus/pakket" : "Pakket met track & trace", m, y - 31, 8, regular);
    if (input.simulated) {
      page.drawRectangle({ x: m, y: y - 52, width: LABEL_W - 2 * m, height: 16, color: rgb(1, 0.95, 0.88) });
      draw(page, "VOORBEELDLABEL - NIET GELDIG VOOR VERZENDING", m + 4, y - 47, 7.5, bold, rgb(0.33, 0.22, 0));
    }
    y -= 62;
  }

  draw(page, "AAN", m, y, 7, bold, BLUE);
  y -= 14;
  for (const line of addressLines(input.to)) {
    draw(page, line, m, y, 12, bold);
    y -= 15;
  }

  y -= 6;
  draw(page, "AFZENDER", m, y, 7, bold, BLUE);
  y -= 11;
  if (senderComplete(input.from)) {
    for (const line of addressLines(input.from)) {
      draw(page, line, m, y, 8, regular);
      y -= 10;
    }
  } else {
    draw(page, "Afzenderadres nog niet ingesteld", m, y, 8, bold, rgb(0.7, 0.1, 0.1));
    y -= 10;
  }

  if (input.carrier !== "letter" && input.trackingCode) {
    const bh = 22 * MM;
    barcode(page, input.trackingCode, m, 16 * MM, LABEL_W - 2 * m, bh);
    draw(page, input.trackingCode, m, 11 * MM, 10, bold);
  }
  const meta = [`Order ${input.orderNumber}`, input.shipDate, input.weightG ? `${input.weightG} g` : ""].filter(Boolean).join("  |  ");
  draw(page, meta, m, 6 * MM, 7, regular);

  return pdf.save();
}

/** Combineert labels tot één printbare PDF (bijv. alle zendingen van één verzenddag). */
export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle("Labels");
  for (const bytes of files) {
    const src = await PDFDocument.load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out.save();
}

/** Zet een geüploade PNG/JPG om naar een PDF-pagina zodat ook die in de dag-PDF past. */
export async function imageToPdf(bytes: Uint8Array, type: "image/png" | "image/jpeg"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const img = type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const scale = Math.min(LABEL_W / img.width, LABEL_H / img.height);
  const page = pdf.addPage([LABEL_W, LABEL_H]);
  page.drawImage(img, { x: (LABEL_W - img.width * scale) / 2, y: (LABEL_H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  return pdf.save();
}
