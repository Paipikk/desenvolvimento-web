import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Cliente, Processo } from "../lib/tipos";
import { Carregando, EstadoVazio, Erro, Girando, Modal } from "../components/ui";
import ClienteForm from "../components/ClienteForm";
import ProcessoForm from "../components/ProcessoForm";
import { formatarTelefone, tempoRelativo } from "../lib/formato";
import { formatarCnj } from "@shared/cnj";
import { useToast } from "../components/Toast";

type Resumo = { processos: number; movimentacoes: number; mensagens: number };

export default function ClienteDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [cliente, setCliente] = useState<Cliente | null | undefined>(undefined);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const novoProcesso = params.get("novoProcesso") === "1";

  const carregar = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from("clientes").select("id, nome, telefone, email, observacoes, criado_em").eq("id", id!).maybeSingle(),
      supabase.from("processos").select("*").eq("cliente_id", id!).order("criado_em", { ascending: false }),
    ]);
    setCliente((c.data as Cliente) ?? null);
    setProcessos((p.data as Processo[]) ?? []);
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (cliente === undefined) return <Carregando />;
  if (cliente === null) {
    return <EstadoVazio icone="🔍" titulo="Cliente não encontrado" acao={{ rotulo: "Voltar para clientes", para: "/clientes" }} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/clientes" className="text-sm text-marca-700 hover:underline">← Clientes</Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{cliente.nome}</h1>
            <div className="mt-1 text-sm text-slate-600">
              📱 {formatarTelefone(cliente.telefone)}
              {cliente.email && <> · ✉️ {cliente.email}</>}
            </div>
          </div>
          <button className="btn-secundario" onClick={() => setEditando(true)}>Editar dados</button>
        </div>
        {cliente.observacoes && (
          <p className="mt-3 whitespace-pre-line rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{cliente.observacoes}</p>
        )}
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Processos</h2>
          <button className="btn-primario" onClick={() => setParams({ novoProcesso: "1" })}>+ Processo</button>
        </div>
        {processos.length === 0 ? (
          <EstadoVazio
            icone="⚖️"
            titulo="Nenhum processo deste cliente"
            texto="Cadastre o número CNJ do processo. O Andamento passa a acompanhá-lo todos os dias."
            acao={{ rotulo: "Cadastrar processo", onClick: () => setParams({ novoProcesso: "1" }) }}
          />
        ) : (
          <div className="cartao divide-y divide-slate-100">
            {processos.map((p) => (
              <Link key={p.id} to={`/processos/${p.id}`} className="block p-4 hover:bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.apelido || formatarCnj(p.numero_cnj)}</span>
                  <span className="text-xs text-slate-500">{p.tribunal}</span>
                </div>
                <div className="font-mono text-xs text-slate-500">{formatarCnj(p.numero_cnj)}</div>
                <div className="mt-1 text-xs">
                  {!p.ativo ? (
                    <span className="text-slate-400">Acompanhamento pausado</span>
                  ) : p.ultimo_erro ? (
                    <span className="text-red-600">Erro na última consulta</span>
                  ) : (
                    <span className="text-slate-500">Consultado {tempoRelativo(p.ultima_consulta)}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="cartao border-red-200 p-5">
        <h2 className="font-semibold text-red-700">Excluir cliente (LGPD)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Apaga definitivamente o cliente e tudo o que está ligado a ele: processos, movimentações e mensagens.
          Use quando o cliente pedir a exclusão dos dados ou encerrar a relação com o escritório.
        </p>
        <button className="btn-perigo mt-3" onClick={() => setExcluindo(true)}>Excluir cliente e dados</button>
      </section>

      <Modal aberto={editando} titulo="Editar cliente" onFechar={() => setEditando(false)}>
        <ClienteForm
          cliente={cliente}
          onCancelar={() => setEditando(false)}
          onSalvo={(c) => {
            setCliente(c);
            setEditando(false);
            toast("Dados atualizados.");
          }}
        />
      </Modal>

      <Modal aberto={novoProcesso} titulo="Novo processo" onFechar={() => setParams({})}>
        <ProcessoForm
          clienteId={cliente.id}
          onCancelar={() => setParams({})}
          onSalvo={(p) => navegar(`/processos/${p.id}?consultar=1`)}
        />
      </Modal>

      <ExcluirCliente
        aberto={excluindo}
        cliente={cliente}
        onFechar={() => setExcluindo(false)}
        onExcluido={() => {
          toast("Cliente e todos os dados vinculados foram excluídos.");
          navegar("/clientes");
        }}
      />
    </div>
  );
}

function ExcluirCliente({
  aberto,
  cliente,
  onFechar,
  onExcluido,
}: {
  aberto: boolean;
  cliente: Cliente;
  onFechar: () => void;
  onExcluido: () => void;
}) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [apagando, setApagando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setConfirmacao("");
    setErro("");
    supabase.rpc("resumo_exclusao_cliente", { p_cliente_id: cliente.id }).then(({ data }) => {
      const r = Array.isArray(data) ? data[0] : data;
      setResumo(r ?? { processos: 0, movimentacoes: 0, mensagens: 0 });
    });
  }, [aberto, cliente.id]);

  const primeiroNome = cliente.nome.trim().split(/\s+/)[0];
  const confere = confirmacao.trim().toLowerCase() === primeiroNome.toLowerCase();

  async function excluir() {
    setApagando(true);
    const { error } = await supabase.from("clientes").delete().eq("id", cliente.id);
    setApagando(false);
    if (error) return setErro("Não foi possível excluir. " + error.message);
    onExcluido();
  }

  return (
    <Modal aberto={aberto} titulo="Excluir cliente" onFechar={onFechar}>
      <div className="space-y-4 text-sm">
        <p>
          Você está prestes a apagar <strong>{cliente.nome}</strong>. Serão excluídos permanentemente:
        </p>
        {resumo ? (
          <ul className="list-inside list-disc text-slate-700">
            <li>os dados de cadastro (nome, telefone, e-mail, observações)</li>
            <li>{resumo.processos} processo(s)</li>
            <li>{resumo.movimentacoes} movimentação(ões)</li>
            <li>{resumo.mensagens} mensagem(ns)</li>
          </ul>
        ) : (
          <Carregando texto="Calculando…" />
        )}
        <p className="font-medium text-red-700">Esta ação não pode ser desfeita.</p>
        <div>
          <label className="rotulo" htmlFor="conf">Para confirmar, digite <strong>{primeiroNome}</strong>:</label>
          <input id="conf" className="campo" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="off" />
        </div>
        <Erro>{erro}</Erro>
        <div className="flex justify-end gap-2">
          <button className="btn-secundario" onClick={onFechar}>Cancelar</button>
          <button className="btn-perigo" disabled={!confere || apagando} onClick={excluir}>
            {apagando && <Girando />} Excluir definitivamente
          </button>
        </div>
      </div>
    </Modal>
  );
}
