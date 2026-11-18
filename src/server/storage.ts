import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { createServiceClient } from "./db/supabase";

export type Bucket = "product-images" | "shipping-labels";

export interface Storage {
  put(bucket: Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Uint8Array>;
  publicUrl(bucket: "product-images", key: string): string;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,200}$/;
function checkKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Ongeldig bestandspad");
}

export function createLocalStorage(root = path.join(process.cwd(), ".data", "storage")): Storage {
  return {
    async put(bucket, key, bytes) {
      checkKey(key);
      // Lokale driver (alleen ontwikkeling/tests); niet meenemen in de output-tracing.
      const file = path.join(/*turbopackIgnore: true*/ root, bucket, key);
      await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
      await writeFile(/*turbopackIgnore: true*/ file, bytes);
    },
    async get(bucket, key) {
      checkKey(key);
      return new Uint8Array(await readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root, bucket, key)));
    },
    publicUrl(bucket, key) {
      return `/api/dev-storage/${bucket}/${key}`;
    },
  };
}

export function createSupabaseStorage(url: string, serviceKey: string): Storage {
  const client = createServiceClient(url, serviceKey);
  return {
    async put(bucket, key, bytes, contentType) {
      checkKey(key);
      const { error } = await client.storage.from(bucket).upload(key, bytes, { contentType, upsert: false });
      if (error) throw new Error(`Opslaan mislukt: ${error.message}`);
    },
    async get(bucket, key) {
      checkKey(key);
      const { data, error } = await client.storage.from(bucket).download(key);
      if (error || !data) throw new Error(`Bestand niet gevonden: ${error?.message ?? key}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    publicUrl(bucket, key) {
      return client.storage.from(bucket).getPublicUrl(key).data.publicUrl;
    },
  };
}

let storage: Storage | undefined;
export function getStorage(): Storage {
  if (storage) return storage;
  if (env.storageDriver() === "supabase") {
    const url = env.supabaseUrl();
    const key = env.supabaseServiceKey();
    if (!url || !key) throw new Error("Supabase Storage niet geconfigureerd");
    storage = createSupabaseStorage(url, key);
  } else {
    storage = createLocalStorage();
  }
  return storage;
}

export function productImageUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return getStorage().publicUrl("product-images", key);
}
