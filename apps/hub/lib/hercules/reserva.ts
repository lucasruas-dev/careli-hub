// A RESERVA DA UNIDADE — o primeiro passo da venda, nascendo no Panteon.
//
// Lucas (03/09/2026): *"se a unidade estiver disponível, ter um botão para reservar. Ao clicar, o
// usuário tem que buscar a imobiliária ou corretor (...) para criar uma reserva em nome de um
// corretor ou imobiliária é OBRIGATÓRIO que esses dois estejam habilitados para vender nesse
// empreendimento. Depois que ele aponta corretor e imobiliária, ele vai informar o Nome do cliente,
// CPF e Telefone (somente) e o prazo de vencimento dessa reserva. Quando ele clicar para reservar,
// reserva essa unidade e automaticamente vai ser encaminhada uma mensagem para o corretor,
// imobiliária e coordenador (...) vai sair do número do relacionamento"*.
//
// ⚠️ ESTE ARQUIVO NÃO TOCA BANCO NEM GATEWAY. É a régua e o texto: o que impede uma reserva de
// existir, e o que cada destinatário lê. A rota faz as idas ao Supabase; a tela faz os cliques. O
// que está aqui é o que precisa de teste, e é onde uma regra de negócio errada dói.
//
// ⚠️ A TRAVA DE UMA RESERVA POR UNIDADE É DO BANCO, não daqui — índice parcial
// `hercules_reservas_uma_viva_por_unidade` (migration 0125). Validar em JavaScript "se já existe
// reserva" perderia a corrida entre dois coordenadores clicando no mesmo lote; o índice não perde.
// O papel deste arquivo é traduzir o 23505 do Postgres numa frase que a tela mostra.

import { cpfValido, soDigitos } from "@/lib/apolo/documento";

/** Quem vai comprar. Só três campos: foi o que ele pediu, e é o que a reserva precisa. */
export type ProponenteDaReserva = {
  cpf: string;
  nome: string;
  telefone: string;
};

export type PedidoDeReserva = {
  /** O corretor. Opcional: a reserva pode sair no nome só da imobiliária. */
  corretorEntityId?: null | string;
  imobiliariaEntityId: string;
  proponente: ProponenteDaReserva;
  unidadeId: string;
  /** Quando a reserva vence, em ISO. */
  validadeEm: string;
};

/**
 * Os prazos que a tela oferece com um clique.
 *
 * ⚠️ SÃO ATALHOS, NÃO A REGRA. Não existe prazo de reserva escrito em lugar nenhum do repositório
 * (procurei em `hercules_reservas`, na política comercial e no legado): hoje é combinado por
 * empreendimento. Enquanto a casa não fixar o número, quem reserva escolhe — e o padrão de 3 dias
 * é só o primeiro da lista, não uma decisão de negócio tomada aqui.
 */
export const PRAZOS_SUGERIDOS = [1, 2, 3, 5, 7] as const;

export const PRAZO_PADRAO_EM_DIAS = 3;

/** O teto: acima disso não é reserva, é unidade fora do mercado sem proposta. */
export const PRAZO_MAXIMO_EM_DIAS = 30;

export type ErroDaReserva = {
  campo: "corretor" | "cpf" | "imobiliaria" | "nome" | "telefone" | "unidade" | "validade";
  mensagem: string;
};

/**
 * O telefone tem cara de celular brasileiro?
 *
 * ⚠️ NÃO É PRECIOSISMO: a reserva DISPARA mensagem para esse número. Aceitar "9999" grava uma
 * reserva cujo aviso nunca chega, e ninguém descobre até o cliente ligar cobrando.
 */
export function telefoneParecePossivel(bruto: string): boolean {
  const d = soDigitos(bruto);
  // 10 = fixo com DDD; 11 = celular com DDD; 12/13 = com DDI 55.
  if (d.length < 10 || d.length > 13) return false;
  const nacional = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  if (nacional.length < 10 || nacional.length > 11) return false;
  // DDD válido: 11 a 99, e o primeiro dígito nunca é 0.
  const ddd = Number(nacional.slice(0, 2));
  return ddd >= 11 && ddd <= 99;
}

