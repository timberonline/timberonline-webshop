import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

export async function createAuthClient() {
  const url = env.supabaseUrl();
  const key = env.supabaseAnonKey();
  if (!url || !key) return null;
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // In Server Components kunnen cookies niet worden gezet; de proxy ververst de sessie.
        }
      },
    },
  });
}
