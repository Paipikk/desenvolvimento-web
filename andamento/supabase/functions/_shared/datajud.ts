// Cliente da API pública do Datajud (CNJ).
// Sempre chamado a partir das edge functions — nunca do navegador.

import { aliasDatajud } from "./tribunais.ts";

const BASE = "https://api-publica.datajud.cnj.jus.br";
const TIMEOUT_MS = 20_000;
const MAX_TENTATIVAS = 3;

export type MovimentoDatajud = {
  codigo: number | null;
  nome: string;
  dataHora: string; // ISO 8601
  complemento: string | null;
};

export type ResultadoDatajud = {
  encontrado: boolean;
  classe: string | null;
  orgaoJulgador: string | null;
  movimentos: MovimentoDatajud[];
};

export class ErroDatajud extends Error {
  constructor(message: string, readonly temporario: boolean) {
    super(message);
  }
}

type ComplementoTabelado = {
  codigo?: number;
  valor?: number | string;
  nome?: string;
  descricao?: string;
};

type MovimentoBruto = {
  codigo?: number;
  nome?: string;
  dataHora?: string;
  complementosTabelados?: ComplementoTabelado[];
};

type HitBruto = {
  _source?: {
    classe?: { nome?: string };
    orgaoJulgador?: { nome?: string };
    movimentos?: MovimentoBruto[];
  };
};

function chaveApi(): string {
  const chave = Deno.env.get("DATAJUD_API_KEY");
  if (!chave) {
    throw new ErroDatajud("DATAJUD_API_KEY não configurada nas variáveis das edge functions.", false);
  }
  return chave;
}

// O Datajud às vezes devolve "2023-05-10T14:32:11.000Z" e às vezes "20230510143211".
export function normalizarDataHora(valor: string | undefined): string | null {
  if (!valor) return null;
  const compacto = valor.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compacto) {
    const [, a, m, d, h, mi, s] = compacto;
    // Sem fuso: o CNJ publica no horário de Brasília
    return new Date(`${a}-${m}-${d}T${h}:${mi}:${s}-03:00`).toISOString();
  }
  const temFuso = /([zZ]|[+-]\d{2}:?\d{2})$/.test(valor);
  const data = new Date(temFuso ? valor : `${valor}-03:00`);
  return isNaN(data.getTime()) ? null : data.toISOString();
}

function montarComplemento(lista: ComplementoTabelado[] | undefined): string | null {
  if (!lista?.length) return null;
  const partes = lista
    .map((c) => {
      const desc = c.descricao?.replace(/_/g, " ").trim();
      const nome = c.nome?.trim();
      if (desc && nome) return `${desc}: ${nome}`;
      return nome || desc || null;
    })
    .filter(Boolean);
  return partes.length ? partes.join("; ") : null;
}

function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function consultarDatajud(numeroCnj: string, siglaTribunal: string): Promise<ResultadoDatajud> {
  const alias = aliasDatajud(siglaTribunal);
  if (!alias) {
    throw new ErroDatajud(`Tribunal "${siglaTribunal}" não é atendido pela API do Datajud.`, false);
  }
  const numero = numeroCnj.replace(/\D/g, "");
  const url = `${BASE}/${alias}/_search`;
  const corpo = JSON.stringify({ query: { match: { numeroProcesso: numero } } });

  let ultimoErro: ErroDatajud | null = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `APIKey ${chaveApi()}`,
          "Content-Type": "application/json",
        },
        body: corpo,
        signal: controle.signal,
      });

      if (resp.status === 429 || resp.status >= 500) {
        const retryAfter = Number(resp.headers.get("retry-after"));
        ultimoErro = new ErroDatajud(
          resp.status === 429
            ? "Limite de consultas do Datajud atingido. Tentaremos novamente mais tarde."
            : `Datajud indisponível no momento (erro ${resp.status}).`,
          true,
        );
        await resp.body?.cancel();
        if (tentativa < MAX_TENTATIVAS) {
          const espera = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15_000)
            : 1000 * 2 ** tentativa;
          await esperar(espera);
          continue;
        }
        throw ultimoErro;
      }

      if (resp.status === 401 || resp.status === 403) {
        await resp.body?.cancel();
        throw new ErroDatajud(
          "A chave pública do Datajud foi recusada. O CNJ pode ter trocado a chave — atualize DATAJUD_API_KEY.",
          false,
        );
      }

      if (!resp.ok) {
        const texto = await resp.text();
        throw new ErroDatajud(`Datajud respondeu ${resp.status}: ${texto.slice(0, 200)}`, false);
      }

      const json = await resp.json();
      const hits: HitBruto[] = json?.hits?.hits ?? [];
      if (!hits.length) {
        return { encontrado: false, classe: null, orgaoJulgador: null, movimentos: [] };
      }

      // Um mesmo número pode ter mais de um registro (ex.: 1º e 2º grau). Juntamos todos.
      const movimentos: MovimentoDatajud[] = [];
      for (const hit of hits) {
        for (const m of hit._source?.movimentos ?? []) {
          const dataHora = normalizarDataHora(m.dataHora);
          if (!m.nome || !dataHora) continue;
          movimentos.push({
            codigo: typeof m.codigo === "number" ? m.codigo : null,
            nome: m.nome.trim(),
            dataHora,
            complemento: montarComplemento(m.complementosTabelados),
          });
        }
      }
      movimentos.sort((a, b) => a.dataHora.localeCompare(b.dataHora));

      const fonte = hits[0]._source;
      return {
        encontrado: true,
        classe: fonte?.classe?.nome ?? null,
        orgaoJulgador: fonte?.orgaoJulgador?.nome ?? null,
        movimentos,
      };
    } catch (e) {
      if (e instanceof ErroDatajud) throw e;
      const abortado = e instanceof DOMException && e.name === "AbortError";
      ultimoErro = new ErroDatajud(
        abortado ? "O Datajud demorou demais para responder." : `Falha de conexão com o Datajud: ${String(e)}`,
        true,
      );
      if (tentativa < MAX_TENTATIVAS) {
        await esperar(1000 * 2 ** tentativa);
        continue;
      }
      throw ultimoErro;
    } finally {
      clearTimeout(timer);
    }
  }

  throw ultimoErro ?? new ErroDatajud("Falha desconhecida ao consultar o Datajud.", true);
}

export async function hashMovimento(m: MovimentoDatajud): Promise<string> {
  const base = [m.codigo ?? "", m.dataHora, m.nome, m.complemento ?? ""].join("|");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
