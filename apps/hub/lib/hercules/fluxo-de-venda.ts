// A AGREGAÇÃO DO FLUXO DE VENDA — o núcleo puro que a tela Venda consome.
//
// Separado da rota de propósito: é conta, e conta se testa. A rota lê o Supabase (paginado) e
// entrega as linhas cruas aqui; daqui sai a faixa do fluxo, o funil, o ranking, a série mensal e o
// mapa do estoque.
//
// ⚠️ AS CINCO ETAPAS DO FLUXO NÃO SÃO AS SETE DA TABELA. `hercules_propostas.etapa` guarda também
// `cancelado` e `distrato`, que NÃO são passos do caminho — são saídas dele. A faixa mostra os
// cinco passos; os dois terminais vão para o quadro de perdas. Misturá-los faria "cancelado"
// parecer uma fase da venda, e o coordenador contaria como pipeline o que já morreu.

// ⚠️ DA RÉGUA PURA, e não de `planos-comerciais-c2x`: aquele módulo importa o driver do MySQL, e
// este roda também no navegador. A importação errada quebrava o build com "node:buffer".
import type { FaixaDePrazo } from "@/lib/hercules/premissa-do-prazo";
import { periodicidadeDaTaxa } from "@/lib/apolo/periodicidade-da-taxa";

import { DEPOIS_DO_CONTRATO } from "./acao-de-cancelamento";
import { codigoDaVenda } from "./codigo-da-venda";
import { tipoDaUnidade } from "./nome-da-unidade";
import type { TipoProduto } from "./produto-novo";
import { apartamentoCanonico, torreCanonica } from "./unidade-nova";

export type EtapaDoFluxo =
  | "assinatura"
  | "contrato"
  | "faturado"
  | "proposta"
  | "reservado";
export type EtapaDaProposta = EtapaDoFluxo | "cancelado" | "distrato";

export const ETAPAS_DO_FLUXO: readonly EtapaDoFluxo[] = [
  "reservado",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
];

/**
 * A etapa como a GRADE pinta a unidade.
 *
 * ⚠️ NÃO É A SITUAÇÃO DO C2X. Lucas (03/09/2026): *"quero ter os mesmos status, em vez de vendida,
 * ter propostas, contrato assinatura faturamento"*. `hercules_unidades.situacao` só sabe dizer
 * disponível / reservada / vendida / bloqueada — e "vendida" esconde a diferença entre o lote que
 * tem proposta emitida hoje e o que já faturou. Quem sabe isso é a PROPOSTA viva da unidade, e é
 * ela que decide a cor.
 *
 * `disponivel` e `bloqueada` continuam vindo da unidade: são os dois estados que existem sem
 * proposta nenhuma.
 */
export type EtapaDoEspelho =
  | EtapaDoFluxo
  | "bloqueada"
  | "disponivel"
  /**
   * ⚠️ VENDIDA SEM PROPOSTA VIVA — e este estado existe por segurança, não por capricho. São 114
   * unidades hoje: o cadastro diz vendida e não há proposta no caminho que diga em que etapa ela
   * está (proposta cancelada e status não atualizado, venda antiga, carga incompleta). Sem este
   * estado elas cairiam em `disponivel` e a grade ofereceria lote já vendido — o pior erro que
   * esta tela pode cometer. Aqui elas aparecem ocupadas, e o rótulo diz que falta a proposta.
   */
  | "vendida"
  /** O par de `vendida`: reservada no cadastro, sem proposta que sustente. Hoje, zero casos. */
  | "reservada"
  /**
   * ⚠️ A VENDA COM CANCELAMENTO (OU DISTRATO) PEDIDO, esperando o jurídico. Lucas (21/09/2026):
   * *"hoje ele aponta para contrato e polui nossos indicadores, acho que devemos separar, pode
   * trazer uma cor nova para cancelamento"* e *"e um card novo"*.
   *
   * ⚠️ ELA NÃO É ETAPA DA PROPOSTA, E ISSO É DE PROPÓSITO. No banco a venda continua em
   * `contrato`/`assinatura`/`faturado` — a etapa só muda quando o jurídico conclui, e é essa
   * decisão que a 0134 registrou (*"a etapa NÃO muda, quem desfaz é o jurídico, e mexer nela
   * devolveria o lote ao estoque com o contrato ainda de pé"*). Quem depende disso: a trava do
   * lote, que procura outro dono por `etapa in (ETAPAS_DO_FLUXO)`. Tirar a venda dali soltaria o
   * lote para uma segunda venda enquanto o contrato ainda existe.
   *
   * Aqui ela é SITUAÇÃO DE TELA, derivada da marca `cancelamento_pedido_em` com card vivo na
   * Têmis. Medido em 21/09/2026: 9 vendas, R$ 1.702.143 — 7 delas em `assinatura` e não em
   * `contrato`, e 8 são distrato.
   */
  | "em_cancelamento";

/**
 * A faixa do fluxo, com o estoque na frente: é dele que a venda começa.
 *
 * ⚠️ `bloqueada` NÃO entra. Ela existe na grade (é uma cor no quadro), mas não é passo do caminho:
 * lote bloqueado está fora da oferta, e somá-lo ao pipeline daria ao coordenador um estoque que
 * ele não pode vender.
 */
export type EtapaDaFaixa = "disponivel" | "em_cancelamento" | EtapaDoFluxo;

export const ETAPAS_DA_FAIXA: readonly EtapaDaFaixa[] = [
  "disponivel",
  ...ETAPAS_DO_FLUXO,
  // ⚠️ NO FIM, E FORA DA FILA: o cancelamento não é o passo seguinte ao faturado, é a saída. No
  // meio, entre contrato e assinatura, o cartão diria ao coordenador que a venda anda para lá.
  "em_cancelamento",
];

/**
 * A venda que já teve o cancelamento PEDIDO: ela sai da etapa dela na faixa e passa a contar
 * sozinha.
 *
 * ⚠️ A MARCA SÓ VALE DEPOIS DO CONTRATO. Antes dele o cancelamento é ato do coordenador e a etapa
 * muda na hora (a proposta vira `cancelado`); a marca que fica é a do pedido ao jurídico, e é só
 * essa que tira a venda do número de contrato.
 *
 * ⚠️ E A MARCA JÁ CHEGA PENEIRADA. Quem monta a carga passa antes por `soltarMarcasQueSobraram`
 * (`marca-de-pedido.ts`), que solta a marca sem card vivo na Têmis — ler a coluna crua contaria
 * como "em cancelamento" a venda de um pedido indeferido meses atrás.
 */
export const ehVendaEmCancelamento = (p: {
  cancelamento_pedido_em?: null | string;
  etapa: string;
}): boolean => Boolean(p.cancelamento_pedido_em) && DEPOIS_DO_CONTRATO.has(p.etapa);

/**
 * A MESMA pergunta, na linha da lista — que é o que a tela tem na mão.
 *
 * ⚠️ DUAS FORMAS DO MESMO DADO, e por isso duas funções e não duas regras: a carga vem do banco em
 * `cancelamento_pedido_em` e a lista sai daqui em `cancelamentoPedidoEm`. O que não pode existir é
 * uma segunda RÉGUA — o cartão contaria uma coisa e a lista mostraria outra.
 */
export const linhaEmCancelamento = (l: {
  cancelamentoPedidoEm?: null | string;
  etapa: string;
}): boolean => Boolean(l.cancelamentoPedidoEm) && DEPOIS_DO_CONTRATO.has(l.etapa);

