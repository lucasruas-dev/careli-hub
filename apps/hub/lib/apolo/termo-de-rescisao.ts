// O TERMO DE RESCISÃO DE UM CONTRATO — do extrato do comprador para os dados do papel.
//
// Lucas (15/09/2026): *"o termo de rescisão é um relatório que dá início a um distrato (...) é
// quando o cliente solicita para gente o termo de rescisão para avaliar se dar continuidade ou
// não"*. O papel sai do Financeiro, ao lado do extrato, e é por isso que ele NASCE do extrato.
//
// ⚠️ ESTE ARQUIVO NÃO CALCULA A RESCISÃO. Quem apura multa, publicidade, corretagem, tributos,
// fruição, total e saldo é `calcularRescisao` (`lib/apolo/rescisao.ts`); quem escreve o papel é
// `montarTermoDeRescisaoPdf` (`lib/apolo/rescisao-pdf.ts`). Aqui só se escolhe, campo a campo, DE
// ONDE sai cada número que aqueles dois recebem — e o que fazer quando ele não existe.
//
// ⚠️ É PURO DE PROPÓSITO, como `extrato-cliente.ts`. O PAINEL do Financeiro ("use client") importa
// `motivoParaNaoEmitirTermo` daqui para explicar o botão apagado; um `import` de mysql2 ou do
// Supabase nesta linha arrastaria o driver para o bundle do navegador. A leitura dos bancos mora
// em `termo-de-rescisao-server.ts`.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// AS SEIS ARMADILHAS DO C2X QUE O EXTRATO JÁ DESARMOU — E QUE O TERMO NÃO PODE REARMAR
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ 1. DINHEIRO FANTASMA. O total pago é `totais.totalPago` do extrato, que só soma parcela com
// data de pagamento (ou baixa explícita). Somar `paid_value` aqui traria de volta os R$ 443 mil
// que o Asaas pré-preenche e ninguém pagou.
//
// ⚠️ 2 e 3. ORDEM E ACORDO. As parcelas vencidas saem de `relatorio.abertas`, já numeradas por
// `current_total_parcel` (nunca por `reference_date`, que o acordo reescreve) e com o Avulso de
// acordo DENTRO — ele é dívida real.
//
// ⚠️ 4. JUROS QUE NÃO EXISTEM. Nenhum centavo de juros ou multa de mora é somado às vencidas: o C2X
// não os grava antes do pagamento, e o próprio papel diz que o valor "permanece sujeito à
// incidência de ... juros, multa". Inventá-los aqui seria prometer um valor de quitação.
//
// ⚠️ 5. A DEFASAGEM. A soma das vencidas usa `valorAtual`, e NÃO `valorContratual`. Parcela vencida
// que nunca recebeu boleto carrega o valor CRU do contrato, sem o reajuste que o boleto teria
// aplicado; `valorAtual` é o extrato trazendo essa linha à mensalidade vigente, que é a única
// correção que a casa aplica. No caso típico (vencida COM boleto) os dois são o mesmo número. Por
// isso o "Em atraso (valores originais)" da tela pode ficar ABAIXO deste total quando houver
// vencida sem boleto — e o termo, que escreve "valor atualizado", tem de ficar com o maior.
//
// ⚠️ 6. O REAJUSTE COMO EVENTO não é usado: o termo não fala de degraus.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// O QUE NÃO EXISTE, CAMPO A CAMPO (a regra é: null com aviso no papel, ou recusa com frase)
// ────────────────────────────────────────────────────────────────────────────────────────────
//
//   valor de tabela ........ RECUSA. Sem ele a multa e a publicidade saem R$ 0,00 como se
//                            apuradas. `price = 1,00` é o marcador de lote sem preço do C2X
//                            (medido no Vale do Ouro: 46 lotes assim), e conta como ausente.
//   contrato encerrado ..... RECUSA. O extrato zera `abertas` de contrato cancelado/em distrato/
//                            distratado; as vencidas sairiam R$ 0,00, calado.
//   comissão em reais ...... null → percentual com aviso. Ver `comissaoDoContratoDeCorretagem`.
//   valor do contrato ...... soma das parcelas (a definição de `rescisao.ts`); zero vira null lá.
//   valor do contrato
//     atualizado ........... null SEMPRE. Ver o aviso em `montarDadosDaRescisao`.
//   posse .................. null = sem fruição, sem aviso (é o estado normal).
//   premissas .............. vazias = praxe, com aviso por rubrica (quem avisa é a conta).
//   qualificação do cliente  nacionalidade, estado civil, profissão e endereço NÃO são lidos, e a
//                            simulação de 16/09/2026 não os imprime. Ver `clienteDoContrato`.

