import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Processo } from "../lib/tipos";
import { Cabecalho, Carregando, EstadoVazio, Modal } from "../components/ui";
import ProcessoForm from "../components/ProcessoForm";
import { tempoRelativo } from "../lib/formato";
import { formatarCnj } from "@shared/cnj";

type ProcessoLista = Processo & { clientes: { id: string; nome: string } | null };

export default function Processos() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const [processos, setProcessos] = useState<ProcessoLista[] | null>(null);
  const [temClientes, setTemClientes] = useState(true);
  const filtroCliente = params.get("cliente") ?? "";
  const filtroTribunal = params.get("tribunal") ?? "";
  const filtroSituacao = params.get("situacao") ?? "ativos";
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);

  useEffect(() => {
    supabase
      .from("processos")
      .select("*, clientes(id, nome)")
      .order("criado_em", { ascending: false })
      .then(({ data }) => setProcessos((data as ProcessoLista[]) ?? []));
    supabase.from("clientes").select("id", { count: "exact", head: true }).then(({ count }) => setTemClientes((count ?? 0) > 0));
  }, []);

  const clientes = useMemo(() => {
    const mapa = new Map<string, string>();
    processos?.forEach((p) => p.clientes && mapa.set(p.clientes.id, p.clientes.nome));
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [processos]);
  const tribunais = useMemo(() => [...new Set(processos?.map((p) => p.tribunal))].sort(), [processos]);

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const dig = busca.replace(/\D/g, "");
    return (processos ?? []).filter((p) => {
      if (filtroCliente && p.cliente_id !== filtroCliente) return false;
      if (filtroTribunal && p.tribunal !== filtroTribunal) return false;
      if (filtroSituacao === "ativos" && !p.ativo) return false;
      if (filtroSituacao === "pausados" && p.ativo) return false;
      if (filtroSituacao === "erro" && !p.ultimo_erro) return false;
      if (b && !(p.apelido?.toLowerCase().includes(b) || (dig.length >= 4 && p.numero_cnj.includes(dig)) || p.clientes?.nome.toLowerCase().includes(b)))
        return false;
      return true;
    });
  }, [processos, filtroCliente, filtroTribunal, filtroSituacao, busca]);

  const setFiltro = (chave: string, valor: string) => {
    const n = new URLSearchParams(params);
    if (valor) n.set(chave, valor);
    else n.delete(chave);
    setParams(n, { replace: true });
  };

  return (
    <div>
      <Cabecalho
        titulo="Processos"
        subtitulo={processos ? `${processos.filter((p) => p.ativo).length} em acompanhamento` : undefined}
        acoes={temClientes && <button className="btn-primario" onClick={() => setNovo(true)}>+ Novo processo</button>}
      />

      {processos === null ? (
        <Carregando />
      ) : processos.length === 0 ? (
        temClientes ? (
          <EstadoVazio
            icone="⚖️"
            titulo="Cadastre seu primeiro processo para começar"
            texto="Informe o número CNJ e o tribunal. O Andamento consulta o Datajud (CNJ) todos os dias e avisa quando houver novidade."
            acao={{ rotulo: "Cadastrar processo", onClick: () => setNovo(true) }}
          />
        ) : (
          <EstadoVazio
            icone="👥"
            titulo="Primeiro, cadastre um cliente"
            texto="Todo processo pertence a um cliente — é para o WhatsApp dele que as novidades serão enviadas."
            acao={{ rotulo: "Cadastrar cliente", para: "/clientes?novo=1" }}
          />
        )
      ) : (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-4">
            <input type="search" className="campo sm:col-span-4" placeholder="Buscar por apelido, número ou cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select className="campo" value={filtroCliente} onChange={(e) => setFiltro("cliente", e.target.value)} aria-label="Filtrar por cliente">
              <option value="">Todos os clientes</option>
              {clientes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </select>
            <select className="campo" value={filtroTribunal} onChange={(e) => setFiltro("tribunal", e.target.value)} aria-label="Filtrar por tribunal">
              <option value="">Todos os tribunais</option>
              {tribunais.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="campo" value={filtroSituacao} onChange={(e) => setFiltro("situacao", e.target.value === "ativos" ? "" : e.target.value)} aria-label="Situação">
              <option value="ativos">Em acompanhamento</option>
              <option value="erro">Com erro</option>
              <option value="pausados">Pausados</option>
              <option value="todos">Todos</option>
            </select>
          </div>

          {filtrados.length === 0 ? (
            <p className="py-8 text-center text-slate-500">Nenhum processo com esses filtros.</p>
          ) : (
            <div className="cartao divide-y divide-slate-100">
              {filtrados.map((p) => (
                <Link key={p.id} to={`/processos/${p.id}`} className="block p-4 hover:bg-slate-50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{p.apelido || formatarCnj(p.numero_cnj)}</span>
                    <span className="etiqueta bg-slate-100 text-slate-700">{p.tribunal}</span>
                  </div>
                  <div className="text-sm text-slate-600">{p.clientes?.nome}</div>
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                    <span className="font-mono">{formatarCnj(p.numero_cnj)}</span>
                    {!p.ativo ? (
                      <span>Pausado</span>
                    ) : p.ultimo_erro ? (
                      <span className="text-red-600">⚠ Erro na consulta</span>
                    ) : (
                      <span>Consultado {tempoRelativo(p.ultima_consulta)}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <Modal aberto={novo} titulo="Novo processo" onFechar={() => setNovo(false)}>
        <ProcessoForm
          clienteId={filtroCliente || undefined}
          onCancelar={() => setNovo(false)}
          onSalvo={(p) => navegar(`/processos/${p.id}?consultar=1`)}
        />
      </Modal>
    </div>
  );
}