export type PropostaDaCarga = {
  cliente_documento: null | string;
  contrato_parcelas: null | number;
  plano_correcao: null | string;
  plano_juros: null | number | string;
  plano_parcelas: null | number;
  plano_personalizado: boolean | null;
  /** O número cru do código. Só as reservas do Panteon têm; ver `LinhaDaLista.codigo`. */
  protocolo_numero?: null | number;
  observacao?: null | string;
  cliente_nome: null | string;
  codigo: null | string;
  /** Quem vendeu. A carga do C2X traz o nome pronto; a reserva do Panteon copia o dela. */
  /** Quando o cancelamento foi PEDIDO à Têmis. A venda segue na etapa até o jurídico decidir. */
  cancelamento_pedido_em?: null | string;
  corretor_nome?: null | string;
  criado_em_c2x: null | string;
  data_assinatura: null | string;
  data_ato: null | string;
  data_faturamento: null | string;
  empreendimento_codigo: null | string;
  etapa: string;
  etapa_c2x: null | number;
  etapa_desde: null | string;
  id: string;
  imobiliaria_nome: null | string;
  motivo: null | string;
  /**
   * `'c2x'` (veio da carga do legado) ou `'panteon'` (nasceu aqui).
   *
   * ⚠️ SÓ A NATIVA SUBSTITUI A RESERVA. As duas convivem na mesma tabela, e quem lê sem separar
   * trata proposta importada de anos atrás como se fosse a que acabou de ser gerada na tela.
   * Opcional porque nem toda leitura pede a coluna — mas quem decidir por ela precisa pedi-la.
   */
  origem?: null | string;
  plano_nome: null | string;
  unidade_id: null | string;
  unidade_nome: null | string;
  valor: null | number | string;
};

export type UnidadeDoMapa = {
  /** A categoria da unidade. Nulo = não pertence a nenhuma. */
  categoria_id?: null | string;
  codigo: string;
  enterprise_id: string;
  /** Preenchido na linha ANTIGA do terreno, apontando para a viva — ver `unidade-viva.ts`. */
  espelho_de?: null | string;
  id: string;
  lote: null | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  situacao: string;
  // ⚠️ AS COLUNAS DO PRÉDIO (migration 0171) SÃO OPCIONAIS NA LINHA. A leitura que não as pede
  // continua compilando e montando loteamento como sempre; sem a 0171 aplicada elas nem existem.
  // Loteamento as tem nulas.
  /** 0 = térreo; negativo = subsolo. */
  andar?: null | number;
  apartamento?: null | string;
  tipologia?: null | string;
  /** Nulo = prédio de torre única. */
  torre?: null | string;
  vagas?: null | number;
};

export type PassoDoFluxo = {
  etapa: EtapaDoEspelho;
  /**
   * Quantas. No `disponivel` são UNIDADES (não existe proposta num lote livre); nas outras são
   * propostas — e como uma unidade tem no máximo uma proposta viva, dá no mesmo.
   */
  quantidade: number;
  vgv: number;
};

export type LinhaDaLista = {
  cliente: null | string;
  /**
   * `000123` — o COD da venda. O MESMO em toda fase: ver `codigoDaVenda`.
   *
   * ⚠️ NULO NAS PROPOSTAS IMPORTADAS DO C2X, e isso é fiel ao que existe: o legado não tem código,
   * e inventar um agora daria número novo para venda antiga toda vez que a carga rodasse. Só as
   * reservas nascidas no Panteon têm.
   */
  codigo: null | string;
  /**
   * O pedido de cancelamento aberto na Têmis.
   *
   * ⚠️ É O QUE IMPEDE O SEGUNDO CARD. Sem ele na lista, o botão "Solicitar cancelamento" continua
   * aceso depois do pedido feito, e o segundo clique abre outro trabalho para o mesmo contrato —
   * com o jurídico sem saber qual dos dois vale.
   */
  cancelamentoPedidoEm: null | string;
  /**
   * Quem vendeu.
   *
   * ⚠️ ELE FALTAVA NA FICHA (Lucas, 05/09/2026: *"trazer o nome do corretor também no descritivo da
   * unidade"*). A ficha mostrava cliente, imobiliária e plano — e o corretor, que é quem o
   * coordenador liga para cobrar o andamento, só aparecia no histórico, na linha da reserva, se
   * alguém rolasse até lá. A linha da RESERVA também o carrega desde então: é lá que ele é
   * escolhido.
   */
  corretor: null | string;
  desde: null | string;
  /** O que o coordenador anotou ao reservar. Só existe no que nasce no Panteon. */
  observacao: null | string;
  etapa: string;
  id: string;
  /**
   * `'panteon'` (nasceu aqui) ou `'c2x'` (veio da carga do legado).
   *
   * ⚠️ A TELA PRECISA SABER PORQUE SÓ A NATIVA SE CANCELA AQUI. Há 14 propostas do C2X em etapa
   * `proposta` — vendas correndo no legado, não lixo antigo —, e elas pintam o lote igual a uma
   * nativa. Sem esta distinção o botão "Cancelar proposta" acendia nelas e a rota respondia "Não
   * há proposta aberta nesta unidade" numa ficha que acabava de dizer Proposta: um beco sem
   * explicação, na tela em que o coordenador decide se liga para o cliente.
   */
  origem: null | string;
  imobiliaria: null | string;
  /** O FLUXO do contrato — "60x · IPCA ANUAL · juros 8% a.a." —, não o nome do plano. */
  plano: null | string;
  produto: null | string;
  unidade: null | string;
  /**
   * A unidade no Panteon — a chave que liga o LOTE DO MAPA a esta proposta.
   *
   * ⚠️ CASAR POR NOME NÃO SERVE: o nome da unidade na proposta vem do `block + lot` do legado e o
   * do mapa vem de `hercules_unidades.codigo`, que a carga pode ter normalizado de outro jeito. O
   * id é exato, e é o mesmo dos dois lados porque a carga casou por `origem_c2x_id`.
   */
  unidadeId: null | string;
  valor: number;
};

/**
 * O funil de CADASTRO — o começo do processo, que não está em `hercules_propostas`.
 *
 * ⚠️ VEM DE OUTRA FONTE, E POR ISSO É OUTRO CAMPO. CAD é do Apolo (`apolo_esteira`); proposta é do
 * C2X importado. Pedido do Lucas: *"quantas cads foram geradas, quantas reservas, propostas"* — as
 * duas coisas na mesma escada. Somá-las num único número seria misturar pessoa com unidade: uma CAD
 * credenciada pode não reservar nada, e uma unidade pode ter tido três propostas de gente
 * diferente.
 */
export type CadsDoEscopo = {
  credenciados: number;
  emAndamento: number;
  emCorrecao: number;
  reprovadas: number;
  total: number;
};

/** O recorte de tempo do painel, em competência (AAAA-MM). Ausente = a base inteira. */
export type PeriodoDoPainel = { ate?: string; de?: string };

/**
 * O plano comercial como a tela recebe.
 *
 * ⚠️ ESPELHA `PlanoComercial` de `lib/apolo/planos-comerciais.ts`, e não o reexporta: aquele tipo
 * carrega uniões estreitas (`IndiceCorrecao`, `SlotDaPa`) que o payload JSON não preserva. A tela
 * usa os campos para MOSTRAR e passa o plano de volta para a matemática de lá.
 */
export type PlanoDaVenda = {
  /**
   * As anuais do plano (0138), quando ele tem. Ausente = sem anual de plano (o C2X não tem).
   *
   * ⚠️ JÁ VIAJAVAM NO JSON DA ROTA E NINGUÉM AS LIA (Lucas, 18/09/2026: *"esta faltando as
   * anuais"*). Declaradas aqui, o simulador as usa no cartão e no clique (`tabela-do-lote.ts`).
   */
  anuaisQuantidade?: null | number;
  anuaisValor?: null | number;
  /**
   * A categoria do plano. Nulo = plano do produto inteiro.
   *
   * ⚠️ É O MENOR DEGRAU DA HIERARQUIA, e sem ele a tela não distingue "plano da categoria X" de
   * "plano do produto" — e o primeiro vaza para todos os lotes.
   */
  categoriaId?: null | string;
  /**
   * O desconto do plano sobre a tabela (0178), 0 a menos de 100. Ausente = sem desconto.
   *
   * ⚠️ É O PREÇO DO PLANO: escolher o plano põe este desconto no campo de desconto do simulador, e
   * a proposta com ele não pede motivo (`ajusteFrenteAoPlano`).
   */
  descontoPercentual?: null | number;
  /** O `enterprise_id` de quem cadastrou o plano — o degrau em que ele vive. */
  enterpriseId?: null | string;
  entradaPercentual: number;
  indiceCorrecao: string;
  jurosConvencao: string;
  jurosPeriodicidade: string;
  jurosTaxa: null | number;
  nome: string;
  parcelas: number;
  sistemaAmortizacao: string;
  slot: null | string;
};

