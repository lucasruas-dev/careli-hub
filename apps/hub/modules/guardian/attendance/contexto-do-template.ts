// O CONTEXTO QUE O TEMPLATE DE COBRANÇA PRECISA — montado na TELA do Hades, lido pela rota.
//
// ⚠️ A ROTA SÓ LÊ ESTES NOMES. `/api/iris/tickets` preenche {{empreendimento}}, {{unidade}},
// {{saldo_aberto}}, {{valor}}, {{vencimento}}, {{dias_atraso}} e {{link_boleto}} a partir de
// `metadata.relatedEnterprise`, `relatedUnit`, `relatedOpenBalance`... Chave que não chega vira
// "-" NO TEXTO QUE O CLIENTE RECEBE.
//
// Foi exatamente o que aconteceu de 02/07 a 01/10/2026: o modal de cobrança do Hades mandava o
// empreendimento em `metadata.cobranca.empreendimento` e as unidades em `cobranca.unidades`, e
// não mandava saldo nenhum. Medido em 01/10/2026: TODAS as ~2.400 mensagens dos templates
// "Confirmação de titular e pendência" e "Parcelas vencidas do empreendimento" saíram com
// "empreendimento -, unidade -" e "Saldo total em aberto: -" — o nome e as parcelas, que a rota
// já sabia montar, chegavam certos, e por isso o defeito passava por "funcionando".
//
// A tela da Iris (iris-start-attendance-modal) já mandava estes campos; agora o Hades usa a mesma
// régua, por esta função única.

import type { QueueClient } from "@/modules/guardian/attendance/types";

type Parcela = Pick<
  NonNullable<QueueClient["c2xInstallments"]>[number],
  "dueDate" | "overdueDays" | "paymentUrl" | "unitCode" | "valueNumber"
>;

export type ContextoDoTemplateDeCobranca = {
  relatedBoletoLink: string;
  relatedDaysLate: string;
  relatedDueDate: string;
  relatedEnterprise: string;
  relatedInstallmentsTotal: string;
  relatedOpenBalance: string;
  relatedUnit: string;
};

export function contextoDoTemplateDeCobranca({
  empreendimento,
  saldoDevedor,
  selecionadas,
  vencidas,
}: {
  empreendimento: null | string | undefined;
  /** O "saldo devedor" da fila: é o total VENCIDO do cliente (overdue_amount do read-model). */
  saldoDevedor: null | string | undefined;
  /** As parcelas que o operador marcou — o assunto da mensagem. */
  selecionadas: Parcela[];
  /** Todas as vencidas do cliente — base do saldo em aberto. */
  vencidas: Parcela[];
}): ContextoDoTemplateDeCobranca {
  // Sem seleção, a unidade sai das vencidas: é o mesmo critério do "Código de unidade" do modal.
  const baseDaUnidade = selecionadas.length ? selecionadas : vencidas;
  const unidades = Array.from(
    new Set(
      baseDaUnidade
        .map((parcela) => parcela.unitCode?.trim())
        .filter((codigo): codigo is string => Boolean(codigo)),
    ),
  );

  const totalSelecionado = somar(selecionadas);
  // ⚠️ O SALDO É DO CLIENTE, NÃO DA SELEÇÃO. O template diz "Parcelas em aberto: (as escolhidas)
  // ... Saldo total em aberto: X" — X é tudo o que está vencido. As parcelas vêm vivas do C2X ao
  // abrir o modal; o `saldoDevedor` da fila (sync a cada 15 min) só entra se elas não carregaram.
  const totalVencido = somar(vencidas);
  const saldo =
    totalVencido > 0 ? formatarMoeda(totalVencido) : valorPreenchido(saldoDevedor);

  // A mais antiga da seleção é a que puxa a urgência (mesma regra da tela da Iris).
  const maisAntiga = [...selecionadas].sort(
    (primeira, segunda) => segunda.overdueDays - primeira.overdueDays,
  )[0];

  return {
    relatedBoletoLink:
      selecionadas.find((parcela) => parcela.paymentUrl?.trim())?.paymentUrl?.trim() ?? "",
    relatedDaysLate:
      maisAntiga && maisAntiga.overdueDays > 0 ? `${maisAntiga.overdueDays} dias` : "",
    relatedDueDate: valorPreenchido(maisAntiga?.dueDate),
    relatedEnterprise: valorPreenchido(empreendimento),
    relatedInstallmentsTotal: totalSelecionado > 0 ? formatarMoeda(totalSelecionado) : "",
    relatedOpenBalance: saldo,
    relatedUnit: unidades.join(", "),
  };
}