import {
  type ExtratoClienteRelatorio,
  situacaoParaOComprador,
} from "@/lib/apolo/extrato-cliente";
import { mesesDeFruicao } from "@/lib/apolo/posse";
import {
  calcularRescisao,
  type PremissaDaRescisao,
  type RubricaCadastravel,
} from "@/lib/apolo/rescisao";
import type {
  ClienteDaRescisao,
  DadosDaRescisao,
  ParcelaVencidaDaRescisao,
} from "@/lib/apolo/rescisao-pdf";
import { limpar } from "@/lib/hades/dossie/encargos";

/** Arredonda para centavos. */
const centavos = (valor: number): number => Math.round((Number(valor) || 0) * 100) / 100;

/**
 * O maior preço que o C2X usa como MARCADOR de "lote sem preço".
 *
 * ⚠️ NÃO É PREÇO BAIXO, É AUSÊNCIA. O BI do Vale do Ouro trata `price <= 1` como lote não lançado
 * pela mesma razão (`bi-vale-do-ouro.ts`, `UNIDADE_COMERCIAL = "eu.price > 1"`). Um termo com
 * "Multa penal (10%) ... R$ 0,10" é a mesma mentira que o R$ 0,00.
 */
const PRECO_DE_MARCADOR = 1;

/**
 * Por que o termo NÃO sai para este contrato — ou `null`, quando sai.
 *
 * ⚠️ A TELA E A ROTA PERGUNTAM AQUI, E É A MESMA FUNÇÃO DE PROPÓSITO. Botão apagado sem frase é
 * defeito (cobrado duas vezes pelo dono do produto em 15/09/2026), e a frase do botão tem de ser a
 * mesma que a rota devolveria se alguém chamasse a URL na mão. Duas redações seriam duas regras.
 */
export function motivoParaNaoEmitirTermo(relatorio: ExtratoClienteRelatorio): null | string {
  const { contrato } = relatorio;

  if (contrato.encerrado) {
    return `O termo de rescisão só sai para contrato em curso, e este está ${situacaoParaOComprador(contrato).toLowerCase()}.`;
  }

  const preco = contrato.precoTabela;
  if (preco === null || !Number.isFinite(preco) || preco <= PRECO_DE_MARCADOR) {
    return `A unidade ${contrato.codigo} está sem valor de tabela no C2X, e sem ele a multa penal e a publicidade do termo sairiam zeradas.`;
  }

  return null;
}

/** "4.705,22" → 4705.22. Nulo quando não é dinheiro. */
function emReais(bruto: string | undefined): null | number {
  if (!bruto) return null;
  const valor = Number(bruto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(valor) ? valor : null;
}

/**
 * A frase do contrato de corretagem que diz quanto custou a intermediação, e como ela se reparte.
 *
 * Texto real (medido em 16/09/2026, nomes trocados): *"R$ 4.053,79 (QUATRO MIL ...) refere-se à
 * intermediação imobiliária, sendo que a quantia R$ 873,12 (...) será destinada ao pagamento da
 * COORDENADORA ... e R$ 3.180,67 destinada aos ASSOCIADOS"*.
 *
 * ⚠️ `\S+` NO LUGAR DO "à", E DAS PALAVRAS ACENTUADAS, e não por preguiça: o texto vem em HTML com
 * entidades, e `limpar` só decodifica as que conhece. Um `&Agrave;` que escapasse faria a frase
 * inteira não casar — e o termo cairia calado no percentual.
 */
const FRASE_DA_INTERMEDIACAO =
  /R\$\s*([\d.]+,\d{2})\s*\([^)]*\)\s*refere-se\s+\S+\s+intermedia\S*\s+imobili\S*,\s*sendo\s+que\s+a\s+quantia\s*(?:de\s*)?R\$\s*([\d.]+,\d{2})[^$]{0,300}?R\$\s*([\d.]+,\d{2})/i;

