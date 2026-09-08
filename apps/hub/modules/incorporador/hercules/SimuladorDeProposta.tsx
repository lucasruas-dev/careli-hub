"use client";

import { useEffect, useMemo, useState } from "react";

import { valorDigitado, valorParaOCampo } from "@/lib/apolo/boletos/valor-digitado";
import {
  fraseDeCorrecao,
  INDICES,
  type IndiceCorrecao,
  type PlanoComercial,
  taxaMensal,
} from "@/lib/apolo/planos-comerciais";
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
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { DIAS_DE_VENCIMENTO } from "@/lib/hercules/proposta";
import { lerPercentualDigitado, proximoVencimento } from "@/lib/hercules/proposta-na-tela";
import { montarProposta, sistemaDoCadastro } from "@/lib/hercules/simulacao";

import {
  type AjusteDePreco,
  aplicarAjuste,
  descreverAjuste,
  SEM_AJUSTE,
} from "@/lib/hercules/ajuste-de-preco";

import { T } from "../tema";

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
  anuais: { quantidade: number; valor: number };
  composicao: Composicao | null;
  entrada: number;
  financiado: number;
  origem: "composicao" | "montada";
  parcela: number;
  parcelas: number;
  plano: string;
  total: number;
};

/**
 * A entrada que o plano sugere para este lote.
 *
 * ⚠️ ARREDONDA PARA CIMA E NUNCA FICA ABAIXO DO PISO. 10% de R$ 136.521 é R$ 13.652,10; arredondar
 * para baixo dava R$ 13.652 e a própria sugestão do plano nascia dez centavos abaixo do mínimo,
 * com a tela acusando "abaixo do mínimo" no valor que ela mesma tinha preenchido.
 */
function entradaDoPlano(valor: number, percentual: number, minimo: null | number): number {
  return Math.max(entradaMinima(valor, minimo), Math.ceil((valor * percentual) / 100));
}

/** Dois valores em reais são o mesmo dinheiro? Compara em centavos, como o resto do módulo. */
const centavosIguais = (a: number, b: number) =>
  Math.round((Number.isFinite(a) ? a : 0) * 100) === Math.round((Number.isFinite(b) ? b : 0) * 100);

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
  anuaisQuantidade: number;
  anuaisValor: number;
  /** 10 ou 20, os dois que a cobrança da casa usa. */
  diaDeVencimento: number;
  /** Os valores de cada parcela da entrada, quando montados à mão. Nulo = partes iguais. */
  entradaParcelas: null | number[];
  entradaValor: number;
  entradaVezes: number;
  /** A mensal do PRIMEIRO ciclo, que é a que a tela anuncia. Ver `parcelaFixa` em `proposta.ts`. */
  parcela: number;
  parcelasMensais: number;
  planoNome: string;
  /** `YYYY-MM-DD` — o dia em que a primeira parcela da ENTRADA vence. */
  primeiraParcelaEm: string;
  valorNegociado: number;
};