export type FluxoDeVenda = {
  /** Nulo quando a leitura do cadastro falhou — a tela mostra o funil sem as duas primeiras barras. */
  cads: CadsDoEscopo | null;
  fluxo: PassoDoFluxo[];
  /** As propostas, já enxutas para a tela. A ordem é a mais recente primeiro. */
  lista: LinhaDaLista[];
  mapa: {
    /** "01" (a quadra) no loteamento; "Torre A" ou "Unidades" (torre única) no prédio. */
    grupo: string;
    /**
     * ⚠️ O GRUPO SABE DE QUE TIPO É. A mesma grade desenha quadra e torre, e só o tipo diz se os
     * quadradinhos vão em linhas de andar. Num escopo com loteamento e prédio juntos, a quadra
     * "Unidades" e a torre única "Unidades" são dois grupos, e não um.
     */
    tipoProduto: TipoProduto;
    unidades: {
      /** Só no prédio. 0 = térreo. */
      andar: null | number;
      /** Só no prédio, na forma canônica ("304"). */
      apartamento: null | string;
      /**
       * A categoria da unidade, quando ela tem.
       *
       * ⚠️ É O MENOR RECORTE DA HIERARQUIA DE PLANOS (Lucas, 15/09/2026: *"se precisar cadastrar um
       * plano e vincular a categoria, quando eu seleciono a unidade daquela categoria o plano e as
       * faixas tem que respeitar"*). Sem este campo a tela recebe um rótulo ("12 06") e não tem
       * chave nenhuma para escolher o plano certo — ver `lib/hercules/recorte-da-unidade.ts`.
       */
      categoriaId: null | string;
      codigo: string;
      /**
       * O empreendimento da unidade (id do C2X).
       *
       * ⚠️ VAI JUNTO PORQUE O PISO DE ENTRADA É POR EMPREENDIMENTO. Num escopo de pai com filhos, o
       * simulador precisa saber de QUAL produto é o lote para aplicar a % mínima certa — o Garden
       * aceita 8% e os outros, 10%.
       */
      enterpriseId: string;
      /** A etapa que pinta o quadrado — ver `EtapaDoEspelho`. */
      etapa: EtapaDoEspelho;
      id: string;
      lote: null | string;
      preco: number;
      /** A quadra, para a tela escrever "03 07" em vez do código interno da unidade. */
      quadra: null | string;
      /** A situação crua da unidade, para quem precisar do dado original. */
      situacao: string;
      /** Só no prédio ("2 quartos, 1 suíte"). */
      tipologia: null | string;
      /** O tipo do produto da unidade: é ele que escolhe "Quadra · Lote" ou "Torre · Apto". */
      tipoProduto: TipoProduto;
      /** Só no prédio, na forma canônica ("A"). Nulo = torre única. */
      torre: null | string;
      /** Só no prédio. Nulo = não informado; 0 = sem vaga. */
      vagas: null | number;
    }[];
  }[];
  perdas: { canceladas: number; distratos: number; vgvCancelado: number };
  /**
   * Quem é o PAI de cada empreendimento do escopo, por `enterprise_id`.
   *
   * ⚠️ É O TERCEIRO DEGRAU DA HIERARQUIA DE PLANOS, e a tela não tinha como saber. O card do
   * produto traz os `enterpriseIds` da família, mas não diz qual deles é o pai — e sem isso o plano
   * cadastrado SÓ no pai continua invisível, que é exatamente o que o Lucas pediu para corrigir.
   *
   * Empreendimento sem pai simplesmente não aparece aqui.
   */
  paiPorEmpreendimento: Record<string, string>;
  /** Os planos do escopo, para o simulador. Vazio quando o produto não tem plano cadastrado. */
  /**
   * A % mínima de entrada por empreendimento (id do C2X), cadastrada na Política Comercial.
   *
   * Empreendimento AUSENTE do mapa não cadastrou o seu: quem lê aplica o padrão da casa. A rota
   * preenche; a agregação não sabe disso.
   */
  entradaMinima: Record<string, number>;
  /**
   * As faixas de prazo cadastradas, por `enterprise_id`.
   *
   * ⚠️ VAZIO É O ESTADO NORMAL DE HOJE (migration 0155 nasceu sem linha nenhuma), e é o que faz a
   * entrega ser segura: sem faixa, `premissaDoPrazo` devolve nulo e a tela se comporta como antes.
   */
  faixasDePrazo: Record<string, FaixaDePrazo[]>;
  planos: PlanoDaVenda[];
  /** Os motivos de cancelamento que EXISTEM na base — ver o aviso sobre o legado. */
  motivos: { motivo: string; n: number }[];
  ranking: {
    imobiliaria: string;
    propostas: number;
    vendidas: number;
    vgv: number;
  }[];
  serie: { canceladas: number; faturadas: number; mes: string }[];
  /** O que o recorte de tempo pegou, para a tela poder dizer de que período está falando. */
  periodo: {
    ate: null | string;
    de: null | string;
    propostasNoPeriodo: number;
  };
  totais: {
    /** Quantas unidades em cada `EtapaDoEspelho` — é a legenda da grade. */
    estoque: Record<string, number>;
    /** Faturadas DENTRO da janela — o par do `vgvFaturado`, para o ticket médio fechar. */
    faturadasNoPeriodo: number;
    propostas: number;
    unidades: number;
    vgvFaturado: number;
  };
};

