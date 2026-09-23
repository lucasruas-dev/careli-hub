"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  valorDigitado,
  valorParaOCampo,
} from "@/lib/apolo/boletos/valor-digitado";
import {
  fraseDeCorrecao,
  textoDaTaxa,
  INDICES,
  type IndiceCorrecao,
  type PlanoComercial,
  taxaMensal,
} from "@/lib/apolo/planos-comerciais";
import {
  type BemOuPermuta,
  somarBensQueContamNaEntrada,
  TAMANHO_MAXIMO_DA_DESCRICAO,
  TETO_DE_BENS_NA_PROPOSTA,
} from "@/lib/hercules/bens-e-permutas";
import {
  type Composicao,
  composicoesQueFecham,
  ENTRADA_MINIMA_PERCENTUAL,
  entradaMinima,
  type PlanoDaComposicao,
} from "@/lib/hercules/composicoes";
import {
  conferirEntradaMontada,
  partesIguais,
  redistribuirDemais,
} from "@/lib/hercules/entrada-montada";
import { pisoDaEntradaNoPrazo } from "@/lib/hercules/faixa-do-plano";
import {
  aplicarPremissa,
  type FaixaDePrazo,
  premissaDoPrazo,
} from "@/lib/hercules/premissa-do-prazo";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { DIAS_DE_VENCIMENTO, ENTRADA_VEZES_MAXIMA } from "@/lib/hercules/proposta";
import {
  lerPercentualDigitado,
  proximoVencimento,
} from "@/lib/hercules/proposta-na-tela";
import { linhaDoAVista, linhasDoCartao } from "@/lib/hercules/cartao-do-plano";
import { montarProposta, sistemaDoCadastro, temAnuaisCadastradas } from "@/lib/hercules/simulacao";
import {
  ajusteAoTrocarDePlano,
  condicaoDoPlano,
  descontoDoPlanoNoPrazo,
  mesmoAjuste,
  precoDeTabelaDoCartao,
} from "@/lib/hercules/tabela-do-lote";

import {
  type AjusteDePreco,
  aplicarAjuste,
  ajusteDoPlano,
  descontoDoPlano,
  descreverAjuste,
  SEM_AJUSTE,
} from "@/lib/hercules/ajuste-de-preco";

import { T } from "../tema";
import { EtiquetaDaRessalva } from "./PoliticasDoProduto";

// O SIMULADOR DE PROPOSTA DO COMERCIAL.
//
// Desenho fechado com o Lucas (03/09/2026), olhando o simulador do masterplan: *"quero melhorar
// esse simulador, está bem confuso. O que eu gosto: a opção de começar pelo valor da parcela, isso
// ajuda bastante; gosto das parcelas dos planos já definidos, e a ideia é eu poder editar isso
// quando necessário. Estamos com 3 botões (...) acho que lado esquerdo ser esse cockpit, de
// montagem de proposta mesmo, e o lado direito o de visualização, recomendação"*.
//
// ⚠️ OS TRÊS BOTÕES SUMIRAM, e é a mudança que resolve a confusão. "Parto da parcela do cliente",
// "eu escolho as condições" e "proposta livre" pediam que a pessoa declarasse o MODO antes de fazer
// qualquer coisa — e ninguém pensa assim numa mesa de venda. Aqui o modo é consequência: mexeu na
// parcela, a conta resolve pela parcela; mexeu na entrada, no prazo ou no reforço, resolve por eles.
//
// ⚠️ E A LEITURA É UMA SÓ para os dois caminhos: o mesmo cartão grande mostra a composição
// recomendada (quando ele partiu da parcela) ou a conta que ele montou (quando mexeu nas
// condições). Duas caixas de resultado, uma por modo, era a outra metade da confusão.
//
// ⚠️ É SÓ DO COMERCIAL (*"vamos mexer somente para o comercial, se eu gostar posso estender para
// cecilio"*). O masterplan continua exatamente como estava; se este ganhar a preferência, a gente
// leva para lá de uma vez.
//
// ⚠️ E NADA AQUI GRAVA. *"a ideia é ter um local que o usuário possa fazer algumas simulações sem
// ter que vincular a nada e nem gerar proposta"* — quem grava é a rota, chamada pela
// `ModalDeProposta`.
//
// ⚠️ A MONTAGEM DA PROPOSTA REUSA ESTA TELA, e o que ela ganhou para isso é UMA prop opcional:
// `aoMudarCondicoes` (Lucas, 04/09/2026, desenhando o "Gerar proposta" *"em cima do simulador que
// já existe"*). Com ela, o cockpit mostra os dois campos que só a proposta precisa — dia de
// vencimento e data da primeira parcela da entrada — e a composição da tela sobe para quem chamou.
// SEM ela, nada muda: é o mesmo simulador do botão "Abrir simulador" da ficha, que continua sendo
// simulação livre. Uma segunda cópia do simulador "com gravação" seria a segunda conta de dinheiro
// da casa, e as duas divergiriam no primeiro conserto feito só de um lado.

type Cockpit = {
  anuaisQuantidade: number;
  anuaisValor: number;
  entrada: number;
  entradaVezes: number;
  parcela: number;
  parcelas: number;
  valor: number;
};

/** Qual campo mandou por último — é ele que a conta obedece. */
type Comando = "condicoes" | "parcela";

/** O prazo de partida quando o produto não tem plano cadastrado. Editável na tela. */
const PARCELAS_SEM_PLANO = 120;

/** O que o cartão grande da direita mostra, venha de onde vier. */
type Leitura = {
  /**
   * O desconto que esta leitura carrega no preço.
   *
   * ⚠️ NA COMPOSIÇÃO ELE NÃO É O DO CAMPO, e é por isso que viaja aqui. Uma composição do
   * Investidor Parcelado do Garden fecha sobre 92% da tabela; subir a proposta com o desconto que
   * está no campo (o do plano ativo) daria entrada e parcela de um preço e valor de outro.
   */
  ajuste: AjusteDePreco;
  anuais: { quantidade: number; valor: number };
  composicao: Composicao | null;
  /** O desconto do plano desta leitura (0 quando não tem). Vai para a modal decidir a nota. */
  descontoDoPlano: number;
  entrada: number;
  financiado: number;
  origem: "composicao" | "montada";
  parcela: number;
  parcelas: number;
  plano: string;
  total: number;
  /** O valor negociado desta leitura: o preço sobre o qual entrada e parcela foram calculadas. */
  valor: number;
};

// ⚠️ A ENTRADA DO PLANO MUDOU DE CASA (18/09/2026): `entradaDoPlano` agora mora em
// `lib/hercules/tabela-do-lote.ts`, junto da conta inteira do cartão (desconto, entrada, anuais e
// parcela), e é chamada por `condicaoDoPlano`. A regra é a mesma, linha a linha.

/** Dois valores em reais são o mesmo dinheiro? Compara em centavos, como o resto do módulo. */
const centavosIguais = (a: number, b: number) =>
  Math.round((Number.isFinite(a) ? a : 0) * 100) ===
  Math.round((Number.isFinite(b) ? b : 0) * 100);

