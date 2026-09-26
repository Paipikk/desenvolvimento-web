import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Escritorio, Usuario } from "./tipos";

type Estado = {
  carregando: boolean;
  sessao: Session | null;
  usuario: Usuario | null;
  escritorio: Escritorio | null;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
};

const Contexto = createContext<Estado | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [escritorio, setEscritorio] = useState<Escritorio | null>(null);

  const carregarPerfil = useCallback(async (s: Session | null) => {
    if (!s) {
      setUsuario(null);
      setEscritorio(null);
      return;
    }
    const { data: u } = await supabase
      .from("usuarios")
      .select("id, escritorio_id, nome, email, papel")
      .eq("id", s.user.id)
      .maybeSingle();
    setUsuario(u ?? null);
    if (u) {
      const { data: e } = await supabase
        .from("escritorios")
        .select("id, nome, oab_responsavel, telefone, assinatura, horario_consulta")
        .eq("id", u.escritorio_id)
        .maybeSingle();
      setEscritorio(e ?? null);
    }
  }, []);

  useEffect(() => {
    let ativo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!ativo) return;
      setSessao(data.session);
      await carregarPerfil(data.session);
      setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSessao(s);
      if (evento === "SIGNED_IN" || evento === "SIGNED_OUT" || evento === "USER_UPDATED") {
        // fora do callback para não travar o cliente do Supabase
        setTimeout(() => carregarPerfil(s), 0);
      }
    });
    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, [carregarPerfil]);

  const recarregar = useCallback(() => carregarPerfil(sessao), [carregarPerfil, sessao]);
  const sair = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <Contexto.Provider value={{ carregando, sessao, usuario, escritorio, recarregar, sair }}>
      {children}
    </Contexto.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