const numero = (v: null | number | string | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const ehDoFluxo = (etapa: string): etapa is EtapaDoFluxo =>
  (ETAPAS_DO_FLUXO as readonly string[]).includes(etapa);

/**
 * A etapa de uma unidade SEM proposta viva — o que o cadastro sozinho consegue afirmar.
 *
 * Situação desconhecida cai em `bloqueada`, e não em `disponivel`: na dúvida, fora da oferta. Um
 * lote a menos no estoque é um aviso; um lote vendido oferecido de novo é um cliente perdido.
 */
function etapaDaSituacao(situacao: string): EtapaDoEspelho {
  switch (situacao) {
    case "disponivel":
      return "disponivel";
    case "reservada":
      return "reservada";
    case "vendida":
      return "vendida";
    default:
      return "bloqueada";
  }
}

/**
 * Quem decide a etapa de cada unidade da grade e do estoque.
 *
 * ⚠️ COM `situacaoPorUnidade`, QUEM DECIDE É A RÉGUA ÚNICA (`situacao-da-unidade.ts`), e a conta
 * local não roda. Lucas (18/09/2026): *"esses status tem que morar em um so lugar"*. A conta local
 * abaixo olha só a linha da grade e só `hercules_propostas`: não vê a proposta que mora na linha
 * ANTIGA do terreno (a do pai, que aponta para a viva por `espelho_de`), nem a reserva do Hércules,
 * nem a do evento (`prometeu_reservas`). Era por isso que a mesma unidade saía com uma situação na
 * Venda e outra no Apolo.
 *
 * ⚠️ UNIDADE AUSENTE DO MAPA VIRA `bloqueada`, NUNCA LIVRE. O mapa vem da mesma tabela e do mesmo
 * escopo da grade, então a ausência só acontece numa corrida (a unidade nasceu entre as duas
 * leituras). Na dúvida, fora da oferta: a mesma regra de `etapaDaSituacao`.
 *
 * ⚠️ SEM O MAPA, SÓ NOS TESTES ANTIGOS. O único chamador de produção (a rota da Venda,
 * `app/api/incorporador/venda/route.ts`) passa o mapa sempre, e a rota responde 503 quando não
 * consegue lê-lo. A conta local ficou para os testes de `agregarFluxo` escritos antes da régua
 * única, que montam propostas e unidades sem mapa. Não é uma segunda régua a manter: quem passar a
 * chamar `agregarFluxo` em produção passa o mapa, ou está pintando lote por uma conta que não vê o
 * terreno.
 * O import de `situacao-da-unidade.ts` não entra aqui, e é de propósito: aquele módulo importa
 * este, e o mapa chega pronto de quem chama.
 */
function reguaDaEtapa(
  propostas: readonly PropostaDaCarga[],
  situacaoPorUnidade: ReadonlyMap<string, EtapaDoEspelho> | undefined,
): (u: UnidadeDoMapa) => EtapaDoEspelho {
  if (situacaoPorUnidade) {
    return (u) => situacaoPorUnidade.get(u.id) ?? "bloqueada";
  }

  // ⚠️ A ETAPA DA UNIDADE VEM DA PROPOSTA VIVA MAIS RECENTE. Uma unidade acumula propostas ao
  // longo do tempo (revenda, cancelamento e nova venda): a que vale é a última que ainda está no
  // caminho. Pegar qualquer uma pintaria de "faturado" um lote que voltou para o estoque.
  const vivaPorUnidade = new Map<string, { desde: string; etapa: EtapaDoEspelho }>();
  for (const p of propostas) {
    if (!p.unidade_id || !ehDoFluxo(p.etapa)) continue;
    const desde = String(p.etapa_desde ?? p.criado_em_c2x ?? "");
    const atual = vivaPorUnidade.get(p.unidade_id);
    // ⚠️ A VENDA PEDINDO PARA SAIR TEM SITUAÇÃO PRÓPRIA, aqui também. A régua única já a devolve
    // como `em_cancelamento` (`situacao-da-unidade.ts`); esta conta local existe para quem ainda
    // não passa o mapa, e sem a mesma marca ela devolveria "assinatura" para um lote que o
    // jurídico está desfazendo — dois números com nomes diferentes para o mesmo lote.
    const etapa: EtapaDoEspelho = ehVendaEmCancelamento(p) ? "em_cancelamento" : p.etapa;
    if (!atual || desde > atual.desde) vivaPorUnidade.set(p.unidade_id, { desde, etapa });
  }
  // ⚠️ A PROPOSTA VIVA REFINA, MAS A SITUAÇÃO NUNCA É REBAIXADA PARA LIVRE. Com proposta, ela
  // manda (é ela que sabe se está em contrato ou já faturou). Sem proposta, vale o cadastro — e
  // "vendida" ou "reservada" continuam ocupadas, nunca disponíveis: dizer que um lote vendido
  // está livre é convidar a segunda venda.
  return (u) => vivaPorUnidade.get(u.id)?.etapa ?? etapaDaSituacao(u.situacao);
}

/** `8` → `8%`; `8.5` → `8,5%`. A mesma escrita do extrato. */
function porcentagem(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * O FLUXO do contrato, no lugar do nome do plano.
 *
 * ⚠️ PEDIDO DO LUCAS (03/09/2026): *"não queria trazer o nome do plano, mas sim o fluxo, igual
 * estamos trazendo nesse relatório de Extrato"*. "PLANO NORMAL" não diz nada a quem vende;
 * "60x · IPCA ANUAL · juros 8% a.a." é o que o comprador reconhece como o contrato dele. A régua é
 * a mesma de `descricaoDoPlano` no extrato (extrato-cliente-pdf.ts).
 *
 * ⚠️ O PARCELAMENTO VEM DA PARCELA, NÃO DO PLANO. `commercial_plans.parcels` descreve o PRODUTO que
 * a mesa vende — um molde serve centenas de contratos —, e foi ele que fez o extrato do TIAGO
 * estampar "144x" num contrato de 62 parcelas. Quem sabe o tamanho do contrato é
 * `payments.total_parcels`; o do molde só entra quando o contrato não tem o dele.
 *
 * ⚠️ E OS TRÊS JUNTOS PORQUE UM SÓ NÃO SE CONFERE: com o parcelamento sozinho um número errado
 * passa; com os três, quem lê reconhece o próprio contrato.
 */
function fluxoDoPlano(p: PropostaDaCarga): null | string {
  const partes: string[] = [];

  const parcelas = p.contrato_parcelas ?? p.plano_parcelas;
  if (parcelas) partes.push(`${parcelas}x`);
  // ⚠️ A SIGLA FICA, O RESTO NÃO GRITA. O legado grava "IPCA ANUAL"; o Lucas não quer caixa alta
  // na tela ("deixa somente a primeira letra"), mas IPCA e INCC são siglas e viram outra coisa em
  // caixa baixa. Então só a primeira palavra — a sigla — mantém a caixa: "IPCA anual".
  const correcao = p.plano_correcao?.trim();
  if (correcao) {
    const [sigla, ...resto] = correcao.split(/\s+/);
    partes.push(
      [sigla, ...resto.map((w) => w.toLocaleLowerCase("pt-BR"))].join(" "),
    );
  }

  // ⚠️ A TAXA DO LEGADO NÃO DIZ A UNIDADE, e chutar "a.a." é errar em um terço dos contratos.
  // Lucas, olhando "juros 0,72% a.a.": *"acho que esse juros é ao mês não?"* — e é. O
  // `contractual_interest` guarda 8.0000 na Lavra do Ouro (ao ano) e 0.7207 em outro produto (ao
  // mês), a mesma taxa econômica gravada de dois jeitos. Os únicos valores que existem no banco
  // são 0,5 · 0,6434 · 0,7207 · 0,8 · 6 · 8: há um vão enorme entre 0,8 e 6, e nenhum juro
  // imobiliário real cai nele. A régua do corte é a do cadastro de planos, importada e não copiada.
  const juros = numero(p.plano_juros);
  if (juros > 0) {
    const unidade = periodicidadeDaTaxa(juros) === "anual" ? "a.a." : "a.m.";
    partes.push(`juros ${porcentagem(juros)} ${unidade}`);
  }

  // Sem nenhum dos três, o nome do plano é melhor do que um travessão — mas só aí.
  return partes.length > 0 ? partes.join(" · ") : p.plano_nome?.trim() || null;
}

/**
 * A data que interessa NAQUELA etapa.
 *
 * ⚠️ NÃO É SEMPRE A MUDANÇA DE ETAPA. `etapa_desde` diz quando o registro MEXEU pela última vez; a
 * data que o coordenador procura é a do fato — quando faturou, quando assinou. Uma correção feita
 * hoje numa venda de março mudaria `etapa_desde` e a ficha passaria a dizer que a venda é de hoje.
 * É a mesma régua que o gráfico mês a mês já usa.
 */
function dataDaEtapa(p: PropostaDaCarga): null | string {
  if (p.etapa === "faturado") return p.data_faturamento ?? p.etapa_desde;
  if (p.etapa === "assinatura") return p.data_assinatura ?? p.etapa_desde;
  return p.etapa_desde;
}

/** "Q07" de "Q07 L12" — o agrupamento do mapa quando a unidade não traz quadra própria. */
function grupoDaUnidade(u: UnidadeDoMapa): string {
  if (u.quadra) return u.quadra;
  const partes = String(u.codigo ?? "")
    .trim()
    .split(/\s+/);
  return partes.length > 1 ? (partes[0] ?? "Unidades") : "Unidades";
}

/**
 * O grupo do apartamento: a TORRE, que é como o corretor fala do estoque de um prédio ("a torre B
 * está quase vendida"). Prédio de torre única cai em "Unidades".
 */
function grupoDoApartamento(torre: null | string): string {
  return torre ? `Torre ${torre}` : "Unidades";
}

/** Ordem natural de texto: "2" antes de "10", vazio por último. */
function naturalComVazioNoFim(a: null | string, b: null | string): number {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (x === y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, "pt-BR", { numeric: true });
}

/**
 * A ordem dos apartamentos dentro da torre: do andar MAIS ALTO para o mais baixo, e o apartamento
 * em ordem natural dentro do andar.
 *
 * ⚠️ DE CIMA PARA BAIXO PORQUE É ASSIM QUE O PRÉDIO SE DESENHA. O espelho de vendas de uma
 * incorporadora é a fachada: cobertura no alto, térreo embaixo. Andar crescente poria o térreo na
 * primeira linha e obrigaria o corretor a ler o prédio de cabeça para baixo. Andar nulo (não
 * informado) vai para o fim, e não para o topo: não é a cobertura.
 */
export function compararApartamentos(
  a: { andar: null | number; apartamento: null | string; codigo: string },
  b: { andar: null | number; apartamento: null | string; codigo: string },
): number {
  if (a.andar !== b.andar) {
    if (a.andar === null) return 1;
    if (b.andar === null) return -1;
    return b.andar - a.andar;
  }
  return (
    naturalComVazioNoFim(a.apartamento, b.apartamento) ||
    a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })
  );
}

/**
 * As torres em ordem natural ("Torre 2" antes de "Torre 10"), e "Unidades" (torre única) no fim.
 */
