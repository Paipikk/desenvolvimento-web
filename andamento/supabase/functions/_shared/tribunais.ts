// Tribunais atendidos pela API pública do Datajud (CNJ) e o "alias" de cada um.
// Endpoint: https://api-publica.datajud.cnj.jus.br/{alias}/_search
// Arquivo puro (sem imports), usado pelas edge functions e pelo frontend.

export type Tribunal = {
  sigla: string; // como o advogado conhece: TJRS, TRT4, TRF4, TRE-SP...
  nome: string;
  alias: string; // api_publica_tjrs
  grupo: "Estadual" | "Trabalho" | "Federal" | "Eleitoral" | "Militar" | "Superior";
};

// Ordem oficial das UFs no código TR para Justiça Estadual (J=8) e Eleitoral (J=6)
const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO",
];

const NOMES_UF: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal e Territórios", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba",
  PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SE: "Sergipe",
  SP: "São Paulo", TO: "Tocantins",
};

function montarLista(): Tribunal[] {
  const lista: Tribunal[] = [];

  for (const uf of UFS) {
    const sigla = uf === "DF" ? "TJDFT" : `TJ${uf}`;
    lista.push({
      sigla,
      nome: `Tribunal de Justiça — ${NOMES_UF[uf]}`,
      alias: `api_publica_${sigla.toLowerCase()}`,
      grupo: "Estadual",
    });
  }
  for (let i = 1; i <= 24; i++) {
    lista.push({
      sigla: `TRT${i}`,
      nome: `Tribunal Regional do Trabalho da ${i}ª Região`,
      alias: `api_publica_trt${i}`,
      grupo: "Trabalho",
    });
  }
  for (let i = 1; i <= 6; i++) {
    lista.push({
      sigla: `TRF${i}`,
      nome: `Tribunal Regional Federal da ${i}ª Região`,
      alias: `api_publica_trf${i}`,
      grupo: "Federal",
    });
  }
  for (const uf of UFS) {
    lista.push({
      sigla: `TRE-${uf}`,
      nome: `Tribunal Regional Eleitoral — ${NOMES_UF[uf]}`,
      alias: `api_publica_tre-${uf === "DF" ? "dft" : uf.toLowerCase()}`,
      grupo: "Eleitoral",
    });
  }
  lista.push(
    { sigla: "TJMMG", nome: "Tribunal de Justiça Militar — MG", alias: "api_publica_tjmmg", grupo: "Militar" },
    { sigla: "TJMRS", nome: "Tribunal de Justiça Militar — RS", alias: "api_publica_tjmrs", grupo: "Militar" },
    { sigla: "TJMSP", nome: "Tribunal de Justiça Militar — SP", alias: "api_publica_tjmsp", grupo: "Militar" },
    { sigla: "STJ", nome: "Superior Tribunal de Justiça", alias: "api_publica_stj", grupo: "Superior" },
    { sigla: "TST", nome: "Tribunal Superior do Trabalho", alias: "api_publica_tst", grupo: "Superior" },
    { sigla: "TSE", nome: "Tribunal Superior Eleitoral", alias: "api_publica_tse", grupo: "Superior" },
    { sigla: "STM", nome: "Superior Tribunal Militar", alias: "api_publica_stm", grupo: "Superior" },
  );
  return lista;
}

export const TRIBUNAIS: Tribunal[] = montarLista();

const POR_SIGLA = new Map(TRIBUNAIS.map((t) => [t.sigla, t]));

export function normalizarSigla(sigla: string): string {
  const s = (sigla ?? "").toUpperCase().replace(/\s/g, "");
  // Aceita variações comuns: "TJDF" -> "TJDFT", "TRESP" -> "TRE-SP"
  if (s === "TJDF") return "TJDFT";
  const tre = s.match(/^TRE-?([A-Z]{2})$/);
  if (tre) return `TRE-${tre[1]}`;
  return s;
}

export function buscarTribunal(sigla: string): Tribunal | undefined {
  return POR_SIGLA.get(normalizarSigla(sigla));
}

export function aliasDatajud(sigla: string): string | null {
  return buscarTribunal(sigla)?.alias ?? null;
}

// Descobre o tribunal a partir dos segmentos J e TR do número CNJ.
// Retorna null quando não dá para inferir com segurança.
export function tribunalPeloNumero(numero20: string): string | null {
  const d = (numero20 ?? "").replace(/\D/g, "");
  if (d.length !== 20) return null;
  const j = d[13];
  const tr = Number(d.slice(14, 16));

  switch (j) {
    case "3": // STJ
      return "STJ";
    case "4": // Federal
      return tr >= 1 && tr <= 6 ? `TRF${tr}` : null;
    case "5": // Trabalho
      if (tr === 0) return "TST";
      return tr >= 1 && tr <= 24 ? `TRT${tr}` : null;
    case "6": // Eleitoral
      if (tr === 0) return "TSE";
      return tr >= 1 && tr <= 27 ? `TRE-${UFS[tr - 1]}` : null;
    case "7": // Militar da União
      return "STM";
    case "8": { // Estadual
      if (tr < 1 || tr > 27) return null;
      const uf = UFS[tr - 1];
      return uf === "DF" ? "TJDFT" : `TJ${uf}`;
    }
    case "9": // Militar estadual
      if (tr === 13) return "TJMMG";
      if (tr === 21) return "TJMRS";
      if (tr === 26) return "TJMSP";
      return null;
    default:
      return null;
  }
}