/**
 * O que impede esta reserva de existir.
 *
 * ⚠️ DEVOLVE TODOS OS ERROS, não o primeiro. Um formulário que reclama de um campo por vez faz a
 * pessoa clicar em "Reservar" quatro vezes para descobrir quatro problemas.
 *
 * ⚠️ A HABILITAÇÃO NÃO É CONFERIDA AQUI. "Corretor e imobiliária habilitados para vender neste
 * empreendimento" depende do banco, e conferir na tela seria conferir no lugar errado: quem decide
 * é a rota, com o vínculo na mão. O que esta função garante é que os dois foram INFORMADOS.
 */
export function conferirReserva(
  pedido: PedidoDeReserva,
  agoraIso: string,
): ErroDaReserva[] {
  const erros: ErroDaReserva[] = [];

  if (!pedido.unidadeId) {
    erros.push({ campo: "unidade", mensagem: "Escolha a unidade." });
  }

  if (!pedido.imobiliariaEntityId) {
    erros.push({
      campo: "imobiliaria",
      mensagem: "A reserva precisa sair no nome de uma imobiliária habilitada.",
    });
  }

  const nome = pedido.proponente.nome.trim();
  if (nome.length < 3 || !nome.includes(" ")) {
    erros.push({ campo: "nome", mensagem: "Informe o nome completo do cliente." });
  }

  if (!cpfValido(pedido.proponente.cpf)) {
    erros.push({ campo: "cpf", mensagem: "CPF inválido." });
  }

  if (!telefoneParecePossivel(pedido.proponente.telefone)) {
    erros.push({
      campo: "telefone",
      mensagem: "Telefone com DDD, para o aviso da reserva chegar.",
    });
  }

  const validade = Date.parse(pedido.validadeEm);
  const agora = Date.parse(agoraIso);
  if (!Number.isFinite(validade)) {
    erros.push({ campo: "validade", mensagem: "Informe o vencimento da reserva." });
  } else if (validade <= agora) {
    erros.push({ campo: "validade", mensagem: "O vencimento tem que ser no futuro." });
  } else if (validade - agora > PRAZO_MAXIMO_EM_DIAS * 86_400_000) {
    erros.push({
      campo: "validade",
      mensagem: `Reserva no máximo por ${PRAZO_MAXIMO_EM_DIAS} dias.`,
    });
  }

  return erros;
}

/**
 * A data de vencimento a partir de um número de dias.
 *
 * ⚠️ VENCE NO FIM DO DIA, e não na hora do clique. Uma reserva feita às 14h com "3 dias" que
 * morresse às 14h do terceiro dia surpreenderia o corretor no meio do expediente. `23:59:59` no
 * fuso de Brasília é o que a pessoa entende por "vale até quinta".
 */
export function vencimentoEmDias(agoraIso: string, dias: number): string {
  const base = new Date(agoraIso);
  if (Number.isNaN(base.getTime())) return agoraIso;
  // −03:00 é o fuso da operação inteira (Careli, Goiás). O offset é fixo: o Brasil não tem mais
  // horário de verão desde 2019.
  const emBrasilia = new Date(base.getTime() - 3 * 3_600_000);
  emBrasilia.setUTCHours(0, 0, 0, 0);
  const fim = emBrasilia.getTime() + (dias + 1) * 86_400_000 - 1_000;
  return new Date(fim + 3 * 3_600_000).toISOString();
}

/** ***.456.789-** — o suficiente para conferir, insuficiente para vazar. */
export function mascararCpf(documento: string): string {
  const so = soDigitos(documento);
  if (so.length !== 11) return so.length > 4 ? `***${so.slice(-4)}` : "documento";
  return `***.${so.slice(3, 6)}.${so.slice(6, 9)}-**`;
}

const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

