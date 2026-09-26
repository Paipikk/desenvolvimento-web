import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Carregando, EstadoVazio } from "../components/ui";
import { dataHora, tempoRelativo } from "../lib/formato";
import { formatarCnj } from "@shared/cnj";

type UltimaMov = {
  id: string;
  nome: string;
  data_hora: string;
  relevancia: "normal" | "baixa";
  processos: { id: string; apelido: string | null; numero_cnj: string; clientes: { nome: string } | null } | null;
};

type ProcErro = {
  id: string;
  numero_cnj: string;
  apelido: string | null;
  tribunal: string;
  ultimo_erro: string;
  ultima_tentativa: string | null;
  clientes: { nome: string } | null;
};

export default function Painel() {
  const { usuario } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [pendentes, setPendentes] = useState(0);
  const [baixa, setBaixa] = useState(0);
  const [aprovadas, setAprovadas] = useState(0);
  const [totalProcessos, setTotalProcessos] = useState(0);
  const [ultimas, setUltimas] = useState<UltimaMov[]>([]);
  const [comErro, setComErro] = useState<ProcErro[]>([]);

  useEffect(() => {
    (async () => {
      const contar = (status: string, relevancia?: string) => {
        let q = supabase.from("mensagens").select("id", { count: "exact", head: true }).eq("status", status);
        if (relevancia) q = q.eq("relevancia", relevancia);
        return q;
      };
      const [p, b, a, t, u, e] = await Promise.all([
        contar("pendente", "normal"),
        contar("pendente", "baixa"),
        contar("aprovada"),
        supabase.from("processos").select("id", { count: "exact", head: true }).eq("ativo", true),
        supabase
          .from("movimentacoes")
          .select("id, nome, data_hora, relevancia, processos(id, apelido, numero_cnj, clientes(nome))")
          .order("data_hora", { ascending: false })
          .limit(8),
        supabase
          .from("processos")
          .select("id, numero_cnj, apelido, tribunal, ultimo_erro, ultima_tentativa, clientes(nome)")
          .eq("ativo", true)
          .not("ultimo_erro", "is", null)
          .order("ultima_tentativa", { ascending: false })
          .limit(10),
      ]);
      setPendentes(p.count ?? 0);
      setBaixa(b.count ?? 0);
      setAprovadas(a.count ?? 0);
      setTotalProcessos(t.count ?? 0);
      setUltimas((u.data as unknown as UltimaMov[]) ?? []);
      setComErro((e.data as unknown as ProcErro[]) ?? []);
      setCarregando(false);
    })();
  }, []);

  if (carregando) return <Carregando />;

  const primeiroNome = (usuario?.nome ?? "").split(" ")[0];

  if (totalProcessos === 0 && ultimas.length === 0) {
    return (
      <div>
        <h1 className="mb-5 text-2xl font-bold">Olá{primeiroNome ? `, ${primeiroNome}` : ""}!</h1>
        <EstadoVazio
          icone="⚖️"
          titulo="Cadastre seu primeiro processo para começar"
          texto={
            <>
              Todo dia de manhã o Andamento consulta os tribunais. Quando houver novidade, ele escreve uma mensagem
              simples para o cliente e deixa aqui para você aprovar e enviar pelo WhatsApp.
              <br />
              <br />
              Comece cadastrando um cliente e depois o número do processo dele.
            </>
          }
          acao={{ rotulo: "Cadastrar cliente e processo", para: "/clientes?novo=1" }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Olá{primeiroNome ? `, ${primeiroNome}` : ""}!</h1>

      <Link to="/fila" className="cartao flex items-center justify-between gap-4 p-5 transition hover:border-marca-500">
        <div>
          <div className="text-sm text-slate-600">Mensagens para revisar</div>
          <div className="mt-1 text-4xl font-bold text-marca-700">{pendentes}</div>
          <div className="mt-1 text-xs text-slate-500">
            {baixa > 0 && `+ ${baixa} de baixa relevância`}
            {baixa > 0 && aprovadas > 0 && " · "}
            {aprovadas > 0 && `${aprovadas} aprovada(s) aguardando envio`}
          </div>
        </div>
        <span className="btn-primario">{pendentes > 0 ? "Revisar agora" : "Abrir fila"}</span>
      </Link>

      {comErro.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-red-700">Processos com erro na última consulta</h2>
          <div className="cartao divide-y divide-slate-100">
            {comErro.map((p) => (
              <Link key={p.id} to={`/processos/${p.id}`} className="block p-4 hover:bg-slate-50">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{p.apelido || formatarCnj(p.numero_cnj)}</span>
                  <span className="text-xs text-slate-500">{tempoRelativo(p.ultima_tentativa)}</span>
                </div>
                <div className="text-xs text-slate-500">{p.clientes?.nome} · {p.tribunal}</div>
                <div className="mt-1 text-sm text-red-700">{p.ultimo_erro}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Últimas movimentações</h2>
          <Link to="/processos" className="text-sm text-marca-700 hover:underline">Ver processos</Link>
        </div>
        {ultimas.length === 0 ? (
          <EstadoVazio
            icone="🕐"
            titulo="Nenhuma movimentação ainda"
            texto={`Você tem ${totalProcessos} processo(s) ativo(s). As movimentações aparecem aqui depois da primeira consulta — ou use "Consultar agora" na página do processo.`}
          />
        ) : (
          <div className="cartao divide-y divide-slate-100">
            {ultimas.map((m) => (
              <Link key={m.id} to={`/processos/${m.processos?.id}`} className="block p-4 hover:bg-slate-50">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{m.nome}</span>
                  <span className="text-xs text-slate-500">{dataHora(m.data_hora)}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {m.processos?.clientes?.nome} · {m.processos?.apelido || formatarCnj(m.processos?.numero_cnj ?? "")}
                  {m.relevancia === "baixa" && <span className="etiqueta ml-2 bg-slate-100 text-slate-500">baixa relevância</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