/**
 * A comissão EM REAIS deste contrato, como o contrato de corretagem assinado a escreve.
 *
 * ⚠️ O C2X NÃO TEM COLUNA DE COMISSÃO POR CONTRATO. Varri `information_schema.columns` por
 * commis/comiss/corret/brokerage em 16/09/2026: o que existe é percentual por empreendimento
 * (`commercial_policies`) e o TEXTO do contrato de corretagem
 * (`acquisition_request_contracts.complete_text_brokerage`, preenchido em 3.021 de 3.024). É nesse
 * texto que o valor mora.
 *
 * ⚠️ A FRASE SE CONFERE SOZINHA, e é isso que tira esta leitura da categoria "ler contrato não
 * resolve" (a das alíquotas, ver `premissas-de-rescisao.ts`). Ela diz o total E as duas partes; só
 * vale quando as partes somam o total. Medido em 16/09/2026 no contrato mais recente de cada venda
 * (3.015, 3.012 com texto): a frase fecha em 2.888 — em 2.754 no centavo exato e em 134 com UM
 * centavo de diferença (R$ 1.052,11 + R$ 3.832,70 para um total de R$ 4.884,82). Esse centavo é o
 * arredondamento de cada parte calculada à parte, não texto quebrado, e por isso a tolerância é de
 * um centavo e só um: o TOTAL escrito é o valor, as partes são a prova. Onde não casa ou não fecha,
 * devolve `null` — e o papel cai no percentual, com o aviso que a conta já dá.
 *
 * ⚠️ E ELA NÃO É UMA SEGUNDA CONTA: é o valor que saiu do caixa. `rescisao.ts` diz por que ele
 * manda sobre o percentual — a tabela do lote muda, a comissão paga lá atrás não.
 *
 * ⚠️ ZERO É VALOR (venda sem intermediação). "Não achei" é `null`.
 */
export function comissaoDoContratoDeCorretagem(html: null | string | undefined): null | number {
  if (!html || !html.trim()) return null;

  const achado = FRASE_DA_INTERMEDIACAO.exec(limpar(html));
  if (!achado) return null;

  const total = emReais(achado[1]);
  const coordenadora = emReais(achado[2]);
  const associados = emReais(achado[3]);
  if (total === null || coordenadora === null || associados === null) return null;

  // Em CENTAVOS INTEIROS: 873,12 + 3.180,67 em ponto flutuante não é 4.053,79. E no máximo UM
  // centavo de folga, que é o arredondamento das partes (ver acima) — dois já é outro número.
  const diferenca = Math.abs(
    Math.round(coordenadora * 100) + Math.round(associados * 100) - Math.round(total * 100),
  );

  return diferenca <= 1 ? total : null;
}

/**
 * O percentual que a comissão em reais representa sobre o valor de tabela, com duas casas.
 *
 * ⚠️ SEM ISTO O PAPEL AFIRMA UMA FALSIDADE. Quando o valor em reais existe, `calcularRescisao` o usa
 * e o percentual vira "só o rótulo" — que, sem premissa, é a PRAXE de 6,5%. O papel então imprime
 * "Corretagem (6,50%)" ao lado de um R$ X que é 8% (Rio de Pedras) ou 4% (Cidade Jardim) da tabela
 * — medido nos contratos de corretagem em 16/09/2026. O rótulo tem de ser o do número impresso ao
 * lado.
 */
export function percentualDaComissaoSobreATabela(comissao: number, valorDeTabela: number): null | number {
  if (!Number.isFinite(comissao) || !Number.isFinite(valorDeTabela) || valorDeTabela <= 0) {
    return null;
  }
  return Math.round((comissao / valorDeTabela) * 10_000) / 100;
}

/** Como o C2X chama o índice e como o papel escreve ("IPCA ANUAL" → "IPCA anual"). */
const INDICE_ESCRITO: Record<string, string> = {
  "IGPM-ANUAL": "IGP-M anual",
  "INCC-M MENSAL": "INCC-M mensal",
  "IPCA ANUAL": "IPCA anual",
  "IPCA-MENSAL": "IPCA mensal",
  "POUPANÇA": "Poupança",
};

