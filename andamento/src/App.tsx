import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { supabaseConfigurado } from "./lib/supabase";
import Layout from "./components/Layout";
import { Carregando } from "./components/ui";
import Entrar from "./pages/Entrar";
import Painel from "./pages/Painel";
import Clientes from "./pages/Clientes";
import ClienteDetalhe from "./pages/ClienteDetalhe";
import Processos from "./pages/Processos";
import ProcessoDetalhe from "./pages/ProcessoDetalhe";
import Fila from "./pages/Fila";
import Configuracoes from "./pages/Configuracoes";

export default function App() {
  const { carregando, sessao, usuario } = useAuth();

  if (!supabaseConfigurado) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-bold">Configuração pendente</h1>
        <p className="mt-2 text-slate-600">
          Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env</code> (veja
          <code> .env.example</code>) e reinicie o servidor.
        </p>
      </div>
    );
  }

  if (carregando) return <Carregando />;

  if (!sessao) {
    return (
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }

  if (!usuario) return <SemPerfil />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Painel />} />
        <Route path="fila" element={<Fila />} />
        <Route path="clientes" element={<Clientes />} />
        <Route path="clientes/:id" element={<ClienteDetalhe />} />
        <Route path="processos" element={<Processos />} />
        <Route path="processos/:id" element={<ProcessoDetalhe />} />
        <Route path="configuracoes" element={<Configuracoes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Logo após o cadastro o perfil pode levar um instante para aparecer.
function SemPerfil() {
  const { recarregar, sair } = useAuth();
  const [demorou, setDemorou] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDemorou(true), 4000);
    const r = setInterval(() => recarregar(), 1500);
    return () => {
      clearTimeout(t);
      clearInterval(r);
    };
  }, [recarregar]);
  if (!demorou) return <Carregando texto="Preparando seu escritório…" />;
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="text-slate-700">Não encontramos o escritório ligado a este acesso.</p>
      <button onClick={sair} className="btn-secundario mt-4">Sair e tentar novamente</button>
    </div>
  );
}
