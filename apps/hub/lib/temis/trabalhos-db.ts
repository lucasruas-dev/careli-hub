// A LEITURA E A ESCRITA DOS TRABALHOS DA TÊMIS — num lugar só.
//
// ⚠️ O CARD ANDA SOZINHO, E QUEM O FAZ ANDAR É ESTA CAMADA. Pedido do Lucas (02/09/2026): *"queria
// que isso andasse sozinho"*. Marcar a última atividade do estágio avança o card na mesma chamada:
// se o avanço dependesse de a tela pedir, uma tela nova (ou uma rota, ou um script) marcaria a
// atividade e deixaria o card para trás — e o board mostraria como pendente o que já acabou.
//
// ⚠️ E O `estagio_desde` REINICIA A CADA AVANÇO. É dele que os prazos contam. Sem reiniciar, um card
// que passou uma semana na entrada chegaria à confecção já atrasado, e o vermelho apareceria em quem
// pegou o trabalho, não em quem o deixou parado.

import { createApoloAdminClient } from "@/lib/apolo/server";

import {
  type EstagioDoTrabalho,
  type TipoDeTrabalho,
  type Trabalho,
  podeAvancar,
  proximoEstagio,
} from "./trabalhos";

export type CanalDoTrabalho = "coordenador" | "hercules" | "iris";

type LinhaCrua = {
  atividades_feitas: string[];
  canal: string;
  cliente_cpf: null | string;
  cliente_nome: string;
  criado_em: string;
  enterprise_codigo: string;
  enterprise_id: string;
  enterprise_nome: string;
  estagio: string;
  estagio_desde: string;
  evidencia_path: null | string;
  id: string;
  iris_ticket_id: null | string;
  observacao: null | string;
  tipo: string;
  trabalho_origem_id: null | string;
  unidade: string;
};

export type TrabalhoDoBoard = Trabalho & {
  canal: CanalDoTrabalho;
  evidenciaPath: null | string;
  irisTicketId: null | string;
};

const CAMPOS =
  "id, tipo, estagio, estagio_desde, enterprise_id, enterprise_codigo, enterprise_nome, unidade, cliente_nome, cliente_cpf, atividades_feitas, observacao, canal, iris_ticket_id, evidencia_path, trabalho_origem_id, criado_em";

function mapear(l: LinhaCrua): TrabalhoDoBoard {
  return {
    atividadesFeitas: Array.isArray(l.atividades_feitas) ? l.atividades_feitas : [],
    canal: l.canal as CanalDoTrabalho,
    clienteCpf: l.cliente_cpf,
    clienteNome: l.cliente_nome,
    criadoEm: l.criado_em,
    empreendimentoCodigo: l.enterprise_codigo,
    empreendimentoNome: l.enterprise_nome,
    estagio: l.estagio as EstagioDoTrabalho,
    estagioDesde: l.estagio_desde,
    evidenciaPath: l.evidencia_path,
    id: l.id,
    irisTicketId: l.iris_ticket_id,
    observacao: l.observacao,
    tipo: l.tipo as TipoDeTrabalho,
    trabalhoOrigemId: l.trabalho_origem_id,
    unidade: l.unidade,
  };
}

/** Tudo que está no board. Finalizado entra também: some da fila, não do histórico. */
export async function trabalhosDoBoard(input?: {
  enterpriseId?: string;
}): Promise<TrabalhoDoBoard[]> {
  const supabase = createApoloAdminClient();
  if (!supabase) return [];

  let consulta = supabase
    .from("temis_trabalhos")
    .select(CAMPOS)
    .eq("workspace_id", "careli")
    .order("estagio_desde", { ascending: true });

  if (input?.enterpriseId) consulta = consulta.eq("enterprise_id", input.enterpriseId);

  const { data, error } = await consulta;
  if (error || !data) return [];
  return (data as LinhaCrua[]).map(mapear);
}

