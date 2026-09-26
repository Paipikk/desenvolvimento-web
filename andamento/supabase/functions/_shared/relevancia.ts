// Classificação de relevância das movimentações para o CLIENTE.
// Movimentações puramente burocráticas vão para a aba "Baixa relevância"
// da fila, em vez do topo. A regra fixa abaixo tem a palavra final quando
// é categórica; nos casos "indefinidos", vale a opinião da IA.

export type ClassificacaoRegra = "alta" | "baixa" | "indefinida";

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Termos que indicam algo que o cliente quer saber.
const TERMOS_ALTA = [
  "sentenca", "julgad", "julgamento", "procedente", "improcedente", "acordao",
  "transito em julgado", "tutela", "liminar", "audiencia", "pericia", "penhora",
  "bloqueio", "desbloqueio", "alvara", "pagamento", "levantamento", "acordo",
  "homologa", "extincao", "arquivamento definitivo", "baixa definitiva",
  "citacao", "provimento", "recurso", "embargos", "suspensao", "sessao de julgamento",
  "pauta", "requisicao de pequeno valor", "precatorio", "rpv", "leilao", "hasta",
  "mandado de levantamento", "cumprimento de sentenca", "revelia", "desistencia",
];

// Termos de movimentações burocráticas (andamento interno do cartório).
const TERMOS_BAIXA = [
  "conclus", "juntada", "expedicao de certidao", "expedicao de documento",
  "certidao", "remessa", "recebimento", "recebidos os autos", "ato ordinatorio",
  "mero expediente", "disponibilizacao no diario", "disponibilizado no dje",
  "publicacao", "publicado", "decurso de prazo", "retificacao", "autuacao",
  "evolucao da classe", "mudanca de classe", "entrega em carga", "carga",
  "devolucao dos autos", "protocolo de peticao", "peticao", "documento",
  "registrado", "cancelamento da distribuicao", "redistribuicao",
  "processo importado", "confirmada a comunicacao", "leitura de intimacao",
  "decorrido prazo", "expedicao de intimacao", "expedicao de mandado",
];

// Códigos TPU (Tabela Processual Unificada) tipicamente burocráticos.
const CODIGOS_BAIXA = new Set<number>([
  51, // Conclusão
  85, // Juntada de petição
  581, // Juntada de documento
  60, // Expedição de documento
  123, // Remessa
  132, // Recebimento
  11383, // Ato ordinatório
  11010, // Mero expediente
  1061, // Disponibilização no Diário da Justiça Eletrônico
  92, // Publicação
  1051, // Decurso de prazo
  12164, // Outros documentos
]);

// Movimentações que são sempre burocráticas, mesmo que o complemento cite
// algo importante (ex.: "Conclusos para julgamento", "Juntada de recurso").
const PREFIXOS_SEMPRE_BAIXA = [
  "conclus", "juntada", "remessa", "recebimento", "recebidos",
  "certidao", "ato ordinatorio", "mero expediente", "decorrido prazo", "decurso de prazo", "confirmada a comunicacao", "carga",
];

export function classificarPorRegra(nome: string, complemento: string | null, codigo: number | null): ClassificacaoRegra {
  const nomeNorm = normalizar(nome).trim();
  const texto = normalizar(`${nome} ${complemento ?? ""}`);

  if (PREFIXOS_SEMPRE_BAIXA.some((p) => nomeNorm.startsWith(p))) return "baixa";
  if (TERMOS_ALTA.some((t) => texto.includes(t))) return "alta";
  if (codigo !== null && CODIGOS_BAIXA.has(codigo)) return "baixa";
  if (TERMOS_BAIXA.some((t) => nomeNorm.includes(t))) return "baixa";
  return "indefinida";
}

export function relevanciaFinal(regra: ClassificacaoRegra, ia: "normal" | "baixa" | null): "normal" | "baixa" {
  if (regra === "alta") return "normal";
  if (regra === "baixa") return "baixa";
  return ia ?? "normal";
}
