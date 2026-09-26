import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { chamarFuncao, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Mensagem } from "../lib/tipos";
import { Cabecalho, Carregando, EstadoVazio, Girando } from "../components/ui";
import { dataHora, formatarTelefone, linkWhatsapp } from "../lib/formato";
import { formatarCnj } from "@shared/cnj";
import { useToast } from "../components/Toast";

type Item = Mensagem & {
  movimentacoes: {
    nome: string;
    complemento: string | null;
    data_hora: string;
    codigo: number | null;
    processos: {
      id: string;
      numero_cnj: string;
      apelido: string | null;
      tribunal: string;
      clientes: { id: string; nome: string; telefone: string; email: string | null } | null;
    } | null;
  } | null;
};

type StatusEmail = { configurado: boolean; modo_teste: boolean; destino_teste: string | null; remetente: string };
type RespostaEnvio = { enviados: number; falhas: number; modo_teste: boolean; resultados: { id: string; ok: boolean; erro?: string }[] };

function enviarPorEmail(ids: string[]): Promise<RespostaEnvio> {
  return chamarFuncao<RespostaEnvio>("enviar-email", { mensagem_ids: ids });
}

type Aba = "revisar" | "baixa" | "aprovadas" | "enviadas" | "ignoradas";

const ABAS: { id: Aba; rotulo: string; status: string; relevancia?: string }[] = [
  { id: "revisar", rotulo: "Para revisar", status: "pendente", relevancia: "normal" },
  { id: "baixa", rotulo: "Baixa relevância", status: "pendente", relevancia: "baixa" },
  { id: "aprovadas", rotulo: "Aprovadas", status: "aprovada" },
  { id: "enviadas", rotulo: "Enviadas", status: "enviada" },
  { id: "ignoradas", rotulo: "Ignoradas", status: "ignorada" },
];

const VAZIOS: Record<Aba, { icone: string; titulo: string; texto: string }> = {
  revisar: {
    icone: "🎉",
    titulo: "Tudo em dia!",
    texto: "Não há mensagens esperando revisão. Quando algum processo tiver novidade, a mensagem pronta aparece aqui.",
  },
  baixa: {
    icone: "🗂️",
    titulo: "Nada de baixa relevância",
    texto: "Movimentações burocráticas (conclusos, juntadas, certidões…) ficam aqui para não atrapalhar a fila principal.",
  },
  aprovadas: {
    icone: "📨",
    titulo: "Nenhuma mensagem aprovada aguardando envio",
    texto: 'Ao aprovar várias de uma vez, elas ficam aqui para você enviar pelo WhatsApp, uma a uma.',
  },
  enviadas: { icone: "📭", titulo: "Nenhuma mensagem enviada ainda", texto: "O histórico de envios aparece aqui." },
  ignoradas: { icone: "🙈", titulo: "Nenhuma mensagem ignorada", texto: "Mensagens que você decidir não enviar ficam aqui." },
};

