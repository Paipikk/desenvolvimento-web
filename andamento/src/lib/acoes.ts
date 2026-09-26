import { chamarFuncao } from "./supabase";
import type { ResultadoSincronizacao } from "./tipos";

export async function consultarProcesso(processoId: string): Promise<ResultadoSincronizacao> {
  return chamarFuncao<ResultadoSincronizacao>("consultar-processo", { processo_id: processoId });
}

export function resumoConsulta(r: ResultadoSincronizacao): string {
  if (!r.sucesso) return r.erro ?? "Não foi possível consultar.";
  if (r.novas === 0) return "Consulta feita. Nenhuma novidade.";
  const msgs = r.mensagens > 0 ? ` ${r.mensagens} mensagem(ns) na fila para revisar.` : "";
  return `${r.novas} movimentação(ões) nova(s).${msgs}`;
}
