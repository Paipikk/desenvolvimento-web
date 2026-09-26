import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { Erro, Girando } from "../components/ui";
import { normalizarTelefone } from "../lib/formato";

type Modo = "entrar" | "cadastrar" | "recuperar";

export default function Entrar() {
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [convidado, setConvidado] = useState(false);
  const [escritorioNome, setEscritorioNome] = useState("");
  const [oab, setOab] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    setEnviando(true);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw new Error(traduzir(error.message));
      } else if (modo === "cadastrar") {
        if (!convidado && !escritorioNome.trim()) throw new Error("Informe o nome do escritório.");
        if (senha.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
        const { data, error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: {
            emailRedirectTo: window.location.origin,
            data: convidado
              ? { nome }
              : { nome, escritorio_nome: escritorioNome, oab_responsavel: oab, telefone: normalizarTelefone(telefone) },
          },
        });
        if (error) throw new Error(traduzir(error.message));
        if (!data.session) {
          setAviso("Enviamos um e-mail de confirmação. Clique no link recebido para entrar.");
          setModo("entrar");
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw new Error(traduzir(error.message));
        setAviso("Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.");
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold text-marca-700">Andamento</div>
          <p className="mt-2 text-slate-600">Seus clientes informados sobre cada novidade do processo, sem você precisar escrever nada.</p>
        </div>

        <div className="cartao p-6">
          {modo !== "recuperar" && (
            <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
              {(["entrar", "cadastrar"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setModo(m); setErro(""); }}
                  className={`rounded-md py-2 font-medium ${modo === m ? "bg-white shadow-sm" : "text-slate-600"}`}
                >
                  {m === "entrar" ? "Entrar" : "Criar conta"}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={enviar} className="space-y-4">
            {modo === "cadastrar" && (
              <>
                <div>
                  <label className="rotulo" htmlFor="nome">Seu nome</label>
                  <input id="nome" className="campo" value={nome} onChange={(e) => setNome(e.target.value)} required autoComplete="name" />
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="mt-1" checked={convidado} onChange={(e) => setConvidado(e.target.checked)} />
                  Fui convidado para um escritório que já usa o Andamento
                </label>
                {!convidado && (
                  <>
                    <div>
                      <label className="rotulo" htmlFor="escr">Nome do escritório</label>
                      <input id="escr" className="campo" value={escritorioNome} onChange={(e) => setEscritorioNome(e.target.value)} placeholder="Ex.: Silva & Souza Advogados" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="rotulo" htmlFor="oab">OAB do responsável</label>
                        <input id="oab" className="campo" value={oab} onChange={(e) => setOab(e.target.value)} placeholder="RS 123.456" />
                      </div>
                      <div>
                        <label className="rotulo" htmlFor="tel">Telefone</label>
                        <input id="tel" className="campo" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(51) 99999-0000" />
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            <div>
              <label className="rotulo" htmlFor="email">E-mail</label>
              <input id="email" type="email" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            {modo !== "recuperar" && (
              <div>
                <label className="rotulo" htmlFor="senha">Senha</label>
                <input
                  id="senha"
                  type="password"
                  className="campo"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                  minLength={modo === "cadastrar" ? 8 : undefined}
                  autoComplete={modo === "cadastrar" ? "new-password" : "current-password"}
                />
              </div>
            )}

            <Erro>{erro}</Erro>
            {aviso && <div className="rounded-lg bg-marca-50 px-3 py-2 text-sm text-marca-800">{aviso}</div>}

            <button type="submit" className="btn-primario w-full" disabled={enviando}>
              {enviando && <Girando />}
              {modo === "entrar" ? "Entrar" : modo === "cadastrar" ? "Criar conta" : "Enviar link"}
            </button>
          </form>

          <div className="mt-4 text-center text-sm">
            {modo === "recuperar" ? (
              <button className="text-marca-700 hover:underline" onClick={() => setModo("entrar")}>Voltar para o login</button>
            ) : (
              modo === "entrar" && (
                <button className="text-marca-700 hover:underline" onClick={() => setModo("recuperar")}>Esqueci minha senha</button>
              )
            )}
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          Os dados dos seus clientes ficam visíveis apenas para o seu escritório.
        </p>
      </div>
    </div>
  );
}

function traduzir(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(msg)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (/already registered/i.test(msg)) return "Este e-mail já tem cadastro. Use a opção Entrar.";
  if (/rate limit/i.test(msg)) return "Muitas tentativas. Aguarde alguns minutos.";
  return msg;
}