export default function Fila() {
  const { usuario } = useAuth();
  const toast = useToast();
  const [aba, setAba] = useState<Aba>("revisar");
  const [itens, setItens] = useState<Item[] | null>(null);
  const [contagens, setContagens] = useState<Partial<Record<Aba, number>>>({});
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [processandoLote, setProcessandoLote] = useState(false);
  const [statusEmail, setStatusEmail] = useState<StatusEmail | null>(null);

  useEffect(() => {
    chamarFuncao<StatusEmail>("enviar-email", { acao: "status" }).then(setStatusEmail).catch(() => setStatusEmail(null));
  }, []);

  const config = ABAS.find((a) => a.id === aba)!;

  const carregarContagens = useCallback(async () => {
    const res = await Promise.all(
      ABAS.map((a) => {
        let q = supabase.from("mensagens").select("id", { count: "exact", head: true }).eq("status", a.status);
        if (a.relevancia) q = q.eq("relevancia", a.relevancia);
        return q;
      }),
    );
    setContagens(Object.fromEntries(ABAS.map((a, i) => [a.id, res[i].count ?? 0])));
  }, []);

  const carregar = useCallback(async () => {
    setItens(null);
    setSelecionadas(new Set());
    let q = supabase
      .from("mensagens")
      .select(
        "*, movimentacoes(nome, complemento, data_hora, codigo, processos(id, numero_cnj, apelido, tribunal, clientes(id, nome, telefone, email)))",
      )
      .eq("status", config.status)
      .order(config.status === "enviada" ? "enviada_em" : "criado_em", { ascending: false })
      .limit(100);
    if (config.relevancia) q = q.eq("relevancia", config.relevancia);
    const { data, error } = await q;
    if (error) toast(error.message, "erro");
    setItens((data as Item[]) ?? []);
  }, [config.status, config.relevancia, toast]);

  useEffect(() => {
    carregar();
    carregarContagens();
  }, [carregar, carregarContagens]);

  const remover = (id: string) => {
    setItens((l) => l?.filter((i) => i.id !== id) ?? null);
    setSelecionadas((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    carregarContagens();
  };
  const atualizarLocal = (id: string, dados: Partial<Item>) =>
    setItens((l) => l?.map((i) => (i.id === id ? { ...i, ...dados } : i)) ?? null);

  async function atualizarStatus(ids: string[], status: "aprovada" | "ignorada" | "pendente") {
    const agora = new Date().toISOString();
    const dados: Record<string, unknown> = { status };
    if (status === "aprovada") Object.assign(dados, { aprovada_em: agora, aprovada_por: usuario?.id });
    const { error } = await supabase.from("mensagens").update(dados).in("id", ids);
    if (error) throw error;
  }

  async function loteAprovar() {
    setProcessandoLote(true);
    try {
      const ids = [...selecionadas];
      await atualizarStatus(ids, "aprovada");
      toast(`${ids.length} mensagem(ns) aprovada(s). Envie pela aba "Aprovadas".`);
      carregar();
      carregarContagens();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setProcessandoLote(false);
    }
  }

  async function loteIgnorar() {
    setProcessandoLote(true);
    try {
      const ids = [...selecionadas];
      await atualizarStatus(ids, "ignorada");
      toast(`${ids.length} mensagem(ns) ignorada(s).`, "info");
      carregar();
      carregarContagens();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setProcessandoLote(false);
    }
  }

  async function loteEmail() {
    const ids = [...selecionadas];
    const semEmail = itens?.filter((i) => selecionadas.has(i.id) && !i.movimentacoes?.processos?.clientes?.email).length ?? 0;
    if (semEmail === ids.length) return toast("Nenhum dos clientes selecionados tem e-mail cadastrado.", "erro");
    const aviso = statusEmail?.modo_teste ? `\n\n(Modo teste: tudo vai para ${statusEmail.destino_teste}.)` : "";
    const extra = semEmail ? `\n${semEmail} sem e-mail cadastrado serão puladas.` : "";
    if (!confirm(`Enviar ${ids.length - semEmail} mensagem(ns) por e-mail agora?${extra}${aviso}`)) return;
    setProcessandoLote(true);
    try {
      const r = await enviarPorEmail(ids);
      const primeiraFalha = r.resultados.find((x) => !x.ok)?.erro;
      toast(
        `${r.enviados} enviada(s) por e-mail${r.falhas ? `, ${r.falhas} com problema${primeiraFalha ? ` (${primeiraFalha})` : ""}` : ""}.`,
        r.falhas && !r.enviados ? "erro" : "sucesso",
      );
      carregar();
      carregarContagens();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setProcessandoLote(false);
    }
  }

  const selecionavel = aba === "revisar" || aba === "baixa" || aba === "aprovadas";
  const todasSelecionadas = !!itens?.length && selecionadas.size === itens.length;

  return (
    <div>
      <Cabecalho
        titulo="Mensagens"
        subtitulo="Revise, ajuste se quiser e envie pelo WhatsApp ou por e-mail. Nada é enviado sem a sua aprovação."
      />

      {statusEmail?.modo_teste && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          🧪 <strong>E-mail em modo teste:</strong> todo envio por e-mail vai para <strong>{statusEmail.destino_teste}</strong>,
          não para os clientes.
        </p>
      )}

      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex gap-1 border-b border-slate-200">
          {ABAS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${
                aba === a.id ? "border-marca-700 text-marca-800" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {a.rotulo}
              {!!contagens[a.id] && (
                <span className={`ml-1.5 rounded-full px-1.5 text-xs ${a.id === "revisar" ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600"}`}>
                  {contagens[a.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {selecionavel && !!itens?.length && (
        <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm md:top-2">
          <label className="flex items-center gap-2 px-2 text-sm">
            <input
              type="checkbox"
              checked={todasSelecionadas}
              onChange={(e) => setSelecionadas(e.target.checked ? new Set(itens.map((i) => i.id)) : new Set())}
            />
            {selecionadas.size ? `${selecionadas.size} selecionada(s)` : "Selecionar todas"}
          </label>
          {selecionadas.size > 0 && (
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <button className="btn-secundario" onClick={loteIgnorar} disabled={processandoLote}>Ignorar</button>
              {statusEmail?.configurado && (
                <button className="btn-secundario" onClick={loteEmail} disabled={processandoLote}>✉️ Enviar por e-mail</button>
              )}
              {aba !== "aprovadas" && (
                <button className="btn-primario" onClick={loteAprovar} disabled={processandoLote}>
                  {processandoLote && <Girando />} Aprovar selecionadas
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {aba === "aprovadas" && !!itens?.length && (
        <p className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          O WhatsApp abre uma conversa por vez, então o envio por WhatsApp é feito mensagem a mensagem. Por e-mail dá
          para selecionar várias e enviar de uma vez.
        </p>
      )}

      {itens === null ? (
        <Carregando />
      ) : itens.length === 0 ? (
        <EstadoVazio {...VAZIOS[aba]} />
      ) : (
        <div className="space-y-4">
          {itens.map((item) => (
            <CartaoMensagem
              key={item.id}
              item={item}
              selecionavel={selecionavel}
              selecionada={selecionadas.has(item.id)}
              onSelecionar={(v) =>
                setSelecionadas((s) => {
                  const n = new Set(s);
                  if (v) n.add(item.id);
                  else n.delete(item.id);
                  return n;
                })
              }
              emailAtivo={Boolean(statusEmail?.configurado)}
              onRemover={() => remover(item.id)}
              onAtualizar={(d) => atualizarLocal(item.id, d)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoMensagem({
  item,
  selecionavel,
  selecionada,
  onSelecionar,
  emailAtivo,
  onRemover,
  onAtualizar,
}: {
  item: Item;
  emailAtivo: boolean;
  selecionavel: boolean;
  selecionada: boolean;
  onSelecionar: (v: boolean) => void;
  onRemover: () => void;
  onAtualizar: (d: Partial<Item>) => void;
}) {
  const { usuario } = useAuth();
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(item.texto_final);
  const [ocupado, setOcupado] = useState<"" | "salvar" | "regerar" | "ignorar" | "enviar" | "email" | "restaurar">("");

  const mov = item.movimentacoes;
  const proc = mov?.processos;
  const cliente = proc?.clientes;
  const alterado = texto !== item.texto_final;

  async function salvarTexto() {
    setOcupado("salvar");
    const { error } = await supabase.from("mensagens").update({ texto_final: texto }).eq("id", item.id);
    setOcupado("");
    if (error) return toast(error.message, "erro");
    onAtualizar({ texto_final: texto });
    setEditando(false);
    toast("Texto salvo.");
  }

  function enviar() {
    if (!cliente) return;
    const textoEnvio = texto.trim();
    if (!textoEnvio) return toast("A mensagem está vazia.", "erro");
    // Abre o WhatsApp imediatamente (dentro do clique) para o navegador não bloquear a nova aba
    window.open(linkWhatsapp(cliente.telefone, textoEnvio), "_blank", "noopener");
    if (item.status === "enviada") return; // reenvio: só abre o WhatsApp

    setOcupado("enviar");
    const agora = new Date().toISOString();
    supabase
      .from("mensagens")
      .update({
        texto_final: textoEnvio,
        status: "enviada",
        canal: "whatsapp_link",
        aprovada_em: item.aprovada_em ?? agora,
        aprovada_por: usuario?.id,
        enviada_em: agora,
        enviada_por: usuario?.id,
      })
      .eq("id", item.id)
      .then(({ error }) => {
        setOcupado("");
        if (error) return toast("WhatsApp aberto, mas não foi possível marcar como enviada: " + error.message, "erro");
        toast(`Mensagem para ${cliente.nome.split(" ")[0]} marcada como enviada.`);
        onRemover();
      });
  }

  async function enviarEmail() {
    if (!cliente?.email) return;
    setOcupado("email");
    try {
      // Se o texto foi editado e não salvo, salva antes para o e-mail sair com a versão certa
      if (alterado) {
        const { error } = await supabase.from("mensagens").update({ texto_final: texto }).eq("id", item.id);
        if (error) throw error;
      }
      const r = await enviarPorEmail([item.id]);
      const res = r.resultados[0];
      if (!res?.ok) {
        onAtualizar({ erro_envio: res?.erro ?? "Falha no envio." });
        return toast(res?.erro ?? "Falha no envio.", "erro");
      }
      toast(r.modo_teste ? "E-mail de teste enviado (foi para o endereço de teste)." : `E-mail enviado para ${cliente.email}.`);
      onRemover();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  async function mudarStatus(status: "ignorada" | "pendente") {
    setOcupado(status === "ignorada" ? "ignorar" : "restaurar");
    const { error } = await supabase.from("mensagens").update({ status }).eq("id", item.id);
    setOcupado("");
    if (error) return toast(error.message, "erro");
    toast(status === "ignorada" ? "Mensagem ignorada." : "Mensagem devolvida para revisão.", "info");
    onRemover();
  }

  async function regerar() {
    setOcupado("regerar");
    try {
      const r = await chamarFuncao<{ mensagem: Mensagem; aviso?: string }>("gerar-mensagem", { mensagem_id: item.id });
      setTexto(r.mensagem.texto_final);
      onAtualizar({ ...r.mensagem });
      toast(r.aviso ? `Texto gerado com aviso: ${r.aviso}` : "Novo texto gerado.", r.aviso ? "info" : "sucesso");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  const podeAgir = item.status === "pendente" || item.status === "aprovada";

  return (
    <article className={`cartao overflow-hidden ${selecionada ? "ring-2 ring-marca-500" : ""}`}>
      <header className="flex items-start gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
        {selecionavel && (
          <input
            type="checkbox"
            className="mt-1.5 h-4 w-4"
            checked={selecionada}
            onChange={(e) => onSelecionar(e.target.checked)}
            aria-label="Selecionar mensagem"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            {cliente ? (
              <Link to={`/clientes/${cliente.id}`} className="font-semibold hover:underline">{cliente.nome}</Link>
            ) : (
              <span className="font-semibold">—</span>
            )}
            <span className="text-xs text-slate-500">{cliente && formatarTelefone(cliente.telefone)}
              {cliente?.email && <span className="hidden sm:inline"> · {cliente.email}</span>}
            </span>
          </div>
          {proc && (
            <Link to={`/processos/${proc.id}`} className="block truncate text-sm text-slate-600 hover:underline">
              {proc.apelido ? `${proc.apelido} · ` : ""}
              <span className="font-mono text-xs">{formatarCnj(proc.numero_cnj)}</span> · {proc.tribunal}
            </Link>
          )}
        </div>
      </header>

      <div className="grid gap-0 md:grid-cols-2">
        <section className="border-b border-slate-100 p-4 md:border-b-0 md:border-r">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">No tribunal</h3>
          <p className="font-medium">{mov?.nome}</p>
          {mov?.complemento && <p className="mt-1 text-sm text-slate-600">{mov.complemento}</p>}
          <p className="mt-2 text-xs text-slate-500">{dataHora(mov?.data_hora)}</p>
          {item.relevancia === "baixa" && (
            <p className="mt-2 text-xs text-slate-500">Marcada como baixa relevância (movimentação burocrática).</p>
          )}
        </section>

        <section className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mensagem para o cliente</h3>
            {item.gerada_por === "modelo" && (
              <span className="etiqueta bg-slate-100 text-slate-500" title="A IA não estava disponível; foi usado um texto padrão.">
                texto padrão
              </span>
            )}
          </div>
          {editando ? (
            <>
              <textarea className="campo min-h-[180px] text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
              <div className={`mt-1 text-right text-xs ${texto.length > 600 ? "text-amber-600" : "text-slate-400"}`}>
                {texto.length} caracteres
              </div>
            </>
          ) : (
            <p className="whitespace-pre-line rounded-lg bg-green-50 p-3 text-sm text-slate-800">{texto}</p>
          )}
          {item.status === "enviada" && (
            <p className="mt-2 text-xs text-slate-500">
              Enviada {item.canal === "email" ? "por e-mail" : "pelo WhatsApp"} em {dataHora(item.enviada_em)}
            </p>
          )}
          {item.erro_envio && item.status !== "enviada" && (
            <p className="mt-2 text-xs text-red-600">Último envio por e-mail falhou: {item.erro_envio}</p>
          )}
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
        {podeAgir && (
          <>
            {editando ? (
              <>
                <button className="btn-texto" onClick={() => { setTexto(item.texto_final); setEditando(false); }}>Descartar</button>
                <button className="btn-secundario" onClick={salvarTexto} disabled={!alterado || !!ocupado}>
                  {ocupado === "salvar" && <Girando />} Salvar texto
                </button>
              </>
            ) : (
              <>
                <button className="btn-texto" onClick={regerar} disabled={!!ocupado} title="Pedir à IA um novo texto">
                  {ocupado === "regerar" ? "Gerando…" : "↻ Novo texto"}
                </button>
                <button className="btn-secundario" onClick={() => setEditando(true)} disabled={!!ocupado}>✏️ Editar</button>
              </>
            )}
            <button className="btn-secundario" onClick={() => mudarStatus("ignorada")} disabled={!!ocupado}>Ignorar</button>
            {emailAtivo && cliente?.email && (
              <button className="btn-secundario" onClick={enviarEmail} disabled={!!ocupado} title={`Enviar para ${cliente.email}`}>
                {ocupado === "email" ? "Enviando…" : "✉️ Enviar por e-mail"}
              </button>
            )}
            <button className="btn-whatsapp" onClick={enviar} disabled={!!ocupado || !cliente}>
              {ocupado === "enviar" && <Girando />}
              {item.status === "aprovada" ? "Enviar no WhatsApp" : "Aprovar e enviar"}
            </button>
          </>
        )}
        {item.status === "enviada" && (
          <button className="btn-secundario" onClick={enviar}>Abrir no WhatsApp de novo</button>
        )}
        {item.status === "ignorada" && (
          <button className="btn-secundario" onClick={() => mudarStatus("pendente")} disabled={!!ocupado}>Voltar para revisão</button>
        )}
      </footer>
    </article>
  );
}