/**
 * O campo "Plano" da ficha: "144x, IPCA anual".
 *
 * ⚠️ O PARCELAMENTO É O DO CONTRATO (`payments.total_parcels`), e não o molde do plano comercial:
 * é o mesmo número que o extrato imprime, e o cliente recebe os dois papéis e compara.
 *
 * ⚠️ O C2X GUARDA `index_monetary_corrections.name` EM CAIXA ALTA ("IPCA ANUAL", "SEM CORREÇAO"). Os
 * seis nomes foram lidos da tabela em 16/09/2026. Índice que não está no mapa sai como o C2X
 * escreve: melhor um "IGP-DI" em maiúsculas do que um índice sumido do papel.
 *
 * ⚠️ VÍRGULA, E NÃO O "·" DO EXTRATO. O pdf-lib escreve o ponto médio como hífen (`limpar`), e um
 * " - " entre dois dados se lê como travessão, que a regra da casa não aceita em texto visível. Os
 * juros ficam de fora: a simulação nunca os imprimiu e nenhuma dedução depende deles.
 */
export function planoEscrito(parcelas: null | number, indice: null | string): null | string {
  const partes: string[] = [];
  if (typeof parcelas === "number" && parcelas > 0) partes.push(`${parcelas}x`);

  const bruto = (indice ?? "").trim();
  if (bruto) {
    const chave = bruto.toUpperCase();
    const escrito = chave.startsWith("SEM CORRE") ? "sem correção" : (INDICE_ESCRITO[chave] ?? bruto);
    partes.push(partes.length ? escrito : `${escrito.charAt(0).toUpperCase()}${escrito.slice(1)}`);
  }

  return partes.length ? partes.join(", ") : null;
}

/**
 * Os titulares da simulação.
 *
 * ⚠️ O CLIENTE DO TERMO É O DO CONTRATO, NÃO O DA FICHA ABERTA. O C2X guarda até cinco titulares na
 * mesma venda, e a ficha pode ser a do coadquirente. A rescisão é do CONTRATO: os promissários
 * compradores são todos os titulares, na ordem do C2X (`client_id` primeiro). A ficha só entra se o
 * contrato vier sem titular nenhum, o que não deveria acontecer.
 *
 * ⚠️ O DOCUMENTO SAI MASCARADO, e é decisão, não limitação. O extrato não deixa o documento inteiro
 * atravessar a rota ("o extrato circula por WhatsApp e e-mail"), e a simulação circula igual.
 *
 * ⚠️ CNPJ SAI COMO O EXTRATO O ESCREVE, entre parênteses e sem rótulo. A versão de 15/09 imprimia
 * "CPF:" fixo, e por isso escondia o documento de titular pessoa jurídica; a ficha do extrato não
 * tem rótulo, e o CNPJ mascarado identifica a empresa sem afirmar que é CPF.
 *
 * ⚠️ NACIONALIDADE, ESTADO CIVIL, PROFISSÃO E ENDEREÇO NÃO SÃO LIDOS. A regra do Lucas de 11/09/2026
 * é que do C2X só se lê financeiro; o cadastro da pessoa mora no Apolo, espalhado em seis camadas
 * que só `lib/temis/dados-do-contrato.ts` sabe casar, e lá a leitura é privada e chaveada pela
 * PROPOSTA do Hércules, não pelo contrato do C2X. Uma sétima leitura aqui seria a ficha paralela que
 * a casa proíbe. E a simulação de 16/09/2026 decidiu não imprimi-los (ver `rescisao-pdf.ts`).
 */
export function clienteDoContrato(
  relatorio: ExtratoClienteRelatorio,
  ficha: { documentoMascarado: null | string; nome: null | string },
): ClienteDaRescisao {
  const titulares = [...relatorio.contrato.titulares]
    .sort((a, b) => a.ordem - b.ordem)
    .map((titular) => ({
      documento: (titular.documentoMascarado ?? "").trim() || null,
      nome: titular.nome.trim(),
    }))
    .filter((titular) => titular.nome);

  if (titulares.length) return { titulares };

  return {
    titulares: [
      {
        documento: (ficha.documentoMascarado ?? "").trim() || null,
        nome: (ficha.nome ?? "").trim() || "Cliente",
      },
    ],
  };
}

