import { useEffect, useState, type FormEvent } from "react";
import { chamarFuncao, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Cabecalho, Erro, Girando } from "../components/ui";
import { SeletorTribunal } from "../components/ProcessoForm";
import { useToast } from "../components/Toast";
import { dataHora, formatarTelefone, normalizarTelefone } from "../lib/formato";
import { mascararCnj, validarCnj } from "@shared/cnj";
import { tribunalPeloNumero } from "@shared/tribunais";
import type { Usuario } from "../lib/tipos";

export default function Configuracoes() {
  return (
    <div className="space-y-6">
      <Cabecalho titulo="Configurações" />
      <DadosEscritorio />
      <Equipe />
      <TesteDatajud />
      <PreviaMensagem />
      <MinhaConta />
    </div>
  );
}

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="cartao p-5">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {descricao && <p className="mt-1 text-sm text-slate-600">{descricao}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DadosEscritorio() {
  const { escritorio, usuario, recarregar } = useAuth();
  const toast = useToast();
  const admin = usuario?.papel === "admin";
  const [nome, setNome] = useState(escritorio?.nome ?? "");
  const [oab, setOab] = useState(escritorio?.oab_responsavel ?? "");
  const [telefone, setTelefone] = useState(escritorio?.telefone ? formatarTelefone(escritorio.telefone) : "");
  const [assinatura, setAssinatura] = useState(escritorio?.assinatura ?? "");
  const [horario, setHorario] = useState(escritorio?.horario_consulta ?? 7);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!escritorio) return;
    if (!nome.trim()) return setErro("Informe o nome do escritório.");
    setErro("");
    setSalvando(true);
    const { error } = await supabase
      .from("escritorios")
      .update({
        nome: nome.trim(),
        oab_responsavel: oab.trim() || null,
        telefone: normalizarTelefone(telefone) || null,
        assinatura: assinatura.trim() || null,
        horario_consulta: horario,
      })
      .eq("id", escritorio.id);
    setSalvando(false);
    if (error) return setErro(error.message);
    await recarregar();
    toast("Configurações salvas.");
  }

  const assinaturaPrevia = assinatura.trim() || nome.trim();

  return (
    <Secao titulo="Escritório" descricao={admin ? undefined : "Somente administradores podem alterar estes dados."}>
      <form onSubmit={salvar} className="space-y-4">
        <fieldset disabled={!admin} className="space-y-4">
          <div>
            <label className="rotulo" htmlFor="e-nome">Nome do escritório</label>
            <input id="e-nome" className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="rotulo" htmlFor="e-oab">OAB do responsável</label>
              <input id="e-oab" className="campo" value={oab} onChange={(e) => setOab(e.target.value)} />
            </div>
            <div>
              <label className="rotulo" htmlFor="e-tel">Telefone</label>
              <input id="e-tel" className="campo" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="rotulo" htmlFor="e-ass">Assinatura das mensagens</label>
            <textarea
              id="e-ass"
              rows={2}
              className="campo"
              placeholder={nome || "Ex.: Dra. Ana Souza — Souza Advocacia"}
              value={assinatura}
              onChange={(e) => setAssinatura(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Vai no fim de toda mensagem. Se ficar em branco, usamos o nome do escritório. Prévia: <em>{assinaturaPrevia}</em>
            </p>
          </div>
          <div>
            <label className="rotulo" htmlFor="e-hora">Horário da consulta diária</label>
            <select id="e-hora" className="campo sm:w-60" value={horario} onChange={(e) => setHorario(Number(e.target.value))}>
              {Array.from({ length: 18 }, (_, i) => i + 5).map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 (horário de Brasília)</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              A partir deste horário o Andamento consulta todos os processos ativos. Com muitos processos, a consulta pode
              levar alguns minutos para terminar.
            </p>
          </div>
        </fieldset>
        <Erro>{erro}</Erro>
        {admin && (
          <div className="flex justify-end">
            <button className="btn-primario" disabled={salvando}>{salvando && <Girando />} Salvar</button>
          </div>
        )}
      </form>
    </Secao>
  );
}

type Convite = { id: string; email: string; papel: string; criado_em: string };

function Equipe() {
  const { usuario } = useAuth();
  const toast = useToast();
  const admin = usuario?.papel === "admin";
  const [membros, setMembros] = useState<Usuario[]>([]);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<"membro" | "admin">("membro");
  const [erro, setErro] = useState("");

  async function carregar() {
    const { data } = await supabase.from("usuarios").select("id, escritorio_id, nome, email, papel").order("nome");
    setMembros((data as Usuario[]) ?? []);
    if (admin) {
      const { data: c } = await supabase.from("convites").select("id, email, papel, criado_em").is("aceito_em", null);
      setConvites((c as Convite[]) ?? []);
    }
  }
  useEffect(() => {
    carregar();
  }, [admin]);

  async function convidar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    const { error } = await supabase
      .from("convites")
      .insert({ email: email.trim().toLowerCase(), papel, escritorio_id: usuario!.escritorio_id, criado_por: usuario!.id });
    if (error) return setErro(error.code === "23505" ? "Já existe um convite pendente para este e-mail." : error.message);
    setEmail("");
    toast("Convite registrado. Peça para a pessoa criar a conta com este e-mail.");
    carregar();
  }

  async function cancelarConvite(id: string) {
    await supabase.from("convites").delete().eq("id", id);
    carregar();
  }

  async function remover(m: Usuario) {
    if (!confirm(`Remover ${m.nome || m.email} do escritório?`)) return;
    const { error } = await supabase.from("usuarios").delete().eq("id", m.id);
    if (error) return toast(error.message, "erro");
    carregar();
  }

  return (
    <Secao titulo="Equipe" descricao="Advogados e estagiários que usam o Andamento neste escritório.">
      <ul className="divide-y divide-slate-100 text-sm">
        {membros.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{m.nome || m.email}</div>
              <div className="truncate text-xs text-slate-500">{m.email} · {m.papel === "admin" ? "Administrador" : "Membro"}</div>
            </div>
            {admin && m.id !== usuario?.id && (
              <button className="btn-texto text-red-600" onClick={() => remover(m)}>Remover</button>
            )}
          </li>
        ))}
        {convites.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-slate-500">
            <div className="min-w-0">
              <div className="truncate">{c.email}</div>
              <div className="text-xs">Convite pendente desde {dataHora(c.criado_em)}</div>
            </div>
            <button className="btn-texto" onClick={() => cancelarConvite(c.id)}>Cancelar</button>
          </li>
        ))}
      </ul>
      {admin && (
        <form onSubmit={convidar} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input type="email" required className="campo" placeholder="e-mail da pessoa" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="campo sm:w-44" value={papel} onChange={(e) => setPapel(e.target.value as "membro" | "admin")}>
            <option value="membro">Membro</option>
            <option value="admin">Administrador</option>
          </select>
          <button className="btn-secundario shrink-0">Convidar</button>
        </form>
      )}
      <Erro>{erro}</Erro>
    </Secao>
  );
}