const dinheiro = (v: number) =>
  `R$ ${Math.round(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

const dinheiroExato = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

/**
 * A composição que está NA TELA, do jeito que a proposta precisa dela.
 *
 * ⚠️ É O QUE O CARTÃO GRANDE MOSTRA, e não o que o cockpit guarda. Quando a pessoa parte da parcela
 * do cliente, o cockpit ainda tem a entrada antiga enquanto a direita já mostra a composição
 * recomendada: subir o cockpit geraria uma proposta diferente da que ela está lendo. Sobe o que
 * está escrito na tela — e por isso `entradaVezes` e `valorNegociado`, que só existem no cockpit,
 * vêm de lá.
 *
 * ⚠️ E NÃO SOBE CRONOGRAMA NENHUM. Datas e série de parcelas são de `montarCronograma`, que a
 * `ModalDeProposta` e o PDF chamam com estas mesmas condições. Duas versões do calendário seriam
 * duas datas de vencimento para o mesmo boleto.
 */
export type CondicoesDaProposta = {
  /**
   * O desconto (ou acréscimo) que o coordenador deu, na moeda em que ele o pensou.
   *
   * ⚠️ ELE SOBE JUNTO PORQUE PRECISA SER GRAVADO. `valorNegociado` já vem com o ajuste aplicado, e
   * até a 0151 era só isso que chegava ao banco — depois de salvo, ninguém sabia se R$ 142.500
   * foram desconto de 5%, tabela desatualizada ou erro de digitação, que é textualmente o defeito
   * que o `ajuste-de-preco.ts` foi escrito para evitar. `null` = sem ajuste.
   */
  ajuste: AjusteDePreco | null;
  anuaisQuantidade: number;
  anuaisValor: number;
  /**
   * Os bens e permutas recebidos na aquisição. `null` = proposta só em dinheiro, que é o normal.
   *
   * ⚠️ SOBE A LISTA INTEIRA, INCLUSIVE A LINHA PELA METADE. A tentação é filtrar aqui o item sem
   * valor ou sem descrição para "não sujar o pedido", e é exatamente o jeito de repetir o defeito
   * que este bloco existe para não ter: a linha continuaria na tela e sumiria do papel, calada.
   * Quem recusa é a régua (`conferirProposta` e a rota), que devolve a frase dizendo QUAL item
   * está incompleto — e é por isso que o `campo` do erro carrega a posição.
   */
  bensEPermutas: null | readonly BemOuPermuta[];
  /**
   * O desconto do plano escolhido, em percentual (0 quando não tem).
   *
   * ⚠️ É O QUE SEPARA A TABELA DA EXCEÇÃO. O desconto do plano chega em `ajuste` como qualquer
   * outro (é o mesmo campo), e a `ModalDeProposta` só pede motivo do que passa DELE — ver
   * `ajusteFrenteAoPlano`, em `tabela-do-lote.ts`.
   */
  descontoDoPlanoPercentual: number;
  /** 10 ou 20, os dois que a cobrança da casa usa. */
  diaDeVencimento: number;
  /** Os valores de cada parcela da entrada, quando montados à mão. Nulo = partes iguais. */
  entradaParcelas: null | number[];
  /**
   * A DATA de cada parcela da entrada, quando escolhida à mão. `AAAA-MM-DD` ou nulo na posição.
   *
   * ⚠️ NULO = A DATA CALCULADA, e é o estado normal. Lucas (13/09/2026): *"pode trazer as data no
   * padrão calculado pelo sistema, mas dar opção de escolha data"* — o padrão continua sendo o de
   * sempre, e a escolha só sobrepõe onde houve escolha.
   */
  entradaDatas: null | (null | string)[];
  /**
   * O corretor escreveu juros ou índice por cima do que o cadastro mandava?
   *
   * ⚠️ É O QUE ABRE A CAIXA DE NOTA na modal. Lucas (13/09/2026): *"ele altera abre uma caixa de
   * nota para ele registrar o que achar necessário"*.
   */
  premissaAlterada: boolean;
  entradaValor: number;
  entradaVezes: number;
  /** A mensal do PRIMEIRO ciclo, que é a que a tela anuncia. Ver `parcelaFixa` em `proposta.ts`. */
  parcela: number;
  parcelasMensais: number;
  /**
   * `temis_planos.id` do plano escolhido — a chave que o rename não muda.
   *
   * ⚠️ NULO É RESPOSTA VÁLIDA, E É O CASO DE UM EMPREENDIMENTO INTEIRO. Os planos servidos pelo
   * C2X (`commercial_plans`, lidos por slot) não têm id nenhum para carregar. Quem monta o POST
   * omite o campo quando ele vem nulo, e o servidor volta a casar pelo nome, como sempre fez.
   */
  planoId: null | string;
  planoNome: string;
  /** `YYYY-MM-DD` — o dia em que a primeira parcela da ENTRADA vence. */
  primeiraParcelaEm: string;
  valorNegociado: number;
};

export function SimuladorDeProposta({
  aoMudarCondicoes,
  previa,
  entradaMinimaPercentual = null,
  faixasDePrazo,
  planos: planosRecebidos,
  unidade,
  valorDaUnidade,
  vocabulario = "proposta",
}: {
  /**
   * Quem vai GERAR a proposta com o que está na tela.
   *
   * ⚠️ OPCIONAL, E É A ÚNICA DIFERENÇA ENTRE OS DOIS USOS. Ausente (o botão "Abrir simulador" da
   * ficha), o simulador é o de sempre: sem os campos de cobrança e sem ninguém escutando. Presente
   * (a `ModalDeProposta`), aparecem o dia de vencimento e a data da primeira parcela, e cada mexida
   * sobe a composição inteira.
   *
   * ⚠️ RECEBE `null` QUANDO NÃO HÁ COMPOSIÇÃO NA TELA — parcela que não fecha em plano nenhum, ou
   * produto sem plano cadastrado. É o que faz o botão "Gerar proposta" ficar apagado em vez de
   * mandar ao servidor uma proposta montada em cima de zeros.
   *
   * ⚠️ PRECISA SER ESTÁVEL (`useCallback`). Ela entra nas dependências do efeito que a chama; uma
   * função nova a cada render do pai faria o efeito rodar em laço.
   */
  aoMudarCondicoes?: (condicoes: CondicoesDaProposta | null) => void;
  /**
   * O que preenche a coluna direita no modo proposta.
   *
   * ⚠️ QUEM MONTA É QUEM TEM O CRONOGRAMA. A prévia é o calendário inteiro (entrada com datas,
   * faixas de reajuste, reforços), e esse objeto nasce na `ModalDeProposta`, que já o monta para o
   * rodapé e para o PDF. Recebê-lo pronto evita a terceira versão do calendário da casa — e mantém
   * este arquivo sendo o que ele é: a conta, não o papel.
   *
   * ⚠️ E ELA OCUPA O LUGAR DAS ALTERNATIVAS, que saíram daqui a pedido do Lucas. Sem nada no lugar
   * sobrava um vazio de meia tela embaixo do cartão de resultado ("tem um espaço grande, UI está
   * ruim") — e o que falta ali é justamente o que o cliente vai receber.
   */
  previa?: React.ReactNode;
  /**
   * A % minima de entrada DESTE empreendimento, da aba Politica Comercial.
   *
   * Nulo = nao cadastrado, e vale o padrao da casa. E o que permite o Garden vender a 8% enquanto
   * os outros exigem 10%, sem duas versoes da regra.
   */
  entradaMinimaPercentual?: null | number;
  /**
   * As faixas de prazo cadastradas para ESTE empreendimento.
   *
   * ⚠️ VAZIO É O NORMAL DE HOJE. A tabela nasceu vazia na migration 0155; enquanto nenhum
   * empreendimento tiver faixa, esta tela se comporta exatamente como se comportava.
   */
  faixasDePrazo?: readonly FaixaDePrazo[];
  /**
   * Os planos do lote. A `ressalva` (0168) é opcional no tipo: a Mesa e a proposta a mandam, e quem
   * não manda simplesmente não desenha etiqueta.
   */
  planos: Array<PlanoDaVenda & { ressalva?: null | string }>;
  /** "12 06" — o lote, como a tela escreve. */
  unidade: string;
  valorDaUnidade: number;
  /**
   * Como a tela CHAMA o que está sendo montado.
   *
   * ⚠️ MUDA SÓ PALAVRA, NUNCA CONTA. O espelho público usa este mesmo simulador — a conta tem de
   * ser a mesma, senão a parcela do site não bate com a que o corretor apresenta —, mas lá a
   * palavra "proposta" não pode aparecer: proposta é o documento que nasce na Mesa de Venda, tem
   * validade, protocolo e vincula a casa. Lucas (10/09/2026): *"não é proposta mas sim uma
   * simulação de pagamento"* · *"é usar o mesmo gerador de proposta e tratar as nomenclaturas"*.
   * O default mantém a Mesa de Venda exatamente como está.
   */
  vocabulario?: "proposta" | "simulacao";
}) {
  const ehSimulacao = vocabulario === "simulacao";

  // ⚠️ A MESMA LISTA ENQUANTO O CONTEÚDO FOR O MESMO (revisão 3, 18/09/2026). O espelho público
  // relê a situação a cada 60 s, e a resposta traz os planos num ARRAY NOVO com o mesmo conteúdo.
  // Por referência a lista "mudava", o efeito que abre o lote rodava de novo, e o simulador voltava
  // para o plano mais longo: medido, o cliente que tinha escolhido o NORMAL era levado de volta ao
  // INVESTIDOR PARCELADO a cada minuto. A chave é o conteúdo serializado (meia dúzia de planos); só
  // um plano que mudou DE VERDADE produz uma lista nova daqui para baixo.
  const chaveDosPlanos = JSON.stringify(planosRecebidos);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave É o conteúdo de `planosRecebidos`
  const planos = useMemo(() => planosRecebidos, [chaveDosPlanos]);

  const [comando, setComando] = useState<Comando>("condicoes");
  /**
   * Os valores de cada parcela da entrada, quando o coordenador montou à mão.
   *
   * ⚠️ `null` É O PADRÃO, e quer dizer "divide igual" — o comportamento de sempre, para quem não
   * quiser mexer em nada ter exatamente o resultado de antes. Só vira lista quando ele pede.
   */
  /**
   * Os valores de cada parcela da entrada, quando o coordenador montou à mão.
   *
   * ⚠️ ELA GUARDA A ENTRADA E O NÚMERO DE VEZES PARA OS QUAIS FOI FEITA, e isso é o que a torna
   * segura. Uma lista solta fica PENDURADA quando a base muda: montar 4 × R$ 14.000 no plano
   * INVESTIDOR (entrada R$ 56.000) e depois clicar no NORMAL (entrada R$ 14.000) deixava as quatro
   * linhas antigas de pé — a tela anunciava entrada de R$ 14.000 e 120× de R$ 1.050, e o PDF que
   * saía por WhatsApp cobrava R$ 56.000 em 4× e 120× de R$ 700. Guardando a base, a montagem se
   * invalida sozinha em TODOS os caminhos que mexem na entrada (trocar plano, usar uma composição,
   * digitar outro valor, partir da parcela), em vez de depender de alguém lembrar de resetá-la em
   * cada um deles.
   */
  const [montagemCrua, setMontagemCrua] = useState<null | {
    base: number;
    parcelas: number[];
    vezes: number;
  }>(null);
  /**
   * As datas escolhidas para as parcelas da entrada, por posição. `null` = a calculada.
   *
   * ⚠️ ESTADO SEPARADO DO DOS VALORES, de propósito. "Dividir igual" e "fixar" mexem em VALOR, e
   * apagar as datas junto obrigaria o coordenador a redigitar o que ele já tinha combinado com o
   * cliente só porque redistribuiu centavos. A lista é indexada por posição e simplesmente
   * acompanha: se o número de parcelas diminui, as posições que sobraram deixam de ser lidas
   * (`montarCronograma` só olha até o tamanho da lista de valores).
   */
  const [datasDaEntradaCruas, setDatasDaEntradaCruas] = useState<
    (null | string)[]
  >([]);
  /**
   * O que o corretor escreveu por cima da premissa: taxa e índice.
   *
   * ⚠️ NULO = NÃO MEXEU, e é diferente de "zero". Lucas (13/09/2026): *"a nossa obrigação é
   * entregar as premissas para aquele plano conforme cadastro e alinhamento, mas o corretor pode
   * alterar isso, e novamente, ele altera abre uma caixa de nota"*. Taxa zerada à mão é uma
   * ALTERAÇÃO (e das caras); campo intocado não é.
   */
  const [sobrescrito, setSobrescrito] = useState<{
    indice: null | string;
    juros: null | string;
  }>({ indice: null, juros: null });
  const [planoAtivo, setPlanoAtivo] = useState<null | string>(null);
  /**
   * O plano escolhido, para o efeito de abertura ler sem depender dele: com `planoAtivo` nas
   * dependências, cada clique num cartão reabriria o lote no plano mais longo.
   */
  const planoAtivoAgora = useRef<null | string>(null);
  planoAtivoAgora.current = planoAtivo;
  // ⚠️ SÓ VIRA TETO SE ELE DIGITOU. O campo Entrada nasce preenchido pelo plano — usar esse número
  // como limite cortaria as composições sem ninguém ter pedido, e a lista aparecia vazia sem
  // explicação. Teto é o que o cliente TEM; o valor do plano é só um ponto de partida.
  const [entradaEhTeto, setEntradaEhTeto] = useState(false);
  /**
   * Os bens e permutas que o cliente entrega na aquisição — o carro, o lote, o apartamento.
   *
   * ⚠️ ESTADO PRÓPRIO, E NÃO UM CAMPO DO `Cockpit`. O cockpit é a conta em números soltos (entrada,
   * parcela, prazo), e cada efeito que o reescreve inteiro o reescreve inteiro: trocar de plano
   * (`carregarPlano`), abrir outro lote e usar uma composição fazem `setCockpit({...})` com a lista
   * de campos escrita à mão. Um bem morando lá desapareceria em cada um desses caminhos — clicar no
   * cartão do plano ao lado apagaria o Ford Ka sem dizer nada. O bem não é consequência do plano: é
   * o que o cliente trouxe, e sobrevive à troca de plano como sobreviveria numa conversa.
   */
  const [bens, setBens] = useState<BemOuPermuta[]>([]);
  // ⚠️ OS DOIS CAMPOS DA COBRANÇA VIVEM AQUI MESMO SEM A PROP. Estado condicional não existe em
  // React, e tentar criá-lo com um hook dentro de `if` quebra a ordem dos hooks. Sem a prop eles
  // simplesmente não são desenhados nem lidos por ninguém.
  const [diaDeVencimento, setDiaDeVencimento] = useState<number>(
    DIAS_DE_VENCIMENTO[0],
  );
  const [primeiraParcelaEm, setPrimeiraParcelaEm] = useState<string>(() =>
    proximoVencimento(new Date().toISOString(), DIAS_DE_VENCIMENTO[0]),
  );
  // ⚠️ O AJUSTE É ESTADO PRÓPRIO, e o preço da proposta passa a ser DERIVADO dele. Antes o campo do
  // lote guardava o valor final e mais nada: depois de salvar, ninguém sabia se R$ 142.500 tinham
  // sido um desconto de 5%, uma tabela desatualizada ou um erro de digitação — e a tela só dizia
  // "editado". Lucas, 08/09/2026: *"desconto em valor ou % que influencia o valor da proposta, isso
  // não pode mudar o valor original de tabela"*.
  const [ajuste, setAjuste] = useState<AjusteDePreco>(SEM_AJUSTE);
  // ⚠️ O PREÇO DA TELA (`preco`) SAIU DAQUI (18/09/2026) e é calculado logo abaixo do prazo
  // efetivo: no modo simulação o desconto é o do plano no prazo do plano, e esse desconto só se
  // conhece depois de saber qual plano está escolhido e quantas parcelas estão no campo.

  const [cockpit, setCockpit] = useState<Cockpit>({
    anuaisQuantidade: 0,
    anuaisValor: 0,
    entrada: 0,
    entradaVezes: 1,
    parcela: 0,
    parcelas: 0,
    valor: valorDaUnidade,
  });

  // ── Os planos, já com a taxa mensal resolvida ────────────────────────────
  //
  // ⚠️ `PlanoDaVenda` é o mesmo `PlanoComercial` com as uniões alargadas para string — a rota
  // serializa e JSON não carrega união. `taxaMensal` só lê juros, convenção e periodicidade, e
  // compara com literais: o cast é de tipo, não de valor.
  const planosDaConta: PlanoDaComposicao[] = useMemo(
    () =>
      planos.map((p) => ({
        // ⚠️ AS ANUAIS E O DESCONTO DO PLANO ENTRAM NA CONTA (Lucas, 18/09/2026: *"esta faltando as
        // anuais"* · *"tem que ser igual o mmendes"*). Até aqui eram descartados neste `map`, e o
        // cartão do Garden anunciava o Investidor Parcelado pelo preço cheio e sem os reforços.
        // Ausentes (o C2X e todo plano sem anual/desconto), a conta é exatamente a de antes.
        anuaisQuantidade: p.anuaisQuantidade ?? null,
        anuaisValor: p.anuaisValor ?? null,
        descontoPercentual: p.descontoPercentual ?? null,
        entradaPercentual: p.entradaPercentual,
        nome: p.nome,
        parcelas: p.parcelas,
        // ⚠️ O SISTEMA VEM JUNTO DESDE 04/09/2026, e é o que impedia a tela e o PDF de contarem a
        // mesma história: sem ele a conta era Price para todo mundo, e no SACOC (21 dos 24
        // empreendimentos) o cartão anunciava R$ 2.157,44 onde o documento dizia R$ 1.500,00.
        sistemaAmortizacao: sistemaDoCadastro(p.sistemaAmortizacao),
        taxaAoMes: taxaMensal(p as unknown as PlanoComercial),
      })),
    [planos],
  );

  /**
   * QUAL plano está escolhido — pela POSIÇÃO, e não pelo nome.
   *
   * ⚠️ RESOLVER POR NOME FAZIA A TELA ESCOLHER DOIS PLANOS DIFERENTES PARA A MESMA SIMULAÇÃO, e o
   * defeito era mudo. Os números (parcelas, entrada, taxa) saíam de `find`, que devolve o PRIMEIRO
   * com aquele nome; o índice de correção, o sistema de amortização e a convenção — que são o que
   * o cliente assina — saíam de um `Map` por nome, onde o ÚLTIMO com a mesma chave VENCE. Com
   * nomes repetidos na lista, um era o plano do filho e o outro o do pai.
   *
   * ⚠️ E OS NOMES SE REPETEM DE VERDADE: medido em 15/09/2026, VLO (pai) e VOC (filho) têm cada um
   * CURTO, INVESTIDOR e NORMAL — três nomes, seis planos. Os valores coincidem HOJE, então nada
   * aparece errado na tela; no dia em que o filho mudar o NORMAL dele, o cartão mostra uma parcela
   * e o contrato sai com o índice do outro, sem erro e sem log.
   *
   * A posição resolve porque `planosDaConta` é um `map` 1:1 de `planos` — o mesmo índice é o mesmo
   * plano nas duas listas, por construção.
   */
  const indiceDoPlano = useMemo(() => {
    const achado = planosDaConta.findIndex((p) => p.nome === planoAtivo);
    if (achado >= 0) return achado;
    return planosDaConta.length > 0 ? 0 : -1;
  }, [planoAtivo, planosDaConta]);

  const planoBase = useMemo(
    () => (indiceDoPlano >= 0 ? (planosDaConta[indiceDoPlano] ?? null) : null),
    [indiceDoPlano, planosDaConta],
  );

  /**
   * O desconto do plano escolhido (0 quando não tem). É dele que o campo de desconto parte quando o
   * plano é carregado, e é contra ele que a troca de plano decide o que fazer com o desconto.
   */
  const descontoDoAtivo = descontoDoPlano(planoBase?.descontoPercentual);

  // ⚠️ O PLANO CRU FICA À MÃO. `PlanoDaComposicao` carrega só o que a conta usa; o índice de
  // correção, o sistema de amortização e a convenção de juros são do CADASTRO, e a tela precisa
  // deles para dizer o que o cliente vai assinar. Vem do MESMO índice do `planoBase`.
  const cruBase = indiceDoPlano >= 0 ? planos[indiceDoPlano] : undefined;

  // (O mapa `crus`, por nome, servia só ao rótulo de correção dos cartões. Desde 18/09/2026 o cartão
  // lê o plano cru pela POSIÇÃO, como a ressalva, e o mapa saiu: pelo nome, o plano do pai e o do
  // filho com o mesmo nome trocariam de correção.)

  /**
   * ── A FAIXA DE PRAZO MANDA NA PREMISSA ──────────────────────────────────
   *
   * Lucas (13/09/2026): *"se eu apontar uma quantidade de parcelas naquele plano que eu estou
   * montando, o sistema tem que entender que aquele parcelamento encaixa em qual premissa"*, e
   * sobre os campos se mexerem sozinhos: *"deve atualizar sozinho"*.
   *
   * ⚠️ ISTO FECHA UM BURACO QUE JÁ ESTAVA ABERTO, e que ninguém via. Até hoje o corretor escolhia
   * o plano NORMAL (120x, 0,6434% a.m.), digitava 40 no campo Parcelas, e o cronograma saía com a
   * taxa do NORMAL aplicada a 40 parcelas — prazo e premissa DIVORCIADOS, porque só a entrada
   * mínima consultava `cockpit.parcelas`. O plano era resolvido por NOME e o prazo era um campo
   * livre ao lado.
   *
   * ⚠️ A TROCA É DO OBJETO, NUNCA DA CONTA. `cru` continua sendo o que alimenta `taxaMensal`,
   * `montarCronograma` e o PDF; ele só passa a chegar com a premissa da faixa por cima. Recalcular
   * a parcela aqui seria a segunda versão da mesma conta — o defeito que em 04/09/2026 fez a
   * mesma modal anunciar R$ 2.157,44 no cartão e R$ 1.500,00 no papel.
   *
   * ⚠️ E O PRAZO QUE DECIDE A FAIXA É O EFETIVO: o que o corretor digitou, ou o do plano quando ele
   * não digitou nada. É o mesmo fallback que `montada`, `aniversarios` e a régua da entrada já
   * usam — usar `cockpit.parcelas` cru faria a faixa sumir enquanto o campo estivesse em branco.
   */
  const prazoDaFaixa =
    cockpit.parcelas > 0 ? cockpit.parcelas : (planoBase?.parcelas ?? 0);

  /**
   * O desconto do plano escolhido, SE o prazo na tela é o do plano; zero quando não é.
   *
   * ⚠️ O DESCONTO SÓ É "DO PLANO" NO PRAZO DO PLANO (18/09/2026). O Investidor do Garden dá 12% em
   * 36 vezes com 40% de entrada; escolhido o Investidor e trocado o prazo para 84, os 12% que ficam
   * no campo deixam de ser a tabela oficial e passam a ser uma exceção do coordenador. É este número
   * que sobe como `descontoDoPlanoPercentual`, e com ele zerado a `ModalDeProposta` pede a nota como
   * pede de qualquer desconto dado à mão (`ajusteFrenteAoPlano`). O prazo é o efetivo, o mesmo da
   * faixa: campo em branco é o prazo do plano.
   */
  const descontoNoPrazo = descontoDoPlanoNoPrazo({
    descontoDoPlano: descontoDoAtivo,
    parcelasDoPlano: planoBase?.parcelas ?? 0,
    parcelasEfetivas: prazoDaFaixa,
  });

  /**
   * O ajuste que vale na tela.
   *
   * ⚠️ NO MODO SIMULAÇÃO NÃO EXISTE DESCONTO À MÃO (18/09/2026). O espelho público monta este
   * simulador numa página sem login, e o PDF que sai de lá leva a marca da casa: o campo de desconto
   * fica preso ao desconto do plano escolhido, no prazo do plano (fora dele, desconto nenhum, pela
   * mesma régua de cima). A rota do PDF confere de novo, porque a tela não é a última palavra
   * (`app/api/publico/espelho/simulacao`). Na Mesa de Venda é o ajuste do campo, como sempre foi.
   */
  const ajusteDaTela = useMemo(
    () => (ehSimulacao ? ajusteDoPlano(descontoNoPrazo) : ajuste),
    [ajuste, descontoNoPrazo, ehSimulacao],
  );
  const preco = useMemo(
    () => aplicarAjuste(valorDaUnidade, ajusteDaTela),
    [ajusteDaTela, valorDaUnidade],
  );

  /**
   * O campo do lote tem um desconto que NÃO é o do plano ativo (dado à mão, a mais ou a menos)?
   *
   * ⚠️ É O QUE FAZ A BUSCA POR PARCELA RESPEITAR O CAMPO. Sem desconto à mão, cada plano compõe sobre
   * o preço do cartão dele (o que o clique carrega). Com desconto à mão, o plano ATIVO compõe sobre
   * o preço do campo: senão o coordenador dava 10% no Investidor Parcelado, partia da parcela, e a
   * composição voltava a 8% por baixo do campo. Nunca no modo simulação, onde não há desconto à mão.
   */
  const campoComDescontoProprio =
    !ehSimulacao && !mesmoAjuste(ajuste, ajusteDoPlano(descontoDoAtivo));

  const premissaDaFaixa = useMemo(
    () => premissaDoPrazo(faixasDePrazo ?? [], prazoDaFaixa),
    [faixasDePrazo, prazoDaFaixa],
  );

  const daFaixa = useMemo(
    () => aplicarPremissa(cruBase as never, premissaDaFaixa) as typeof cruBase,
    [cruBase, premissaDaFaixa],
  );

  /**
   * O plano que vale, na ordem: CADASTRO → FAIXA DE PRAZO → o que o corretor escreveu por cima.
   *
   * ⚠️ O CORRETOR É O ÚLTIMO, e é assim que tem que ser: a faixa entrega a premissa "conforme
   * cadastro e alinhamento", e a alteração dele é uma decisão comercial que vence o cadastro — com
   * a nota obrigatória logo em seguida, que é o preço de poder fazer isso.
   *
   * ⚠️ TAXA VAZIA VOLTA À PREMISSA, NÃO A ZERO. Apagar o campo é desfazer a alteração; para dizer
   * "sem juros" ele escreve 0, e aí é uma alteração de verdade e a nota abre.
   */
  const cru = useMemo(() => {
    if (!daFaixa) return daFaixa;
    const bruto = sobrescrito.juros;
    const taxa =
      bruto == null || bruto.trim() === ""
        ? null
        : Number(bruto.replace(",", "."));
    const mexeuNaTaxa = taxa != null && Number.isFinite(taxa) && taxa >= 0;
    const mexeuNoIndice =
      sobrescrito.indice != null && sobrescrito.indice !== "";
    if (!mexeuNaTaxa && !mexeuNoIndice) return daFaixa;
    return {
      ...daFaixa,
      ...(mexeuNaTaxa ? { jurosTaxa: taxa } : {}),
      ...(mexeuNoIndice ? { indiceCorrecao: sobrescrito.indice } : {}),
    };
  }, [daFaixa, sobrescrito]);

  /** O corretor mexeu na premissa? É o que abre a caixa de nota na modal. */
  const premissaAlterada = cru !== daFaixa;

  /**
   * O plano da conta, já com a premissa da faixa.
   *
   * ⚠️ A TAXA É RECALCULADA A PARTIR DO CRU EFETIVO, e não herdada do `planoBase`: trocar o índice
   * e a taxa sem refazer `taxaMensal` deixaria o cartão mostrando a parcela da premissa ANTIGA
   * enquanto o rodapé já anunciaria o índice novo.
   */
  const plano = useMemo(() => {
    if (!planoBase || !cru || cru === cruBase) return planoBase;
    return {
      ...planoBase,
      entradaPercentual: cru.entradaPercentual,
      sistemaAmortizacao: sistemaDoCadastro(cru.sistemaAmortizacao),
      taxaAoMes: taxaMensal(cru as unknown as PlanoComercial),
    };
  }, [cru, cruBase, planoBase]);

  // ── A TABELA: cada plano aplicado a ESTE lote ────────────────────────────
  //
  // ⚠️ Com a entrada do próprio plano, e não uma qualquer: é a condição que a diretoria aprovou, e
  // é dela que a conversa parte. Clicar carrega tudo no cockpit.
  //
  // ⚠️ E COM O DESCONTO E AS ANUAIS DO PLANO (Lucas, 18/09/2026: *"tem que ser igual o mmendes"*).
  // A conta é `condicaoDoPlano` (`lib/hercules/tabela-do-lote.ts`): a tabela com o desconto do
  // plano, a entrada do plano sobre esse preço (com o piso do empreendimento por baixo), as anuais
  // que cabem no prazo e a parcela de `montarProposta`. Antes eram três cópias desta conta aqui
  // dentro, as três com `baloesQuantidade: 0`.
  //
  // ⚠️ O CARTÃO É O CLIQUE. O preço de cada cartão sai de `precoDeTabelaDoCartao`, que devolve o
  // preço que o clique naquele plano vai deixar no campo (`ajusteAoTrocarDePlano`). Sem desconto em
  // plano nenhum (todos os outros empreendimentos), é `cockpit.valor`, como sempre foi.
  const tabela = useMemo(
    () =>
      planosDaConta.map((p) => {
        const condicao = condicaoDoPlano({
          entradaMinimaPercentual,
          plano: p,
          precoDeTabela: precoDeTabelaDoCartao({
            descontoDoAtivo,
            descontoDoPlano: p.descontoPercentual,
            valorDaUnidade,
            valorNaTela: cockpit.valor,
          }),
        });
        return {
          anuais: condicao.anuais,
          desconto: condicao.descontoPercentual,
          entrada: condicao.entrada,
          parcela: condicao.parcela,
          plano: p,
          preco: condicao.precoDoPlano,
        };
      }),
    [cockpit.valor, descontoDoAtivo, entradaMinimaPercentual, planosDaConta, valorDaUnidade],
  );

  /** A linha do À VISTA embaixo dos cartões (a da MMendes). Nula sem plano com desconto. */
  const aVista = useMemo(
    () =>
      linhaDoAVista({
        planos: tabela.map((t) => ({ desconto: t.desconto, nome: t.plano.nome })),
        precoDeTabela: valorDaUnidade,
      }),
    [tabela, valorDaUnidade],
  );

  function carregarPlano(nome: string) {
    const alvo = tabela.find((t) => t.plano.nome === nome);
    if (!alvo) return;
    setPlanoAtivo(nome);
    // ⚠️ O DESCONTO DO PLANO VAI PARA O CAMPO DE DESCONTO, e trocar de plano troca o desconto. Ver
    // `ajusteAoTrocarDePlano`: entre planos sem desconto, o desconto à mão continua de pé.
    setAjuste((atual) =>
      ajusteAoTrocarDePlano({
        ajusteAtual: atual,
        descontoDoAnterior: descontoDoAtivo,
        descontoDoNovo: alvo.desconto,
      }),
    );
    setCockpit((a) => ({
      ...a,
      // ⚠️ AS ANUAIS DO PLANO, e não zero (Lucas: *"esta faltando as anuais"*). Plano sem anual
      // cadastrada continua zerando, como antes.
      anuaisQuantidade: alvo.anuais.quantidade,
      anuaisValor: alvo.anuais.valor,
      entrada: alvo.entrada,
      parcela: alvo.parcela,
      parcelas: alvo.plano.parcelas,
      // O preço do cartão é o que o novo desconto produz: gravar junto evita um render com a
      // entrada nova sobre o preço velho, antes de o efeito do ajuste alcançar o cockpit.
      valor: alvo.preco,
    }));
    setComando("condicoes");
    setEntradaEhTeto(false);
  }

  /**
   * Em que lote, preço e piso a tela abriu por último. É o que separa "abriu outro lote" (reinicia
   * tudo) de "os planos mudaram com a tela aberta" (mantém a escolha).
   */
  const aberturaAnterior = useRef<null | string>(null);

  // ⚠️ A TELA NUNCA ABRE VAZIA. Sem um ponto de partida, a direita seria um espaço em branco e a
  // primeira ação de todo mundo seria a mesma: clicar no plano mais longo. O simulador já faz isso
  // — abre no maior prazo, que é o que atende mais gente, e o resto se ajusta em cima.
  useEffect(() => {
    // ⚠️ PLANO QUE MUDOU COM A TELA ABERTA NÃO TROCA A ESCOLHA (revisão 3, 18/09/2026). Mesmo lote,
    // mesmo preço, mesmo piso, e o plano escolhido ainda existe na lista nova: a escolha e o que foi
    // digitado ficam, e os números que dependem do plano (os cartões, o preço do plano no modo
    // simulação, o piso da faixa) se refazem sozinhos a partir da lista nova. Só abre de novo quando
    // o lote é outro, ou quando o plano escolhido deixou de existir.
    const abertura = `${unidade}|${valorDaUnidade}|${entradaMinimaPercentual ?? ""}`;
    const mesmaAbertura = aberturaAnterior.current === abertura;
    aberturaAnterior.current = abertura;
    if (
      mesmaAbertura &&
      planoAtivoAgora.current !== null &&
      planosDaConta.some((p) => p.nome === planoAtivoAgora.current)
    ) {
      return;
    }

    const maisLongo =
      [...planosDaConta].sort((a, b) => b.parcelas - a.parcelas)[0] ?? null;
    // ⚠️ A MESMA CONTA DO CARTÃO E DO CLIQUE, sobre a tabela do lote: o lote abre no plano mais
    // longo com o desconto, a entrada e as anuais dele. No Garden isso é o Investidor Parcelado a
    // 92% da tabela, com 4 anuais de R$ 25.000 — o cartão que o Lucas mandou no print.
    const condicao = maisLongo
      ? condicaoDoPlano({
          entradaMinimaPercentual,
          plano: maisLongo,
          precoDeTabela: valorDaUnidade,
        })
      : null;

    setPlanoAtivo(maisLongo?.nome ?? null);
    setComando("condicoes");
    setEntradaEhTeto(false);
    // ⚠️ TROCOU DE UNIDADE, ZERA O DESCONTO À MÃO. Um desconto de 5% que sobrevivesse à troca de
    // lote seria aplicado a um preço que ninguém negociou — e como este efeito também reescreve o
    // valor, deixar o ajuste de pé faria a tela mostrar a tabela do lote novo com o desconto do
    // antigo. O que fica é o do PLANO em que o lote abre (nenhum, fora dos planos com desconto).
    setAjuste(condicao?.ajuste ?? SEM_AJUSTE);
    setCockpit({
      anuaisQuantidade: condicao?.anuais.quantidade ?? 0,
      anuaisValor: condicao?.anuais.valor ?? 0,
      entrada: condicao?.entrada ?? 0,
      entradaVezes: 1,
      parcela: condicao?.parcela ?? 0,
      // ⚠️ SEM PLANO, UM PRAZO DE PARTIDA — e não zero. Com zero parcelas não existe conta
      // possível, e a tela abria morta no produto sem plano cadastrado. 120 é ponto de partida
      // editável, não regra da casa: o plano NORMAL do C2X vai de 37 a 200 parcelas, e não existe
      // um número que sirva a todos.
      parcelas: maisLongo?.parcelas ?? PARCELAS_SEM_PLANO,
      valor: condicao?.precoDoPlano ?? valorDaUnidade,
    });
  }, [entradaMinimaPercentual, planosDaConta, unidade, valorDaUnidade]);

  // ⚠️ O AJUSTE REFAZ A CONTA INTEIRA. Mudar o preço sem refazer parcela e entrada deixaria a tela
  // mostrando um total novo com o financiamento velho — e o cronograma que vai para a proposta sairia
  // do preço antigo, sem ninguém ver. Só age quando o valor REALMENTE mudou, senão o efeito brigaria
  // com quem está digitando a parcela.
  useEffect(() => {
    setCockpit((a) =>
      a.valor === preco.valor ? a : { ...a, valor: preco.valor },
    );
  }, [preco.valor]);

  // ── A conta montada à mão, quando o comando veio das condições ───────────
  //
  // ⚠️ SEM PLANO A CONTA CONTINUA, e isso não é detalhe: até 04/09/2026 esta função devolvia
  // `null` quando o produto não tinha plano no C2X, e a coluna da direita ficava EM BRANCO. Foi o
  // que o Lucas viu no empreendimento de teste ("está dando erro, não abriu a simulação") — a tela
  // dizia "a conta sai sem juros e sem correção" e não fazia conta nenhuma. Sem plano, a conta é a
  // simples: divide o saldo pelo prazo, sem juros e sem correção.
  /**
   * A montagem que ainda VALE para a entrada de agora.
   *
   * ⚠️ A BASE É `cockpit.entrada`, que é a entrada que o campo mostra e sobre a qual as parcelas
   * foram digitadas. Quando ela muda — por plano, por composição, por digitação —, a montagem
   * antiga deixa de existir e a tela volta a dividir igual, que é o único estado que sempre fecha.
   */
  // ⚠️ E SÓ VALE NO COMANDO "CONDIÇÕES", que é quando o cartão mostra a conta MONTADA. Guardar a
  // base contra `cockpit.entrada` não bastava: o caminho "parcela" não mexe no cockpit — ele troca
  // a entrada que o CARTÃO mostra (a da composição recomendada) e deixa a montagem antiga de pé por
  // baixo. O resultado era a pior combinação possível: o cartão anunciava "entrada R$ 28.000, 60×
  // de R$ 1.866,67" e o pedido subia com a entrada da montagem, R$ 50.500 — o PDF saía com
  // R$ 22.500 a mais de entrada e R$ 375 a menos por mês do que o coordenador acabara de ler e
  // prometer ao cliente. A composição recomendada traz a PRÓPRIA entrada; montar parcelas sobre ela
  // só faz sentido depois de "Editar" (`usarComposicao`), que devolve o comando para "condições".
  const parcelasDaEntrada =
    montagemCrua &&
    comando === "condicoes" &&
    centavosIguais(montagemCrua.base, cockpit.entrada) &&
    montagemCrua.vezes === cockpit.entradaVezes
      ? montagemCrua.parcelas
      : null;

  // ⚠️ SÓ SOBE SE ALGUÉM ESCOLHEU ALGUMA. Uma lista de nulos gravaria ruído no `condicoes` da
  // proposta e faria toda proposta parecer ter data personalizada.
  const datasDaEntrada = datasDaEntradaCruas.some((d) => d)
    ? datasDaEntradaCruas
    : null;

  /**
   * Os bens que ENTRAM NA CONTA — e no espelho público não entra nenhum.
   *
   * ⚠️ A TRAVA É AQUI, NA CONTA, E NÃO SÓ NO DESENHO DO BLOCO. Esconder o campo já bastaria hoje,
   * porque sem campo a lista nasce vazia e fica vazia; mas no dia em que alguém passar uma lista
   * inicial por prop (para reabrir uma proposta, por exemplo), o `/e/<apelido>-<selo>` sem login
   * passaria a abater o saldo por um bem que o visitante não pode nem ver, e o PDF sairia com o
   * desconto. Permuta é negociação: ela existe do lado de cá do login e em lugar nenhum mais.
   *
   * ⚠️ E O `null` É A MESMA REFERÊNCIA SEMPRE, assim como `bens` só muda quando alguém mexe. Isto
   * importa: este valor entra nas dependências do efeito que sobe a composição, e um array novo a
   * cada render faria o efeito rodar em laço.
   */
  const bensDaNegociacao = ehSimulacao ? null : bens;
  /** Quanto dos bens CUMPRE a entrada mínima — só os apontados na entrada. */
  const bensNaEntrada = somarBensQueContamNaEntrada(bensDaNegociacao);

  const montagem = conferirEntradaMontada(
    cockpit.entrada,
    parcelasDaEntrada ?? [cockpit.entrada],
  );

  const montada = useMemo(() => {
    const parcelas =
      cockpit.parcelas > 0 ? cockpit.parcelas : (plano?.parcelas ?? 0);
    if (parcelas <= 0) return null;
    return {
      ...montarProposta({
        // ⚠️ O CRITÉRIO DO VALOR CHEIO É O DO PLANO (`temAnuaisCadastradas`, Lucas 18/09/2026: *"So
        // no Garden"*): o reforço digitado aqui abate pelo valor de face só no plano que tem anuais
        // cadastradas; no resto, a valor presente, como sempre. É o mesmo critério do cartão, da
        // busca por parcela e do cronograma do PDF.
        anuaisCadastradasNoPlano: temAnuaisCadastradas(plano),
        baloesQuantidade: cockpit.anuaisQuantidade,
        baloesValor: cockpit.anuaisValor,
        // ⚠️ O BEM ABATE O SALDO AQUI, E É O QUE FAZ A CONTA ANDAR NA HORA. Lucas (22/09/2026):
        // *"Abate, como uma entrada"*. Sem esta linha o bloco da esquerda mostraria o carro e o
        // cartão grande continuaria anunciando o financiado do valor cheio — a pessoa digita
        // R$ 80.000 e nada se mexe, e a única leitura possível é que o campo não funciona.
        bensEPermutas: bensDaNegociacao,
        // ⚠️ A ENTRADA É A DA MONTAGEM, e não a do cockpit. Quando as parcelas somam MAIS que o
        // combinado, é a soma que vira a entrada (regra do Lucas) — e o cartão grande da direita é
        // onde o coordenador está olhando quando clica em Gerar. Enquanto esta conta usava o valor
        // antigo, o cartão anunciava entrada, financiado, parcela e total de uma proposta, e o PDF
        // que saía por WhatsApp trazia outra: a mesma venda contada de dois jeitos, na mesma tela.
        entrada: montagem.entrada,
        parcelas,
        // ⚠️ SEM PLANO, O SISTEMA NÃO MUDA NADA — a taxa é zero e Price, SAC e SACOC caem todos em
        // `financiado ÷ prazo`. Fica o SACOC porque é onde a cascata de `calcularParcela` manda o
        // que não se declarou, e é o que o cronograma vai usar para o mesmo produto.
        sistemaAmortizacao: plano?.sistemaAmortizacao ?? "sacoc",
        taxaAoMes: plano?.taxaAoMes ?? 0,
        valor: cockpit.valor,
      }),
      parcelas,
    };
  }, [bensDaNegociacao, cockpit, montagem.entrada, plano]);

  /** O chão da casa para este lote — 10% do valor negociado, e acompanha o valor editado. */
  // ⚠️ O PISO DA ENTRADA DEPENDE DO PRAZO (Lucas, 05/09/2026: *"se eu colocar o parcelamento de 30
  // vezes eu não posso ter uma entrada menor que 56k, pois está dentro do plano investidor; se eu
  // colocar 48 eu não posso ter uma entrada menor que 28k"*). A tabela do empreendimento é uma
  // ESCADA — prazo curto custa entrada alta —, e até aqui o `entradaPercentual` de cada plano era
  // lido só como sugestão de preenchimento: a tela aceitava 30 parcelas com os 10% da casa, uma
  // condição que nenhum plano sustenta, e ela saía no papel do cliente. Agora o piso é o do plano
  // que COMPORTA o parcelamento pedido, com o piso da casa continuando por baixo.
  const pisoDoPrazo = pisoDaEntradaNoPrazo({
    // ⚠️ O MESMO FALLBACK DE `montada` E `aniversarios`, e não `cockpit.parcelas` cru. Apagar o
    // campo Parcelas para redigitar grava 0 (`Number("") || 0`), e com 0 a faixa não acha plano
    // nenhum: o piso despencava para o da casa e o rótulo passava a "Mínimo de 10%" — enquanto o
    // input voltava a exibir 36, o cartão dizia "36 vezes" e o efeito subia `parcelasMensais: 36`.
    // Bastava clicar fora para ficar estável: uma proposta de 36 parcelas com entrada de 10%, com a
    // tela endossando, onde a faixa exige 40%.
    parcelas: cockpit.parcelas > 0 ? cockpit.parcelas : (plano?.parcelas ?? 0),
    pisoDaCasaEmReais: entradaMinima(cockpit.valor, entradaMinimaPercentual),
    planos: planosDaConta,
    valorNegociado: cockpit.valor,
  });
  const minimoDaEntrada = pisoDoPrazo.emReais;
  /**
   * Quanto o cliente ainda precisa pôr EM DINHEIRO para cumprir o piso.
   *
   * ⚠️ É A MESMA CONTA DE `conferirProposta`, E TEM DE SER. Lá a régua aceita a proposta quando
   * `entrada + bem apontado na entrada` chega ao mínimo; se o campo aqui continuasse cobrando o
   * piso cheio, a tela acusaria "Abaixo do mínimo de 10%" em vermelho sobre uma proposta que o
   * servidor grava sem reclamar — a tela desmentindo a rota na cara de quem está vendendo, com o
   * botão "usar o mínimo" ao lado oferecendo pôr em espécie um dinheiro que a régua não pede.
   *
   * ⚠️ E É SÓ O `entraComo: "entrada"` QUE ABATE O PISO. O "abatimento" reduz o saldo igual, mas o
   * piso existe para garantir dinheiro do ATO, e um carro apontado como abatimento é justamente o
   * caso em que o comercial disse que ele NÃO cobre a entrada (Lucas, 22/09/2026: *"pode ser um ou
   * outro, pode apontar na entrada ou somente no valor negociado"*).
   *
   * ⚠️ O PISO CHEIO (`minimoDaEntrada`) CONTINUA SENDO O DA RÉGUA, e é ele que responde de quem é
   * a exigência logo abaixo (`pisoEmPercentual`): o bem não muda a política do empreendimento, ele
   * só paga parte dela.
   */
  const minimoEmDinheiro = Math.max(0, minimoDaEntrada - bensNaEntrada);
  /**
   * A entrada montada à mão, conferida.
   *
   * ⚠️ SEM MONTAGEM ELA FECHA SOZINHA: com `parcelasDaEntrada` nulo o resultado é a entrada do
   * cockpit, `ok: true` e excedente zero — ou seja, o caminho de sempre passa por aqui sem mudar
   * de comportamento. Com montagem, é ela quem diz qual é a entrada de verdade.
   */

  /** De quem é a régua: o plano da faixa quando ele aperta, senão o piso da casa. */
  const faixaDoPiso = pisoDoPrazo.faixa;
  const pisoEmPercentual =
    faixaDoPiso &&
    cockpit.valor > 0 &&
    minimoDaEntrada > entradaMinima(cockpit.valor, entradaMinimaPercentual)
      ? faixaDoPiso.entradaPercentual
      : (entradaMinimaPercentual ?? ENTRADA_MINIMA_PERCENTUAL);

  /** Quantos aniversários cabem no prazo — o teto de reforços anuais. */
  const aniversarios = Math.floor(
    (cockpit.parcelas > 0 ? cockpit.parcelas : (plano?.parcelas ?? 0)) / 12,
  );

  /** A parcela sobre a qual a direita conversa: a pedida, ou a que a conta devolveu. */
  const parcelaDeReferencia =
    comando === "parcela" ? cockpit.parcela : Math.round(montada?.parcela ?? 0);

  /**
   * O preço sobre o qual cada plano compõe na busca por parcela: o do cartão dele, que é o que o
   * clique carrega; e, para o plano ativo com desconto à mão, o do campo.
   *
   * ⚠️ UMA FONTE SÓ PARA O PREÇO DA COMPOSIÇÃO (18/09/2026). Antes a busca recebia um `valor` e um
   * `precoDeTabela` e decidia o preço de cada plano por conta própria, com uma regra parecida com a
   * do cartão e não a mesma. Sem desconto de plano nenhum (os outros empreendimentos), toda posição
   * é `cockpit.valor`, como sempre foi.
   */
  const precosDasComposicoes = useMemo(
    () =>
      tabela.map((t, posicao) =>
        posicao === indiceDoPlano && campoComDescontoProprio ? cockpit.valor : t.preco,
      ),
    [campoComDescontoProprio, cockpit.valor, indiceDoPlano, tabela],
  );

  const composicoes = useMemo(
    () =>
      parcelaDeReferencia > 0
        ? composicoesQueFecham({
            // ⚠️ A BUSCA POR PARCELA TAMBÉM CONTA O BEM, senão a MESMA TELA mostra dois
            // financiados: o cartão da composição recomendada sai desta varredura e o rodapé "O
            // que vai sair" sai de `montarCronograma`, que já desconta o carro. Num lote de
            // R$ 200.000 com permuta de R$ 80.000 um diria R$ 195.000 e o outro R$ 115.000, lado a
            // lado, e o PDF sairia com o segundo.
            bensEPermutas: bensDaNegociacao,
            parcelaAlvo: parcelaDeReferencia,
            planos: planosDaConta,
            entradaMinimaPercentual,
            // ⚠️ CADA PLANO COMPÕE SOBRE O PREÇO DELE (18/09/2026): o do cartão, que é a tabela com
            // o desconto do plano, ou o valor da tela no plano sem desconto (ver
            // `precosDasComposicoes`). `valor` e `precoDeTabela` ficam como a regra de reserva.
            precoDeTabela: valorDaUnidade,
            precos: precosDasComposicoes,
            tetoDaEntrada:
              entradaEhTeto && cockpit.entrada > 0 ? cockpit.entrada : null,
            valor: descontoDoAtivo > 0 ? valorDaUnidade : cockpit.valor,
          })
        : [],
    [
      bensDaNegociacao,
      cockpit.entrada,
      cockpit.valor,
      descontoDoAtivo,
      entradaEhTeto,
      entradaMinimaPercentual,
      parcelaDeReferencia,
      planosDaConta,
      precosDasComposicoes,
      valorDaUnidade,
    ],
  );

  /**
   * O desconto que uma composição carrega no preço: o que o clique nela deixaria no campo.
   *
   * ⚠️ A MESMA REGRA DO CARTÃO (`ajusteAoTrocarDePlano`), com uma exceção: a composição do plano
   * ATIVO, quando o campo tem desconto à mão, fechou sobre o preço do campo (`precosDasComposicoes`)
   * e carrega o ajuste do campo. É o par exato do preço: sem ele o cartão diria um valor e o
   * desconto subiria outro.
   */
  const nomeDoAtivo = planoBase?.nome ?? null;
  const ajusteDaComposicao = useCallback(
    (c: Composicao): AjusteDePreco =>
      c.plano === nomeDoAtivo && campoComDescontoProprio
        ? ajuste
        : ajusteAoTrocarDePlano({
            ajusteAtual: ajusteDaTela,
            descontoDoAnterior: descontoDoAtivo,
            descontoDoNovo: c.descontoPercentual,
          }),
    [ajuste, ajusteDaTela, campoComDescontoProprio, descontoDoAtivo, nomeDoAtivo],
  );

  /**
   * Escolher esta composição muda o preço do campo? Aí o cartão dela diz o preço e o desconto.
   *
   * ⚠️ SÓ QUANDO MUDA (18/09/2026): composição de plano com desconto, ou com preço diferente do que
   * está no campo. Nos empreendimentos sem desconto de plano toda composição fecha sobre o preço do
   * campo, e os cartões ficam exatamente como eram.
   */
  const composicaoMostraPreco = (c: Composicao) =>
    c.descontoPercentual > 0 || !centavosIguais(c.valor, cockpit.valor);

  /** "R$ 400.200 (desconto de 8%)" ou "R$ 435.000 (tabela)": o par que a escolha leva ao campo. */
  const precoDaComposicao = (c: Composicao) => {
    const ajusteDela = descreverAjuste(aplicarAjuste(valorDaUnidade, ajusteDaComposicao(c)));
    return `${dinheiro(c.valor)} (${ajusteDela ? ajusteDela.toLowerCase() : "tabela"})`;
  };

  /**
   * O id da linha de `temis_planos` do plano que ESTA TELA está mostrando.
   *
   * ⚠️ É O QUE FECHA O BURACO DO RENAME, e o buraco grava dinheiro errado. O servidor casava o
   * plano da proposta pelo NOME, e nome é texto que o cadastro edita: quando o Garden trocou NORMAL
   * por INVESTIDOR e INVESTIDOR por PROMOÇÃO À VISTA, uma aba aberta antes continuou mandando
   * "INVESTIDOR" querendo o plano de 36 parcelas SEM JUROS, e o nome passou a casar com a linha de
   * 60 com 6% ao ano — medido no banco, e congelado no cronograma que alimenta o contrato.
   *
   * ⚠️ PELA PRIMEIRA POSIÇÃO DO NOME, que é como TODA esta tela resolve plano (`indiceDoPlano`,
   * `carregarPlano`, o cartão da tabela) e é exatamente o que o servidor faz no caminho sem id.
   * Mandar este id não troca o plano de ninguém: ele CONGELA o plano que estava nesta tela quando
   * ela carregou, contra um cadastro que pode ter mudado no meio.
   */
  const idDoPlanoNaTela = useCallback(
    (nome: string): null | string => {
      const posicao = planos.findIndex((p) => p.nome === nome);
      return posicao >= 0 ? String(planos[posicao]?.id ?? "").trim() || null : null;
    },
    [planos],
  );

  const principal: Leitura | null = useMemo(() => {
    if (comando === "condicoes" && montada && plano) {
      return {
        ajuste: ajusteDaTela,
        anuais: {
          quantidade: cockpit.anuaisQuantidade,
          valor: cockpit.anuaisValor,
        },
        composicao: null,
        // ⚠️ O DO PLANO SÓ NO PRAZO DO PLANO (`descontoNoPrazo`): fora dele, o desconto que está no
        // campo é exceção e a modal pede a nota.
        descontoDoPlano: descontoNoPrazo,
        // A mesma entrada da conta acima: o cartão mostra o que vai ser gravado.
        entrada: montagem.entrada,
        financiado: montada.financiado,
        origem: "montada",
        parcela: montada.parcela,
        parcelas: montada.parcelas,
        plano: plano.nome,
        total: montada.total,
        valor: cockpit.valor,
      };
    }

    const melhor = composicoes[0];
    if (!melhor) return null;
    return {
      // ⚠️ O DESCONTO DA COMPOSIÇÃO é o que o clique nela deixaria no campo — a mesma regra da
      // troca de plano (`ajusteDaComposicao`). Sem desconto de plano nenhum, é o ajuste de sempre.
      ajuste: ajusteDaComposicao(melhor),
      anuais: melhor.anuais,
      composicao: melhor,
      descontoDoPlano: melhor.descontoPercentual,
      entrada: melhor.entrada,
      // ⚠️ VEM DA COMPOSIÇÃO, NÃO DE `valor − entrada`: os reforços anuais são abatidos pelo que
      // valem hoje, e é este o número que o PDF imprime como "Financiado". Recalcular aqui fazia a
      // tela e o papel discordarem em milhares na mesma venda — e o ramo `montada`, logo acima,
      // sempre usou `montada.financiado`, então as duas metades da mesma tela também discordavam.
      financiado: melhor.financiado,
      origem: "composicao",
      parcela: melhor.parcela,
      parcelas: melhor.parcelas,
      plano: melhor.plano,
      total: melhor.total,
      valor: melhor.valor,
    };
    // ⚠️ `montagem.entrada` NAS DEPENDÊNCIAS (16/09/2026, aviso do lint que já vinha do HEAD): o
    // cartão do ramo `montada` mostra essa entrada, e um memo que lê um valor sem declará-lo pode
    // devolver o cartão com o número anterior. É memo de leitura: recalcular a mais não dispara nada.
  }, [
    ajusteDaComposicao,
    ajusteDaTela,
    comando,
    composicoes,
    cockpit,
    descontoNoPrazo,
    montada,
    montagem.entrada,
    plano,
  ]);

  // ⚠️ A COMPOSIÇÃO SOBE POR EFEITO, e não por um callback em cada `onChange`. São nove campos que
  // mexem no mesmo resultado (valor, parcela, entrada, vezes, prazo, reforço, plano, dia,
  // data), e chamar o pai em cada um deles significaria lembrar de chamar em todos — o campo
  // esquecido geraria uma proposta com o número velho. Aqui a fonte é o que a tela está mostrando:
  // mudou o que está escrito, sobe.
  useEffect(() => {
    if (!aoMudarCondicoes) return;
    aoMudarCondicoes(
      principal
        ? {
            // Ajuste zerado é "sem ajuste": o que interessa gravar é o desconto que existiu.
            //
            // ⚠️ O AJUSTE E O VALOR SÃO OS DA LEITURA, e não os do campo (18/09/2026). Na
            // composição recomendada de um plano com desconto, o preço é o DELE; subir o valor do
            // campo junto com a entrada e a parcela da composição geraria uma proposta que não
            // fecha. No ramo montado, e em todo empreendimento sem desconto de plano, os dois são
            // exatamente o `ajuste` e o `cockpit.valor` de sempre.
            ajuste: principal.ajuste.valor !== 0 ? principal.ajuste : null,
            anuaisQuantidade: principal.anuais.quantidade,
            anuaisValor: principal.anuais.valor,
            // ⚠️ LISTA VAZIA SOBE COMO `null`, e não como `[]`. Proposta sem permuta é a regra, e
            // um array vazio em toda proposta gravaria `[]` no jsonb de milhares de vendas que não
            // têm bem nenhum — e faria `bensEPermutas != null` deixar de significar "tem permuta"
            // para quem ler a coluna depois.
            bensEPermutas: bensDaNegociacao?.length ? bensDaNegociacao : null,
            descontoDoPlanoPercentual: principal.descontoDoPlano,
            diaDeVencimento,
            // ⚠️ QUANDO HÁ MONTAGEM, A ENTRADA É A SOMA DELA — inclusive quando passa do
            // combinado, que é o caso em que o cliente paga mais no ato. Sem isto o papel sairia
            // com a entrada antiga e um fluxo somando outro valor.
            entradaValor: parcelasDaEntrada
              ? montagem.entrada
              : principal.entrada,
            entradaVezes: cockpit.entradaVezes,
            entradaDatas: datasDaEntrada,
            entradaParcelas: parcelasDaEntrada,
            premissaAlterada,
            parcela: principal.parcela,
            parcelasMensais: principal.parcelas,
            planoId: idDoPlanoNaTela(principal.plano),
            planoNome: principal.plano,
            primeiraParcelaEm,
            valorNegociado: principal.valor,
          }
        : null,
    );
  }, [
    aoMudarCondicoes,
    // ⚠️ A DOS BENS ENTROU EM 23/09/2026, E O QUE ELA SEGURA FOI MEDIDO, não suposto. Tirando SÓ
    // esta linha, os 10 testes de `SimuladorDeProposta.permuta.comportamento` continuam passando:
    // `principal` muda de identidade quando `montada` e `composicoes` refazem a conta com o bem, e
    // o efeito roda por ela. Tirando as três de uma vez (esta e as de `montada`/`composicoes`),
    // caem 6 dos 10 — e o modo como caem é o defeito que a casa já teve duas vezes: o bem aparece
    // na tela, o cartão não se mexe e o pedido sobe SEM a lista, em silêncio. Ela fica porque a
    // garantia não pode depender de outro memo continuar recalculando: no dia em que alguém
    // memoizar `principal` por valor, ou um campo de bem deixar de mexer na conta (uma nota, um
    // documento do carro), o efeito para de rodar e ninguém percebe.
    bensDaNegociacao,
    cockpit.entradaVezes,
    // ⚠️ AS DUAS ENTRARAM EM 13/09/2026 E SÃO OBRIGATÓRIAS. Sem `datasDaEntrada`, mudar a data de
    // uma parcela da entrada não avisava a modal e a data não chegava à proposta; sem
    // `premissaAlterada`, mexer nos juros não abria a caixa de nota. Nos dois casos a tela mostrava
    // uma coisa e o que subia era outra — em silêncio, que é o pior jeito de errar aqui.
    datasDaEntrada,
    premissaAlterada,
    diaDeVencimento,
    idDoPlanoNaTela,
    // ⚠️ A MONTAGEM ENTRA NAS DEPENDÊNCIAS. Sem ela, digitar um valor de parcela da entrada não
    // subiria nada: o pai continuaria com a composição antiga, e o botão "Gerar proposta" mandaria
    // ao servidor uma entrada diferente da que está escrita na tela.
    montagem.entrada,
    parcelasDaEntrada,
    primeiraParcelaEm,
    principal,
  ]);

  // ── O QUE O CAMPO DO LOTE MOSTRA ─────────────────────────────────────────
  //
  // ⚠️ É O PREÇO DA LEITURA PRINCIPAL, que é o que sobe (`aoMudarCondicoes`). No ramo montado ele é
  // o próprio ajuste da tela; na composição recomendada é o desconto dela sobre a tabela, que é
  // exatamente o `valor` com que ela fechou (`precoNoPlano` é `aplicarAjuste` com o desconto do
  // plano). Nos empreendimentos sem desconto de plano os dois caminhos dão o mesmo `ajuste`.
  const ajusteNoCampo =
    principal?.origem === "composicao" ? principal.ajuste : ajusteDaTela;
  /** O empreendimento tem plano com desconto próprio (o Garden)? Ver o campo do lote, abaixo. */
  const algumPlanoComDesconto = planosDaConta.some(
    (p) => descontoDoPlano(p.descontoPercentual) > 0,
  );
  const precoNoCampo = useMemo(
    () =>
      ajusteNoCampo === ajusteDaTela
        ? preco
        : aplicarAjuste(valorDaUnidade, ajusteNoCampo),
    [ajusteDaTela, ajusteNoCampo, preco, valorDaUnidade],
  );

  function usarComposicao(c: Composicao) {
    // ⚠️ A COMPOSIÇÃO TRAZ O PREÇO DO PLANO DELA, e o desconto vai junto para o campo — o mesmo
    // par que o cartão dela mostra (`ajusteDaComposicao`). Sem desconto de plano, nada muda.
    setAjuste(ajusteDaComposicao(c));
    setCockpit((atual) => ({
      ...atual,
      anuaisQuantidade: c.anuais.quantidade,
      anuaisValor: c.anuais.valor,
      entrada: c.entrada,
      parcela: c.parcela,
      parcelas: c.parcelas,
      valor: c.valor,
    }));
    setPlanoAtivo(c.plano);
    setComando("condicoes");
    setEntradaEhTeto(false);
  }

  /**
   * Mais um bem na negociação.
   *
   * ⚠️ NASCE COMO "ABATIMENTO", E É DE PROPÓSITO O LADO QUE NÃO AFROUXA A RÉGUA. Os dois destinos
   * são escolha por item (Lucas, 22/09/2026: *"pode ser um ou outro"*), e algum tem de ser o
   * padrão. Nascendo "entrada", todo carro digitado às pressas passaria a CUMPRIR a entrada mínima
   * sem ninguém ter decidido isso: o piso de 10% existe para garantir dinheiro no ato, e ele
   * desapareceria em silêncio. Nascendo "abatimento", o esquecimento aparece na hora, em vermelho,
   * no campo da entrada, e um clique conserta.
   */
  function acrescentarBem() {
    setBens((atual) =>
      atual.length >= TETO_DE_BENS_NA_PROPOSTA
        ? atual
        : [
            ...atual,
            { descricao: "", entraComo: "abatimento", tipo: "bem", valor: 0 },
          ],
    );
  }

  function mudarBem(posicao: number, mudanca: Partial<BemOuPermuta>) {
    setBens((atual) =>
      atual.map((bem, i) => (i === posicao ? { ...bem, ...mudanca } : bem)),
    );
  }

  function removerBem(posicao: number) {
    setBens((atual) => atual.filter((_, i) => i !== posicao));
  }

  return (
    <div
      style={{
        // ⚠️ A COR DO TEXTO É DECLARADA AQUI, e não herdada. O modal vive dentro do layout do hub,
        // que tem tema próprio: sem esta linha, os números grandes saíam com a cor do hub sobre o
        // cartão do portal — preto sobre preto no tema escuro.
        color: T.text,
        display: "grid",
        gap: 14,
        gridTemplateColumns: "minmax(270px, 320px) minmax(0, 1fr)",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* ═══ O COCKPIT ═══════════════════════════════════════════════════ */}
      <div
        data-sim-rolagem="comandos"
        style={{
          display: "grid",
          gap: 10,
          gridAutoRows: "min-content",
          minHeight: 0,
          // ⚠️ ROLA SÓ NA VERTICAL. Lucas, 08/09/2026: *"não queria o simulador com barra de
          // rolagem"*. Com `overflow: auto` nos dois eixos, qualquer filho um pixel mais largo que a
          // coluna (o campo de desconto, a fila de atalhos) criava uma barra horizontal — e barra
          // horizontal dentro de um modal esconde metade de um campo sem avisar. Aqui o excesso é
          // cortado, o que obriga os filhos a caberem de verdade.
          overflowX: "hidden",
          overflowY: "auto",
          // ⚠️ O ARRASTO NÃO SAI DAQUI. Sem isto, no dedo, o gesto que chega ao fim desta coluna
          // continua na página de trás: no espelho público Lucas viu *"quem sobe é a tela do
          // fundo"* (22/09/2026). O simulador vive dentro de uma janela sobreposta, e uma janela
          // que empurra o que está atrás dela some debaixo do dedo.
          overscrollBehavior: "contain",
          paddingRight: 4,
        }}
      >
        <Bloco titulo="O lote">
          {/* ⚠️ O CAMPO MOSTRA O PREÇO QUE SOBE (18/09/2026). Partindo da parcela, o que vai para a
              proposta e para o PDF é a composição recomendada, com o preço e o desconto DELA
              (`principal`); o campo continuava no plano ativo, e no Garden a tela dizia
              "R$ 400.200,00, desconto de 8% do plano" enquanto a proposta subia o Normal a
              R$ 435.000,00. Agora o campo lê a leitura principal.

              ⚠️ E MEXER NELE ENQUANTO ELE MOSTRA UMA COMPOSIÇÃO É EDITAR ESSA COMPOSIÇÃO, onde os
              planos têm preço próprio: a composição vai para o cockpit (o mesmo "Editar") e o
              desconto digitado vale sobre ela. Sem isso o coordenador digitava 3% em cima do Normal
              recomendado, a busca refazia a recomendação e o campo pulava para os 8% do Investidor
              Parcelado. Nos empreendimentos sem desconto de plano nada muda: o desconto digitado
              continua valendo para todas as composições, no modo parcela, como sempre valeu. */}
          <CampoDoLote
            ajuste={ajusteNoCampo}
            aoMudarAjuste={(novo) => {
              if (
                algumPlanoComDesconto &&
                principal?.origem === "composicao" &&
                principal.composicao
              ) {
                usarComposicao(principal.composicao);
              }
              // Por último: é o que foi digitado que vale, por cima do desconto da composição.
              setAjuste(novo);
            }}
            descontoDoPlano={
              principal ? principal.descontoDoPlano : descontoNoPrazo
            }
            preco={precoNoCampo}
            rotulo={`Lote ${unidade}`}
            rotuloDoValor={ehSimulacao ? "Valor simulado" : "Proposta"}
            somenteLeitura={ehSimulacao}
          />
        </Bloco>

        <Bloco titulo="Quanto o cliente paga por mês">
          <CampoEmReais
            aoMudar={(v) => {
              setCockpit((a) => ({ ...a, parcela: v }));
              setComando("parcela");
            }}
            destaque={comando === "parcela"}
            rotulo="Parcela"
            valor={cockpit.parcela}
          />
          <Atalhos
            aoEscolher={(v) => {
              setCockpit((a) => ({ ...a, parcela: v }));
              setComando("parcela");
            }}
            valores={[1_500, 2_000, 3_000, 4_000]}
          />
        </Bloco>

        <Bloco titulo="Entrada">
          <CampoDeEntrada
            aoMudar={(v) => {
              setCockpit((a) => ({ ...a, entrada: v }));
              setEntradaEhTeto(true);
              if (comando !== "parcela") setComando("condicoes");
            }}
            cobertoPorBem={bensNaEntrada}
            // ⚠️ O PISO QUE O CAMPO COBRA É O QUE FALTA EM DINHEIRO, e não o piso da política. Ver
            // `minimoEmDinheiro`: é a mesma conta que `conferirProposta` faz para aceitar a
            // proposta, e a tela e a rota têm de recusar exatamente as mesmas condições.
            minimo={minimoEmDinheiro}
            minimoEmPercentual={pisoEmPercentual}
            valor={cockpit.entrada}
            valorDoLote={cockpit.valor}
          />
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: 8,
              marginTop: 8,
            }}
          >
            <Contador
              aoMudar={(n) => {
                // A montagem se invalida sozinha: ela guarda para quantas vezes foi feita.
                setCockpit((a) => ({ ...a, entradaVezes: n }));
              }}
              // O mesmo teto que a rota pública do PDF aplica (`valoresDaSimulacaoPublica`).
              maximo={ENTRADA_VEZES_MAXIMA}
              valor={cockpit.entradaVezes}
            />
            <span style={{ color: T.muted, fontSize: 11.5 }}>
              {cockpit.entradaVezes > 1
                ? `vezes de ${dinheiro(cockpit.entrada / cockpit.entradaVezes)}`
                : "à vista"}
            </span>
            {/* ⚠️ SÓ APARECE PARCELADO (Lucas, 05/09/2026: *"quando a entrada for parcelada, temos
                que dar opção do usuário poder montar os valores em cada parcela"*). Numa entrada à
                vista não há o que montar, e o link ali seria um convite para uma tela vazia. */}
            {cockpit.entradaVezes > 1 ? (
              <button
                onClick={() =>
                  setMontagemCrua(
                    parcelasDaEntrada
                      ? null
                      : {
                          base: cockpit.entrada,
                          parcelas: partesIguais(
                            cockpit.entrada,
                            cockpit.entradaVezes,
                          ),
                          vezes: cockpit.entradaVezes,
                        },
                  )
                }
                style={{
                  background: "transparent",
                  border: "none",
                  color: T.gold,
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 11.5,
                  fontWeight: 700,
                  marginLeft: "auto",
                  padding: 0,
                }}
                type="button"
              >
                {parcelasDaEntrada ? "dividir igual" : "montar valores"}
              </button>
            ) : null}
          </div>

          {/* AS PARCELAS MONTADAS À MÃO.
              ⚠️ A RÉGUA É ASSIMÉTRICA, e é regra comercial: somar MENOS que o combinado é vender
              por menos do que foi negociado — o financiado cresce e a parcela sobe. Somar MAIS é o
              cliente pagando mais no ato, e aí o excedente não é erro: ele VIRA a entrada. */}
          {parcelasDaEntrada ? (
            <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
              {parcelasDaEntrada.map((valor, i) => (
                /* ⚠️ DUAS LINHAS, E NÃO UMA. Lucas (13/09/2026), vendo a primeira versão:
                   *"ficou ruim, acho que pode fazer abaixo, em vez do lado"*, e logo depois
                   *"traz os valores iguais em vez de nada"*.

                   Os dois problemas eram O MESMO: lado a lado, o campo de data espremeu o campo de
                   valor até sobrar só o prefixo "R$" visível. Os valores SEMPRE estiveram lá — o
                   rodapé "Somando R$ 17.000,00" media a divisão igual que a montagem já faz desde
                   05/09 —, mas o número não cabia mais na tela. Descer a data devolve a largura ao
                   valor, e os dois pedidos se resolvem com a mesma mudança. */
                <div key={i} style={{ display: "grid", gap: 4 }}>
                  <div
                    style={{ alignItems: "center", display: "flex", gap: 8 }}
                  >
                    <span
                      style={{
                        color: T.muted,
                        fontSize: 11,
                        fontWeight: 650,
                        minWidth: 58,
                      }}
                    >
                      {i + 1}ª parcela
                    </span>
                    <div style={{ flex: 1 }}>
                      <CampoEmReais
                        aoMudar={(v) =>
                          setMontagemCrua((atual) =>
                            atual
                              ? {
                                  ...atual,
                                  parcelas: atual.parcelas.map((antigo, j) =>
                                    j === i ? v : antigo,
                                  ),
                                }
                              : atual,
                          )
                        }
                        rotulo=""
                        valor={valor}
                      />
                    </div>
                    {/* "A primeira é 10 mil, divide o resto" — o caso que o coordenador descreve na
                      mesa, num clique em vez de três contas na calculadora. */}
                    {parcelasDaEntrada.length > 1 ? (
                      <button
                        onClick={() =>
                          setMontagemCrua((atual) =>
                            atual
                              ? {
                                  ...atual,
                                  parcelas: redistribuirDemais(
                                    cockpit.entrada,
                                    atual.parcelas,
                                    i,
                                  ),
                                }
                              : atual,
                          )
                        }
                        style={{
                          background: "transparent",
                          border: `1px solid ${T.border}`,
                          borderRadius: 7,
                          color: T.sub,
                          cursor: "pointer",
                          font: "inherit",
                          fontSize: 10.5,
                          padding: "4px 8px",
                          whiteSpace: "nowrap",
                        }}
                        title="Mantém esta parcela e divide o restante entre as outras"
                        type="button"
                      >
                        fixar
                      </button>
                    ) : null}
                  </div>

                  {/* ⚠️ A DATA É OPCIONAL E SOBREPÕE SÓ A POSIÇÃO ESCOLHIDA. Lucas (13/09/2026):
                      *"pode trazer as data no padrão calculado pelo sistema, mas dar opção de
                      escolha data"*. Em branco vale a calculada — mês a mês a partir da primeira;
                      apagar devolve a calculada.

                      ⚠️ O RÓTULO EXPLICA O BRANCO, e é por isso que ele existe. Um campo de data
                      vazio sem explicação parece campo por preencher, e o coordenador digitaria
                      três datas que o sistema já sabia calcular. */}
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      gap: 8,
                      paddingLeft: 66,
                    }}
                  >
                    <span style={{ color: T.muted, fontSize: 10.5 }}>
                      vence em
                    </span>
                    <input
                      aria-label={`Vencimento da ${i + 1}ª parcela da entrada`}
                      onChange={(e) =>
                        setDatasDaEntradaCruas((atual) => {
                          const proxima = [...atual];
                          while (proxima.length <= i) proxima.push(null);
                          proxima[i] = e.target.value || null;
                          return proxima;
                        })
                      }
                      style={{
                        background: T.card,
                        border: `1px solid ${T.border}`,
                        borderRadius: 7,
                        color: T.text,
                        font: "inherit",
                        fontSize: 11,
                        padding: "4px 6px",
                      }}
                      type="date"
                      value={datasDaEntradaCruas[i] ?? ""}
                    />
                    <span style={{ color: T.muted, fontSize: 10.5 }}>
                      {datasDaEntradaCruas[i] ? "escolhida" : "calculada"}
                    </span>
                  </div>
                </div>
              ))}

              <div
                style={{
                  alignItems: "baseline",
                  borderTop: `1px dashed ${T.border}`,
                  display: "flex",
                  gap: 8,
                  justifyContent: "space-between",
                  paddingTop: 6,
                }}
              >
                <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>
                  Somando
                </span>
                <b
                  style={{
                    color: montagem.ok ? T.text : T.danger,
                    fontSize: 12.5,
                  }}
                >
                  {dinheiroExato(montagem.soma)}
                </b>
              </div>

              {!montagem.ok ? (
                <span style={{ color: T.danger, fontSize: 11 }}>
                  Faltam {dinheiroExato(montagem.falta)} para fechar a entrada.
                </span>
              ) : montagem.excedente > 0 ? (
                <span style={{ color: T.ok, fontSize: 11 }}>
                  {dinheiroExato(montagem.excedente)} acima do combinado — a
                  entrada passa a ser {dinheiroExato(montagem.entrada)}.
                </span>
              ) : null}
            </div>
          ) : null}
        </Bloco>

        {/* BENS E PERMUTAS — o carro, o lote, o apartamento que o cliente entrega na aquisição.

            Lucas (22/09/2026), perguntado como o bem entra: *"Abate, como uma entrada"*; quantos
            cabem: *"Vários"*; e se conta para a entrada mínima: *"pode ser um ou outro, pode
            apontar na entrada ou somente no valor negociado"*. A conta, a régua, a rota, o PDF e o
            contrato já sabiam disso desde a 0187 — só faltava ONDE DIGITAR, e por isso nenhuma
            proposta do Panteon tinha nascido com permuta dentro.

            ⚠️ DEPOIS DA ENTRADA, E NÃO NO FIM DA COLUNA. O bem é a outra metade do que o cliente
            põe no ato: a linha de baixo do campo Entrada passa a dizer quanto do piso ele já cobre,
            e as duas coisas têm de ser lidas juntas. No fim da coluna, embaixo do prazo, o campo
            responderia "o bem cobre R$ 80.000 do mínimo" a três blocos de distância de onde o
            número aparece.

            ⚠️ E NÃO EXISTE NO ESPELHO PÚBLICO (`ehSimulacao`). Este mesmo componente é montado no
            link sem login que o corretor manda para o cliente: permuta é negociação, não vitrine.
            Com o campo lá, qualquer visitante inventa um bem de R$ 200.000, zera o saldo e imprime
            o PDF. É a mesma trava do bloco de cobrança e da edição de juros, logo abaixo.

            ⚠️ MAS A TRAVA DE VERDADE ESTÁ NA CONTA (`bensDaNegociacao`), e não neste `if`. Esconder
            o campo só resolve enquanto ninguém passar uma lista inicial por prop. */}
        {!ehSimulacao ? (
          <Bloco titulo="Bens e permutas">
            {bens.length > 0 ? (
              <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                {bens.map((bem, i) => (
                  <div
                    // ⚠️ A CHAVE É A POSIÇÃO, e aqui ela é a identidade certa: o item não tem id
                    // até a proposta ser gravada, e duas permutas podem ser idênticas em tipo,
                    // valor e descrição. Remover um item reordena as chaves, e é o que se quer: o
                    // campo de texto da linha 2 passa a mostrar o que a linha 2 tem agora.
                    key={i}
                    style={{
                      background: T.soft,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      display: "grid",
                      gap: 6,
                      padding: 8,
                    }}
                  >
                    <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
                      <select
                        aria-label={`Tipo do item ${i + 1}`}
                        onChange={(e) =>
                          mudarBem(i, {
                            tipo: e.target.value as BemOuPermuta["tipo"],
                          })
                        }
                        style={{ ...campo, flex: "0 0 96px", width: 96 }}
                        value={bem.tipo}
                      >
                        <option value="bem">Bem</option>
                        <option value="permuta">Permuta</option>
                      </select>
                      <span style={{ flex: "1 1 0", minWidth: 0 }}>
                        <CampoEmReais
                          aoMudar={(v) => {
                            mudarBem(i, { valor: v });
                            setComando("condicoes");
                          }}
                          rotulo=""
                          rotuloAcessivel={`Valor do item ${i + 1}`}
                          valor={bem.valor}
                        />
                      </span>
                      <button
                        aria-label={`Remover o item ${i + 1}`}
                        onClick={() => {
                          removerBem(i);
                          setComando("condicoes");
                        }}
                        style={{
                          background: "transparent",
                          border: `1px solid ${T.border}`,
                          borderRadius: 8,
                          color: T.muted,
                          cursor: "pointer",
                          flex: "0 0 auto",
                          font: "inherit",
                          fontSize: 13,
                          fontWeight: 700,
                          lineHeight: 1,
                          padding: "0 9px",
                        }}
                        type="button"
                      >
                        ×
                      </button>
                    </div>

                    {/* ⚠️ A DESCRIÇÃO É O QUE VAI PARA O CONTRATO, e o teto é o mesmo da rota
                        (`TAMANHO_MAXIMO_DA_DESCRICAO`): lá ele RECUSA em vez de cortar, então
                        cortar aqui é o que evita digitar 400 caracteres para receber 422. */}
                    <input
                      aria-label={`Descrição do item ${i + 1}`}
                      maxLength={TAMANHO_MAXIMO_DA_DESCRICAO}
                      onChange={(e) => mudarBem(i, { descricao: e.target.value })}
                      placeholder="Ford Ka 2019 placa ABC1D23"
                      style={{ ...campo, fontSize: 12.5, fontWeight: 500 }}
                      value={bem.descricao}
                    />

                    {/* ONDE O VALOR ENTRA. Os dois abatem o saldo igual; o que muda é se ele
                        CUMPRE a entrada mínima. */}
                    <div style={{ display: "flex", gap: 6 }}>
                      {(
                        [
                          {
                            aria: `O item ${i + 1} entra na entrada`,
                            modo: "entrada" as const,
                            texto: "Na entrada",
                          },
                          {
                            aria: `O item ${i + 1} só abate o valor negociado`,
                            modo: "abatimento" as const,
                            texto: "Só no valor negociado",
                          },
                        ] as const
                      ).map((opcao) => {
                        const marcado = bem.entraComo === opcao.modo;
                        return (
                          <button
                            aria-label={opcao.aria}
                            aria-pressed={marcado}
                            key={opcao.modo}
                            onClick={() => {
                              mudarBem(i, { entraComo: opcao.modo });
                              setComando("condicoes");
                            }}
                            style={{
                              background: marcado ? T.card : "transparent",
                              border: `1px solid ${marcado ? T.gold : T.border}`,
                              borderRadius: 999,
                              color: marcado ? T.text : T.sub,
                              cursor: "pointer",
                              font: "inherit",
                              fontSize: 11,
                              fontWeight: 650,
                              padding: "4px 11px",
                            }}
                            type="button"
                          >
                            {opcao.texto}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
              {/* ⚠️ O BOTÃO SOME NO DÉCIMO, e o teto é o da rota. Sem isto, o jeito de descobrir o
                  limite era digitar o décimo primeiro item e receber 422 com a lista pronta. */}
              {bens.length < TETO_DE_BENS_NA_PROPOSTA ? (
                <button
                  onClick={acrescentarBem}
                  style={{ ...botaoDiscreto, padding: "6px 12px" }}
                  type="button"
                >
                  Acrescentar bem ou permuta
                </button>
              ) : (
                <span style={{ color: T.muted, fontSize: 11 }}>
                  Máximo de {TETO_DE_BENS_NA_PROPOSTA} itens por proposta.
                </span>
              )}
              {bens.length > 0 ? (
                <span
                  style={{ color: T.muted, fontSize: 11.5, marginLeft: "auto" }}
                >
                  {bensNaEntrada > 0
                    ? `${dinheiro(bensNaEntrada)} na entrada`
                    : "só abatem o valor"}
                </span>
              ) : null}
            </div>
          </Bloco>
        ) : null}

        {/* ⚠️ SÓ NA PROPOSTA, e por isso preso à prop. Numa simulação livre não existe primeira
            parcela: o coordenador está olhando quanto o cliente paga por mês, e um campo de data
            pedindo um dia que não vai virar boleto nenhum é campo para ninguém preencher.

            Lucas (04/09/2026): *"com a data da primeira parcela da entrada as demais segue na data
            que ele escolheu e de acordo com o parcelamento"*. Quem espalha essa data pelo
            calendário é `montarCronograma`; aqui só se escolhe o ponto de partida. */}
        {/* ⚠️ NO MODO SIMULAÇÃO A COBRANÇA NÃO APARECE, mesmo com `aoMudarCondicoes` presente.
            O espelho público precisa da prop para saber o que está na tela (é o que vai no PDF),
            mas dia de vencimento e data da primeira parcela são de PROPOSTA — Lucas (10/09/2026):
            *"tira essa coisa de vencimento (...) como é um simulador"*. Antes as duas coisas
            andavam juntas na mesma condição, e escutar a tela obrigava a mostrar o vencimento. */}
        {aoMudarCondicoes && !ehSimulacao ? (
          <Bloco titulo="Cobrança">
            <div
              style={{
                color: T.muted,
                fontSize: 11,
                fontWeight: 650,
                marginBottom: 5,
              }}
            >
              Dia de vencimento
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {DIAS_DE_VENCIMENTO.map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setDiaDeVencimento(d);
                    // ⚠️ TROCAR O CHIP REESCREVE A DATA, e é o que ele pediu ("já preenchida com o
                    // próximo dia escolhido"). Manter 10/10 depois de escolher o dia 20 deixaria a
                    // entrada vencendo num dia e o boleto mensal em outro, sem ninguém ter pedido.
                    // Quem quiser outra data digita depois — a digitada só se perde se ele clicar
                    // no chip de novo.
                    setPrimeiraParcelaEm(
                      proximoVencimento(new Date().toISOString(), d),
                    );
                  }}
                  style={{
                    background: diaDeVencimento === d ? T.soft : "transparent",
                    border: `1px solid ${diaDeVencimento === d ? T.gold : T.border}`,
                    borderRadius: 999,
                    color: diaDeVencimento === d ? T.text : T.sub,
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 12,
                    fontWeight: 650,
                    padding: "5px 14px",
                  }}
                  type="button"
                >
                  dia {d}
                </button>
              ))}
            </div>

            <label style={{ display: "grid", gap: 3, marginTop: 10 }}>
              <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>
                Primeira parcela da entrada
              </span>
              <input
                onChange={(e) => setPrimeiraParcelaEm(e.target.value)}
                style={campo}
                type="date"
                value={primeiraParcelaEm}
              />
            </label>
          </Bloco>
        ) : null}

        <Bloco titulo="Parcelas anuais">
          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
            {/* ⚠️ O TETO É O PRAZO: o k-ésimo reforço cai no mês 12k, e um contrato de 24 meses só
                tem dois aniversários. Deixar subir além disso cobraria depois da última parcela. */}
            <Contador
              aoMudar={(n) => {
                setCockpit((a) => ({
                  ...a,
                  anuaisQuantidade: n,
                  anuaisValor:
                    n > 0 && a.anuaisValor === 0 ? 20_000 : a.anuaisValor,
                }));
                setComando("condicoes");
              }}
              maximo={aniversarios}
              minimo={0}
              valor={cockpit.anuaisQuantidade}
            />
            <span style={{ color: T.muted, fontSize: 11.5 }}>
              {cockpit.anuaisQuantidade > 0
                ? "reforços, um por ano"
                : aniversarios > 0
                  ? "sem reforço anual"
                  : "o prazo não chega a um ano"}
            </span>
          </div>
          {cockpit.anuaisQuantidade > 0 ? (
            <div style={{ marginTop: 8 }}>
              <CampoEmReais
                aoMudar={(v) => {
                  setCockpit((a) => ({ ...a, anuaisValor: v }));
                  setComando("condicoes");
                }}
                direita={`total ${dinheiro(cockpit.anuaisQuantidade * cockpit.anuaisValor)}`}
                rotulo="Valor de cada reforço"
                valor={cockpit.anuaisValor}
              />
              <Atalhos
                aoEscolher={(v) => {
                  setCockpit((a) => ({ ...a, anuaisValor: v }));
                  setComando("condicoes");
                }}
                valores={[10_000, 15_000, 20_000, 30_000]}
              />
            </div>
          ) : null}
        </Bloco>

        <Bloco titulo="Prazo, juros e reajuste">
          <label style={{ display: "grid", gap: 3 }}>
            <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>
              Parcelas
            </span>
            <input
              onChange={(e) => {
                setCockpit((a) => ({
                  ...a,
                  parcelas: Number(e.target.value) || 0,
                }));
                setComando("condicoes");
              }}
              style={campo}
              type="number"
              value={String(cockpit.parcelas || plano?.parcelas || 0)}
            />
          </label>

          {/* ⚠️ O ÍNDICE DE REAJUSTE É PARTE DO PREÇO (Lucas, 03/09/2026: *"faltou o índice de
              reajuste"*). Dois planos com a mesma parcela e a mesma taxa custam diferente se um
              corrige por IPCA e o outro não. A frase sai de `fraseDeCorrecao`, a MESMA que a ficha
              do plano usa, para as duas telas não divergirem. */}
          {cru ? (
            <>
              <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
                <Linha
                  rotulo="Reajuste"
                  valor={INDICES[cru.indiceCorrecao as IndiceCorrecao] ?? "—"}
                />
                {/* ⚠️ A TAXA SAI COMO ESTÁ NO CADASTRO, sem truncar. Lucas (13/09/2026): *"a
                    correção tem que trazer com 4 casas decimais quando a mesma tiver isso no
                    cadastro"*. Esta linha imprimia com `maximumFractionDigits: 2` e transformava
                    os 0,6434% do plano Normal - Price em "0,64% ao mês" — enquanto a linha logo
                    abaixo, seis linhas daqui, já dizia "0,6434% a.m." pela `fraseDeCorrecao`. Os
                    dois números na mesma tela, e o errado em cima.

                    ⚠️ E A FUNÇÃO JÁ EXISTIA: `textoDaTaxa` (planos-comerciais.ts) é a mesma que o
                    PDF e a PA impressa usam desde sempre, e ela já faz exatamente o que o Lucas
                    pediu — imprime "0,6434% a.m." e "0,5% a.m." sem zeros à direita. Escrever uma
                    segunda formatação aqui era o começo da terceira.

                    ⚠️ ISTO TAMBÉM É TELA DE CLIENTE: este componente é montado dentro do espelho
                    público (EspelhoPublico.tsx), então o "0,64% ao mês" estava no link que vai
                    para o comprador. */}
                <Linha
                  rotulo="Juros"
                  valor={
                    textoDaTaxa(cru as unknown as PlanoComercial) || "sem juros"
                  }
                />
              </div>

              {/* ⚠️ EDITAR JUROS E ÍNDICE SÓ EXISTE NA PROPOSTA, e a trava é a mesma do bloco de
                  cobrança logo abaixo: este componente é montado DENTRO DO ESPELHO PÚBLICO, sem
                  login (EspelhoPublico.tsx). Um campo novo aqui sem esta condição nasceria numa
                  página de cliente, onde ele poderia reescrever a taxa do próprio contrato.

                  ⚠️ E A ORDEM É CADASTRO → FAIXA → CORRETOR. O que estes campos fazem é a última
                  etapa: Lucas (13/09/2026) *"a nossa obrigação é entregar as premissas para aquele
                  plano conforme cadastro e alinhamento, mas o corretor pode alterar isso"*. Mexer
                  aqui abre a caixa de nota na modal — é o preço de poder mexer. */}
              {aoMudarCondicoes && !ehSimulacao ? (
                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <label style={{ display: "grid", flex: "1 1 0", gap: 3 }}>
                      <span
                        style={{
                          color: T.muted,
                          fontSize: 10.5,
                          fontWeight: 650,
                        }}
                      >
                        Juros %{" "}
                        {cru.jurosPeriodicidade === "anual" ? "a.a." : "a.m."}
                      </span>
                      <input
                        inputMode="decimal"
                        onChange={(e) =>
                          setSobrescrito((a) => ({
                            ...a,
                            juros: e.target.value,
                          }))
                        }
                        placeholder="em branco = o do cadastro"
                        style={campo}
                        value={sobrescrito.juros ?? ""}
                      />
                    </label>
                    <label style={{ display: "grid", flex: "1 1 0", gap: 3 }}>
                      <span
                        style={{
                          color: T.muted,
                          fontSize: 10.5,
                          fontWeight: 650,
                        }}
                      >
                        Correção
                      </span>
                      <select
                        onChange={(e) =>
                          setSobrescrito((a) => ({
                            ...a,
                            indice: e.target.value || null,
                          }))
                        }
                        style={campo}
                        value={sobrescrito.indice ?? ""}
                      >
                        <option value="">o do cadastro</option>
                        {Object.entries(INDICES).map(([codigo, rotulo]) => (
                          <option key={codigo} value={codigo}>
                            {rotulo}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {premissaAlterada ? (
                    <p
                      style={{
                        color: T.sub,
                        fontSize: 10.5,
                        margin: 0,
                      }}
                    >
                      Condição alterada. O motivo vai ser pedido antes de gerar
                      a proposta.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p style={{ color: T.muted, fontSize: 11, margin: "8px 0 0" }}>
                {fraseDeCorrecao(cru as unknown as PlanoComercial)}. A parcela
                acima é a valor de hoje: o índice corrige o contrato ao longo do
                prazo e não entra nesta conta.
              </p>
            </>
          ) : (
            <p style={{ color: T.muted, fontSize: 11.5, margin: "8px 0 0" }}>
              Nenhum plano cadastrado para este produto: a conta sai sem juros e
              sem correção, e o prazo abaixo é só um ponto de partida — edite à
              vontade.
            </p>
          )}
        </Bloco>
      </div>

      {/* ═══ A LEITURA ═══════════════════════════════════════════════════ */}
      <div
        data-sim-rolagem="leitura"
        style={{
          display: "grid",
          gap: 12,
          gridAutoRows: "min-content",
          minHeight: 0,
          // ⚠️ AQUI MORAM OS CARTÕES DE PLANO E AS "OUTRAS COMPOSIÇÕES": é esta coluna que precisa
          // rolar por dentro, e é ela que no iPad cortava embaixo. O eixo horizontal continua em
          // `auto` (ao contrário da coluna dos comandos) porque a prévia do cronograma é uma
          // tabela: cortá-la esconderia colunas do fluxo sem dar como chegar nelas.
          overflow: "auto",
          overscrollBehavior: "contain",
          paddingRight: 4,
        }}
      >
        {/* A TABELA como ponto de partida: um cartão por plano, e clicar carrega no cockpit. */}
        <div>
          <div style={{ ...rotuloDeSecao, marginBottom: 8 }}>
            Tabela do empreendimento, aplicada a este lote
          </div>
          <div
            style={{
              display: "grid",
              gap: 8,
              gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
            }}
          >
            {tabela.map((t, posicao) => {
              const ativo = plano?.nome === t.plano.nome;
              // ⚠️ A RESSALVA PELA POSIÇÃO, e não pelo nome: `tabela` é um `map` 1:1 de
              // `planosDaConta`, que é 1:1 de `planos` (ver `indiceDoPlano`). Pelo nome, o plano do
              // pai e o do filho com o mesmo nome trocariam de etiqueta.
              const ressalva = planos[posicao]?.ressalva ?? null;
              // ⚠️ O TEXTO DO CARTÃO É O DA MMENDES, linha a linha e na ordem dela (Lucas,
              // 18/09/2026: *"tem esse escrito. tem que ser igual o mmendes"*): nome e ressalva,
              // entrada · anuais · prazo, o valor do lote com a tabela e o desconto, a parcela com os
              // centavos e a correção. Quem escreve é `linhasDoCartao` (lib/hercules/cartao-do-plano),
              // conferida contra a conta extraída do `garden.html`.
              const cru = planos[posicao];
              const linhas = linhasDoCartao({
                anuais: t.anuais,
                entrada: t.entrada,
                entradaPercentual: t.plano.entradaPercentual,
                indiceCorrecao: cru?.indiceCorrecao,
                nome: t.plano.nome,
                parcela: t.parcela,
                parcelas: t.plano.parcelas,
                preco: t.preco,
                precoDeTabela: valorDaUnidade,
                ressalva,
                taxa: cru ? textoDaTaxa(cru as unknown as PlanoComercial) : "",
              });
              return (
                <button
                  key={t.plano.nome}
                  onClick={() => carregarPlano(t.plano.nome)}
                  style={{
                    background: ativo ? T.soft : T.card,
                    border: `1px solid ${ativo ? T.gold : T.border}`,
                    borderRadius: 11,
                    cursor: "pointer",
                    font: "inherit",
                    padding: "10px 12px",
                    textAlign: "left",
                  }}
                  type="button"
                >
                  {/* ⚠️ O NOME É O PRIMEIRO FILHO, SOZINHO: é por ele que os testes e a leitura de
                      tela acham o cartão. A ressalva vem ao lado, na mesma linha, como na MMendes. */}
                  <span
                    data-cartao="nome"
                    style={{ color: T.text, fontSize: 12.5, fontWeight: 650, marginRight: 6 }}
                  >
                    {linhas.nome}
                  </span>
                  {/* ⚠️ A CONDIÇÃO DE DISPONIBILIDADE DO PLANO (0168), onde o plano é ESCOLHIDO.
                      Lucas (16/09/2026) pediu a escrita no plano investidor ("válido para as
                      próximas 16 unidades"); ela só aparecia no Apolo e na aba de políticas, e a Mesa
                      oferecia o plano sem a condição. É a mesma etiqueta âmbar de lá, ao lado do nome
                      como na MMendes (*"precisa estar onde o corretor lê o nome do plano"*). */}
                  {linhas.ressalva ? (
                    <span data-cartao="ressalva" style={{ display: "inline-flex", verticalAlign: 1 }}>
                      <EtiquetaDaRessalva texto={linhas.ressalva} />
                    </span>
                  ) : null}
                  {/* ⚠️ O % DA ENTRADA VEM JUNTO (Lucas, 05/09/2026: *"pode colocar o % de cada plano
                      aqui"*). Os cartões são a ESCADA do produto (prazo curto, entrada alta), e só
                      com o valor em reais a escada não se lê. É o único acréscimo ao texto da MMendes. */}
                  <div
                    data-cartao="resumo"
                    style={{ color: T.muted, fontSize: 10.5, lineHeight: 1.45, marginTop: 2 }}
                  >
                    {linhas.resumo}
                  </div>
                  <div style={{ marginTop: 7 }}>
                    <div style={{ color: T.muted, fontSize: 9.5 }}>Valor do lote</div>
                    <div
                      data-cartao="valor-do-lote"
                      style={{
                        color: T.text,
                        fontSize: 14,
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 650,
                        lineHeight: 1.2,
                      }}
                    >
                      {linhas.valorDoLote}
                    </div>
                    <div
                      data-cartao="origem-do-valor"
                      style={{ color: T.muted, fontSize: 10, fontVariantNumeric: "tabular-nums" }}
                    >
                      {linhas.origemDoValor}
                    </div>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div style={{ color: T.muted, fontSize: 9.5 }}>Parcela mensal</div>
                    <div
                      style={{
                        color: T.text,
                        fontSize: 17,
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 650,
                        lineHeight: 1.15,
                      }}
                    >
                      <span data-cartao="parcela">{linhas.parcela}</span>
                      <small
                        data-cartao="prazo"
                        style={{ color: T.muted, fontSize: 11, fontWeight: 400, marginLeft: 3 }}
                      >
                        {linhas.prazo}
                      </small>
                    </div>
                    <div data-cartao="correcao" style={{ color: T.muted, fontSize: 10 }}>
                      {linhas.correcao}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {/* ⚠️ A LINHA DO À VISTA, DEPOIS DOS PLANOS, como na MMendes: o lote com o maior desconto de
              tabela, em uma parcela. Não é botão (não há o que carregar no cockpit: à vista não tem
              série). Só aparece quando algum plano tem desconto; ver `linhaDoAVista`. */}
          {aVista ? (
            <div
              data-cartao="a-vista"
              style={{
                alignItems: "center",
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 11,
                display: "flex",
                flexWrap: "wrap",
                gap: "6px 16px",
                marginTop: 8,
                padding: "9px 12px",
              }}
            >
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <div style={{ color: T.text, fontSize: 12.5, fontWeight: 650 }}>À vista</div>
                <div style={{ color: T.muted, fontSize: 10.5 }}>{aVista.detalhe}</div>
              </div>
              <div>
                <div style={{ color: T.muted, fontSize: 9.5 }}>Valor do lote</div>
                <div
                  style={{
                    color: T.text,
                    fontSize: 14,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 650,
                  }}
                >
                  {aVista.valorDoLote}
                </div>
                <div style={{ color: T.muted, fontSize: 10 }}>{aVista.origemDoValor}</div>
              </div>
              <div>
                <div style={{ color: T.muted, fontSize: 9.5 }}>Pagamento</div>
                <div style={{ color: T.text, fontSize: 13, fontWeight: 650 }}>
                  {aVista.pagamento}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ⚠️ UMA LEITURA SÓ PARA OS DOIS CAMINHOS — ver o cabeçalho do arquivo. */}
        {/* ⚠️ ESTE CARTÃO NÃO É MAIS UM BLOCO IGUAL AOS OUTROS (Lucas, 05/09/2026: *"tô achando que
            falta uns destaques, está muito tudo igual, difícil visualmente"*). Ele é a RESPOSTA —
            "quanto meu cliente vai pagar" —, e estava com o mesmo fundo, a mesma borda e o mesmo
            padding dos seis blocos de preenchimento que ficam em volta. O que muda: fundo próprio,
            borda mais presente e mais ar. Nada de cor nova: a única cor aqui continua sendo o verde
            da composição recomendada, que já significava alguma coisa. */}
        {principal ? (
          <div
            style={{
              background: T.soft,
              // ⚠️ O NEUTRO NÃO PODE GRITAR MAIS QUE O VERDE. `T.sub` é cinza-escuro de TEXTO: numa
              // borda de 1,5px ele pesa mais que o `T.ok` da composição recomendada, e a cor que
              // significa alguma coisa passaria a ser a menos visível das duas. O que destaca este
              // cartão é o fundo próprio e a espessura; a cor continua reservada ao recomendado.
              border: `1.5px solid ${principal.origem === "composicao" ? T.ok : T.border}`,
              borderRadius: 14,
              // ⚠️ O PADDING NÃO CRESCEU. Esta coluna já rola por dentro, e o Lucas pediu a modal
              // "sem barra de rolagem": o destaque tem que sair do contraste, não de altura nova.
              padding: 16,
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: 8,
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  background:
                    principal.origem === "composicao" ? T.okBg : T.soft,
                  borderRadius: 999,
                  color: principal.origem === "composicao" ? T.ok : T.muted,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".05em",
                  padding: "3px 9px",
                  textTransform: "uppercase",
                }}
              >
                {principal.origem === "composicao"
                  ? "Recomendada · menor entrada"
                  : ehSimulacao
                    ? "Simulação montada"
                    : "Proposta montada"}
              </span>
              <span style={{ color: T.muted, fontSize: 11.5 }}>
                Plano {principal.plano}
                {/* ⚠️ A COMPOSIÇÃO DIZ O PREÇO DELA (18/09/2026). Cada plano compõe sobre o próprio
                    preço, e a recomendada pode ser de um plano com outro preço que o do plano
                    ativo: sem esta linha o cartão anunciava a parcela do Normal a R$ 435.000 logo
                    abaixo de um campo que dizia R$ 400.200. Nos empreendimentos sem desconto de
                    plano o preço da composição é o do campo, e a linha não aparece. */}
                {principal.origem === "composicao" &&
                principal.composicao &&
                composicaoMostraPreco(principal.composicao)
                  ? ` · ${precoDaComposicao(principal.composicao)}`
                  : ""}
              </span>
            </div>

            <div
              style={{
                alignItems: "baseline",
                display: "flex",
                gap: 10,
                marginBottom: 4,
              }}
            >
              {/* O NÚMERO QUE A CONVERSA COM O CLIENTE USA. É o primeiro que tem de ser lido. */}
              <b
                style={{
                  fontSize: 34,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                }}
              >
                {dinheiroExato(principal.parcela)}
              </b>
              <span style={{ color: T.muted, fontSize: 13 }}>
                por mês, {principal.parcelas} vezes
              </span>
            </div>

            {/* ⚠️ EXPLICA A PARCELA MENOR QUE A PEDIDA. Com a entrada ancorada no piso de 10%, a
                parcela cai abaixo do valor que o cliente disse que podia pagar. É notícia boa, mas
                sem esta linha parece conta errada — "pedi 2.000 e a tela devolveu 1.736". */}
            {principal.origem === "composicao" &&
            principal.parcela < parcelaDeReferencia * 0.99 ? (
              <p style={{ color: T.muted, fontSize: 11.5, margin: "0 0 12px" }}>
                Abaixo dos {dinheiro(parcelaDeReferencia)} que ele pode pagar:
                chegar exatamente nesse valor exigiria entrada menor que o
                mínimo de {pisoEmPercentual}%.
              </p>
            ) : (
              <div style={{ height: 10 }} />
            )}

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))",
              }}
            >
              <Dado
                // ⚠️ COM ENTRADA MONTADA, "4 × R$ 7.750" É MENTIRA. A nota divide o total pelo
                // número de vezes, e numa montagem desigual (10.000 + 7.000 + 7.000 + 7.000) essa
                // divisão descreve parcelas que não existem — bem embaixo do número certo, no
                // cartão que o coordenador está lendo quando clica em Gerar. Montada, ela anuncia
                // a PRIMEIRA, que é a que a conversa com o cliente usa; o resto está listado logo
                // ao lado, linha a linha.
                nota={
                  parcelasDaEntrada && parcelasDaEntrada.length > 1
                    ? `${parcelasDaEntrada.length}× · 1ª de ${dinheiro(parcelasDaEntrada[0] ?? 0)}`
                    : cockpit.entradaVezes > 1
                      ? `${cockpit.entradaVezes} × ${dinheiro(principal.entrada / cockpit.entradaVezes)}`
                      : `${Math.round((principal.entrada / (principal.valor || 1)) * 100)}% do valor`
                }
                rotulo="Entrada"
                valor={dinheiro(principal.entrada)}
              />
              <Dado
                nota={
                  principal.anuais.quantidade > 0
                    ? `total ${dinheiro(principal.anuais.quantidade * principal.anuais.valor)}`
                    : "sem reforço"
                }
                rotulo="Anuais"
                valor={
                  principal.anuais.quantidade > 0
                    ? `${principal.anuais.quantidade} × ${dinheiro(principal.anuais.valor)}`
                    : "—"
                }
              />
              <Dado
                nota="depois da entrada e dos reforços"
                rotulo="A financiar"
                valor={dinheiro(principal.financiado)}
              />
              <Dado
                // ⚠️ CONTRA O VALOR NEGOCIADO, E NÃO MAIS "% SOBRE A TABELA" (22/09/2026). Com os
                // juros fora do total (ver `montarProposta`), o percentual sobre a tabela virou
                // aritmeticamente o DESCONTO do plano: medido nos dois prints do Lucas, "−8% sobre
                // a tabela" nos dois, exatamente os 8% do INVESTIDOR PARCELADO — e o mesmo cartão
                // já imprime "R$ 382.720 (desconto de 8%)" na linha do preço, duas linhas acima.
                // Era um número morto, e um que mudava de sentido sozinho no dia em que o plano
                // fosse Price (lá o percentual passaria a misturar desconto com juros da parcela).
                // Contra o valor negociado ele é zero exatamente quando a conta fecha — que é o que
                // o Lucas pediu ver — e só sai do zero onde a própria parcela carrega juros (Price)
                // ou onde o reforço abate a valor presente, que é a única notícia que sobra ali.
                nota={
                  centavosIguais(principal.total, principal.valor)
                    ? "igual ao valor negociado"
                    : `${dinheiro(Math.abs(principal.total - principal.valor))} ${principal.total > principal.valor ? "acima" : "abaixo"} do negociado`
                }
                rotulo="Total pago"
                valor={dinheiro(principal.total)}
              />
            </div>

            {/* Lucas: *"aqui em vez desse textão, somente um editar"*. A ação é óbvia pelo lugar. */}
            {principal.composicao ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: 12,
                }}
              >
                <button
                  onClick={() =>
                    usarComposicao(principal.composicao as Composicao)
                  }
                  style={botaoDiscreto}
                  type="button"
                >
                  Editar
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
            {cockpit.parcela > 0
              ? "Nenhuma composição fecha com essa parcela: ela pode estar alta demais (pagaria o lote antes do prazo) ou a entrada disponível não cobre nenhum plano."
              : "Diga quanto o cliente paga por mês, ou escolha um plano acima."}
          </p>
        )}

        {previa}

        {/* ⚠️ AS "OUTRAS COMPOSIÇÕES" SAÍRAM DA TELA, e não é ajuste de layout: é decisão de
            produto. Lucas, 22/09/2026, com o print da lista aberta: *"pode tirar isso aqui"*, e
            perguntado de onde, *"De todo lugar"*. Ela já tinha saído da modal de proposta em
            05/09 (*"deixa somente no simulador, aqui quanto mais objetivo for melhor"*); agora sai
            do simulador também, e não sobra lugar que a desenhe.
            ⚠️ `composicoesQueFecham` CONTINUA SENDO CHAMADA, e tirar a chamada junto quebraria a
            tela: é ela que acha a composição RECOMENDADA, a do cartão grande, quando a pessoa parte
            da parcela que o cliente pode pagar. O que saiu é a lista de alternativas embaixo do
            cartão, não a busca. */}

        {/* ⚠️ O RODAPÉ MUDA COM O USO. Dizer "nada aqui vincula a unidade nem gera proposta" na
            modal que está gerando a proposta seria a tela desmentindo o botão logo abaixo dela. */}
        <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
          {aoMudarCondicoes
            ? "Estas são as condições que vão para a proposta. Conta feita com os planos cadastrados do empreendimento."
            : ehSimulacao
              ? "Simulação de pagamento com os planos cadastrados do empreendimento. Os valores e o prazo são confirmados com o corretor."
              : "Simulação livre: nada aqui vincula a unidade nem gera proposta. Conta feita nesta tela, com os planos cadastrados do empreendimento."}
        </p>
      </div>
    </div>
  );
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

const campo = {
  background: T.soft,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  font: "inherit",
  fontSize: 13.5,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
  padding: "7px 10px",
  width: "100%",
} as const;

// ⚠️ O TÍTULO DA SEÇÃO SAIU DE `T.muted`. Com seis blocos empilhados, um título no cinza mais
// claro da paleta pesa menos que o próprio conteúdo — e é ele que diz onde a pessoa está. Um degrau
// de cinza (`T.sub`) resolve sem gastar um pixel de altura, que é o que falta nesta modal.
const rotuloDeSecao = {
  color: T.sub,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
} as const;

const botaoDiscreto = {
  background: T.soft,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.sub,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 650,
  padding: "6px 16px",
} as const;

/**
 * ⚠️ AS NOTAS DE RODAPÉ DOS BLOCOS SAÍRAM (Lucas, 05/09/2026: *"esses textos eu acho poluição"*).
 * Elas explicavam a mecânica da tela — "vira o teto da busca", "veio do plano", "reforços que
 * abatem o saldo" — e faziam sentido no dia em que a tela nasceu. Num cockpit de seis blocos, cada
 * um com duas linhas cinzas embaixo, o que se lê é o cinza: a explicação de cada campo empurra o
 * campo seguinte para baixo e cria a barra de rolagem que o Lucas pediu para tirar. O que o campo
 * faz, ele diz fazendo; a prop `nota` continua existindo para o cartão de resultado, onde ela
 * qualifica um NÚMERO ("depois da entrada e dos reforços") em vez de ensinar a usar a tela.
 */
function Bloco({
  children,
  nota,
  titulo,
}: {
  children: React.ReactNode;
  nota?: string;
  titulo: string;
}) {
  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ ...rotuloDeSecao, marginBottom: 8 }}>{titulo}</div>
      {children}
      {nota ? (
        <p style={{ color: T.muted, fontSize: 11, margin: "8px 0 0" }}>
          {nota}
        </p>
      ) : null}
    </section>
  );
}

function Atalhos({
  aoEscolher,
  valores,
}: {
  aoEscolher: (v: number) => void;
  valores: number[];
}) {
  return (
    // Uma linha só, em grade: em coluna estreita o `flex-wrap` deixava um atalho órfão embaixo.
    <div
      style={{
        display: "grid",
        gap: 5,
        // ⚠️ `minmax(0, 1fr)` E NÃO `1fr`: com `1fr` a coluna nunca fica menor que o conteúdo, e
        // "R$ 4.000" empurrava a grade inteira para além da largura do cockpit — era daí que vinha
        // a barra de rolagem horizontal do modal.
        gridTemplateColumns: `repeat(${valores.length}, minmax(0, 1fr))`,
        marginTop: 8,
        minWidth: 0,
      }}
    >
      {valores.map((v) => (
        <button
          key={v}
          onClick={() => aoEscolher(v)}
          style={{
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            color: T.sub,
            cursor: "pointer",
            font: "inherit",
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 2px",
          }}
          type="button"
        >
          {dinheiro(v)}
        </button>
      ))}
    </div>
  );
}

/**
 * Campo de dinheiro com cifrão e pontuação.
 *
 * ⚠️ Os dois (Lucas, 03/09/2026): a pontuação porque "145451" obriga a contar casas com o dedo na
 * tela, e o símbolo porque numa grade com prazo e quantidade ele diz de imediato o que é dinheiro.
 */
function CampoEmReais({
  aoMudar,
  destaque,
  direita,
  rotulo,
  rotuloAcessivel,
  valor,
}: {
  aoMudar: (n: number) => void;
  destaque?: boolean;
  direita?: string;
  rotulo: string;
  /**
   * O nome do campo para quem não vê o desenho, quando `rotulo` está vazio.
   *
   * ⚠️ EXISTE PORQUE HÁ CAMPO SEM RÓTULO VISÍVEL, e "sem rótulo visível" não pode virar "sem
   * rótulo". Na linha de um bem, o valor divide a linha com o tipo e o botão de remover, e um
   * rótulo escrito por cima de cada um empilharia três linhas de cinza por item. O leitor de tela
   * (e o teste) continuam achando o campo pelo nome.
   */
  rotuloAcessivel?: string;
  valor: number;
}) {
  const [texto, setTexto] = useState(valorParaOCampo(valor));

  // ⚠️ SÓ REESCREVE QUANDO O VALOR VEIO DE FORA. Enquanto a pessoa digita, o texto é dela: formatar
  // a cada tecla move o cursor e apaga a vírgula que ela acabou de escrever.
  useEffect(() => {
    setTexto((atual) =>
      (valorDigitado(atual) ?? 0) === valor ? atual : valorParaOCampo(valor),
    );
  }, [valor]);

  return (
    <label style={{ display: "grid", gap: 3 }}>
      {/* Rótulo vazio = quem chama já desenhou o seu (é o caso do campo de entrada, que tem o
          alternador R$/% na mesma linha). Um <span> vazio abriria um vão de 11px. */}
      {rotulo || direita ? (
        <span
          style={{
            alignItems: "baseline",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>
            {rotulo}
          </span>
          {direita ? (
            <span style={{ color: T.muted, fontSize: 10.5 }}>{direita}</span>
          ) : null}
        </span>
      ) : null}
      <span
        style={{ alignItems: "center", display: "flex", position: "relative" }}
      >
        <span
          style={{
            color: T.muted,
            fontSize: 12,
            fontWeight: 600,
            left: 10,
            pointerEvents: "none",
            position: "absolute",
          }}
        >
          R$
        </span>
        <input
          aria-label={rotuloAcessivel}
          inputMode="decimal"
          onBlur={() => setTexto(valor > 0 ? valorParaOCampo(valor) : "")}
          onChange={(e) => {
            setTexto(e.target.value);
            aoMudar(valorDigitado(e.target.value) ?? 0);
          }}
          placeholder="0,00"
          style={{
            ...campo,
            border: `1px solid ${destaque ? T.gold : T.border}`,
            padding: "7px 10px 7px 34px",
          }}
          value={texto}
        />
      </span>
    </label>
  );
}

/**
 * A entrada: em reais ou em percentual, e com o piso da casa na cara.
 *
 * ⚠️ OS DOIS MODOS SÃO PEDIDO DELE (Lucas, 03/09/2026: *"libera para gente também colocar %"*). Numa
 * mesa a entrada se fala das duas formas — "vinte por cento" quando a conversa é de política, "trinta
 * mil" quando é do bolso do cliente. Converter na cabeça, com o valor do lote quebrado, é onde o erro
 * entra.
 *
 * ⚠️ E O MÍNIMO APARECE, não bloqueia. Digitar é um caminho, não um resultado: travar no meio da
 * digitação apagaria o número enquanto ele ainda está sendo escrito. A tela avisa e oferece o piso
 * num clique.
 */
function CampoDeEntrada({
  aoMudar,
  cobertoPorBem = 0,
  minimo,
  minimoEmPercentual,
  valor,
  valorDoLote,
}: {
  aoMudar: (n: number) => void;
  /**
   * Quanto do piso já está pago por bem apontado NA ENTRADA. Zero = o caso de sempre.
   *
   * ⚠️ O NÚMERO PRECISA SER DITO, e não só descontado. Sem esta linha, o campo passaria de
   * "Mínimo de 10%: R$ 20.000" para "Mínimo de 10%: R$ 0" no instante em que o bem é digitado, e
   * um mínimo que vira zero sozinho se lê como defeito. Dizer de onde veio é o que transforma o
   * mesmo número em notícia: o carro já cumpre o piso.
   */
  cobertoPorBem?: number;
  minimo: number;
  /** O mesmo piso, em %, para a tela escrever "minimo de 8%" em vez de repetir a constante. */
  minimoEmPercentual: number;
  valor: number;
  valorDoLote: number;
}) {
  const [modo, setModo] = useState<"pct" | "reais">("reais");
  const abaixo = abaixoDoMinimo(valor, minimo);
  const pct = valorDoLote > 0 ? (valor / valorDoLote) * 100 : 0;

  return (
    <div style={{ display: "grid", gap: 3 }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>
          Valor
        </span>
        <span style={{ display: "flex", gap: 3 }}>
          {(["reais", "pct"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              style={{
                background: modo === m ? T.soft : "transparent",
                border: `1px solid ${modo === m ? T.border : "transparent"}`,
                borderRadius: 6,
                color: modo === m ? T.text : T.muted,
                cursor: "pointer",
                font: "inherit",
                fontSize: 10.5,
                fontWeight: 700,
                lineHeight: 1.4,
                padding: "2px 7px",
              }}
              type="button"
            >
              {m === "reais" ? "R$" : "%"}
            </button>
          ))}
        </span>
      </div>

      {modo === "reais" ? (
        <CampoEmReais aoMudar={aoMudar} rotulo="" valor={valor} />
      ) : (
        <CampoEmPorcento
          // ⚠️ ARREDONDA NO CENTAVO, NÃO NO REAL. 10% de R$ 145.451 é R$ 14.545,10; arredondando
          // para o real inteiro dava R$ 14.545 e o campo nascia DEZ CENTAVOS abaixo do piso — com
          // a tela acusando, logo abaixo, "Abaixo do mínimo de 10% (R$ 14.545)", porque a frase
          // arredonda o piso para o mesmo número que o campo mostra. A pessoa lia que R$ 14.545 é
          // menor que R$ 14.545 e a proposta era recusada na hora de gerar. Acontece em todo lote
          // cujo valor termina em 1, 2, 3 ou 4. É o mesmo defeito que `entradaDoPlano` já corrigiu
          // lá em cima, reintroduzido no campo ao lado.
          aoMudar={(p) => aoMudar(Math.round(valorDoLote * p) / 100)}
          valor={pct}
        />
      )}

      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <span style={{ color: abaixo ? T.danger : T.muted, fontSize: 10.5 }}>
          {/* ⚠️ `minimo` AQUI É O RESÍDUO EM DINHEIRO, NÃO O PISO, desde que o bem passou a cobrir
              parte dele. Chamá-lo de "mínimo de 10%" fazia a linha desmentir a régua: num lote de
              R$ 200.000 com bem de R$ 15.000 na entrada, ela escrevia "Abaixo do mínimo de 10%
              (R$ 5.000)" — e R$ 5.000 é 2,5% do lote —, e escrevia "Falta R$ 5.000" logo depois de
              o botão "usar o mínimo" ter posto exatamente esses R$ 5.000. Medido na revisão de
              23/09/2026. Cada frase abaixo diz o que o número É: com bem, fala em DINHEIRO que
              falta; sem bem, fala no piso. */}
          {abaixo
            ? cobertoPorBem > 0
              ? `Faltam ${dinheiro(minimo - valor)} em dinheiro: o bem cobre ${dinheiro(cobertoPorBem)} do mínimo de ${minimoEmPercentual}%`
              : `Abaixo do mínimo de ${minimoEmPercentual}% (${dinheiro(minimo)})`
            : cobertoPorBem > 0 && minimo <= 0
              ? `O bem apontado na entrada já cumpre o mínimo de ${minimoEmPercentual}%`
              : cobertoPorBem > 0
                ? `Com o bem de ${dinheiro(cobertoPorBem)}, o mínimo de ${minimoEmPercentual}% está cumprido`
                : valor > 0
                  ? `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do valor · mínimo ${dinheiro(minimo)}`
                  : `Mínimo de ${minimoEmPercentual}%: ${dinheiro(minimo)}`}
        </span>
        {abaixo ? (
          <button
            onClick={() => aoMudar(minimo)}
            style={{
              background: "transparent",
              border: "none",
              color: T.gold,
              cursor: "pointer",
              font: "inherit",
              fontSize: 10.5,
              fontWeight: 700,
              padding: 0,
              whiteSpace: "nowrap",
            }}
            type="button"
          >
            usar o mínimo
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** O irmão do `CampoEmReais` para percentual: mesmo comportamento, sufixo em vez de prefixo. */
function CampoEmPorcento({
  aoMudar,
  valor,
}: {
  aoMudar: (n: number) => void;
  valor: number;
}) {
  const escreve = (v: number) =>
    v > 0 ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "";
  const [texto, setTexto] = useState(escreve(valor));

  useEffect(() => {
    setTexto((atual) =>
      lerPercentualDigitado(atual) === Math.round(valor * 100) / 100
        ? atual
        : escreve(valor),
    );
  }, [valor]);

  return (
    <span
      style={{ alignItems: "center", display: "flex", position: "relative" }}
    >
      <input
        inputMode="decimal"
        onBlur={() => setTexto(escreve(valor))}
        onChange={(e) => {
          setTexto(e.target.value);
          aoMudar(lerPercentualDigitado(e.target.value));
        }}
        placeholder="0"
        style={{ ...campo, paddingRight: 28 }}
        value={texto}
      />
      <span
        style={{
          color: T.muted,
          fontSize: 12,
          fontWeight: 600,
          pointerEvents: "none",
          position: "absolute",
          right: 10,
        }}
      >
        %
      </span>
    </span>
  );
}

/**
 * Está abaixo do piso?
 *
 * ⚠️ A COMPARAÇÃO É EM CENTAVOS INTEIROS. Em ponto flutuante 10% de R$ 178.100 é
 * 17810.000000000002, e `17810 < 17810.000000000002` é verdadeiro: a tela acusava "abaixo do
 * mínimo" para o valor exato do mínimo. O piso é inclusivo — 10% em diante.
 *
 * ⚠️ E ZERO ACUSA TAMBÉM, DESDE 22/09/2026. Até aqui a função exigia `valor > 0`, com a ideia de que
 * campo vazio é "ainda não escolhi". Medido na própria tela, é falso: apagar o campo faz
 * `cockpit.entrada = 0`, a composição sai com entrada zero e o cartão grande já imprime
 * "Entrada R$ 0,00", "A financiar" cheio e a parcela maior — a tela CALCULOU com zero, e só o aviso
 * ficava mudo. Era o pior caso da entrada solta: o Lucas aceitou liberar a entrada sem trava (*"pode
 * deixar tudo liberado, sem trava, somente com alertas"*) EM TROCA do alerta, e sem ele o que sobra
 * é só a liberação.
 *
 * ⚠️ SEM PISO NÃO HÁ AVISO: com `minimo` zero (o empreendimento 42, piso 0%), zero não está abaixo
 * de nada, e a comparação em centavos já devolve falso sozinha.
 */
function abaixoDoMinimo(valor: number, minimo: number): boolean {
  return Math.round(valor * 100) < Math.round(minimo * 100);
}

function Contador({
  aoMudar,
  maximo,
  minimo = 1,
  valor,
}: {
  aoMudar: (n: number) => void;
  maximo: number;
  minimo?: number;
  valor: number;
}) {
  const passo = (d: number) =>
    aoMudar(Math.max(minimo, Math.min(maximo, valor + d)));

  return (
    <span
      style={{
        alignItems: "center",
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        display: "inline-flex",
      }}
    >
      <button
        aria-label="Diminuir"
        onClick={() => passo(-1)}
        style={passoDoContador}
        type="button"
      >
        −
      </button>
      <span
        style={{
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 650,
          minWidth: 22,
          textAlign: "center",
        }}
      >
        {valor}
      </span>
      <button
        aria-label="Aumentar"
        onClick={() => passo(1)}
        style={passoDoContador}
        type="button"
      >
        +
      </button>
    </span>
  );
}

const passoDoContador = {
  background: "transparent",
  border: "none",
  color: T.sub,
  cursor: "pointer",
  font: "inherit",
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1,
  padding: "5px 10px",
} as const;

/** Rótulo à esquerda, valor à direita — para as duas linhas de condição do plano. */
function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
      <span style={{ color: T.muted, fontSize: 11.5 }}>{rotulo}</span>
      <b style={{ fontSize: 11.5, fontWeight: 650 }}>{valor}</b>
    </div>
  );
}

function Dado({
  nota,
  rotulo,
  valor,
}: {
  nota: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div>
      <div style={{ color: T.muted, fontSize: 10.5, fontWeight: 650 }}>
        {rotulo}
      </div>
      <div
        style={{
          fontSize: 14,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 650,
        }}
      >
        {valor}
      </div>
      <div style={{ color: T.muted, fontSize: 10.5 }}>{nota}</div>
    </div>
  );
}

// ── O CAMPO DO LOTE, COM DESCONTO ───────────────────────────────────────────
//
// Lucas, 08/09/2026: *"não temos um campo para dar desconto ou aumentar o preço caso o usuário
// entenda que deva aumentar. Acho que aqui pode ficar isso, desconto em valor ou % que influencia o
// valor da proposta — isso não pode mudar o valor original de tabela"*.
//
// ⚠️ SÃO TRÊS LINHAS, E A ORDEM IMPORTA: tabela (leitura), ajuste (o único campo), proposta (o
// resultado). Antes havia um campo só, que guardava o valor final: quem desse 5% de desconto digitava
// 142.500 por cima de 150.000 e a tela dizia "editado" — e ninguém mais sabia se aquilo tinha sido um
// desconto concedido, uma tabela desatualizada ou um erro de digitação.
//
// ⚠️ UM CAMPO PARA OS DOIS SENTIDOS. Negativo desconta, positivo acresce. Dois controles para a mesma
// ideia obrigariam quem revisa a olhar em dois lugares para saber o que aconteceu com o preço.
//
// ⚠️ E ELE MOSTRA SEMPRE AS DUAS MEDIDAS. Digitou `-5` em %, a linha do meio responde `− R$ 7.500,00`;
// digitou `-7.500` em R$, ela responde `5%`. Quem aprova desconto pensa em percentual e quem fecha a
// proposta pensa em reais — a conta de cabeça entre os dois é onde nasce o erro que só aparece no
// contrato assinado.

/**
 * O número que a pessoa digitou no campo de desconto, sempre positivo — o sinal vem do botão.
 *
 * Fora do componente (18/09/2026) porque o efeito que mostra no campo o desconto do plano também o
 * usa, e uma função recriada a cada render viraria dependência do efeito.
 */
function numeroDigitado(cru: string): number {
  const limpo = cru
    .replace(/[\s+-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!limpo) return 0;
  const n = Number(limpo);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function CampoDoLote({
  ajuste,
  aoMudarAjuste,
  descontoDoPlano: descontoDoPlanoAtivo = 0,
  preco,
  rotulo,
  rotuloDoValor,
  somenteLeitura = false,
}: {
  ajuste: AjusteDePreco;
  aoMudarAjuste: (a: AjusteDePreco) => void;
  /** O desconto do plano escolhido. Quando o campo é exatamente ele, a tela diz "do plano". */
  descontoDoPlano?: number;
  preco: ReturnType<typeof aplicarAjuste>;
  rotulo: string;
  /** "Proposta" na Mesa de Venda; "Valor simulado" no espelho público. */
  rotuloDoValor: string;
  /**
   * Sem os controles de desconto: a tela só mostra a tabela, o desconto do plano e o valor.
   *
   * ⚠️ É O ESPELHO PÚBLICO (18/09/2026). A página não tem login e o PDF sai com a marca da casa: lá
   * o desconto é o do plano escolhido, e ninguém digita outro.
   */
  somenteLeitura?: boolean;
}) {
  const [texto, setTexto] = useState("");
  // ⚠️ O SENTIDO É UM BOTÃO, NÃO UM SINAL DIGITADO. Na primeira versão o desconto exigia escrever
  // "-10", e o Lucas testou digitando "10": virou acréscimo. *"Eu não vi como dou desconto, os teste
  // só aumentaram o valor, acho que devia ter um botão de + e -"*. Ninguém digita o menos — e o
  // resultado de esquecê-lo não é um erro na tela, é uma proposta com o preço para cima.
  const [sentido, setSentido] = useState<-1 | 1>(-1);
  const temAjuste = preco.emReais !== 0;
  const desconto = preco.emReais < 0;
  /** O campo é o desconto do plano, e não um desconto dado à mão. */
  const ehODoPlano =
    descontoDoPlanoAtivo > 0 &&
    ajuste.modo === "percentual" &&
    ajuste.valor === ajusteDoPlano(descontoDoPlanoAtivo).valor;

  // Enquanto a pessoa digita, o texto é dela — reescrever a cada tecla move o cursor e apaga o
  // sinal de menos que ela acabou de escrever. Só volta a seguir o estado quando o ajuste muda de
  // fora: zerado (troca de unidade, por exemplo) ou trocado pelo desconto de um plano.
  //
  // ⚠️ O DESCONTO DO PLANO PRECISA APARECER NO CAMPO (18/09/2026). Escolher o Investidor
  // Parcelado põe -8% no ajuste; sem esta leitura o campo continuava em branco com a linha de baixo
  // dizendo "Desconto de 8%", e quem digitasse ali achando que estava vazio SUBSTITUIRIA os 8% sem
  // perceber. O texto só é reescrito quando não é o número que já está escrito — digitar "8," não
  // vira "8" embaixo do dedo.
  useEffect(() => {
    if (ajuste.valor === 0) {
      setTexto("");
      return;
    }
    const absoluto = Math.abs(ajuste.valor);
    setTexto((atual) =>
      numeroDigitado(atual) === absoluto
        ? atual
        : absoluto.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    );
    setSentido(ajuste.valor < 0 ? -1 : 1);
  }, [ajuste.valor]);

  function mudarModo(modo: AjusteDePreco["modo"]) {
    // ⚠️ O NÚMERO NÃO É CONVERTIDO NA TROCA DE MODO. "-5" em percentual virando "-R$ 5,00" seria
    // uma conta que ninguém pediu; e converter para o equivalente (-R$ 7.500) mudaria o que a
    // pessoa escreveu. Ela trocou de moeda: o número é reinterpretado, e ela vê o resultado na hora.
    aoMudarAjuste({ modo, valor: ajuste.valor });
  }

  function mudarValor(cru: string) {
    setTexto(cru);
    aoMudarAjuste({ ...ajuste, valor: sentido * numeroDigitado(cru) });
  }

  function mudarSentido(novo: -1 | 1) {
    setSentido(novo);
    // ⚠️ TROCAR O SENTIDO REAPROVEITA O NÚMERO. Quem digitou 10 e percebeu que era desconto clica no
    // menos e vê o resultado virar na hora — em vez de apagar e redigitar.
    aoMudarAjuste({ ...ajuste, valor: novo * numeroDigitado(texto) });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span
        style={{
          alignItems: "baseline",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>
          {rotulo}
        </span>
        <span style={{ color: T.muted, fontSize: 10.5 }}>tabela</span>
      </span>
      {/* ⚠️ A TABELA NÃO É CAMPO. Ela é o número que o pedido do Lucas manda preservar, e deixá-la
          editável devolveria exatamente o problema que este bloco veio resolver. Quem precisa
          corrigir o preço de tabela faz isso no cadastro da unidade, não aqui. */}
      <div
        style={{
          alignItems: "center",
          background: T.soft,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          display: "flex",
          fontSize: 14,
          fontVariantNumeric: "tabular-nums",
          gap: 6,
          height: 34,
          padding: "0 10px",
        }}
      >
        <span>{dinheiroExato(preco.tabela)}</span>
      </div>

      {/* ⚠️ SOMENTE LEITURA ESCONDE A LINHA INTEIRA (sentido, moeda e número). E não é só aparência:
          no modo simulação o ajuste da conta é derivado do plano (`ajusteDaTela`), e o que se
          digitasse aqui não entraria em conta nenhuma. */}
      <div
        data-controles-do-desconto=""
        style={{ display: somenteLeitura ? "none" : "flex", gap: 6, minWidth: 0 }}
      >
        {/* ⚠️ O SENTIDO VEM PRIMEIRO, à esquerda: é a decisão que muda o resultado de lado, e ela
            precisa ser vista antes de o número ser digitado. O menos nasce escolhido porque
            desconto é o caso comum — e porque, se alguém não reparar no par de botões, errar para
            menos é uma proposta que precisa de aprovação, não uma que sai cara para o cliente. */}
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            display: "flex",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {([-1, 1] as const).map((s) => (
            <button
              aria-label={s === -1 ? "Desconto" : "Acréscimo"}
              key={s}
              onClick={() => mudarSentido(s)}
              onMouseDown={(e) => e.preventDefault()}
              style={{
                background:
                  sentido === s ? (s === -1 ? T.danger : T.ok) : "transparent",
                border: "none",
                color: sentido === s ? "#fff" : T.muted,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1,
                padding: "0 11px",
              }}
              title={s === -1 ? "Desconto" : "Acréscimo"}
              type="button"
            >
              {s === -1 ? "−" : "+"}
            </button>
          ))}
        </div>
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            display: "flex",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {(["percentual", "reais"] as const).map((m) => (
            <button
              key={m}
              onClick={() => mudarModo(m)}
              onMouseDown={(e) => e.preventDefault()}
              style={{
                background: ajuste.modo === m ? T.gold : "transparent",
                border: "none",
                color: ajuste.modo === m ? "#fff" : T.muted,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                padding: "0 9px",
              }}
              type="button"
            >
              {m === "percentual" ? "%" : "R$"}
            </button>
          ))}
        </div>
        <input
          inputMode="decimal"
          onChange={(e) => mudarValor(e.target.value)}
          placeholder={sentido === -1 ? "desconto" : "acréscimo"}
          style={{
            background: T.card,
            border: `1px solid ${temAjuste ? T.gold : T.border}`,
            borderRadius: 8,
            color: T.text,
            flex: 1,
            fontSize: 13,
            fontVariantNumeric: "tabular-nums",
            height: 34,
            minWidth: 0,
            outline: "none",
            padding: "0 10px",
          }}
          value={texto}
        />
      </div>

      {/* ⚠️ O AVISO DE RECORTE. Quem quis dar R$ 500 e digitou -500 com o botão em "%" precisa ver
          que o pedido não coube — senão a proposta sai por um centavo e o PDF sai junto. */}
      {preco.limitado ? (
        <span style={{ color: T.danger, fontSize: 10.5, lineHeight: 1.35 }}>
          O ajuste pedido não cabe no preço e foi limitado. Confira se o botão
          está no % ou no R$ certo.
        </span>
      ) : null}

      <div
        style={{
          borderTop: `1px solid ${T.border}`,
          display: "grid",
          gap: 4,
          paddingTop: 8,
        }}
      >
        {temAjuste ? (
          <span
            style={{
              alignItems: "baseline",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span style={{ color: T.muted, fontSize: 11 }}>
              {descreverAjuste(preco)}
              {ehODoPlano ? " do plano" : ""}
            </span>
            <span
              style={{
                color: desconto ? T.danger : T.ok,
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {desconto ? "−" : "+"} {dinheiroExato(Math.abs(preco.emReais))}
            </span>
          </span>
        ) : null}
        <span
          style={{
            alignItems: "baseline",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>
            {rotuloDoValor}
          </span>
          <span
            style={{
              fontSize: 17,
              fontVariantNumeric: "tabular-nums",
              fontWeight: 700,
            }}
          >
            {dinheiroExato(preco.valor)}
          </span>
        </span>
      </div>
    </div>
  );
}

