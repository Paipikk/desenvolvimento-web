import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";

// Cliente com service role: ignora RLS. Use SOMENTE depois de verificar
// que o registro pertence ao escritório do usuário (ou na rotina do cron).
export function clienteAdmin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cliente com o token do usuário: respeita RLS.
export function clienteUsuario(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Usuario = { id: string; escritorio_id: string };

// Retorna o usuário logado e seu escritório, ou null se não autenticado.
export async function usuarioLogado(req: Request): Promise<Usuario | null> {
  const sb = clienteUsuario(req);
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return null;
  const { data } = await sb.from("usuarios").select("id, escritorio_id").eq("id", auth.user.id).maybeSingle();
  return data ?? null;
}
