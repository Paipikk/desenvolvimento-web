import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { chamarFuncao, supabase } from "../lib/supabase";
import type { Movimentacao, Processo } from "../lib/tipos";
import { Carregando, EstadoVazio, EtiquetaStatus, Girando, Modal } from "../components/ui";
import ProcessoForm from "../components/ProcessoForm";
import { dataHora, tempoRelativo } from "../lib/formato";
import { formatarCnj } from "@shared/cnj";
import { buscarTribunal } from "@shared/tribunais";
import { consultarProcesso, resumoConsulta } from "../lib/acoes";
import { useToast } from "../components/Toast";

type ProcessoCompleto = Processo & { clientes: { id: string; nome: string } | null };
type MovComMensagem = Movimentacao & { mensagens: { id: string; status: string } | null };
type Log = { id: string; criado_em: string; origem: string; sucesso: boolean; novas: number; erro: string | null };

export default function ProcessoDetalhe() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const toast = useToast();
  const [processo, setProcesso] = useState<ProcessoCompleto | null | undefined>(undefined);
  const [movs, setMovs] = useState<MovComMensagem[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [consultando, setConsultando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [mostrarBaixa, setMostrarBaixa] = useState(true);
  const [criandoMsg, setCriandoMsg] = useState<string | null>(null);
  const autoConsulta = useRef(false);

  const carregar = useCallback(async () => {
    const [p, m, l] = await Promise.all([
      supabase.from("processos").select("*, clientes(id, nome)").eq("id", id!).maybeSingle(),
      supabase
        .from("movimentacoes")
        .select("*, mensagens(id, status)")
        .eq("processo_id", id!)
        .order("data_hora", { ascending: false })
        .limit(500),
      supabase
        .from("consultas_log")
        .select("id, criado_em, origem, sucesso, novas, erro")
        .eq("processo_id", id!)
        .order("criado_em", { ascending: false })
        .limit(5),
    ]);
    setProcesso((p.data as ProcessoCompleto) ?? null);
    setMovs((m.data as MovComMensagem[]) ?? []);
    setLogs((l.data as Log[]) ?? []);
  }, [id]);

  const consultar = useCallback(async () => {
    setConsultando(true);
    try {
      const r = await consultarProcesso(id!);
      toast(resumoConsulta(r), r.sucesso ? "sucesso" : "erro");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setConsultando(false);
      carregar();
    }
  }, [id, carregar, toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Logo após o cadastro, faz a primeira consulta automaticamente
  useEffect(() => {
    if (params.get("consultar") === "1" && !autoConsulta.current) {
      autoConsulta.current = true;
      setParams({}, { replace: true });
      consultar();
    }
  }, [params, setParams, consultar]);

  // Cria a mensagem de uma movimentação que ainda não tem (ex.: histórico antigo)
  async function criarMensagem(movId: string) {
    setCriandoMsg(movId);
    try {
      const r = await chamarFuncao<{ aviso?: string }>("gerar-mensagem", { movimentacao_id: movId });
      toast(r.aviso ? `Mensagem criada na fila (${r.aviso})` : "Mensagem criada. Ela está na fila de mensagens.", r.aviso ? "info" : "sucesso");
      carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setCriandoMsg(null);
    }
  }

  async function alternarAtivo() {
    if (!processo) return;
    const { error } = await supabase.from("processos").update({ ativo: !processo.ativo }).eq("id", processo.id);
    if (error) return toast(error.message, "erro");
    toast(processo.ativo ? "Acompanhamento pausado." : "Acompanhamento retomado.");
    carregar();
  }

  async function excluir() {
    const { error } = await supabase.from("processos").delete().eq("id", processo!.id);
    if (error) return toast(error.message, "erro");
    toast("Processo excluído.");
    navegar(processo?.clientes ? `/clientes/${processo.clientes.id}` : "/processos");
  }

  if (processo === undefined) return <Carregando />;
  if (processo === null)
    return <EstadoVazio icone="🔍" titulo="Processo não encontrado" acao={{ rotulo: "Voltar", para: "/processos" }} />;

  const visiveis = mostrarBaixa ? movs : movs.filter((m) => m.relevancia === "normal");
  const tribunal = buscarTribunal(processo.tribunal);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/processos" className="text-sm text-marca-700 hover:underline">← Processos</Link>
        <h1 className="mt-2 text-2xl font-bold">{processo.apelido || formatarCnj(processo.numero_cnj)}</h1>
        <div className="mt-1 space-y-0.5 text-sm text-slate-600">
          <div className="font-mono">{formatarCnj(processo.numero_cnj)}</div>
          <div>{tribunal ? `${tribunal.sigla} — ${tribunal.nome}` : processo.tribunal}</div>
          <div>
            Cliente:{" "}
            {processo.clientes && (
              <Link to={`/clientes/${processo.clientes.id}`} className="text-marca-700 hover:underline">{processo.clientes.nome}</Link>
            )}
          </div>
          <div>
            Última consulta: {tempoRelativo(processo.ultima_consulta)}
            {!processo.ativo && <span className="etiqueta ml-2 bg-slate-200 text-slate-600">Pausado</span>}
          </div>
        </div>

        {processo.ultimo_erro && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <strong>Erro na última consulta ({tempoRelativo(processo.ultima_tentativa)}):</strong> {processo.ultimo_erro}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primario" onClick={consultar} disabled={consultando}>
            {consultando ? <><Girando /> Consultando…</> : "🔄 Consultar agora"}
          </button>
          <button className="btn-secundario" onClick={() => setEditando(true)}>Editar</button>
          <button className="btn-secundario" onClick={alternarAtivo}>{processo.ativo ? "Pausar acompanhamento" : "Retomar acompanhamento"}</button>
          <button className="btn-texto text-red-600" onClick={() => setExcluindo(true)}>Excluir</button>
        </div>
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Histórico de movimentações ({movs.length})</h2>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={mostrarBaixa} onChange={(e) => setMostrarBaixa(e.target.checked)} />
            Mostrar as de baixa relevância
          </label>
        </div>
        {movs.length === 0 ? (
          <EstadoVazio
            icone="🕐"
            titulo={consultando ? "Consultando o tribunal…" : "Nenhuma movimentação ainda"}
            texto={consultando ? "Isso pode levar alguns segundos." : 'Clique em "Consultar agora" para buscar o histórico no Datajud.'}
          />
        ) : (
          <ol className="cartao divide-y divide-slate-100">
            {visiveis.map((m) => (
              <li key={m.id} className={`p-4 ${m.relevancia === "baixa" ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{m.nome}</span>
                  <span className="text-xs text-slate-500">{dataHora(m.data_hora)}</span>
                </div>
                {m.complemento && <div className="mt-0.5 text-sm text-slate-600">{m.complemento}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {m.codigo !== null && <span>Código {m.codigo}</span>}
                  {m.relevancia === "baixa" && <span className="etiqueta bg-slate-100 text-slate-500">baixa relevância</span>}
                  {m.mensagens ? (
                    <Link to="/fila" className="inline-flex items-center gap-1 hover:underline">
                      Mensagem: <EtiquetaStatus status={m.mensagens.status} />
                    </Link>
                  ) : (
                    <button
                      className="text-marca-700 hover:underline disabled:opacity-50"
                      onClick={() => criarMensagem(m.id)}
                      disabled={criandoMsg !== null}
                    >
                      {criandoMsg === m.id ? "Criando mensagem…" : "✉️ Criar mensagem para o cliente"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {logs.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Últimas consultas</h2>
          <ul className="cartao divide-y divide-slate-100 text-sm">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 p-3">
                <span>
                  {l.sucesso ? "✅" : "❌"} {dataHora(l.criado_em)} · {l.origem === "rotina" ? "automática" : "manual"}
                </span>
                <span className={l.sucesso ? "text-slate-500" : "text-red-600"}>
                  {l.sucesso ? `${l.novas} nova(s)` : l.erro}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal aberto={editando} titulo="Editar processo" onFechar={() => setEditando(false)}>
        <ProcessoForm
          processo={processo}
          onCancelar={() => setEditando(false)}
          onSalvo={() => {
            setEditando(false);
            toast("Processo atualizado.");
            carregar();
          }}
        />
      </Modal>

      <Modal aberto={excluindo} titulo="Excluir processo" onFechar={() => setExcluindo(false)}>
        <p className="text-sm">
          O processo e todo o histórico de movimentações e mensagens dele serão apagados. Se você só quer parar de
          acompanhar, prefira <strong>pausar o acompanhamento</strong>.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secundario" onClick={() => setExcluindo(false)}>Cancelar</button>
          <button className="btn-perigo" onClick={excluir}>Excluir processo</button>
        </div>
      </Modal>
    </div>
  );
}
