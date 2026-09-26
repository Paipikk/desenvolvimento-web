import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type { Processo } from "../lib/tipos";
import { mascararCnj, validarCnj } from "@shared/cnj";
import { TRIBUNAIS, tribunalPeloNumero } from "@shared/tribunais";
import { Erro, Girando } from "./ui";

const GRUPOS = ["Estadual", "Trabalho", "Federal", "Eleitoral", "Militar", "Superior"] as const;

export function SeletorTribunal({ valor, onChange, id }: { valor: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select id={id} className="campo" value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecione…</option>
      {GRUPOS.map((g) => (
        <optgroup key={g} label={g === "Superior" ? "Tribunais superiores" : `Justiça ${g}`}>
          {TRIBUNAIS.filter((t) => t.grupo === g).map((t) => (
            <option key={t.sigla} value={t.sigla}>{t.sigla} — {t.nome}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function ProcessoForm({
  clienteId,
  processo,
  onSalvo,
  onCancelar,
}: {
  clienteId?: string;
  processo?: Processo;
  onSalvo: (p: Processo, novo: boolean) => void;
  onCancelar: () => void;
}) {
  const [numero, setNumero] = useState(processo ? mascararCnj(processo.numero_cnj) : "");
  const [tribunal, setTribunal] = useState(processo?.tribunal ?? "");
  const [tribunalManual, setTribunalManual] = useState(Boolean(processo));
  const [apelido, setApelido] = useState(processo?.apelido ?? "");
  const [cliente, setCliente] = useState(processo?.cliente_id ?? clienteId ?? "");
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (clienteId) return;
    supabase.from("clientes").select("id, nome").order("nome").then(({ data }) => setClientes(data ?? []));
  }, [clienteId]);

  const digitos = numero.replace(/\D/g, "");
  const validacao = useMemo(() => (digitos.length === 20 ? validarCnj(numero) : null), [numero, digitos.length]);

  // Sugere o tribunal a partir do número (segmentos J e TR)
  useEffect(() => {
    if (tribunalManual || digitos.length !== 20) return;
    const sugerido = tribunalPeloNumero(digitos);
    if (sugerido) setTribunal(sugerido);
  }, [digitos, tribunalManual]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    const v = validarCnj(numero);
    if (!v.valido) return setErro(v.erro);
    if (!tribunal) return setErro("Selecione o tribunal.");
    if (!cliente) return setErro("Selecione o cliente.");
    setSalvando(true);
    const dados = { numero_cnj: v.numero, tribunal, apelido: apelido.trim() || null, cliente_id: cliente };
    const q = processo
      ? supabase.from("processos").update(dados).eq("id", processo.id)
      : supabase.from("processos").insert(dados);
    const { data, error } = await q.select("*").single();
    setSalvando(false);
    if (error) {
      if (error.code === "23505") return setErro("Este processo já está cadastrado no escritório.");
      return setErro("Não foi possível salvar. " + error.message);
    }
    onSalvo(data as Processo, !processo);
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <div>
        <label className="rotulo" htmlFor="p-num">Número do processo (CNJ)</label>
        <input
          id="p-num"
          className="campo font-mono"
          inputMode="numeric"
          placeholder="0000000-00.0000.0.00.0000"
          value={numero}
          onChange={(e) => setNumero(mascararCnj(e.target.value))}
          autoFocus
        />
        {validacao && !validacao.valido && <p className="mt-1 text-sm text-red-600">{validacao.erro}</p>}
        {validacao?.valido && <p className="mt-1 text-sm text-marca-700">✓ Número válido</p>}
        {!validacao && digitos.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">{digitos.length} de 20 dígitos</p>
        )}
      </div>

      <div>
        <label className="rotulo" htmlFor="p-trib">Tribunal</label>
        <SeletorTribunal
          id="p-trib"
          valor={tribunal}
          onChange={(v) => {
            setTribunal(v);
            setTribunalManual(true);
          }}
        />
        {!tribunalManual && tribunal && (
          <p className="mt-1 text-xs text-slate-500">Identificado automaticamente pelo número. Altere se necessário.</p>
        )}
      </div>

      <div>
        <label className="rotulo" htmlFor="p-apelido">
          Apelido <span className="font-normal text-slate-400">(opcional — como o cliente conhece o processo)</span>
        </label>
        <input
          id="p-apelido"
          className="campo"
          placeholder="Ex.: divórcio da Maria, ação contra a operadora"
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          maxLength={80}
        />
      </div>

      {!clienteId && (
        <div>
          <label className="rotulo" htmlFor="p-cli">Cliente</label>
          <select id="p-cli" className="campo" value={cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="">Selecione…</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>
      )}

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
