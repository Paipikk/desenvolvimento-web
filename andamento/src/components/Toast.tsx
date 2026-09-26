import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tipo = "sucesso" | "erro" | "info";
type Aviso = { id: number; texto: string; tipo: Tipo };

const Contexto = createContext<(texto: string, tipo?: Tipo) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const mostrar = useCallback((texto: string, tipo: Tipo = "sucesso") => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === "erro" ? 7000 : 4000);
  }, []);

  const cores: Record<Tipo, string> = {
    sucesso: "bg-marca-700",
    erro: "bg-red-600",
    info: "bg-slate-800",
  };

  return (
    <Contexto.Provider value={mostrar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`pointer-events-auto max-w-md rounded-lg px-4 py-3 text-sm text-white shadow-lg ${cores[a.tipo]}`}>
            {a.texto}
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

export const useToast = () => useContext(Contexto);