/**
 * As parcelas vencidas do contrato: a lista para NOMEAR e o total que entra na conta.
 *
 * ⚠️ O TOTAL É `valorAtual`, NÃO `valorContratual` — ver a armadilha 5 no cabeçalho.
 *
 * ⚠️ O VALOR DE CADA UMA É O MESMO QUE ENTRA NA SOMA, arredondado ao centavo ANTES de somar. A
 * simulação imprime a lista com o valor de cada parcela e, embaixo, o total da conta: se a lista
 * levasse o valor cru e a soma o arredondado, as linhas impressas poderiam não fechar com o total
 * por um centavo, no mesmo papel.
 */
export function parcelasVencidasDoExtrato(relatorio: ExtratoClienteRelatorio): {
  lista: ParcelaVencidaDaRescisao[];
  total: number;
} {
  const vencidas = relatorio.abertas
    .filter((parcela) => parcela.situacao === "vencida")
    .map((parcela) => ({
      centavos: Math.round((Number(parcela.valorAtual) || 0) * 100),
      numero: parcela.numero,
      vencimento: parcela.vencimento,
    }));

  return {
    lista: vencidas.map((parcela) => ({
      numero: parcela.numero,
      valor: parcela.centavos / 100,
      vencimento: parcela.vencimento,
    })),
    total: vencidas.reduce((soma, parcela) => soma + parcela.centavos, 0) / 100,
  };
}

export type EntradaDoTermo = {
  /** Município do empreendimento, do cadastro do Panteon (`hercules_empreendimentos`). */
  cidade: null | string;
  /** O cliente da ficha, como o extrato devolve — só entra se o contrato vier sem titular. */
  cliente: { documentoMascarado: null | string; nome: null | string };
  /** De `comissaoDoContratoDeCorretagem`. `null` = não achado. */
  comissaoEmReais: null | number;
  /** 'YYYY-MM-DD' de `hercules_posse`, ou `null` (o estado normal). */
  dataDaPosse: null | string;
  /** 'YYYY-MM-DD' — hoje em Brasília. É também a data até a qual a fruição corre. */
  emitidoEm: string;
  /** Já resolvidas por `premissasDoRecorte`. Rubrica sem cadastro é CHAVE AUSENTE. */
  premissas: Partial<Record<RubricaCadastravel, PremissaDaRescisao>>;
  /** O extrato de UM contrato, de `loadExtratoDoCliente`. */
  relatorio: ExtratoClienteRelatorio;
  uf: null | string;
};

export type TermoMontado = { dados: DadosDaRescisao; ok: true } | { error: string; ok: false };

/**
 * Os dados do papel, prontos para `montarTermoDeRescisaoPdf`.
 *
 * ⚠️ `valorDoContratoAtualizado` VAI NULO, E ISSO FOI DECIDIDO, NÃO ESQUECIDO. É a base da praxe da
 * FRUIÇÃO e uma das bases cadastráveis — e nenhuma fonte da casa o define. O extrato sabe o saldo
 * trazido à mensalidade vigente, mas NÃO traz a hoje o que já foi pago (a parcela de 2024 entrou
 * pelo valor de 2024). Somar os dois e chamar de "contrato atualizado" imprimiria uma base que
 * ninguém validou, sob a rubrica mais pesada do termo (R$ 11.401,11 no caso de referência). Nulo,
 * `calcularRescisao` tira a linha e IMPRIME o aviso "não entrou na conta: ... não foi informado".
 * Hoje isso só acontece com posse cadastrada — `hercules_posse` tinha 0 linhas em 16/09/2026.
 *
 * ⚠️ O PERCENTUAL DA CORRETAGEM SÓ É DERIVADO QUANDO O VALOR EM REAIS VEIO. Sem ele, a conta fica
 * com a premissa ou com a praxe, e avisa. Com ele, a premissa cadastrada ainda ganha o rótulo
 * (`premissa.percentual ?? atalho`) — o que pode divergir do valor, e está na lista de dúvidas.
 */
