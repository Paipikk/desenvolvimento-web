import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-marca-700" />
      {texto}
    </div>
  );
}

export function Girando() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

export function EstadoVazio({
  icone = "📂",
  titulo,
  texto,
  acao,
}: {
  icone?: string;
  titulo: string;
  texto?: ReactNode;
  acao?: { rotulo: string; para?: string; onClick?: () => void };
}) {
  return (
    <div className="cartao flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 text-4xl" aria-hidden>{icone}</div>
      <h3 className="text-lg font-semibold text-slate-800">{titulo}</h3>
      {texto && <p className="mt-2 max-w-md text-sm text-slate-600">{texto}</p>}
      {acao &&
        (acao.para ? (
          <Link to={acao.para} className="btn-primario mt-5">{acao.rotulo}</Link>
        ) : (
          <button onClick={acao.onClick} className="btn-primario mt-5">{acao.rotulo}</button>
        ))}
    </div>
  );
}

export function Cabecalho({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-sm text-slate-600">{subtitulo}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

export function Modal({
  aberto,
  titulo,
  onFechar,
  children,
  largura = "max-w-lg",
}: {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
  largura?: string;
}) {
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto, onFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        className={`max-h-[92vh] w-full ${largura} overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button onClick={onFechar} className="btn-texto -mr-2" aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Erro({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div>;
}

export function EtiquetaStatus({ status }: { status: string }) {
  const mapa: Record<string, [string, string]> = {
    pendente: ["Pendente", "bg-amber-100 text-amber-800"],
    aprovada: ["Aprovada", "bg-blue-100 text-blue-800"],
    enviada: ["Enviada", "bg-green-100 text-green-800"],
    ignorada: ["Ignorada", "bg-slate-100 text-slate-600"],
  };
  const [rotulo, cor] = mapa[status] ?? [status, "bg-slate-100"];
  return <span className={`etiqueta ${cor}`}>{rotulo}</span>;
}
