// INDEFERIMENTO — quando a Têmis recusa o trabalho e devolve a quem vendeu.
//
// Lucas (10/09/2026): *"Temos que ter uma sessão de Indeferimento, o deferimento tem que chegar no
// corretor - imobiliaria - coordenador. Ae temos que ter os motivos e tal"*.
//
// ⚠️ NÃO É REPROVA DE CRÉDITO, e a confusão já aconteceu uma vez. Lucas, no mesmo dia: *"credito?
// não tem credito na temis"*. Crédito mora no Apolo — esteira de CAD e Serasa, antes da venda.
// Aqui o que se recusa é o TRABALHO: o processo chegou do Hércules e não dá para produzir o
// documento como está.
//
// ⚠️ LISTA PRONTA MAIS OBSERVAÇÃO, e a razão da lista é medição. Motivo escrito à mão não se
// conta: com catálogo dá para responder "qual motivo mais repete?" e atacar a causa — se metade
// dos indeferimentos é documento faltando, o problema está na entrada do Hércules, não na Têmis.
// A observação existe porque catálogo nenhum cobre o caso concreto.

/** O código gravado em `temis_trabalhos.indeferido_motivo`. */
export type MotivoDeIndeferimento = (typeof MOTIVOS)[number]["codigo"];

/**
 * O catálogo.
 *
 * ⚠️ VIVE NO CÓDIGO, E NÃO EM TABELA. Lucas escolheu "lista pronta + observação", e não "lista que
 * você cadastra": são poucos motivos, mudam raramente, e uma tela de Setup para gerenciá-los seria
 * mais tela do que valor. Se um dia virar cadastro, o `codigo` é a chave que sobrevive à mudança —
 * é ele que está gravado nas linhas antigas.
 *
 * ⚠️ E O `codigo` NUNCA MUDA depois de usado. Ele está gravado no banco e viaja nas mensagens
 * enviadas; renomear um código transforma o histórico em motivo desconhecido. Para corrigir uma
 * palavra, mude o `rotulo` — ele é o que aparece na tela.
 */
export const MOTIVOS = [
  {
    codigo: "documento_faltando",
    // O que a pessoa do outro lado precisa FAZER. O rótulo do motivo é a primeira coisa que o
    // corretor lê na mensagem, então ele diz o problema, não a categoria.
    descricao: "Falta documento do proponente ou do cônjuge para montar o contrato.",
    rotulo: "Documento faltando",
  },
  {
    codigo: "dado_divergente",
    descricao: "Um dado do contrato não bate com o cadastro (nome, CPF, estado civil, endereço).",
    rotulo: "Dado divergente do cadastro",
  },
  {
    codigo: "proponente_sem_cadastro",
    descricao: "O proponente não tem cadastro no Apolo, ou o cadastro está incompleto.",
    rotulo: "Proponente sem cadastro",
  },
  {
    codigo: "condicao_nao_confere",
    descricao: "O plano, a entrada ou o valor não conferem com a proposta aprovada.",
    rotulo: "Condição de pagamento não confere",
  },
  {
    codigo: "unidade_com_pendencia",
    descricao: "A unidade tem pendência que impede a venda (bloqueio, matrícula, reserva de outro).",
    rotulo: "Unidade com pendência",
  },
  {
    codigo: "outro",
    // ⚠️ EXISTE DE PROPÓSITO, e a observação vira obrigatória quando ele é escolhido: sem o campo
    // livre, "outro" é exatamente o motivo que não diz nada — e é o que mais aparece quando a
    // lista não cobre o caso.
    descricao: "O caso não se encaixa nos anteriores. Explique na observação.",
    rotulo: "Outro motivo",
  },
] as const;

const CODIGOS = new Set<string>(MOTIVOS.map((m) => m.codigo));

/** O motivo, ou `null` quando o código não existe (linha antiga, código renomeado). */
export function motivoDeIndeferimento(
  codigo: null | string | undefined,
): (typeof MOTIVOS)[number] | null {
  const limpo = String(codigo ?? "").trim();
  return MOTIVOS.find((m) => m.codigo === limpo) ?? null;
}

/** Como o motivo aparece na tela e na mensagem. Código desconhecido sai como ele mesmo. */
export function rotuloDoMotivo(codigo: null | string | undefined): string {
  const limpo = String(codigo ?? "").trim();
  if (!limpo) return "Sem motivo";
  return motivoDeIndeferimento(limpo)?.rotulo ?? limpo;
}

export type PedidoDeIndeferimento = {
  motivo: string;
  observacao: string;
};

export type IndeferimentoConferido =
  | { erro: string; ok: false }
  | { motivo: MotivoDeIndeferimento; observacao: null | string; ok: true };

/**
 * A conferência antes de gravar.
 *
 * ⚠️ FAIL-CLOSED, e o motivo é que o indeferimento SAI DA CASA. Ele vira mensagem para o corretor
 * e para a imobiliária; um motivo vazio, ou um código inventado pelo cliente da API, produziria
 * uma mensagem dizendo "seu contrato foi recusado por" e nada depois.
 */
export function conferirIndeferimento(
  pedido: PedidoDeIndeferimento,
): IndeferimentoConferido {
  const motivo = String(pedido.motivo ?? "").trim();
  const observacao = String(pedido.observacao ?? "").trim();

  if (!motivo) return { erro: "Escolha o motivo do indeferimento.", ok: false };
  if (!CODIGOS.has(motivo)) return { erro: "Motivo desconhecido.", ok: false };

  // "Outro" sem explicação é o mesmo que não dizer nada — e é justamente o que a pessoa do outro
  // lado precisa para corrigir.
  if (motivo === "outro" && !observacao) {
    return { erro: "Explique o motivo na observação.", ok: false };
  }

  return {
    motivo: motivo as MotivoDeIndeferimento,
    observacao: observacao || null,
    ok: true,
  };
}

/**
 * O texto que chega em quem vendeu.
 *
 * ⚠️ QUEM LÊ ESTÁ FORA DA CASA — corretor e imobiliária, pela central de Relacionamento. Então:
 * sem jargão de sistema ("estágio", "card", "trabalho"), sem travessão
 * ([[feedback_sem_travessao]]), e sempre dizendo O QUE FAZER. Um aviso que só informa a recusa
 * devolve o problema sem devolver o caminho.
 */
export function textoDoIndeferimento(dados: {
  motivo: string;
  observacao: null | string;
  unidade: string;
}): string {
  const motivo = motivoDeIndeferimento(dados.motivo);
  const linhas = [
    `O contrato da unidade ${dados.unidade} voltou para correção.`,
    "",
    `Motivo: ${motivo?.rotulo ?? dados.motivo}`,
  ];

  if (dados.observacao) linhas.push(`Detalhe: ${dados.observacao}`);
  else if (motivo) linhas.push(motivo.descricao);

  linhas.push("", "Corrija e envie de novo pelo Panteon.");
  return linhas.join("\n");
}
