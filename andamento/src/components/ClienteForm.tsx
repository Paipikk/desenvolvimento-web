import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type { Cliente } from "../lib/tipos";
import { formatarTelefone, normalizarTelefone, telefoneValido } from "../lib/formato";
import { Erro, Girando } from "./ui";

export default function ClienteForm({
  cliente,
  onSalvo,
  onCancelar,
}: {
  cliente?: Cliente;
  onSalvo: (c: Cliente) => void;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState(cliente?.nome ?? "");
  const [telefone, setTelefone] = useState(cliente ? formatarTelefone(cliente.telefone) : "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [observacoes, setObservacoes] = useState(cliente?.observacoes ?? "");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (!nome.trim()) return setErro("Informe o nome do cliente.");
    if (!telefoneValido(telefone)) return setErro("Informe o WhatsApp com DDD, ex.: (51) 99999-0000.");
    setSalvando(true);
    const dados = {
      nome: nome.trim(),
      telefone: normalizarTelefone(telefone),
      email: email.trim() || null,
      observacoes: observacoes.trim() || null,
    };
    const q = cliente
      ? supabase.from("clientes").update(dados).eq("id", cliente.id)
      : supabase.from("clientes").insert(dados);
    const { data, error } = await q.select("id, nome, telefone, email, observacoes, criado_em").single();
    setSalvando(false);
    if (error) return setErro("Não foi possível salvar. " + error.message);
    onSalvo(data as Cliente);
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <div>
        <label className="rotulo" htmlFor="c-nome">Nome completo</label>
        <input id="c-nome" className="campo" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="rotulo" htmlFor="c-tel">WhatsApp (com DDD)</label>
        <input
          id="c-tel"
          className="campo"
          inputMode="tel"
          placeholder="(51) 99999-0000"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          onBlur={() => telefoneValido(telefone) && setTelefone(formatarTelefone(telefone))}
        />
      </div>
      <div>
        <label className="rotulo" htmlFor="c-email">E-mail <span className="font-normal text-slate-400">(opcional)</span></label>
        <input id="c-email" type="email" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="rotulo" htmlFor="c-obs">Observações <span className="font-normal text-slate-400">(opcional, só o escritório vê)</span></label>
        <textarea id="c-obs" rows={3} className="campo" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </div>
      <Erro>{erro}</Erro>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secundario" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn-primario" disabled={salvando}>
          {salvando && <Girando />} Salvar
        </button>
      </div>
    </form>
  );
}