export function montarDadosDaRescisao(entrada: EntradaDoTermo): TermoMontado {
  const { relatorio } = entrada;
  const motivo = motivoParaNaoEmitirTermo(relatorio);
  if (motivo) return { error: motivo, ok: false };

  const { contrato, totais } = relatorio;
  // O `motivo` acima já recusou o nulo; a leitura de novo é só para o tipo.
  const valorDeTabela = centavos(contrato.precoTabela ?? 0);
  const vencidas = parcelasVencidasDoExtrato(relatorio);

  const comissaoEmReais =
    typeof entrada.comissaoEmReais === "number" && Number.isFinite(entrada.comissaoEmReais)
      ? centavos(entrada.comissaoEmReais)
      : null;
  const percentualDaComissao =
    comissaoEmReais === null
      ? null
      : percentualDaComissaoSobreATabela(comissaoEmReais, valorDeTabela);

  const conta = calcularRescisao({
    comissaoEmReais,
    mesesDeFruicao: mesesDeFruicao({
      ateRestituicao: new Date(`${entrada.emitidoEm}T00:00:00Z`),
      dataDaPosse: entrada.dataDaPosse,
    }),
    parcelasVencidas: vencidas.total,
    // Chave AUSENTE quando não há o que dizer — ver o aviso de `premissas` em `rescisao.ts`.
    ...(percentualDaComissao === null ? {} : { percentuais: { corretagem: percentualDaComissao } }),
    premissas: entrada.premissas,
    totalPago: totais.totalPago,
    valorDeTabela,
    // "Valor do contrato" não é coluna no C2X: é a SOMA DAS PARCELAS (`rescisao.ts`). O que já foi
    // quitado entra pelo valor de contrato da parcela, e o que está aberto também — os dois pelo
    // `initial_value`, sem mora e sem trazer nada a hoje. Zero vira ausência lá dentro, com aviso.
    valorDoContrato: centavos(totais.totalContratualPago + totais.saldoNominal),
    valorDoContratoAtualizado: null,
  });

  // ⚠️ CORRETAGEM DE R$ 0,00 NÃO SAI CALADA. O contrato de corretagem de 15 vendas escreve "R$ 0,00"
  // para a intermediação (medido em 16/09/2026), e a frase fecha (0 + 0 = 0). Pode ser venda sem
  // corretor, pode ser modelo que ninguém preencheu — o texto não diz qual. Sem este aviso o papel
  // imprimiria "Corretagem (0%) ... Conforme contrato ... R$ 0,00" na tabela de deduções, com a
  // mesma cara de um número apurado. Zero calado em documento financeiro é
  // o pior defeito: o valor fica (é o que o contrato diz), e quem entrega o papel é avisado. Se zero
  // deve cair na praxe é decisão do dono do produto, não desta linha.
  if (comissaoEmReais === 0) {
    conta.avisos.push(
      "Corretagem saiu R$ 0,00 porque é o valor escrito no contrato de corretagem desta venda: confira no contrato assinado se houve intermediação antes de entregar o termo.",
    );
  }

  return {
    dados: {
      cliente: clienteDoContrato(relatorio, entrada.cliente),
      conta,
      contrato: {
        dataDoAto: contrato.dataAto,
        // `planoParcelas` já é o do CONTRATO (`payments.total_parcels`), e não o molde do plano.
        plano: planoEscrito(contrato.planoParcelas, contrato.indiceCorrecao),
        valorDeTabela,
      },
      emitidoEm: entrada.emitidoEm,
      imovel: {
        area: contrato.area,
        cidade: (entrada.cidade ?? "").trim() || null,
        codigo: contrato.codigo,
        // O MESMO nome que o extrato imprime: o cliente recebe os dois papéis e compara.
        empreendimento: contrato.empreendimentoNome ?? contrato.empreendimentoCodigo,
        lote: contrato.lote,
        quadra: contrato.quadra,
        uf: (entrada.uf ?? "").trim() || null,
      },
      pagamentos: {
        mesFinal: totais.ultimoPagamento,
        mesInicial: totais.primeiroPagamento,
        // As MESMAS linhas que somam `totais.totalPago`: a tabela "Pagamentos realizados" do extrato.
        quantidade: relatorio.realizados.length,
      },
      parcelasVencidas: vencidas.lista,
    },
    ok: true,
  };
}
