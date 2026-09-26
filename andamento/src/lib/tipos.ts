export type StatusMensagem = "pendente" | "aprovada" | "enviada" | "ignorada";
export type Relevancia = "normal" | "baixa";

export type Escritorio = {
  id: string;
  nome: string;
  oab_responsavel: string | null;
  telefone: string | null;
  assinatura: string | null;
  horario_consulta: number;
  email_resposta: string | null;
};

export type Usuario = {
  id: string;
  escritorio_id: string;
  nome: string | null;
  email: string | null;
  papel: "admin" | "membro";
};

export type Cliente = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  observacoes: string | null;
  criado_em: string;
};

export type Processo = {
  id: string;
  cliente_id: string;
  numero_cnj: string;
  tribunal: string;
  apelido: string | null;
  ativo: boolean;
  ultima_consulta: string | null;
  ultima_tentativa: string | null;
  ultimo_erro: string | null;
  falhas_consecutivas: number;
  criado_em: string;
};

export type Movimentacao = {
  id: string;
  processo_id: string;
  codigo: number | null;
  nome: string;
  data_hora: string;
  complemento: string | null;
  relevancia: Relevancia;
  criado_em: string;
};

export type Mensagem = {
  id: string;
  movimentacao_id: string;
  texto_gerado: string;
  texto_final: string;
  status: StatusMensagem;
  relevancia: Relevancia;
  gerada_por: "ia" | "modelo";
  canal: "whatsapp_link" | "whatsapp_api" | "email" | null;
  erro_envio: string | null;
  aprovada_em: string | null;
  enviada_em: string | null;
  criado_em: string;
};

export type ResultadoSincronizacao = {
  processo_id: string;
  sucesso: boolean;
  novas: number;
  mensagens: number;
  erro?: string;
  avisos?: string[];
};
