import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigurado = Boolean(url && chave);

export const supabase = createClient(url ?? "http://localhost", chave ?? "sem-chave", {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Chama uma edge function e devolve o JSON; lança Error com a mensagem em português.
export async function chamarFuncao<T>(nome: string, corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo });
  if (error) {
    let mensagem = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = await ctx.json();
        if (j?.erro) mensagem = j.erro;
        else if (j) return j as T; // respostas 502 do sincronizador trazem o resultado
      } catch {
        /* sem corpo JSON */
      }
    }
    throw new Error(mensagem);
  }
  return data as T;
}