function compararGruposDoPredio(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "Unidades") return 1;
  if (b === "Unidades") return -1;
  return a.localeCompare(b, "pt-BR", { numeric: true });
}

/**
 * Os andares de um grupo do prédio, de cima para baixo, cada um com os seus apartamentos. A grade
 * desenha uma linha por andar.
 *
 * ⚠️ UMA LINHA POR ANDAR, E NÃO SEIS QUADRADINHOS POR LINHA. Na grade de seis colunas da quadra,
 * um prédio de quatro apartamentos por andar sairia com o 1201 ao lado do 1101: a linha deixaria de
 * ser o andar, que é justamente o que quem vende apartamento procura ("tem alguma coisa no alto?").
 */
export function andaresDoGrupo<U extends { andar: null | number; apartamento: null | string; codigo: string }>(
  unidades: readonly U[],
): { andar: null | number; unidades: U[] }[] {
  const porAndar = new Map<null | number, U[]>();
  for (const u of [...unidades].sort(compararApartamentos)) {
    const lista = porAndar.get(u.andar);
    if (lista) lista.push(u);
    else porAndar.set(u.andar, [u]);
  }
  // O Map guarda a ordem de inserção, e a inserção já veio ordenada pelo andar.
  return [...porAndar.entries()].map(([andar, doAndar]) => ({ andar, unidades: doAndar }));
}

/**
 * As palavras do filtro e da busca do estoque, pelo que está na tela.
 *
 * ⚠️ "TODAS AS QUADRAS" NUM PRÉDIO É O ERRO QUE O LUCAS PROIBIU (16/09/2026): o corretor leria que
 * o prédio tem quadra. Só loteamento fala em quadra; só prédio fala em torre; o escopo com os dois
 * (o consolidado de um incorporador que tem loteamento e prédio) diz os dois.
 */
export function vocabularioDoEstoque(tipos: Iterable<TipoProduto>): {
  busca: string;
  todos: string;
} {
  const presentes = new Set(tipos);
  const temPredio = presentes.has("vertical");
  const temLote = presentes.has("loteamento") || presentes.size === 0;
  if (temPredio && temLote) {
    return { busca: "Buscar quadra, lote, torre, apartamento ou código", todos: "Todas as quadras e torres" };
  }
  if (temPredio) return { busca: "Buscar torre, apartamento ou código", todos: "Todas as torres" };
  return { busca: "Buscar quadra, lote ou código", todos: "Todas as quadras" };
}

/**
 * O mês de referência de uma proposta faturada ou cancelada.
 *
 * ⚠️ FATURADA USA A DATA DE FATURAMENTO, e só cai para `etapa_desde` quando ela falta: `etapa_desde`
 * é quando o registro MUDOU de etapa, e uma correção feita hoje numa venda de março jogaria a venda
 * para o mês errado no gráfico.
 */
