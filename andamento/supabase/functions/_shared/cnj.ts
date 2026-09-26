// Validação e formatação do número único de processo (Resolução CNJ 65/2008).
// Formato: NNNNNNN-DD.AAAA.J.TR.OOOO
// Este arquivo é puro (sem imports) e é usado tanto pelas edge functions
// quanto pelo frontend.

export function somenteDigitos(valor: string): string {
  return (valor ?? "").replace(/\D/g, "");
}

// Resto da divisão por 97 de um número grande representado como string.
function mod97(numero: string): number {
  let resto = 0;
  for (const c of numero) {
    resto = (resto * 10 + Number(c)) % 97;
  }
  return resto;
}

export function calcularDigitoVerificador(
  sequencial: string,
  ano: string,
  segmento: string,
  tribunal: string,
  origem: string,
): string {
  const base = `${sequencial}${ano}${segmento}${tribunal}${origem}00`;
  const dv = 98 - mod97(base);
  return String(dv).padStart(2, "0");
}

export type PartesCnj = {
  sequencial: string; // NNNNNNN
  digito: string; // DD
  ano: string; // AAAA
  segmento: string; // J
  tribunal: string; // TR
  origem: string; // OOOO
};

export function partesCnj(numero: string): PartesCnj | null {
  const d = somenteDigitos(numero);
  if (d.length !== 20) return null;
  return {
    sequencial: d.slice(0, 7),
    digito: d.slice(7, 9),
    ano: d.slice(9, 13),
    segmento: d.slice(13, 14),
    tribunal: d.slice(14, 16),
    origem: d.slice(16, 20),
  };
}

export type ResultadoValidacao =
  | { valido: true; numero: string }
  | { valido: false; erro: string };

const FORMATO_MASCARA = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;

export function validarCnj(entrada: string): ResultadoValidacao {
  const texto = (entrada ?? "").trim();
  if (!texto) return { valido: false, erro: "Informe o número do processo." };

  // Aceita com máscara (NNNNNNN-DD.AAAA.J.TR.OOOO) ou só os 20 dígitos
  if (/[^\d.\-\s]/.test(texto)) {
    return { valido: false, erro: "O número deve conter apenas dígitos, pontos e traço." };
  }
  const temPontuacao = /[.\-]/.test(texto);
  if (temPontuacao && !FORMATO_MASCARA.test(texto.replace(/\s/g, ""))) {
    return {
      valido: false,
      erro: "Formato inválido. Use NNNNNNN-DD.AAAA.J.TR.OOOO (ex.: 5001234-56.2023.8.21.0001).",
    };
  }

  const p = partesCnj(texto);
  if (!p) {
    return { valido: false, erro: "O número CNJ tem 20 dígitos." };
  }

  const ano = Number(p.ano);
  const anoAtual = new Date().getFullYear();
  if (ano < 1900 || ano > anoAtual + 1) {
    return { valido: false, erro: `Ano do processo (${p.ano}) parece incorreto.` };
  }

  const esperado = calcularDigitoVerificador(p.sequencial, p.ano, p.segmento, p.tribunal, p.origem);
  if (esperado !== p.digito) {
    return {
      valido: false,
      erro: "Dígito verificador não confere. Confira se o número foi digitado corretamente.",
    };
  }

  return { valido: true, numero: somenteDigitos(texto) };
}

export function formatarCnj(numero: string): string {
  const p = partesCnj(numero);
  if (!p) return numero;
  return `${p.sequencial}-${p.digito}.${p.ano}.${p.segmento}.${p.tribunal}.${p.origem}`;
}

// Máscara progressiva para campos de digitação
export function mascararCnj(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 20);
  const cortes: Array<[number, string]> = [
    [7, "-"],
    [9, "."],
    [13, "."],
    [14, "."],
    [16, "."],
  ];
  let saida = "";
  for (let i = 0; i < d.length; i++) {
    saida += d[i];
    const corte = cortes.find(([pos]) => pos === i + 1);
    if (corte && i + 1 < d.length) saida += corte[1];
  }
  return saida;
}