export type AvisoDaReserva = {
  /** Para quem, na frase — "corretor", "imobiliária", "coordenador". */
  papel: "coordenador" | "corretor" | "imobiliaria";
  texto: string;
};

export type DadosDoAviso = {
  cliente: string;
  corretor: null | string;
  cpf: string;
  empreendimento: string;
  imobiliaria: string;
  /** `000123` — o COD da venda. É por ele que se acha a venda depois, e é o que o corretor anota. */
  codigo: string;
  /** "Quadra 12 · Lote 06", como a tela escreve. */
  unidade: string;
  validadeEm: string;
};

/**
 * As mensagens da reserva, uma por destinatário.
 *
 * ⚠️ TRÊS TEXTOS, E NÃO UM COPIADO TRÊS VEZES. Quem lê muda o que precisa saber: o corretor quer
 * saber que o lote é dele até quando; a imobiliária quer saber qual corretor está com ele; o
 * coordenador quer saber quem reservou o quê no produto dele. Uma mensagem única serviria mal aos
 * três.
 *
 * ⚠️ NEGRITO DE WHATSAPP É *UM ASTERISCO*. Dois é Markdown, e chega literal na conversa.
 *
 * ⚠️ CPF VAI MASCARADO. Ele existe na mensagem para o corretor reconhecer o cliente dele, não para
 * circular por grupo de WhatsApp — e mensagem enviada não volta.
 */
export function avisosDaReserva(dados: DadosDoAviso): AvisoDaReserva[] {
  const ate = DIA.format(new Date(dados.validadeEm));
  const lote = `*${dados.unidade}* (${dados.empreendimento})`;
  const cliente = `*${dados.cliente}* (CPF ${mascararCpf(dados.cpf)})`;
  // ⚠️ O COD ENTRA NA MENSAGEM porque é ali que ele serve (Lucas, 04/09/2026: *"isso tem que ir na
  // mensagem também"*): o corretor anota o número que chegou no WhatsApp e é com ele que liga
  // perguntando da venda. Código que só existe na tela obriga a abrir a tela para descobrir o
  // código.
  const cod = dados.codigo ? `COD *${dados.codigo}*.` : "";

  return [
    {
      papel: "corretor",
      texto: [
        `Olá, ${dados.corretor ?? "tudo bem"}!`,
        "",
        `A unidade ${lote} está *reservada* para ${cliente}.`,
        `A reserva vale até *${ate}*. ${cod}`.trim(),
        "",
        "Depois desse prazo a unidade volta para o mapa automaticamente. Para seguir com a venda, gere a proposta antes do vencimento.",
      ].join("\n"),
    },
    {
      papel: "imobiliaria",
      texto: [
        `Olá, ${dados.imobiliaria}!`,
        "",
        `A unidade ${lote} foi *reservada* para ${cliente}.`,
        dados.corretor ? `Corretor responsável: *${dados.corretor}*.` : "Reserva no nome da imobiliária.",
        `Válida até *${ate}*. ${cod}`.trim(),
      ].join("\n"),
    },
    {
      papel: "coordenador",
      texto: [
        `Reserva registrada em ${dados.empreendimento}.`,
        "",
        `Unidade: ${lote}`,
        `Cliente: ${cliente}`,
        `Imobiliária: *${dados.imobiliaria}*`,
        dados.corretor ? `Corretor: *${dados.corretor}*` : "Corretor: não informado",
        `Vence em *${ate}*`,
        dados.codigo ? `COD: *${dados.codigo}*` : "",
      ].join("\n"),
    },
  ];
}

// ── A RESERVA DENTRO DO FLUXO ───────────────────────────────────────────────
//
// ⚠️ A RESERVA VIRA UMA LINHA DO FLUXO, e não um caso especial em cada consumidor. A tela Venda
// inteira — funil, grade, mapa, lista analítica, ranking de imobiliária — é construída a partir de
// `PropostaDaCarga`. Ensinar cada uma dessas peças a também conhecer `hercules_reservas` daria
// cinco lugares para esquecer; convertida aqui, a reserva aparece nas cinco de graça.
//
// ⚠️ E ELA É A ETAPA `reservado` DO FLUXO, não a `reservada` do cadastro. As duas existem e são
// diferentes: `reservada` é "a unidade diz que está reservada e não há nada que sustente" (o par de
// "vendida sem proposta"). A reserva do Panteon tem dono, prazo e quem a criou — é passo do
// caminho, e conta no funil.