function mesDe(p: PropostaDaCarga): null | string {
  const bruta =
    p.etapa === "faturado"
      ? (p.data_faturamento ?? p.etapa_desde)
      : (p.etapa_desde ?? p.criado_em_c2x);
  if (!bruta) return null;
  const m = /^(\d{4})-(\d{2})/.exec(String(bruta));
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * ⚠️ O PERÍODO NÃO VALE PARA A FAIXA DO FLUXO, e isso é decisão de desenho, não esquecimento.
 *
 * A faixa responde "o que está na minha mão AGORA": uma reserva feita em julho e ainda viva é
 * pipeline de hoje, e sumir dela porque o filtro está em setembro faria o coordenador trabalhar com
 * menos do que tem. Já o Panorama responde "como fui no período" — aí faturamento, cancelamento,
 * ranking e série só contam o que aconteceu na janela.
 */
export function agregarFluxo({
  cads = null,
  periodo,
  propostas,
  situacaoPorUnidade,
  terrenoDe,
  tiposDeProduto,
  unidades,
}: {
  cads?: CadsDoEscopo | null;
  periodo?: PeriodoDoPainel;
  propostas: PropostaDaCarga[];
  /**
   * A situação de cada unidade pela régua única, pelo id de QUALQUER linha do terreno: é o
   * `porLinha` de `lerSituacaoDasUnidades` reduzido à situação.
   *
   * ⚠️ ELA PINTA A GRADE E CONTA O ESTOQUE (inclusive o passo `disponivel` da faixa); o resto da
   * faixa, a lista, o VGV, o ranking e a série continuam saindo das propostas. São perguntas
   * diferentes: "em que situação está este lote" é da régua; "quantas propostas andam no funil"
   * é das propostas.
   *
   * ⚠️ OPCIONAL SÓ PARA OS TESTES ANTIGOS. O único chamador de produção (a rota da Venda) passa o
   * mapa sempre; ausente, roda a conta local de `reguaDaEtapa`, que olha só a linha da grade e não
   * vê o terreno, a reserva do Hércules nem a do salão. Ela existe para os testes escritos antes da
   * régua única, e não para produção.
   */
  situacaoPorUnidade?: ReadonlyMap<string, EtapaDoEspelho>;
  /**
   * As linhas irmãs de cada terreno (`terreno` de `lerSituacaoDasUnidades`).
   *
   * ⚠️ SEM ELA A FAIXA PERDE A PROPOSTA QUE MUDOU DE GLEBA. O lote que migrou guarda a
   * proposta sob o código ANTIGO (VOR, VLO), e a grade a enxerga porque a régua olha o terreno
   * inteiro. Medido em 21/09/2026 no VOC: 5 propostas nessa condição (2 reservado, 2 faturado,
   * 1 assinatura) — exatamente o tamanho da divergência que a tela mostrava entre a faixa e a
   * legenda (0x2, 83x85, 6x7).
   */
  terrenoDe?: (linhaId: string) => undefined | { linhas: string[] };
  /**
   * O tipo de cada produto do escopo, por `enterprise_id` (`hercules_empreendimentos.tipo_produto`).
   *
   * ⚠️ OPCIONAL, E A UNIDADE SE DEFENDE SEM ELE: apartamento preenchido com quadra e lote vazios já
   * é prédio (`tipoDaUnidade`). O mapa serve para o produto vertical cuja leitura não trouxe as
   * colunas da 0171. Ausente do mapa = loteamento, que é o que todo produto era até a 0170.
   */
  tiposDeProduto?: Readonly<Record<string, TipoProduto>>;
  unidades: UnidadeDoMapa[];
}): FluxoDeVenda {
  // ⚠️ A ETAPA É A ETAPA: `data_faturamento` NÃO PROMOVE NADA (revertido em 22/09/2026).
  // Entre 21 e 22/09 esta função promovia a `faturado` toda venda com `data_faturamento` no
  // passado, e o campo não é o fato: ele guarda `acquisition_requests.billing_date`, que é a data
  // PREVISTA. Medido nos dois bancos: das 60 vendas que a promoção alcançava, **36 não tinham
  // faturado** no legado (35 do CDJ em assinatura, com previsão de set/2025, e 1 do RDP em
  // contrato gerado, de dez/2024). Ver `data-faturamento-e-previsao.test.ts`.
  const de = periodo?.de ?? null;
  const ate = periodo?.ate ?? null;
  /** A proposta caiu na janela? Sem janela, tudo cai. */
  const naJanela = (p: PropostaDaCarga): boolean => {
    if (!de && !ate) return true;
    const mes = mesDe(p);
    if (!mes) return false;
    if (de && mes < de) return false;
    if (ate && mes > ate) return false;
    return true;
  };
  let propostasNoPeriodo = 0;
  // ── A faixa do fluxo ──────────────────────────────────────────────────────
  const porEtapa = new Map<EtapaDoFluxo, { propostas: number; vgv: number }>();
  for (const etapa of ETAPAS_DO_FLUXO)
    porEtapa.set(etapa, { propostas: 0, vgv: 0 });

  let canceladas = 0;
  let distratos = 0;
  let emCancelamento = 0;
  let vgvEmCancelamento = 0;
  let vgvCancelado = 0;
  let vgvFaturado = 0;

  const porImobiliaria = new Map<
    string,
    { propostas: number; vendidas: number; vgv: number }
  >();
  const porMes = new Map<string, { canceladas: number; faturadas: number }>();
  const porMotivo = new Map<string, number>();

  for (const p of propostas) {
    const valor = numero(p.valor);

    // A FAIXA: estado atual, sem janela.
    //
    // ⚠️ A VENDA EM CANCELAMENTO SAI DA ETAPA DELA, e é o ponto de tudo isto (Lucas, 21/09/2026:
    // *"hoje ele aponta para contrato e polui nossos indicadores"*). Ela não é somada duas vezes
    // nem fica nas duas: o cartão de contrato passa a contar só o que o jurídico não está
    // desfazendo, que é o que o coordenador quer saber ao olhar para ele.
    if (ehVendaEmCancelamento(p)) {
      emCancelamento += 1;
      vgvEmCancelamento += valor;
    } else if (ehDoFluxo(p.etapa)) {
      const atual = porEtapa.get(p.etapa)!;
      atual.propostas += 1;
      atual.vgv += valor;
    }

    // O DESEMPENHO: só o que caiu na janela.
    const dentro = naJanela(p);
    if (dentro) propostasNoPeriodo += 1;
    if (dentro && p.etapa === "faturado") vgvFaturado += valor;
    if (dentro && p.etapa === "cancelado") {
      canceladas += 1;
      vgvCancelado += valor;
    }
    if (dentro && p.etapa === "distrato") {
      distratos += 1;
      vgvCancelado += valor;
    }

    // ⚠️ O RANKING CONTA A IMOBILIÁRIA DE TODAS AS PROPOSTAS, e separa quantas VIRARAM venda: quem
    // abre muita proposta e fecha pouca é justamente o que o coordenador precisa enxergar.
    const imob = String(p.imobiliaria_nome ?? "").trim();
    if (imob && dentro) {
      const atual = porImobiliaria.get(imob) ?? {
        propostas: 0,
        vendidas: 0,
        vgv: 0,
      };
      atual.propostas += 1;
      if (p.etapa === "faturado") {
        atual.vendidas += 1;
        atual.vgv += valor;
      }
      porImobiliaria.set(imob, atual);
    }

    const mes = mesDe(p);
    if (mes && dentro && (p.etapa === "faturado" || p.etapa === "cancelado")) {
      const atual = porMes.get(mes) ?? { canceladas: 0, faturadas: 0 };
      if (p.etapa === "faturado") atual.faturadas += 1;
      else atual.canceladas += 1;
      porMes.set(mes, atual);
    }

    const motivo = String(p.motivo ?? "").trim();
    if (
      motivo &&
      dentro &&
      (p.etapa === "cancelado" || p.etapa === "distrato")
    ) {
      porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1);
    }
  }

  // ── O estoque, pelas unidades ────────────────────────────────────────────
  const estoque: Record<string, number> = {};
  const etapaDa = reguaDaEtapa(propostas, situacaoPorUnidade);

  /**
   * A proposta viva mais recente de cada LINHA, com o valor.
   *
   * ⚠️ O VALOR DA FAIXA SAI DAQUI, E NÃO DO PREÇO DE TABELA. Lucas, 21/09/2026: *"valor sempre
   * será o que está na proposta"* — o card é lido como VGV do pipeline, e o que está em jogo é o
   * que foi negociado, não o que a tabela pedia. O único passo que foge é `disponivel`, que não
   * tem proposta: *"o disponivel sempre será o que está no cadastro"*.
   */
  const vivaPorLinha = new Map<string, { desde: string; valor: number }>();
  for (const p of propostas) {
    if (!p.unidade_id || !ehDoFluxo(p.etapa)) continue;
    const desde = String(p.etapa_desde ?? p.criado_em_c2x ?? "");
    const atual = vivaPorLinha.get(p.unidade_id);
    if (!atual || desde > atual.desde) {
      vivaPorLinha.set(p.unidade_id, { desde, valor: numero(p.valor) });
    }
  }

  /** O valor negociado daquele LOTE, venha a proposta desta linha ou de uma irmã do terreno. */
  const valorNegociado = (linhaId: string): number => {
    const daPropria = vivaPorLinha.get(linhaId);
    if (daPropria) return daPropria.valor;
    const irmas = terrenoDe?.(linhaId)?.linhas ?? [];
    let escolhida: null | { desde: string; valor: number } = null;
    for (const irma of irmas) {
      const viva = vivaPorLinha.get(irma);
      if (viva && (!escolhida || viva.desde > escolhida.desde)) escolhida = viva;
    }
    return escolhida?.valor ?? 0;
  };

  /** A faixa, contada por LOTE. Ver a nota de `terrenoDe`. */
  const faixaPorEtapa = new Map<string, { quantidade: number; vgv: number }>();

  // ⚠️ A CHAVE DO GRUPO LEVA O TIPO. Sem ele, a quadra "Unidades" de um loteamento e a torre única
  // "Unidades" de um prédio virariam o mesmo grupo no consolidado, e a grade poria lote e
  // apartamento na mesma coluna.
  const grupos = new Map<string, FluxoDeVenda["mapa"][number]>();
  /** Unidades livres, para o passo `disponivel` da faixa. */
  let disponiveis = 0;
  let vgvDisponivel = 0;
  for (const u of unidades) {
    const etapa = etapaDa(u);

    estoque[etapa] = (estoque[etapa] ?? 0) + 1;
    if (etapa === "disponivel") {
      disponiveis += 1;
      vgvDisponivel += numero(u.preco_tabela);
    } else {
      // ⚠️ UM LOTE, UMA LINHA NA FAIXA. Antes a faixa contava PROPOSTAS filtradas pelo código do
      // empreendimento, e a legenda contava LOTES pela régua: dois números com o mesmo nome na
      // mesma tela, e o de cima escondia o lote que migrou de gleba.
      const balde = faixaPorEtapa.get(etapa) ?? { quantidade: 0, vgv: 0 };
      balde.quantidade += 1;
      balde.vgv += valorNegociado(u.id);
      faixaPorEtapa.set(etapa, balde);
    }

    const tipoProduto = tipoDaUnidade({
      apartamento: u.apartamento,
      lote: u.lote,
      quadra: u.quadra,
      tipoProduto: tiposDeProduto?.[String(u.enterprise_id)],
    });
    const vertical = tipoProduto === "vertical";
    const torre = vertical ? torreCanonica(u.torre) : null;
    const andar =
      vertical && typeof u.andar === "number" && Number.isInteger(u.andar) ? u.andar : null;
    const g = vertical ? grupoDoApartamento(torre) : grupoDaUnidade(u);
    const chave = `${tipoProduto}|${g}`;
    const item = {
      andar,
      apartamento: vertical ? apartamentoCanonico(u.apartamento) : null,
      categoriaId: String(u.categoria_id ?? "").trim() || null,
      codigo: u.codigo,
      enterpriseId: String(u.enterprise_id),
      etapa,
      id: u.id,
      lote: u.lote,
      preco: numero(u.preco_tabela),
      quadra: u.quadra,
      situacao: u.situacao,
      tipologia: vertical ? String(u.tipologia ?? "").trim() || null : null,
      tipoProduto,
      torre,
      vagas: vertical && typeof u.vagas === "number" ? u.vagas : null,
    };
    const grupo = grupos.get(chave);
    if (grupo) grupo.unidades.push(item);
    else grupos.set(chave, { grupo: g, tipoProduto, unidades: [item] });
  }

  return {
    cads,
    // A rota preenche depois: os planos, as faixas, o piso de entrada e o parentesco vêm de
    // outras fontes e não passam pela agregação.
    entradaMinima: {},
    faixasDePrazo: {},
    paiPorEmpreendimento: {},
    planos: [],
    // ⚠️ A FAIXA SAI DA CONTAGEM POR LOTE, inclusive o passo `em_cancelamento` — ele já é situação
    // da régua única desde 21/09/2026, e o VGV de cada passo continua sendo o valor da PROPOSTA
    // daquele lote, achada pelo terreno quando ela ficou na linha irmã.
    //
    // ⚠️ SEM GRADE, A CONTA VOLTA A SER POR PROPOSTA. Quem chama sem `unidades` não tem lote para
    // contar, e zerar a faixa inteira seria pior do que a divergência que este trabalho conserta:
    // a tela mostraria um funil vazio com vendas vivas no banco.
    fluxo: ETAPAS_DA_FAIXA.map((etapa) => {
      if (etapa === "disponivel") {
        return { etapa, quantidade: disponiveis, vgv: Math.round(vgvDisponivel * 100) / 100 };
      }
      if (unidades.length === 0) {
        if (etapa === "em_cancelamento") {
          return { etapa, quantidade: emCancelamento, vgv: Math.round(vgvEmCancelamento * 100) / 100 };
        }
        return {
          etapa,
          quantidade: porEtapa.get(etapa)?.propostas ?? 0,
          vgv: Math.round((porEtapa.get(etapa)?.vgv ?? 0) * 100) / 100,
        };
      }
      return {
        etapa,
        quantidade: faixaPorEtapa.get(etapa)?.quantidade ?? 0,
        vgv: Math.round((faixaPorEtapa.get(etapa)?.vgv ?? 0) * 100) / 100,
      };
    }),
    lista: propostas.map((p) => ({
      cliente: p.cliente_nome,
      codigo: p.protocolo_numero ? codigoDaVenda(p.protocolo_numero) : null,
      cancelamentoPedidoEm: p.cancelamento_pedido_em ?? null,
      corretor: p.corretor_nome ?? null,
      observacao: p.observacao ?? null,
      desde: dataDaEtapa(p),
      etapa: p.etapa,
      id: p.id,
      imobiliaria: p.imobiliaria_nome,
      origem: p.origem ?? null,
      plano: fluxoDoPlano(p),
      produto: p.empreendimento_codigo,
      unidade: p.unidade_nome,
      unidadeId: p.unidade_id,
      valor: numero(p.valor),
    })),
    // ⚠️ O LOTEAMENTO SEGUE A ORDEM DE SEMPRE: grupo e lote em ordem natural. O prédio vem depois,
    // torre por torre, e dentro da torre de cima para baixo (`compararApartamentos`).
    mapa: [...grupos.values()]
      .sort((a, b) =>
        a.tipoProduto !== b.tipoProduto
          ? a.tipoProduto === "loteamento"
            ? -1
            : 1
          : a.tipoProduto === "vertical"
            ? compararGruposDoPredio(a.grupo, b.grupo)
            : a.grupo.localeCompare(b.grupo, "pt-BR", { numeric: true }),
      )
      .map((g) => ({
        grupo: g.grupo,
        tipoProduto: g.tipoProduto,
        unidades:
          g.tipoProduto === "vertical"
            ? g.unidades.sort(compararApartamentos)
            : g.unidades.sort((a, b) =>
                String(a.lote ?? a.codigo).localeCompare(
                  String(b.lote ?? b.codigo),
                  "pt-BR",
                  {
                    numeric: true,
                  },
                ),
              ),
      })),
    motivos: [...porMotivo.entries()]
      .map(([motivo, n]) => ({ motivo, n }))
      .sort((a, b) => b.n - a.n),
    perdas: {
      canceladas,
      distratos,
      vgvCancelado: Math.round(vgvCancelado * 100) / 100,
    },
    ranking: [...porImobiliaria.entries()]
      .map(([imobiliaria, v]) => ({
        imobiliaria,
        ...v,
        vgv: Math.round(v.vgv * 100) / 100,
      }))
      .sort((a, b) => b.vgv - a.vgv || b.vendidas - a.vendidas),
    periodo: { ate, de, propostasNoPeriodo },
    serie: [...porMes.entries()]
      .map(([mes, v]) => ({ mes, ...v }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    totais: {
      estoque,
      // ⚠️ `faturadasNoPeriodo` existe porque `fluxo` conta o TOTAL faturado e `vgvFaturado` só o
      // do período: dividir um pelo outro daria um ticket médio inventado.
      faturadasNoPeriodo: propostas.filter(
        (p) => p.etapa === "faturado" && naJanela(p),
      ).length,
      propostas: propostas.length,
      unidades: unidades.length,
      vgvFaturado: Math.round(vgvFaturado * 100) / 100,
    },
  };
}

// ── O PROCESSO QUE OS BOTÕES DA FICHA OPERAM ────────────────────────────────
//
// Lucas (18/09/2026): *"esses status tem que morar em um so lugar"* · *"eu não posso vender dois
// lotes para pessoas diferentes, eu tomo processo por conta disso"*.
//
// ⚠️ A COR E OS BOTÕES TÊM FONTES DIFERENTES, E ESTA FUNÇÃO É A PONTE ENTRE ELAS. A grade pinta pela
// régua única (`situacao-da-unidade.ts`), que olha o TERRENO inteiro: a linha antiga do pai, a irmã
// de outra gleba e a reserva antiga do salão do lançamento. Os botões agem numa LINHA DA LISTA da
// Venda, e as rotas também: reserva, proposta, contrato e cancelamento procuram o processo pelo
// `unidade_id` da própria unidade. Quando a régua via um processo que mora fora dessa linha, o lote
// saía amarelo, "Gerar proposta" e "Cancelar reserva" acendiam e a rota respondia "Não há reserva
// ativa nesta unidade"; sem linha nenhuma, a ficha ainda dizia que a proposta "veio do C2X", uma
// origem inventada.
//
// ⚠️ A REGRA: os botões só agem quando a lista tem uma linha VIVA desta unidade NA MESMA ETAPA que a
// régua pintou (e, na reserva, uma reserva do Hércules, que é o que as rotas da reserva operam). Fora
// disso eles apagam, e a ficha diz uma frase que é verdade em qualquer causa. A frase não afirma de
// onde o processo veio quando a lista não sabe: a reserva do salão, a linha antiga do pai e a irmã
// de outra gleba chegam aqui iguais, como ausência. Só a origem que está escrita na própria linha
// (`origem = 'c2x'`) é dita.
//
// ⚠️ NA DÚVIDA, APAGADO. Botão apagado num lote que tinha dono custa um telefonema para a coordenação;
// botão aceso num lote de outro dono é o começo da segunda venda. A rota recusa de qualquer jeito
// (`trava-do-lote.ts`); a tela só para de oferecer o que a rota vai recusar.

/** O mínimo que a decisão precisa de uma linha da lista (`LinhaDaLista` serve). */
export type LinhaDaFicha = {
  /** A marca do pedido de cancelamento. É ela, e não a etapa, que sustenta `em_cancelamento`. */
  cancelamentoPedidoEm?: null | string;
  etapa: string;
  id: string;
  origem: null | string;
  unidadeId: null | string;
};

export type ProcessoDaFicha<L extends LinhaDaFicha> =
  /**
   * A régua pintou fora do fluxo (disponível, bloqueada, vendida ou reservada sem proposta) e a lista
   * concorda: os botões seguem as regras de sempre.
   */
  | { tipo: "sem-processo" }
  /** A linha que sustenta a cor do lote: é nela que os botões agem e é ela que as modais mostram. */
  | { linha: L; tipo: "na-lista" }
  /** Os botões apagam todos, e a ficha diz a frase. */
  | {
      causa: "divergente" | "dois-processos" | "fora-da-lista" | "reserva-do-legado";
      frase: string;
      tipo: "apagado";
    };

/**
 * ⚠️ A RESERVA DO HÉRCULES SE RECONHECE PELO PREFIXO DO ID. É o contrato de `reservaComoLinhaDoFluxo`
 * (`reserva.ts`, com teste): a reserva entra na lista com `reserva:` na frente do uuid. A proposta
 * importada do C2X também pode estar na etapa `reservado` (a etapa 1 do legado), e sobre ela
 * "Gerar proposta" e "Cancelar reserva" não têm o que operar: as duas rotas procuram
 * `hercules_reservas`.
 */
const ehReservaDoHercules = (linha: LinhaDaFicha) => linha.id.startsWith("reserva:");

const FRASE_DIVERGENTE =
  "A situação deste lote não bate com a lista desta tela. Recarregue; se continuar, fale com a coordenação.";

const FRASE_DOIS_PROCESSOS =
  "Este lote tem uma reserva e outro processo abertos ao mesmo tempo. Fale com a coordenação.";

const FRASE_RESERVA_DO_LEGADO =
  "Reserva importada do C2X: esta tela não gera proposta nem cancela sobre ela. Fale com a coordenação.";

/**
 * ⚠️ "PODE SER", E NÃO "É". A lista não diz de onde veio o processo que ela não mostra, e a frase
 * não inventa: o salão do lançamento e a outra linha do lote são as causas conhecidas, ditas como
 * possibilidade. O que ela afirma (o lote tem processo e esta tela não o mostra) é verdade em todas.
 */
const FRASE_FORA_DA_LISTA: Record<EtapaDoFluxo, string> = {
  assinatura: "Assinatura que esta tela não mostra: pode estar em outra linha do lote. Fale com a coordenação.",
  contrato: "Contrato que esta tela não mostra: pode estar em outra linha do lote. Fale com a coordenação.",
  faturado: "Venda faturada que esta tela não mostra: pode estar em outra linha do lote. Fale com a coordenação.",
  proposta: "Proposta que esta tela não mostra: pode estar em outra linha do lote. Fale com a coordenação.",
  reservado:
    "Reserva que esta tela não mostra: pode ser do salão do lançamento ou de outra linha do lote. Fale com a coordenação.",
};

/**
 * Sobre qual processo os botões da ficha podem agir, dada a cor que a régua deu ao lote.
 *
 * `unidade.etapa` é a da grade (a régua única); `lista` é a lista da Venda INTEIRA (`FluxoDeVenda.lista`),
 * e não a da etapa aberta: a linha que sustenta a cor pode estar em outra aba do funil.
 */
export function processoDaFicha<L extends LinhaDaFicha>(
  unidade: { etapa: EtapaDoEspelho; id: string },
  lista: readonly L[],
): ProcessoDaFicha<L> {
  const vivas = lista.filter((l) => l.unidadeId === unidade.id && ehDoFluxo(l.etapa));

  // ⚠️ EM CANCELAMENTO A COR VEM DA MARCA, E NÃO DA ETAPA DA LINHA. No banco a venda continua em
  // contrato, assinatura ou faturado (é a etapa que segura o lote), então procurar uma linha "na
  // etapa em_cancelamento" não acharia nenhuma e a ficha apagaria os botões dizendo que a situação
  // do lote não bate com a lista — sobre o lote em que ela bate.
  if (unidade.etapa === "em_cancelamento") {
    const marcada = vivas.find(linhaEmCancelamento);
    return marcada
      ? { linha: marcada, tipo: "na-lista" }
      : { causa: "divergente", frase: FRASE_DIVERGENTE, tipo: "apagado" };
  }

  if (!ehDoFluxo(unidade.etapa)) {
    // ⚠️ LIVRE (OU FORA DO FLUXO) PELA RÉGUA E COM PROCESSO VIVO NA LISTA. A rota lê a lista e a
    // situação em momentos diferentes; alguém que reservou no meio da carga faz as duas discordarem.
    // Oferecer "Reservar" aqui é oferecer lote que acabou de ganhar dono.
    return vivas.length > 0
      ? { causa: "divergente", frase: FRASE_DIVERGENTE, tipo: "apagado" }
      : { tipo: "sem-processo" };
  }

  if (vivas.length === 0) {
    return { causa: "fora-da-lista", frase: FRASE_FORA_DA_LISTA[unidade.etapa], tipo: "apagado" };
  }

  // ⚠️ RESERVA DO HÉRCULES MAIS QUALQUER OUTRA LINHA VIVA DA MESMA UNIDADE SÃO DOIS DONOS. A reserva
  // que virou proposta não chega aqui (a lista só traz a reserva `ativa`, e a rota tira a que tem
  // proposta nativa na mesma linha); o que sobra ao lado dela é outra venda. Qualquer botão aqui
  // mexeria num dos dois sem enxergar o outro.
  if (vivas.length > 1 && vivas.some(ehReservaDoHercules)) {
    return { causa: "dois-processos", frase: FRASE_DOIS_PROCESSOS, tipo: "apagado" };
  }

  const naEtapa = vivas.find((l) => l.etapa === unidade.etapa);
  if (!naEtapa) {
    return { causa: "divergente", frase: FRASE_DIVERGENTE, tipo: "apagado" };
  }

  if (unidade.etapa === "reservado" && !ehReservaDoHercules(naEtapa)) {
    // A origem está na própria linha: dizer "C2X" aqui não é inventar. Linha de reserva sem ser do
    // Hércules e sem ser do legado não existe hoje; se aparecer, cai no lado seguro com a frase geral.
    return naEtapa.origem === "c2x"
      ? { causa: "reserva-do-legado", frase: FRASE_RESERVA_DO_LEGADO, tipo: "apagado" }
      : { causa: "divergente", frase: FRASE_DIVERGENTE, tipo: "apagado" };
  }

  return { linha: naEtapa, tipo: "na-lista" };
}

/**
 * A linha que as modais da ficha mostram e mandam para a rota (o `propostaId` que a rota confere).
 *
 * ⚠️ A MESMA DOS BOTÕES. A modal existe para quem clicou dizer "não era essa"; se ela mostrasse outra
 * linha da unidade, o botão agiria num processo e a confirmação falaria de outro.
 *
 * Sem linha que sustente a cor os botões estão apagados e nenhuma modal abre por eles. A primeira
 * viva da unidade (a regra de antes) fica só para a modal que já estava aberta quando a tela
 * recarregou: mandar o id dela deixa a rota recusar com "recarregue", em vez de mandar nulo e a rota
 * não ter o que conferir.
 */
export function linhaDaFicha<L extends LinhaDaFicha>(
  unidade: { etapa: EtapaDoEspelho; id: string },
  lista: readonly L[],
): L | null {
  const processo = processoDaFicha(unidade, lista);
  if (processo.tipo === "na-lista") return processo.linha;
  return lista.find((l) => l.unidadeId === unidade.id && ehDoFluxo(l.etapa)) ?? null;
}

// ── O BALDE DA TELA PRODUTOS ────────────────────────────────────────────────
//
// ⚠️ A CONTA DO ESTOQUE POR EMPREENDIMENTO SAIU DAQUI (18/09/2026). `estoquePorEmpreendimento`
// olhava a proposta da própria linha e, sem ela, o cadastro cru: não via a reserva do Hércules, a do
// salão nem a proposta da linha antiga do terreno. As rotas de Produtos passaram a contar pela régua
// única (`situacao-da-unidade.ts`) e ela ficou sem chamador. Ficou só o balde, que as duas rotas de
// Produtos ainda chamam.

/** Os cinco baldes da tela Produtos, na régua do Panteon. */
export type BaldeDoProduto =
  | "bloqueado"
  | "disponivel"
  | "negociacao"
  | "reservado"
  | "vendido";

/**
 * Em qual balde da tela Produtos esta etapa cai.
 *
 * ⚠️ FATURADO É VENDIDO, e as etapas do meio são NEGOCIAÇÃO. A tela Produtos responde "quanto do
 * estoque está livre, andando ou fora"; o detalhe de proposta/contrato/assinatura é a pergunta da
 * tela Venda, e repeti-lo aqui daria cinco colunas novas numa tela que serve para outra coisa.
 *
 * ⚠️ É O MESMO AGRUPAMENTO DE `baldeDaSituacao` (`situacao-da-unidade.ts`), que é quem as telas
 * devem chamar. As rotas de Produtos (`app/api/incorporador/produtos/route.ts` e `./painel`) ainda
 * chamam esta para separar a negociação dentro do vendido, o que `baldeDaSituacao` já faz: quando
 * elas deixarem de chamá-la, esta sai também.
 */
export function baldeDaEtapa(etapa: EtapaDoEspelho): BaldeDoProduto {
  switch (etapa) {
    case "assinatura":
    case "contrato":
    case "proposta":
      return "negociacao";
    case "bloqueada":
      return "bloqueado";
    // ⚠️ EM CANCELAMENTO É VENDIDO AQUI, E NUNCA DISPONÍVEL. Enquanto o jurídico não desfaz, o
    // contrato existe e o lote tem dono: o `default` desta função devolve `disponivel`, e sem este
    // caso a tela Produtos contaria como estoque livre um lote que a trava recusa vender.
    case "em_cancelamento":
    case "faturado":
    case "vendida":
      return "vendido";
    case "reservada":
    case "reservado":
      return "reservado";
    default:
      return "disponivel";
  }
}