export type NovoTrabalho = {
  canal: CanalDoTrabalho;
  clienteCpf: null | string;
  clienteNome: string;
  empreendimentoCodigo: string;
  empreendimentoId: string;
  empreendimentoNome: string;
  evidenciaPath?: null | string;
  irisTicketId?: null | string;
  observacao?: null | string;
  tipo: TipoDeTrabalho;
  trabalhoOrigemId?: null | string;
  unidade: string;
};

/**
 * Abre uma solicitação.
 *
 * ⚠️ A REGRA DO RASTRO É CONFERIDA AQUI E NO BANCO, e a repetição é deliberada. O CHECK da tabela é
 * a garantia; esta conferência é o que devolve uma frase legível em vez de um erro de constraint que
 * o operador não sabe o que fazer com.
 */
export async function abrirTrabalho(
  novo: NovoTrabalho,
): Promise<{ erro: string; ok: false } | { id: string; ok: true }> {
  if (novo.canal === "iris" && (!novo.irisTicketId || !novo.evidenciaPath)) {
    return {
      erro: "solicitação pelo atendimento exige o ticket da Iris e a evidência do pedido do cliente",
      ok: false,
    };
  }

  const supabase = createApoloAdminClient();
  if (!supabase) return { erro: "sem acesso ao banco", ok: false };

  const { data, error } = await supabase
    .from("temis_trabalhos")
    .insert({
      canal: novo.canal,
      cliente_cpf: novo.clienteCpf,
      cliente_nome: novo.clienteNome,
      enterprise_codigo: novo.empreendimentoCodigo,
      enterprise_id: novo.empreendimentoId,
      enterprise_nome: novo.empreendimentoNome,
      evidencia_path: novo.evidenciaPath ?? null,
      iris_ticket_id: novo.irisTicketId ?? null,
      observacao: novo.observacao ?? null,
      tipo: novo.tipo,
      trabalho_origem_id: novo.trabalhoOrigemId ?? null,
      unidade: novo.unidade,
      workspace_id: "careli",
    })
    .select("id")
    .single();

  if (error || !data) return { erro: error?.message ?? "não consegui abrir", ok: false };
  return { id: data.id as string, ok: true };
}

/**
 * Marca (ou desmarca) uma atividade — e faz o card andar quando o estágio acaba.
 *
 * ⚠️ DESMARCAR NÃO FAZ O CARD VOLTAR. Quem já passou de estágio e desmarca uma atividade está
 * corrigindo o registro, não desfazendo trabalho: puxar o card para trás sozinho tiraria da fila de
 * assinatura um documento que já foi despachado.
 */
export async function marcarAtividade(input: {
  atividade: string;
  feita: boolean;
  id: string;
}): Promise<{ erro: string; ok: false } | { andou: boolean; estagio: EstagioDoTrabalho; ok: true }> {
  const supabase = createApoloAdminClient();
  if (!supabase) return { erro: "sem acesso ao banco", ok: false };

  const { data: atual, error: erroLeitura } = await supabase
    .from("temis_trabalhos")
    .select(CAMPOS)
    .eq("id", input.id)
    .single();
  if (erroLeitura || !atual) return { erro: "trabalho não encontrado", ok: false };

  const trabalho = mapear(atual as LinhaCrua);
  const feitas = new Set(trabalho.atividadesFeitas);
  if (input.feita) feitas.add(input.atividade);
  else feitas.delete(input.atividade);

  const depois = { ...trabalho, atividadesFeitas: [...feitas] };
  const avanca = input.feita && podeAvancar(depois);
  const seguinte = avanca ? proximoEstagio(depois.tipo, depois.estagio) : null;

  const mudanca: Record<string, unknown> = {
    atividades_feitas: [...feitas],
    atualizado_em: new Date().toISOString(),
  };
  if (seguinte) {
    mudanca.estagio = seguinte;
    // ⚠️ O RELÓGIO DO PRAZO REINICIA AQUI, e não na criação do card.
    mudanca.estagio_desde = new Date().toISOString();
  }

  const { error } = await supabase.from("temis_trabalhos").update(mudanca).eq("id", input.id);
  if (error) return { erro: error.message, ok: false };

  return { andou: Boolean(seguinte), estagio: seguinte ?? trabalho.estagio, ok: true };
}