/**
 * Os valores de cada CHAVE de variável, para a pré-visualização da tela.
 *
 * Espelha `buildTemplateBodyParameters` de `app/api/iris/tickets/route.ts`: mesmas chaves, mesmo
 * "-" para o que falta. A prévia diz "é esta que o cliente recebe", então ela não pode mostrar
 * outra coisa — até 01/10/2026 ela preenchia {{2}} com as parcelas e {{3}} com o protocolo, a
 * ordem do template antigo, e o texto na tela não batia com o que saía.
 */
export function valoresDaPrevia({
  contexto,
  nomeCompleto,
  primeiroNome,
  resumoDasParcelas,
  assunto,
}: {
  assunto: string;
  contexto: ContextoDoTemplateDeCobranca;
  nomeCompleto: string;
  primeiroNome: string;
  resumoDasParcelas: string;
}): Record<string, string> {
  const ou = (valor: string) => valor.trim() || "-";
  const boleto = ou(contexto.relatedBoletoLink);

  return {
    assunto: ou(assunto),
    dias_atraso: ou(contexto.relatedDaysLate),
    empreendimento: ou(contexto.relatedEnterprise),
    link: boleto,
    link_boleto: boleto,
    nome_cliente: nomeCompleto.trim() || primeiroNome,
    operador: "(seu nome)",
    parcelas: resumoDasParcelas,
    primeiro_nome: primeiroNome,
    protocolo: "(gerado na abertura)",
    saldo_aberto: ou(contexto.relatedOpenBalance),
    unidade: ou(contexto.relatedUnit),
    valor: ou(contexto.relatedInstallmentsTotal),
    vencimento: ou(contexto.relatedDueDate),
  };
}

/**
 * Os parâmetros {{1}}..{{n}} da prévia, pela mesma regra da rota: resolve por chave quando o
 * template declara as variáveis e TODAS são conhecidas; senão, a ordem legada da cobrança
 * (nome, parcelas, protocolo).
 */
export function parametrosDaPrevia(
  variaveis: { key: string; placeholder: string }[] | null | undefined,
  valores: Record<string, string>,
): string[] {
  const ordenadas = (variaveis ?? [])
    .map((variavel) => ({ indice: indiceDoPlaceholder(variavel.placeholder), chave: variavel.key }))
    .filter((variavel) => variavel.indice > 0);
  const todasConhecidas =
    ordenadas.length > 0 &&
    ordenadas.every((variavel) => Object.prototype.hasOwnProperty.call(valores, variavel.chave));

  if (!todasConhecidas) {
    return [
      valores.primeiro_nome ?? "-",
      valores.parcelas ?? "-",
      valores.protocolo ?? "-",
    ];
  }

  const maior = Math.max(...ordenadas.map((variavel) => variavel.indice));
  const parametros: string[] = [];
  for (let indice = 1; indice <= maior; indice += 1) {
    const variavel = ordenadas.find((item) => item.indice === indice);
    parametros.push(variavel ? (valores[variavel.chave] ?? "-") : "-");
  }
  return parametros;
}

function indiceDoPlaceholder(placeholder: string) {
  const achado = /{{\s*(\d+)\s*}}/.exec(placeholder);
  const indice = achado ? Number.parseInt(achado[1] ?? "", 10) : 0;
  return Number.isNaN(indice) ? 0 : indice;
}

function somar(parcelas: Parcela[]) {
  return parcelas.reduce(
    (soma, parcela) => soma + (Number.isFinite(parcela.valueNumber) ? parcela.valueNumber : 0),
    0,
  );
}

function formatarMoeda(valor: number) {
  return valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

/** "-" e "—" são o "vazio" da fila do Hades, não um valor: não podem ir para o cliente. */
function valorPreenchido(valor: null | string | undefined) {
  const limpo = valor?.trim() ?? "";
  return limpo === "-" || limpo === "—" ? "" : limpo;
}
