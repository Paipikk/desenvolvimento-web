import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

const ITENS = [
  { para: "/", rotulo: "Início", icone: "🏠", fim: true },
  { para: "/fila", rotulo: "Mensagens", icone: "💬" },
  { para: "/processos", rotulo: "Processos", icone: "⚖️" },
  { para: "/clientes", rotulo: "Clientes", icone: "👥" },
  { para: "/configuracoes", rotulo: "Ajustes", icone: "⚙️" },
];

function usePendentes() {
  const [n, setN] = useState(0);
  const local = useLocation();
  useEffect(() => {
    supabase
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("status", "pendente")
      .eq("relevancia", "normal")
      .then(({ count }) => setN(count ?? 0));
  }, [local.pathname]);
  return n;
}

export default function Layout() {
  const { escritorio, usuario, sair } = useAuth();
  const pendentes = usePendentes();

  const classe = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
      isActive ? "bg-marca-50 text-marca-800" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div className="min-h-full md:flex">
      {/* Menu lateral (computador) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 px-2">
          <div className="text-xl font-bold text-marca-700">Andamento</div>
          <div className="truncate text-xs text-slate-500">{escritorio?.nome}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {ITENS.map((i) => (
            <NavLink key={i.para} to={i.para} end={i.fim} className={classe}>
              <span aria-hidden>{i.icone}</span>
              <span className="flex-1">{i.rotulo}</span>
              {i.para === "/fila" && pendentes > 0 && (
                <span className="etiqueta bg-amber-500 text-white">{pendentes}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 pt-3 text-xs text-slate-500">
          <div className="truncate px-2">{usuario?.nome || usuario?.email}</div>
          <button onClick={sair} className="btn-texto mt-1 w-full justify-start text-xs">Sair</button>
        </div>
      </aside>

      {/* Topo (celular) */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <div>
          <div className="font-bold text-marca-700">Andamento</div>
          <div className="max-w-[60vw] truncate text-xs text-slate-500">{escritorio?.nome}</div>
        </div>
        <button onClick={sair} className="btn-texto text-xs">Sair</button>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
        <Outlet />
      </main>

      {/* Barra inferior (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {ITENS.map((i) => (
          <NavLink
            key={i.para}
            to={i.para}
            end={i.fim}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? "text-marca-700" : "text-slate-500"}`
            }
          >
            <span className="text-lg" aria-hidden>{i.icone}</span>
            {i.rotulo}
            {i.para === "/fila" && pendentes > 0 && (
              <span className="absolute right-3 top-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                {pendentes}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
