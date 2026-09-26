export function somenteDigitos(v: string) {
  return (v ?? "").replace(/\D/g, "");
}

// Guarda o telefone só com dígitos, sem o 55 do país: DDD + número
export function normalizarTelefone(v: string): string {
  let d = somenteDigitos(v);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d;
}

export function telefoneValido(v: string): boolean {
  const d = normalizarTelefone(v);
  return d.length === 10 || d.length === 11;
}

export function formatarTelefone(v: string): string {
  const d = normalizarTelefone(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export function data(iso: string | null | undefined) {
  return iso ? fmtData.format(new Date(iso)) : "—";
}
export function dataHora(iso: string | null | undefined) {
  return iso ? fmtDataHora.format(new Date(iso)) : "—";
}

export function tempoRelativo(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `há ${d} dias`;
  return data(iso);
}

// Link do WhatsApp (wa.me). O envio é sempre manual nesta versão.
export function linkWhatsapp(telefone: string, texto: string): string {
  return `https://wa.me/55${normalizarTelefone(telefone)}?text=${encodeURIComponent(texto)}`;
}
