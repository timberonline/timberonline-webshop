/**
 * Back-up en herstel van Supabase Storage (productfoto's; optioneel verzendlabels).
 *   npx tsx scripts/backup/storage.ts backup  <map> [bucket]
 *   npx tsx scripts/backup/storage.ts restore <map> [bucket]
 * Vereist NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in de omgeving.
 * Let op: verzendlabels bevatten adresgegevens; bewaar die back-up versleuteld en niet langer dan nodig.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [mode, dir, bucket = "product-images"] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!mode || !dir || !url || !key) {
  console.error("Gebruik: storage.ts backup|restore <map> [bucket]  (met Supabase-omgevingsvariabelen)");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function list(prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const f of data ?? []) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.id) out.push(p);
    else out.push(...(await list(p)));
  }
  return out;
}

async function walk(d: string, base = d): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(path.relative(base, p));
  }
  return out;
}

const target = path.join(dir, bucket);
if (mode === "backup") {
  const files = await list();
  for (const f of files) {
    const { data, error } = await sb.storage.from(bucket).download(f);
    if (error || !data) throw error ?? new Error(f);
    await mkdir(path.dirname(path.join(target, f)), { recursive: true });
    await writeFile(path.join(target, f), Buffer.from(await data.arrayBuffer()));
  }
  console.log(`${files.length} bestanden uit ${bucket} opgeslagen in ${target}`);
} else if (mode === "restore") {
  const files = await walk(target);
  for (const f of files) {
    const type = f.endsWith(".png") ? "image/png" : f.endsWith(".webp") ? "image/webp" : f.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
    const { error } = await sb.storage.from(bucket).upload(f.split(path.sep).join("/"), await readFile(path.join(target, f)), { contentType: type, upsert: true });
    if (error) throw error;
  }
  console.log(`${files.length} bestanden teruggezet in ${bucket}`);
}