export function SimuladorDeProposta({
  aoMudarCondicoes,
  previa,
  entradaMinimaPercentual = null,
  planos,
  unidade,
  valorDaUnidade,
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
  planos: PlanoDaVenda[];
  /** "12 06" — o lote, como a tela escreve. */
  unidade: string;
  valorDaUnidade: number;
}) {
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
  const [montagemCrua, setMontagemCrua] = useState<
    null | { base: number; parcelas: number[]; vezes: number }
  >(null);
  const [planoAtivo, setPlanoAtivo] = useState<null | string>(null);
  // ⚠️ SÓ VIRA TETO SE ELE DIGITOU. O campo Entrada nasce preenchido pelo plano — usar esse número
  // como limite cortaria as composições sem ninguém ter pedido, e a lista aparecia vazia sem
  // explicação. Teto é o que o cliente TEM; o valor do plano é só um ponto de partida.
  const [entradaEhTeto, setEntradaEhTeto] = useState(false);
  // ⚠️ OS DOIS CAMPOS DA COBRANÇA VIVEM AQUI MESMO SEM A PROP. Estado condicional não existe em
  // React, e tentar criá-lo com um hook dentro de `if` quebra a ordem dos hooks. Sem a prop eles
  // simplesmente não são desenhados nem lidos por ninguém.
  const [diaDeVencimento, setDiaDeVencimento] = useState<number>(DIAS_DE_VENCIMENTO[0]);
  const [primeiraParcelaEm, setPrimeiraParcelaEm] = useState<string>(() =>
    proximoVencimento(new Date().toISOString(), DIAS_DE_VENCIMENTO[0]),
  );
  // ⚠️ O AJUSTE É ESTADO PRÓPRIO, e o preço da proposta passa a ser DERIVADO dele. Antes o campo do
  // lote guardava o valor final e mais nada: depois de salvar, ninguém sabia se R$ 142.500 tinham
  // sido um desconto de 5%, uma tabela desatualizada ou um erro de digitação — e a tela só dizia
  // "editado". Lucas, 08/09/2026: *"desconto em valor ou % que influencia o valor da proposta, isso
  // não pode mudar o valor original de tabela"*.
  const [ajuste, setAjuste] = useState<AjusteDePreco>(SEM_AJUSTE);
  const preco = useMemo(() => aplicarAjuste(valorDaUnidade, ajuste), [ajuste, valorDaUnidade]);

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

  const plano = useMemo(
    () => planosDaConta.find((p) => p.nome === planoAtivo) ?? planosDaConta[0] ?? null,
    [planoAtivo, planosDaConta],
  );

  // ⚠️ O PLANO CRU FICA À MÃO. `PlanoDaComposicao` carrega só o que a conta usa; o índice de
  // correção, o sistema de amortização e a convenção de juros são do CADASTRO, e a tela precisa
  // deles para dizer o que o cliente vai assinar.
  const crus = useMemo(() => new Map(planos.map((p) => [p.nome, p])), [planos]);
  const cru = plano ? crus.get(plano.nome) : undefined;

  // ── A TABELA: cada plano aplicado a ESTE lote ────────────────────────────
  //
  // ⚠️ Com a entrada do próprio plano, e não uma qualquer: é a condição que a diretoria aprovou, e
  // é dela que a conversa parte. Clicar carrega tudo no cockpit.
  const tabela = useMemo(
    () =>
      planosDaConta.map((p) => {
        const entrada = entradaDoPlano(cockpit.valor, p.entradaPercentual, entradaMinimaPercentual);
        const montada = montarProposta({
          baloesQuantidade: 0,
          baloesValor: 0,
          entrada,
          parcelas: p.parcelas,
          sistemaAmortizacao: p.sistemaAmortizacao,
          taxaAoMes: p.taxaAoMes,
          valor: cockpit.valor,
        });
        return { entrada, parcela: montada.parcela, plano: p };
      }),
    [cockpit.valor, entradaMinimaPercentual, planosDaConta],
  );

  function carregarPlano(nome: string) {
    const alvo = tabela.find((t) => t.plano.nome === nome);
    if (!alvo) return;
    setPlanoAtivo(nome);
    setCockpit((a) => ({
      ...a,
      anuaisQuantidade: 0,
      anuaisValor: 0,
      entrada: alvo.entrada,
      parcela: alvo.parcela,
      parcelas: alvo.plano.parcelas,
    }));
    setComando("condicoes");
    setEntradaEhTeto(false);
  }

  // ⚠️ A TELA NUNCA ABRE VAZIA. Sem um ponto de partida, a direita seria um espaço em branco e a
  // primeira ação de todo mundo seria a mesma: clicar no plano mais longo. O simulador já faz isso
  // — abre no maior prazo, que é o que atende mais gente, e o resto se ajusta em cima.
  useEffect(() => {
    const maisLongo = [...planosDaConta].sort((a, b) => b.parcelas - a.parcelas)[0] ?? null;
    const entrada = maisLongo
      ? entradaDoPlano(valorDaUnidade, maisLongo.entradaPercentual, entradaMinimaPercentual)
      : 0;

    setPlanoAtivo(maisLongo?.nome ?? null);
    setComando("condicoes");
    setEntradaEhTeto(false);
    // ⚠️ TROCOU DE UNIDADE, ZERA O DESCONTO. Um desconto de 5% que sobrevivesse à troca de lote
    // seria aplicado a um preço que ninguém negociou — e como este efeito também reescreve o valor,
    // deixar o ajuste de pé faria a tela mostrar a tabela do lote novo com o desconto do antigo.
    setAjuste(SEM_AJUSTE);
    setCockpit({
      anuaisQuantidade: 0,
      anuaisValor: 0,
      entrada,
      entradaVezes: 1,
      parcela: maisLongo
        ? montarProposta({
            baloesQuantidade: 0,
            baloesValor: 0,
            entrada,
            parcelas: maisLongo.parcelas,
            sistemaAmortizacao: maisLongo.sistemaAmortizacao,
            taxaAoMes: maisLongo.taxaAoMes,
            valor: valorDaUnidade,
          }).parcela
        : 0,
      // ⚠️ SEM PLANO, UM PRAZO DE PARTIDA — e não zero. Com zero parcelas não existe conta
      // possível, e a tela abria morta no produto sem plano cadastrado. 120 é ponto de partida
      // editável, não regra da casa: o plano NORMAL do C2X vai de 37 a 200 parcelas, e não existe
      // um número que sirva a todos.
      parcelas: maisLongo?.parcelas ?? PARCELAS_SEM_PLANO,
      valor: valorDaUnidade,
    });
  }, [entradaMinimaPercentual, planosDaConta, unidade, valorDaUnidade]);

  // ⚠️ O AJUSTE REFAZ A CONTA INTEIRA. Mudar o preço sem refazer parcela e entrada deixaria a tela
  // mostrando um total novo com o financiamento velho — e o cronograma que vai para a proposta sairia
  // do preço antigo, sem ninguém ver. Só age quando o valor REALMENTE mudou, senão o efeito brigaria
  // com quem está digitando a parcela.
  useEffect(() => {
    setCockpit((a) => (a.valor === preco.valor ? a : { ...a, valor: preco.valor }));
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

  const montagem = conferirEntradaMontada(cockpit.entrada, parcelasDaEntrada ?? [cockpit.entrada]);

  const montada = useMemo(() => {
    const parcelas = cockpit.parcelas > 0 ? cockpit.parcelas : (plano?.parcelas ?? 0);
    if (parcelas <= 0) return null;
    return {
      ...montarProposta({
        baloesQuantidade: cockpit.anuaisQuantidade,
        baloesValor: cockpit.anuaisValor,
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
  }, [cockpit, montagem.entrada, plano]);

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
   * A entrada montada à mão, conferida.
   *
   * ⚠️ SEM MONTAGEM ELA FECHA SOZINHA: com `parcelasDaEntrada` nulo o resultado é a entrada do
   * cockpit, `ok: true` e excedente zero — ou seja, o caminho de sempre passa por aqui sem mudar
   * de comportamento. Com montagem, é ela quem diz qual é a entrada de verdade.
   */

  /** De quem é a régua: o plano da faixa quando ele aperta, senão o piso da casa. */
  const faixaDoPiso = pisoDoPrazo.faixa;
  const pisoEmPercentual =
    faixaDoPiso && cockpit.valor > 0 && minimoDaEntrada > entradaMinima(cockpit.valor, entradaMinimaPercentual)
      ? faixaDoPiso.entradaPercentual
      : (entradaMinimaPercentual ?? ENTRADA_MINIMA_PERCENTUAL);

  /** Quantos aniversários cabem no prazo — o teto de reforços anuais. */
  const aniversarios = Math.floor((cockpit.parcelas > 0 ? cockpit.parcelas : (plano?.parcelas ?? 0)) / 12);

  /** A parcela sobre a qual a direita conversa: a pedida, ou a que a conta devolveu. */
  const parcelaDeReferencia =
    comando === "parcela" ? cockpit.parcela : Math.round(montada?.parcela ?? 0);

  const composicoes = useMemo(
    () =>
      parcelaDeReferencia > 0
        ? composicoesQueFecham({
            parcelaAlvo: parcelaDeReferencia,
            planos: planosDaConta,
            entradaMinimaPercentual,
            tetoDaEntrada: entradaEhTeto && cockpit.entrada > 0 ? cockpit.entrada : null,
            valor: cockpit.valor,
          })
        : [],
    [
      cockpit.entrada,
      cockpit.valor,
      entradaEhTeto,
      entradaMinimaPercentual,
      parcelaDeReferencia,
      planosDaConta,
    ],
  );

  const principal: Leitura | null = useMemo(() => {
    if (comando === "condicoes" && montada && plano) {
      return {
        anuais: { quantidade: cockpit.anuaisQuantidade, valor: cockpit.anuaisValor },
        composicao: null,
        // A mesma entrada da conta acima: o cartão mostra o que vai ser gravado.
        entrada: montagem.entrada,
        financiado: montada.financiado,
        origem: "montada",
        parcela: montada.parcela,
        parcelas: montada.parcelas,
        plano: plano.nome,
        total: montada.total,
      };
    }

    const melhor = composicoes[0];
    if (!melhor) return null;
    return {
      anuais: melhor.anuais,
      composicao: melhor,
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
    };
  }, [comando, composicoes, cockpit, montada, plano]);

  /**
   * As demais: mesma parcela, outro arranjo.
   *
   * ⚠️ FORA A QUE JÁ ESTÁ NO CARTÃO GRANDE, e a comparação é por plano + número de reforços, não
   * por origem: quando ele monta à mão no Normal 180 sem reforço, a varredura acha esse mesmo
   * arranjo (com a entrada arredondada) e ele apareceria de novo logo abaixo de si mesmo.
   */
  const alternativas = composicoes.filter(
    (c) =>
      !principal ||
      c.plano !== principal.plano ||
      c.anuais.quantidade !== principal.anuais.quantidade,
  );

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
            anuaisQuantidade: principal.anuais.quantidade,
            anuaisValor: principal.anuais.valor,
            diaDeVencimento,
            // ⚠️ QUANDO HÁ MONTAGEM, A ENTRADA É A SOMA DELA — inclusive quando passa do
            // combinado, que é o caso em que o cliente paga mais no ato. Sem isto o papel sairia
            // com a entrada antiga e um fluxo somando outro valor.
            entradaValor: parcelasDaEntrada ? montagem.entrada : principal.entrada,
            entradaVezes: cockpit.entradaVezes,
            entradaParcelas: parcelasDaEntrada,
            parcela: principal.parcela,
            parcelasMensais: principal.parcelas,
            planoNome: principal.plano,
            primeiraParcelaEm,
            valorNegociado: cockpit.valor,
          }
        : null,
    );
  }, [
    aoMudarCondicoes,
    cockpit.entradaVezes,
    cockpit.valor,
    diaDeVencimento,
    // ⚠️ A MONTAGEM ENTRA NAS DEPENDÊNCIAS. Sem ela, digitar um valor de parcela da entrada não
    // subiria nada: o pai continuaria com a composição antiga, e o botão "Gerar proposta" mandaria
    // ao servidor uma entrada diferente da que está escrita na tela.
    montagem.entrada,
    parcelasDaEntrada,
    primeiraParcelaEm,
    principal,
  ]);

  function usarComposicao(c: Composicao) {
    setCockpit((atual) => ({
      ...atual,
      anuaisQuantidade: c.anuais.quantidade,
      anuaisValor: c.anuais.valor,
      entrada: c.entrada,
      parcela: c.parcela,
      parcelas: c.parcelas,
    }));
    setPlanoAtivo(c.plano);
    setComando("condicoes");
    setEntradaEhTeto(false);
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
          paddingRight: 4,
        }}
      >
        <Bloco titulo="O lote">
          <CampoDoLote
            ajuste={ajuste}
            aoMudarAjuste={setAjuste}
            preco={preco}
            rotulo={`Lote ${unidade}`}
          />
        </Bloco>

        <Bloco
          titulo="Quanto o cliente paga por mês"
        >
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
            minimo={minimoDaEntrada}
            minimoEmPercentual={pisoEmPercentual}
            valor={cockpit.entrada}
            valorDoLote={cockpit.valor}
          />
          <div style={{ alignItems: "center", display: "flex", gap: 8, marginTop: 8 }}>
            <Contador
              aoMudar={(n) => {
                // A montagem se invalida sozinha: ela guarda para quantas vezes foi feita.
                setCockpit((a) => ({ ...a, entradaVezes: n }));
              }}
              maximo={12}
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
                          parcelas: partesIguais(cockpit.entrada, cockpit.entradaVezes),
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
                <div
                  key={i}
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
                                parcelas: atual.parcelas.map((antigo, j) => (j === i ? v : antigo)),
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
                                parcelas: redistribuirDemais(cockpit.entrada, atual.parcelas, i),
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
                <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>Somando</span>
                <b style={{ color: montagem.ok ? T.text : T.danger, fontSize: 12.5 }}>
                  {dinheiroExato(montagem.soma)}
                </b>
              </div>

              {!montagem.ok ? (
                <span style={{ color: T.danger, fontSize: 11 }}>
                  Faltam {dinheiroExato(montagem.falta)} para fechar a entrada.
                </span>
              ) : montagem.excedente > 0 ? (
                <span style={{ color: T.ok, fontSize: 11 }}>
                  {dinheiroExato(montagem.excedente)} acima do combinado — a entrada passa a ser{" "}
                  {dinheiroExato(montagem.entrada)}.
                </span>
              ) : null}
            </div>
          ) : null}

        </Bloco>

        {/* ⚠️ SÓ NA PROPOSTA, e por isso preso à prop. Numa simulação livre não existe primeira
            parcela: o coordenador está olhando quanto o cliente paga por mês, e um campo de data
            pedindo um dia que não vai virar boleto nenhum é campo para ninguém preencher.

            Lucas (04/09/2026): *"com a data da primeira parcela da entrada as demais segue na data
            que ele escolheu e de acordo com o parcelamento"*. Quem espalha essa data pelo
            calendário é `montarCronograma`; aqui só se escolhe o ponto de partida. */}
        {aoMudarCondicoes ? (
          <Bloco
            titulo="Cobrança"
          >
            <div style={{ color: T.muted, fontSize: 11, fontWeight: 650, marginBottom: 5 }}>
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
                    setPrimeiraParcelaEm(proximoVencimento(new Date().toISOString(), d));
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
                  anuaisValor: n > 0 && a.anuaisValor === 0 ? 20_000 : a.anuaisValor,
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
            <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>Parcelas</span>
            <input
              onChange={(e) => {
                setCockpit((a) => ({ ...a, parcelas: Number(e.target.value) || 0 }));
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
                <Linha rotulo="Reajuste" valor={INDICES[cru.indiceCorrecao as IndiceCorrecao] ?? "—"} />
                <Linha
                  rotulo="Juros"
                  valor={
                    plano && plano.taxaAoMes > 0
                      ? `${(plano.taxaAoMes * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% ao mês`
                      : "sem juros"
                  }
                />
              </div>
              <p style={{ color: T.muted, fontSize: 11, margin: "8px 0 0" }}>
                {fraseDeCorrecao(cru as unknown as PlanoComercial)}. A parcela acima é a valor de
                hoje: o índice corrige o contrato ao longo do prazo e não entra nesta conta.
              </p>
            </>
          ) : (
            <p style={{ color: T.muted, fontSize: 11.5, margin: "8px 0 0" }}>
              Nenhum plano cadastrado para este produto: a conta sai sem juros e sem correção,
              e o prazo abaixo é só um ponto de partida — edite à vontade.
            </p>
          )}
        </Bloco>
      </div>

      {/* ═══ A LEITURA ═══════════════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridAutoRows: "min-content",
          minHeight: 0,
          overflow: "auto",
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
            {tabela.map((t) => {
              const ativo = plano?.nome === t.plano.nome;
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
                  <div style={{ color: T.sub, fontSize: 12, fontWeight: 650 }}>{t.plano.nome}</div>
                  <div
                    style={{
                      color: T.text,
                      fontSize: 17,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 650,
                      marginTop: 3,
                    }}
                  >
                    {dinheiro(t.parcela)}
                  </div>
                  <div style={{ color: T.muted, fontSize: 11 }}>
                    {/* ⚠️ O % VEM JUNTO (Lucas, 05/09/2026: *"pode colocar o % de cada plano
                        aqui"*). Os quatro cards são a ESCADA do produto — prazo curto, entrada
                        alta —, e só com o valor em reais a escada não se lê: R$ 14.000 e
                        R$ 56.000 são dois números soltos até virarem 10% e 40%. É o mesmo
                        percentual que agora decide o piso da entrada pelo prazo escolhido. */}
                    {t.plano.parcelas}x · entrada {dinheiro(t.entrada)} ({t.plano.entradaPercentual}%)
                  </div>
                  <div style={{ color: T.muted, fontSize: 10.5, marginTop: 2 }}>
                    {INDICES[
                      (crus.get(t.plano.nome)?.indiceCorrecao ?? "SEM_CORRECAO") as IndiceCorrecao
                    ] ?? "sem correção"}
                  </div>
                </button>
              );
            })}
          </div>
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
                  background: principal.origem === "composicao" ? T.okBg : T.soft,
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
                  : "Proposta montada"}
              </span>
              <span style={{ color: T.muted, fontSize: 11.5 }}>Plano {principal.plano}</span>
            </div>

            <div style={{ alignItems: "baseline", display: "flex", gap: 10, marginBottom: 4 }}>
              {/* O NÚMERO QUE A CONVERSA COM O CLIENTE USA. É o primeiro que tem de ser lido. */}
              <b style={{ fontSize: 34, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                {dinheiroExato(principal.parcela)}
              </b>
              <span style={{ color: T.muted, fontSize: 13 }}>
                por mês, {principal.parcelas} vezes
              </span>
            </div>

            {/* ⚠️ EXPLICA A PARCELA MENOR QUE A PEDIDA. Com a entrada ancorada no piso de 10%, a
                parcela cai abaixo do valor que o cliente disse que podia pagar. É notícia boa, mas
                sem esta linha parece conta errada — "pedi 2.000 e a tela devolveu 1.736". */}
            {principal.origem === "composicao" && principal.parcela < parcelaDeReferencia * 0.99 ? (
              <p style={{ color: T.muted, fontSize: 11.5, margin: "0 0 12px" }}>
                Abaixo dos {dinheiro(parcelaDeReferencia)} que ele pode pagar: chegar exatamente
                nesse valor exigiria entrada menor que o mínimo de {pisoEmPercentual}%.
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
                      : `${Math.round((principal.entrada / (cockpit.valor || 1)) * 100)}% do valor`
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
                nota={`+${Math.round((principal.total / (cockpit.valor || 1) - 1) * 100)}% sobre a tabela`}
                rotulo="Total pago"
                valor={dinheiro(principal.total)}
              />
            </div>

            {/* Lucas: *"aqui em vez desse textão, somente um editar"*. A ação é óbvia pelo lugar. */}
            {principal.composicao ? (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  onClick={() => usarComposicao(principal.composicao as Composicao)}
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

        {/* AS ALTERNATIVAS: mesma parcela, outro arranjo de entrada e reforço.
            ⚠️ SÓ NO SIMULADOR (Lucas, 05/09/2026: *"essas outras composições, deixa somente no
            simulador, aqui quanto mais objetivo for melhor (...) pois ali pode ocorrer testes de
            cenário com mais frequência"*). São dois momentos diferentes: no simulador a pessoa
            está EXPLORANDO — cinco arranjos lado a lado é o serviço; na hora de gerar a proposta
            ela já decidiu, e cinco alternativas embaixo do que ela escolheu convidam a recomeçar
            uma conversa que já terminou, num formulário que precisa acabar.
            ⚠️ `aoMudarCondicoes` É O SINAL, e não uma prop nova: ela já é a única diferença entre
            os dois usos (ausente = simulador da ficha; presente = modal de proposta). Um segundo
            interruptor para a mesma distinção daria dois lugares para eles discordarem. */}
        {!aoMudarCondicoes && alternativas.length > 0 ? (
          <div>
            <div style={{ ...rotuloDeSecao, marginBottom: 8 }}>
              Outras composições com {dinheiro(parcelaDeReferencia)} por mês
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {alternativas.map((c) => (
                <button
                  key={`${c.plano}-${c.anuais.quantidade}`}
                  onClick={() => usarComposicao(c)}
                  style={{
                    alignItems: "center",
                    background: T.card,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    display: "flex",
                    flexWrap: "wrap",
                    font: "inherit",
                    gap: 12,
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    textAlign: "left",
                  }}
                  type="button"
                >
                  <span style={{ color: T.text, fontSize: 12.5, fontWeight: 650, minWidth: 84 }}>
                    {c.plano}
                  </span>
                  <span style={{ color: T.sub, fontSize: 12 }}>
                    entrada{" "}
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>{dinheiro(c.entrada)}</b>
                  </span>
                  <span style={{ color: T.sub, fontSize: 12 }}>
                    {c.anuais.quantidade > 0
                      ? `${c.anuais.quantidade} × ${dinheiro(c.anuais.valor)} ao ano`
                      : "sem reforço anual"}
                  </span>
                  <span style={{ color: T.sub, fontSize: 12 }}>{c.parcelas} meses</span>
                  <span style={{ color: T.muted, fontSize: 12 }}>total {dinheiro(c.total)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* ⚠️ O RODAPÉ MUDA COM O USO. Dizer "nada aqui vincula a unidade nem gera proposta" na
            modal que está gerando a proposta seria a tela desmentindo o botão logo abaixo dela. */}
        <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
          {aoMudarCondicoes
            ? "Estas são as condições que vão para a proposta. Conta feita com os planos cadastrados do empreendimento."
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
      {nota ? <p style={{ color: T.muted, fontSize: 11, margin: "8px 0 0" }}>{nota}</p> : null}
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
  valor,
}: {
  aoMudar: (n: number) => void;
  destaque?: boolean;
  direita?: string;
  rotulo: string;
  valor: number;
}) {
  const [texto, setTexto] = useState(valorParaOCampo(valor));

  // ⚠️ SÓ REESCREVE QUANDO O VALOR VEIO DE FORA. Enquanto a pessoa digita, o texto é dela: formatar
  // a cada tecla move o cursor e apaga a vírgula que ela acabou de escrever.
  useEffect(() => {
    setTexto((atual) => ((valorDigitado(atual) ?? 0) === valor ? atual : valorParaOCampo(valor)));
  }, [valor]);

  return (
    <label style={{ display: "grid", gap: 3 }}>
      {/* Rótulo vazio = quem chama já desenhou o seu (é o caso do campo de entrada, que tem o
          alternador R$/% na mesma linha). Um <span> vazio abriria um vão de 11px. */}
      {rotulo || direita ? (
        <span style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>{rotulo}</span>
          {direita ? <span style={{ color: T.muted, fontSize: 10.5 }}>{direita}</span> : null}
        </span>
      ) : null}
      <span style={{ alignItems: "center", display: "flex", position: "relative" }}>
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
  minimo,
  minimoEmPercentual,
  valor,
  valorDoLote,
}: {
  aoMudar: (n: number) => void;
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
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>Valor</span>
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

      <div style={{ alignItems: "baseline", display: "flex", gap: 8, justifyContent: "space-between" }}>
        <span style={{ color: abaixo ? T.danger : T.muted, fontSize: 10.5 }}>
          {abaixo
            ? `Abaixo do mínimo de ${minimoEmPercentual}% (${dinheiro(minimo)})`
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
function CampoEmPorcento({ aoMudar, valor }: { aoMudar: (n: number) => void; valor: number }) {
  const escreve = (v: number) =>
    v > 0 ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "";
  const [texto, setTexto] = useState(escreve(valor));

  useEffect(() => {
    setTexto((atual) =>
      lerPercentualDigitado(atual) === Math.round(valor * 100) / 100 ? atual : escreve(valor),
    );
  }, [valor]);

  return (
    <span style={{ alignItems: "center", display: "flex", position: "relative" }}>
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
 */
function abaixoDoMinimo(valor: number, minimo: number): boolean {
  return valor > 0 && Math.round(valor * 100) < Math.round(minimo * 100);
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
  const passo = (d: number) => aoMudar(Math.max(minimo, Math.min(maximo, valor + d)));

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
      <button aria-label="Diminuir" onClick={() => passo(-1)} style={passoDoContador} type="button">
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
      <button aria-label="Aumentar" onClick={() => passo(1)} style={passoDoContador} type="button">
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

function Dado({ nota, rotulo, valor }: { nota: string; rotulo: string; valor: string }) {
  return (
    <div>
      <div style={{ color: T.muted, fontSize: 10.5, fontWeight: 650 }}>{rotulo}</div>
      <div style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>
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
function CampoDoLote({
  ajuste,
  aoMudarAjuste,
  preco,
  rotulo,
}: {
  ajuste: AjusteDePreco;
  aoMudarAjuste: (a: AjusteDePreco) => void;
  preco: ReturnType<typeof aplicarAjuste>;
  rotulo: string;
}) {
  const [texto, setTexto] = useState("");
  // ⚠️ O SENTIDO É UM BOTÃO, NÃO UM SINAL DIGITADO. Na primeira versão o desconto exigia escrever
  // "-10", e o Lucas testou digitando "10": virou acréscimo. *"Eu não vi como dou desconto, os teste
  // só aumentaram o valor, acho que devia ter um botão de + e -"*. Ninguém digita o menos — e o
  // resultado de esquecê-lo não é um erro na tela, é uma proposta com o preço para cima.
  const [sentido, setSentido] = useState<-1 | 1>(-1);
  const temAjuste = preco.emReais !== 0;
  const desconto = preco.emReais < 0;

  // Enquanto a pessoa digita, o texto é dela — reescrever a cada tecla move o cursor e apaga o
  // sinal de menos que ela acabou de escrever. Só volta a seguir o estado quando o ajuste é zerado
  // de fora (troca de unidade, por exemplo).
  useEffect(() => {
    if (ajuste.valor === 0) setTexto("");
  }, [ajuste.valor]);

  function mudarModo(modo: AjusteDePreco["modo"]) {
    // ⚠️ O NÚMERO NÃO É CONVERTIDO NA TROCA DE MODO. "-5" em percentual virando "-R$ 5,00" seria
    // uma conta que ninguém pediu; e converter para o equivalente (-R$ 7.500) mudaria o que a
    // pessoa escreveu. Ela trocou de moeda: o número é reinterpretado, e ela vê o resultado na hora.
    aoMudarAjuste({ modo, valor: ajuste.valor });
  }

  /** O número que a pessoa digitou, sempre positivo — o sinal vem do botão. */
  function numeroDigitado(cru: string): number {
    const limpo = cru.replace(/[\s+-]/g, "").replace(/\./g, "").replace(",", ".");
    if (!limpo) return 0;
    const n = Number(limpo);
    return Number.isFinite(n) ? Math.abs(n) : 0;
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
      <span style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>{rotulo}</span>
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

      <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
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
                background: sentido === s ? (s === -1 ? T.danger : T.ok) : "transparent",
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
          O ajuste pedido não cabe no preço e foi limitado. Confira se o botão está no % ou no R$
          certo.
        </span>
      ) : null}

      <div style={{ borderTop: `1px solid ${T.border}`, display: "grid", gap: 4, paddingTop: 8 }}>
        {temAjuste ? (
          <span style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: T.muted, fontSize: 11 }}>{descreverAjuste(preco)}</span>
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
        <span style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>Proposta</span>
          <span style={{ fontSize: 17, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
            {dinheiroExato(preco.valor)}
          </span>
        </span>
      </div>
    </div>
  );
}
