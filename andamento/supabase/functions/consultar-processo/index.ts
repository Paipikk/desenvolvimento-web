// Botão "Consultar agora": consulta um processo do escritório no Datajud.
import { corsHeaders, erro, json } from "../_shared/cors.ts";
import { clienteAdmin, clienteUsuario, usuarioLogado } from "../_shared/supabase.ts";
import { sincronizarProcesso } from "../_shared/sincronizar.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return erro("Método não permitido", 405);

  const usuario = await usuarioLogado(req);
  if (!usuario) return erro("Faça login novamente.", 401);

  const { processo_id } = await req.json().catch(() => ({}));
  if (typeof processo_id !== "string") return erro("Informe processo_id.");

  // Confere, com RLS, se o processo é do escritório do usuário
  const { data: proc } = await clienteUsuario(req)
    .from("processos").select("id").eq("id", processo_id).maybeSingle();
  if (!proc) return erro("Processo não encontrado.", 404);

  const resultado = await sincronizarProcesso(clienteAdmin(), processo_id, "manual");
  return json(resultado, resultado.sucesso ? 200 : 502);
});
