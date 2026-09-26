import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Cliente } from "../lib/tipos";
import { Cabecalho, Carregando, EstadoVazio, Modal } from "../components/ui";
import ClienteForm from "../components/ClienteForm";
import { formatarTelefone } from "../lib/formato";
import { useToast } from "../components/Toast";

type ClienteLista = Cliente & { processos: { count: number }[] };

function semAcento(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default function Clientes() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const toast = useToast();
  const [clientes, setClientes] = useState<ClienteLista[] | null>(null);
  const [busca, setBusca] = useState("");
  const novoAberto = params.get("novo") === "1";

  async function carregar() {
    const { data } = await supabase
      .from("clientes")
      .select("id, nome, telefone, email, observacoes, criado_em, processos(count)")
      .order("nome");
    setClientes((data as ClienteLista[]) ?? []);
  }
  useEffect(() => {
    carregar();
  }, []);

  const filtrados = useMemo(() => {
    if (!clientes) return [];
    const b = semAcento(busca.trim());
    const digitos = busca.replace(/\D/g, "");
    if (!b) return clientes;
    return clientes.filter(
      (c) =>
        semAcento(c.nome).includes(b) ||
        (digitos.length >= 3 && c.telefone.includes(digitos)) ||
        (c.email && semAcento(c.email).includes(b)),
    );
  }, [clientes, busca]);

  const fecharNovo = () => setParams({});

  return (
    <div>
      <Cabecalho
        titulo="Clientes"
        subtitulo={clientes ? `${clientes.length} cliente(s)` : undefined}
        acoes={<button className="btn-primario" onClick={() => setParams({ novo: "1" })}>+ Novo cliente</button>}
      />

      {clientes === null ? (
        <Carregando />
      ) : clientes.length === 0 ? (
        <EstadoVazio
          icone="👥"
          titulo="Nenhum cliente cadastrado"
          texto="Cadastre o cliente com o WhatsApp dele. Depois você liga os processos a ele e o Andamento avisa sobre cada novidade."
          acao={{ rotulo: "Cadastrar primeiro cliente", onClick: () => setParams({ novo: "1" }) }}
        />
      ) : (
        <>
          <input
            type="search"
            className="campo mb-4"
            placeholder="Buscar por nome, telefone ou e-mail"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {filtrados.length === 0 ? (
            <p className="py-8 text-center text-slate-500">Nenhum cliente encontrado para “{busca}”.</p>
          ) : (
            <div className="cartao divide-y divide-slate-100">
              {filtrados.map((c) => (
                <Link key={c.id} to={`/clientes/${c.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.nome}</div>
                    <div className="text-sm text-slate-500">{formatarTelefone(c.telefone)}</div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    {c.processos?.[0]?.count ?? 0} processo(s)
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <Modal aberto={novoAberto} titulo="Novo cliente" onFechar={fecharNovo}>
        <ClienteForm
          onCancelar={fecharNovo}
          onSalvo={(c) => {
            toast("Cliente cadastrado. Agora cadastre o processo dele.");
            navegar(`/clientes/${c.id}?novoProcesso=1`);
          }}
        />
      </Modal>
    </div>
  );
}