export type ReservaDoFluxo = {
  criado_em: string;
  id: string;
  imobiliaria_nome: null | string;
  observacao?: null | string;
  proponentes: unknown;
  protocolo_numero?: null | number;
  unidade_id: string;
  validade_em: null | string;
};

export type UnidadeDaLinha = {
  codigo: string;
  lote: null | string;
  preco_tabela: null | number;
  quadra: null | string;
};

/** O primeiro proponente é o titular — o nome que a lista mostra. */
function titular(proponentes: unknown): { cpf: string; nome: string } {
  const lista = Array.isArray(proponentes) ? proponentes : [];
  const primeiro = lista[0] as null | undefined | { cpf?: unknown; nome?: unknown };
  return {
    cpf: typeof primeiro?.cpf === "string" ? primeiro.cpf : "",
    nome: typeof primeiro?.nome === "string" ? primeiro.nome : "",
  };
}

/**
 * A reserva como o fluxo de venda a enxerga.
 *
 * ⚠️ O ID GANHA PREFIXO. `hercules_reservas.id` e `hercules_propostas.id` são dois uuids de tabelas
 * diferentes: sem `reserva:` na frente, uma colisão (ou um clique na lista) abriria a proposta
 * errada, e o bug só apareceria muito depois.
 */
export function reservaComoLinhaDoFluxo(
  reserva: ReservaDoFluxo,
  unidade: null | UnidadeDaLinha,
  empreendimentoCodigo: null | string,
): {
  cliente_documento: null | string;
  cliente_nome: null | string;
  codigo: null | string;
  contrato_parcelas: null;
  criado_em_c2x: null | string;
  data_assinatura: null;
  data_ato: null;
  data_faturamento: null;
  empreendimento_codigo: null | string;
  etapa: string;
  etapa_c2x: null;
  etapa_desde: null | string;
  id: string;
  imobiliaria_nome: null | string;
  motivo: null | string;
  observacao: null | string;
  plano_correcao: null;
  plano_juros: null;
  plano_nome: null;
  plano_parcelas: null;
  plano_personalizado: null;
  protocolo_numero: null | number;
  unidade_id: null | string;
  unidade_nome: null | string;
  valor: null | number;
} {
  const dono = titular(reserva.proponentes);
  const nomeDaUnidade =
    unidade?.quadra && unidade.lote
      ? `${unidade.quadra} ${unidade.lote}`
      : (unidade?.codigo ?? null);

  return {
    cliente_documento: dono.cpf || null,
    cliente_nome: dono.nome || null,
    codigo: null,
    contrato_parcelas: null,
    criado_em_c2x: reserva.criado_em,
    data_assinatura: null,
    data_ato: null,
    data_faturamento: null,
    empreendimento_codigo: empreendimentoCodigo,
    etapa: "reservado",
    etapa_c2x: null,
    etapa_desde: reserva.criado_em,
    id: `reserva:${reserva.id}`,
    imobiliaria_nome: reserva.imobiliaria_nome,
    // A reserva não tem plano nem valor negociado: o que existe é o preço de tabela do lote, e é
    // ele que entra no VGV do funil — dizer zero encolheria o pipeline sem motivo.
    motivo: null,
    observacao: reserva.observacao ?? null,
    plano_correcao: null,
    plano_juros: null,
    plano_nome: null,
    plano_parcelas: null,
    plano_personalizado: null,
    protocolo_numero: reserva.protocolo_numero ?? null,
    unidade_id: reserva.unidade_id,
    unidade_nome: nomeDaUnidade,
    valor: unidade?.preco_tabela ?? null,
  };
}