type RespostaTeste = {
  erro?: string;
  tribunal: string;
  endpoint: string;
  duracao_ms?: number;
  encontrado?: boolean;
  classe?: string | null;
  orgao_julgador?: string | null;
  total_movimentos?: number;
  movimentos?: { nome: string; dataHora: string; codigo: number | null; complemento: string | null; relevancia: string }[];
};

function TesteDatajud() {
  const [numero, setNumero] = useState("");
  const [tribunal, setTribunal] = useState("");
  const [testando, setTestando] = useState(false);
  const [resp, setResp] = useState<RespostaTeste | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const t = tribunalPeloNumero(numero);
    if (t) setTribunal(t);
  }, [numero]);

  async function testar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setResp(null);
    const v = validarCnj(numero);
    if (!v.valido) return setErro(v.erro);
    setTestando(true);
    try {
      setResp(await chamarFuncao<RespostaTeste>("testar-datajud", { numero: v.numero, tribunal }));
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setTestando(false);
    }
  }

  return (
    <Secao
      titulo="Testar conexão com o Datajud"
      descricao="Consulta um número de processo na API pública do CNJ, sem salvar nada. Útil para conferir se a integração está funcionando."
    >
      <form onSubmit={testar} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className="campo font-mono" inputMode="numeric" placeholder="0000000-00.0000.0.00.0000" value={numero} onChange={(e) => setNumero(mascararCnj(e.target.value))} />
        <SeletorTribunal valor={tribunal} onChange={setTribunal} />
        <button className="btn-secundario" disabled={testando}>{testando ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" /> Testando…</> : "Testar"}</button>
      </form>
      <div className="mt-3"><Erro>{erro}</Erro></div>
      {resp && (
        <div className="mt-3 space-y-2 text-sm">
          {resp.erro ? (
            <Erro>{resp.erro}</Erro>
          ) : !resp.encontrado ? (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
              Conexão OK, mas o processo não foi encontrado em {resp.tribunal}. Confira o número e o tribunal.
            </p>
          ) : (
            <>
              <p className="rounded-lg bg-marca-50 p-3 text-marca-800">
                ✅ Conexão OK ({resp.duracao_ms} ms). {resp.classe} — {resp.orgao_julgador}. {resp.total_movimentos} movimentação(ões).
              </p>
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {resp.movimentos?.map((m, i) => (
                  <li key={i} className="p-2">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{m.nome}</span>
                      <span className="shrink-0 text-xs text-slate-500">{dataHora(m.dataHora)}</span>
                    </div>
                    {m.complemento && <div className="text-xs text-slate-600">{m.complemento}</div>}
                    <div className="text-xs text-slate-400">
                      código {m.codigo ?? "—"} · relevância pela regra: {m.relevancia}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-xs text-slate-400">Endpoint: {resp.endpoint}</p>
        </div>
      )}
    </Secao>
  );
}

function PreviaMensagem() {
  const [nomeMov, setNomeMov] = useState("Audiência de conciliação designada");
  const [complemento, setComplemento] = useState("");
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<{ texto: string; relevancia: string; gerada_por: string; aviso?: string } | null>(null);
  const [erro, setErro] = useState("");

  async function gerar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setGerando(true);
    try {
      setResultado(
        await chamarFuncao("gerar-mensagem", {
          nome_cliente: "Maria Silva",
          apelido: "divórcio da Maria",
          nome_movimentacao: nomeMov,
          complemento,
          data_hora: new Date().toISOString(),
        }),
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setGerando(false);
    }
  }

  return (
    <Secao
      titulo="Ver exemplo de mensagem"
      descricao="Veja como a IA escreveria para uma cliente fictícia (Maria Silva). Nada é salvo nem enviado."
    >
      <form onSubmit={gerar} className="space-y-2">
        <input className="campo" value={nomeMov} onChange={(e) => setNomeMov(e.target.value)} placeholder="Nome da movimentação" />
        <input className="campo" value={complemento} onChange={(e) => setComplemento(e.target.value)} placeholder="Complemento (opcional)" />
        <button className="btn-secundario" disabled={gerando || !nomeMov.trim()}>{gerando ? "Gerando…" : "Gerar exemplo"}</button>
      </form>
      <div className="mt-3"><Erro>{erro}</Erro></div>
      {resultado && (
        <div className="mt-3 space-y-1">
          <p className="whitespace-pre-line rounded-lg bg-green-50 p-3 text-sm">{resultado.texto}</p>
          <p className="text-xs text-slate-500">
            Relevância: {resultado.relevancia === "baixa" ? "baixa (iria para a aba separada)" : "normal"} ·{" "}
            {resultado.gerada_por === "ia" ? "escrita pela IA" : "texto padrão"}
            {resultado.aviso && ` · ${resultado.aviso}`}
          </p>
        </div>
      )}
    </Secao>
  );
}

function MinhaConta() {
  const { usuario, recarregar } = useAuth();
  const toast = useToast();
  const [nome, setNome] = useState(usuario?.nome ?? "");
  const [senha, setSenha] = useState("");

  async function salvarNome(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("usuarios").update({ nome: nome.trim() || null }).eq("id", usuario!.id);
    if (error) return toast(error.message, "erro");
    await recarregar();
    toast("Nome atualizado.");
  }

  async function trocarSenha(e: FormEvent) {
    e.preventDefault();
    if (senha.length < 8) return toast("A senha precisa ter pelo menos 8 caracteres.", "erro");
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) return toast(error.message, "erro");
    setSenha("");
    toast("Senha alterada.");
  }

  return (
    <Secao titulo="Minha conta">
      <form onSubmit={salvarNome} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="rotulo" htmlFor="m-nome">Seu nome</label>
          <input id="m-nome" className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <button className="btn-secundario">Salvar nome</button>
      </form>
      <form onSubmit={trocarSenha} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="rotulo" htmlFor="m-senha">Nova senha</label>
          <input id="m-senha" type="password" className="campo" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </div>
        <button className="btn-secundario">Trocar senha</button>
      </form>
    </Secao>
  );
}
