// Teste manual da integração com o Datajud: consulta um número qualquer
// e devolve as movimentações, SEM gravar nada.
import { corsHeaders, erro, json } from "../_shared/cors.ts";
import { usuarioLogado } from "../_shared/supabase.ts";
import { consultarDatajud, ErroDatajud } from "../_shared/datajud.ts";
import { validarCnj } from "../_shared/cnj.ts";
import { aliasDatajud, tribunalPeloNumero } from "../_shared/tribunais.ts";
import { classificarPorRegra } from "../_shared/relevancia.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return erro("Método não permitido", 405);

  const usuario = await usuarioLogado(req);
  if (!usuario) return erro("Faça login novamente.", 401);

  const corpo = await req.json().catch(() => ({}));
  const validacao = validarCnj(String(corpo.numero ?? ""));
  if (!validacao.valido) return erro(validacao.erro);

  const tribunal = String(corpo.tribunal || tribunalPeloNumero(validacao.numero) || "");
  const alias = aliasDatajud(tribunal);
  if (!alias) return erro("Tribunal não reconhecido. Informe a sigla (ex.: TJRS, TRT4, TRF4).");

  const inicio = Date.now();
  try {
    const r = await consultarDatajud(validacao.numero, tribunal);
    return json({
      tribunal,
      endpoint: `https://api-publica.datajud.cnj.jus.br/${alias}/_search`,
      duracao_ms: Date.now() - inicio,
      encontrado: r.encontrado,
      classe: r.classe,
      orgao_julgador: r.orgaoJulgador,
      total_movimentos: r.movimentos.length,
      movimentos: r.movimentos.slice(-30).reverse().map((m) => ({
        ...m,
        relevancia: classificarPorRegra(m.nome, m.complemento, m.codigo),
      })),
    });
  } catch (e) {
    const msg = e instanceof ErroDatajud ? e.message : String(e);
    return json({ erro: msg, tribunal, endpoint: `https://api-publica.datajud.cnj.jus.br/${alias}/_search` }, 502);
  }
});
