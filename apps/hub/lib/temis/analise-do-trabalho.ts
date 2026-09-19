// A ETAPA 1 DA TELA DE TRABALHO — o que o operador confere antes de abrir o contrato.
//
// Lucas (09/09/2026): *"na primeira etapa, acho que deveria trazer os dados dos proponentes,
// imobiliaria, a proposta"*.
//
// ⚠️ LEITURA PURA, E REUSA O QUE JÁ MONTA O CONTRATO. `dadosDaProposta` é a mesma função que
// alimenta a geração do documento (`lib/temis/dados-do-contrato.ts`) — ela lê seis tabelas do
// Apolo e quatro do Hércules e devolve os valores já formatados para papel. Montar aqui uma
// segunda leitura dos mesmos dados criaria duas versões da verdade: a tela diria uma coisa e o
// contrato sairia com outra, e a divergência só apareceria no papel assinado.
//
// ⚠️ E NÃO PASSA PELA MINUTA. `montarContratoDaProposta` é a camada acima, que exige minuta
// publicada e responde 409 sem ela. A etapa 1 tem de funcionar ANTES de existir minuta: é
// justamente onde se descobre que falta uma.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CarteiraDaVenda } from "@/lib/apolo/carteira-da-venda";
import { dataBr, dinheiro } from "@/lib/apolo/extrato-cliente";

import type { ComercialDaAnalise } from "./comercial-da-analise";

import { comercialDaProposta } from "./comercial-da-analise";
import {
  CARTEIRA_AINDA_SEM_A_VENDA,
  dadosDaProposta,
  SEM_LANCAMENTOS_NA_CARTEIRA,
  semValorNaCarteira,
} from "./dados-do-contrato";

/** Um campo como a tela mostra: rótulo humano, valor, e se está faltando. */
export type CampoDaAnalise = {
  /** `true` quando o dado não existe no cadastro. A tela pinta como pendência. */
  faltando: boolean;
  rotulo: string;
  valor: string;
};

export type ProponenteDaAnalise = {
  campos: CampoDaAnalise[];
  conjuge: CampoDaAnalise[] | null;
  /** O nome no topo do bloco. "Sem nome" quando o cadastro não tem. */
  nome: string;
};

export type AnaliseDoTrabalho = {
  /** Os avisos que `dadosDaProposta` já produz — lacunas que impedem o contrato. */
  avisos: string[];
  /**
   * A proposta comercial: os números grandes e o fluxo de pagamento combinado.
   *
   * `null` quando a proposta não tem cronograma gravado — as 4.857 importadas do C2X nasceram sem
   * `condicoes`. A tela diz isso, em vez de desenhar uma tabela de zeros.
   */
  comercial: ComercialDaAnalise | null;
  /**
   * De onde saiu o financeiro do bloco "A proposta" na venda IMPORTADA sem cronograma: a carteira do
   * Apolo, e só ela. `null` na nativa e em toda venda que tem `comercial`.
   *
   * Lucas (18/09/2026): *"a única coisa que vamos utilizar o c2x é a questão financeira, mesmo assim
   * ela tem que morar dentro da carteira no apolo"*. `texto` é a frase que a tela põe no topo do
   * bloco, e diz a fonte em todos os casos — inclusive quando a carteira ainda não tem a venda.
   */
  financeiro: FinanceiroDaAnalise | null;
  imobiliaria: CampoDaAnalise[];
  proponentes: ProponenteDaAnalise[];
  /**
   * O dinheiro combinado em texto — RESERVA de `comercial`, e não um segundo lugar para o mesmo
   * número. A tela mostra este bloco só quando `comercial` é `null` (proposta importada, sem
   * cronograma gravado): sem ele, essas vendas ficariam sem valor nenhum na tela.
   */
  proposta: CampoDaAnalise[];
  /** Onde é: empreendimento, quadra, lote, área e matrícula. Independe do cronograma. */
  unidade: CampoDaAnalise[];
};

export type FinanceiroDaAnalise = {
  fonte: "carteira_do_apolo";
  situacao: "erro" | "nunca_sincronizada" | "ok" | "sem_parcela";
  texto: string;
};

/**
 * ⚠️ CHAVE AUSENTE É PENDÊNCIA, E NÃO CAMPO VAZIO. `dadosDaProposta` segue a regra "chave sem
 * valor não entra" — não há string vazia, há chave que não existe. Renderizar isso como campo em
 * branco esconderia a falta; a etapa 1 existe para MOSTRAR o que falta, então a ausência vira uma
 * linha marcada, com o rótulo do que deveria estar ali.
 */
function campo(
  valores: Record<string, string>,
  chave: string,
  rotulo: string,
): CampoDaAnalise {
  const valor = String(valores[chave] ?? "").trim();
  return { faltando: !valor, rotulo, valor: valor || "não informado" };
}

/** Pessoa física e jurídica têm qualificações diferentes; o bloco segue a flag do dado. */
function camposDoProponente(comprador: {
  ehCasado?: boolean;
  ehPessoaFisica: boolean;
  valores: Record<string, string>;
}): CampoDaAnalise[] {
  const v = comprador.valores;

  if (!comprador.ehPessoaFisica) {
    return [
      campo(v, "razao_social_cliente", "Razão social"),
      campo(v, "nome_fantasia_cliente", "Nome fantasia"),
      campo(v, "cnpj_cliente", "CNPJ"),
      campo(v, "email_cliente", "E-mail"),
      campo(v, "rua_cliente", "Rua"),
      campo(v, "numero_cliente", "Número"),
      campo(v, "bairro_cliente", "Bairro"),
      campo(v, "cep_cliente", "CEP"),
      campo(v, "percentual_cliente", "Participação"),
    ];
  }

  return [
    campo(v, "cpf_cliente", "CPF"),
    // ⚠️ NÃO trocar por `identificacao_cliente`: aquela chave é o PAPEL na venda, e sai como
    // o literal "COMPRADOR" para todo mundo (dados-do-contrato.ts, `por("identificacao_cliente",
    // "COMPRADOR")`). O RG é este, montado como "número + órgão" — e só quando o número existe,
    // porque o órgão sozinho imprimia "cédula de identidade nº SSP/MG".
    //
    // ⚠️ E ELE SÓ APARECE QUANDO EXISTE. Lucas (18/09/2026): *"rg não precisa"*. Como linha marcada
    // "não informado" ele pintava de pendência quase toda CAD pública, que nunca pediu o número.
    ...(String(v.rg_cliente ?? "").trim() ? [campo(v, "rg_cliente", "RG")] : []),
    campo(v, "data_nascimento_cliente", "Nascimento"),
    campo(v, "estado_civil_cliente", "Estado civil"),
    // ⚠️ O REGIME SÓ É PENDÊNCIA DE QUEM É CASADO. Como linha "não informado" ele pintava de pendência
    // o solteiro: medido em 18/09/2026, 7 dos 10 cards em análise, e era a única pendência que sobrava
    // no bloco deles. É a regra de `conferir` (dados-do-contrato.ts), que não avisa regime de solteiro,
    // e a do contrato: sem estado civil `ehCasado` é indefinido, a cláusula do regime fica no papel, e
    // a linha fica aqui também. Com valor, ela aparece sempre.
    ...(comprador.ehCasado !== false || String(v.regime_casamento_cliente ?? "").trim()
      ? [campo(v, "regime_casamento_cliente", "Regime de bens")]
      : []),
    campo(v, "nacionalidade_cliente", "Nacionalidade"),
    campo(v, "email_cliente", "E-mail"),
    campo(v, "telefone_cliente", "Telefone"),
    campo(v, "rua_cliente", "Rua"),
    campo(v, "numero_cliente", "Número"),
    campo(v, "bairro_cliente", "Bairro"),
    campo(v, "cep_cliente", "CEP"),
    campo(v, "percentual_cliente", "Participação"),
  ];
}

/**
 * ⚠️ O CÔNJUGE SÓ APARECE QUANDO EXISTE, e `temConjuge` é quem decide — não a presença do nome.
 * A distinção importa: `ehCasado` indefinido NÃO é "não casado" (a regra está em
 * `preencher-contrato.ts`), e um bloco de cônjuge vazio num contrato de solteiro é exatamente o
 * tipo de campo que alguém preenche à mão sem perceber.
 */
function camposDoConjuge(comprador: {
  temConjuge: boolean;
  valores: Record<string, string>;
}): CampoDaAnalise[] | null {
  if (!comprador.temConjuge) return null;
  const v = comprador.valores;
  return [
    campo(v, "nome_conjuge", "Nome"),
    campo(v, "cpf_conjuge", "CPF"),
    campo(v, "email_conjuge", "E-mail"),
    campo(v, "telefone_conjuge", "Telefone"),
    campo(v, "profissao_conjuge", "Profissão"),
    campo(v, "nacionalidade_conjuge", "Nacionalidade"),
  ];
}

/**
 * A frase do topo do bloco "A proposta" da venda importada. `null` quando não há o que dizer (a venda
 * é nativa).
 *
 * ⚠️ A FONTE É DITA SEMPRE, até quando não há número: a frase diz onde o financeiro mora e por que
 * ele não está aqui; "não informado" dizia que alguém esqueceu. E cada frase só afirma o que se sabe
 * (ver `semValorNaCarteira`): "sem lançamentos" é só da carteira da venda sincronizada e vazia.
 */
export function financeiroDaCarteira(carteira: CarteiraDaVenda | null): FinanceiroDaAnalise | null {
  if (!carteira || carteira.situacao === "nativa") return null;

  if (carteira.situacao === "ok") {
    return {
      fonte: "carteira_do_apolo",
      situacao: "ok",
      texto: `Venda importada do C2X. Entrada, parcelas, pago e em aberto vêm da carteira do Apolo, sincronizada em ${dataBr(carteira.sincronizadaEm)}.`,
    };
  }
  if (carteira.situacao === "erro") {
    return {
      fonte: "carteira_do_apolo",
      situacao: "erro",
      texto:
        "Venda importada do C2X. Não consegui ler a carteira do Apolo desta venda agora: os valores dela ficaram de fora. Tente abrir de novo.",
    };
  }
  if (carteira.motivo === "sem_parcela") {
    const quando = carteira.sincronizadaEm ? `, sincronizada em ${dataBr(carteira.sincronizadaEm)}` : "";
    return {
      fonte: "carteira_do_apolo",
      situacao: "sem_parcela",
      texto: `Venda importada do C2X, ${SEM_LANCAMENTOS_NA_CARTEIRA}${quando}.`,
    };
  }
  // ⚠️ AQUI NÃO SE DIZ "SEM LANÇAMENTOS": a carteira do Apolo tem as parcelas da pessoa (o retrato
  // de `apolo_financial_snapshots`), e o que ainda não existe é a carteira separada por venda. Ver
  // `CARTEIRA_AINDA_SEM_A_VENDA`.
  return {
    fonte: "carteira_do_apolo",
    situacao: "nunca_sincronizada",
    texto: `Venda importada do C2X: ${CARTEIRA_AINDA_SEM_A_VENDA}, então entrada, parcelas, pago e em aberto não aparecem aqui.`,
  };
}

/**
 * O bloco "A proposta" da venda importada: o que a proposta tem, mais o financeiro da carteira.
 *
 * ⚠️ O QUE A CARTEIRA NÃO TEM NÃO VIRA "NÃO INFORMADO": vira a frase de onde ele deveria estar. E o
 * valor de venda, o plano, o prazo e o vencimento continuam saindo da proposta, porque são dela.
 */
function camposDaCarteira(
  g: Record<string, string>,
  carteira: CarteiraDaVenda | null,
): CampoDaAnalise[] {
  // ⚠️ A FRASE DEPENDE DA RAZÃO (ver `semValorNaCarteira`): leitura que falhou não vira "sem
  // lançamentos", e a carteira que ainda não separa a venda também não.
  const semLancamento = (rotulo: string): CampoDaAnalise => ({
    faltando: true,
    rotulo,
    valor: semValorNaCarteira(carteira),
  });
  const daProposta = [campo(g, "preco_venda", "Valor da venda"), campo(g, "plano_nome", "Plano")];
  const prazo = String(g.prazo_meses_amortizacao ?? "").trim()
    ? campo(g, "prazo_meses_amortizacao", "Parcelas")
    : semLancamento("Parcelas");
  const vencimento = campo(g, "dia_vencimento", "Vencimento");

  if (carteira?.situacao !== "ok") {
    return [
      ...daProposta,
      semLancamento("Entrada"),
      semLancamento("A financiar"),
      prazo,
      vencimento,
    ];
  }

  const { porTipo } = carteira;
  const vezes = (n: number, uma: string, varias: string) => `${n} ${n === 1 ? uma : varias}`;
  const comEntrada = porTipo.ato.quantidade + porTipo.sinal.quantidade;
  const pago = Object.values(porTipo).reduce((t, p) => t + p.pago, 0);
  const aberto = Object.values(porTipo).reduce((t, p) => t + p.aberto, 0);
  const vencido = Object.values(porTipo).reduce((t, p) => t + p.vencido, 0);
  const { totais } = carteira.relatorio;

  const campos: CampoDaAnalise[] = [
    ...daProposta,
    comEntrada > 0
      ? {
          faltando: false,
          rotulo: "Entrada",
          valor: `${dinheiro(carteira.entrada)} · ${[
            porTipo.ato.quantidade ? vezes(porTipo.ato.quantidade, "ato", "atos") : "",
            porTipo.sinal.quantidade ? vezes(porTipo.sinal.quantidade, "sinal", "sinais") : "",
          ]
            .filter(Boolean)
            .join(" + ")}`,
        }
      : semLancamento("Entrada"),
    porTipo.mensal.quantidade > 0
      ? {
          faltando: false,
          rotulo: "Mensais",
          valor: `${porTipo.mensal.quantidade} de ${dinheiro(carteira.mensalidade)}`,
        }
      : semLancamento("Mensais"),
  ];

  // Só entra quando existe: "Anuais e reforços: 0" faz quem lê procurar do que se trata.
  if (porTipo.reforco.quantidade > 0) {
    campos.push({
      faltando: false,
      rotulo: "Anuais e reforços",
      valor: `${porTipo.reforco.quantidade}, somando ${dinheiro(porTipo.reforco.valorContratual)}`,
    });
  }

  campos.push(
    porTipo.mensal.quantidade + porTipo.reforco.quantidade > 0
      ? { faltando: false, rotulo: "A financiar", valor: dinheiro(carteira.financiado) }
      : semLancamento("A financiar"),
    prazo,
    vencimento,
    {
      faltando: false,
      rotulo: "Pago até hoje",
      // ⚠️ O PAGO É O QUE ENTROU (`realizados`), e não o saldo a valor de hoje: num distrato é o
      // número da devolução.
      valor:
        totais.parcelasPagas > 0
          ? `${dinheiro(pago)} · ${vezes(totais.parcelasPagas, "parcela", "parcelas")}`
          : "nada pago",
    },
    {
      faltando: false,
      rotulo: "Em aberto",
      valor: carteira.relatorio.contrato.encerrado
        ? "contrato encerrado, sem saldo em aberto"
        : `${dinheiro(aberto)} · ${vezes(totais.parcelasAbertas, "parcela", "parcelas")}${
            vencido > 0 ? `, ${dinheiro(vencido)} vencidos` : ""
          }`,
    },
  );

  return campos;
}

/**
 * Os três blocos da etapa 1, prontos para a tela.
 *
 * `null` quando a proposta não existe — o card sem `proposta_id` (os antigos, nascidos antes da
 * migration 0134) cai aqui, e a tela mostra "sem venda ligada" em vez de blocos vazios.
 */
export async function analiseDoTrabalho(
  sb: SupabaseClient,
  propostaId: string,
): Promise<AnaliseDoTrabalho | null> {
  const montado = await dadosDaProposta(propostaId, sb);
  if (!montado) return null;

  const { avisos, carteira, dados } = montado;
  const g = dados.gerais;

  // ⚠️ EM PARALELO NÃO, DE PROPÓSITO — `dadosDaProposta` já decidiu se a proposta existe. Buscar o
  // comercial antes disso gastaria duas consultas em todo card sem venda ligada.
  const comercial = await comercialDaProposta(sb, propostaId);

  // ⚠️ A CARTEIRA SÓ FALA QUANDO NÃO HÁ CRONOGRAMA. Com `comercial`, o bloco é o cronograma que o
  // comprador leu; a carteira não o substitui.
  const financeiro = comercial ? null : financeiroDaCarteira(carteira);

  return {
    avisos,
    comercial,
    financeiro,
    // ⚠️ SEM COMISSÃO AQUI. `gerais` traz `percentual_comissao_*` e `valor_total_comissao`, que
    // são política comercial — a etapa 1 confere QUEM vendeu, não QUANTO se paga a quem.
    imobiliaria: [
      campo(g, "imobiliaria_nome", "Imobiliária"),
      campo(g, "corretor_nome", "Corretor"),
      // ⚠️ A COORDENADORA É DO EMPREENDIMENTO, NÃO DA PROPOSTA. Ela vem de
      // `apolo_enterprise_settings.coordenadora_entity_id` (migration 0145) e é a terceira ponta
      // do processo de venda: coordena a imobiliária, recebe a sua parte da comissão e entra no
      // contrato com CNPJ e endereço próprios (bloco "a." da minuta).
      //
      // ⚠️ ELA É "COORDENADORA DE VENDAS", E NUNCA "INTERVENIENTE". Este comentário já disse
      // interveniente, e essa palavra sozinha fez nascer um SÉTIMO papel na fila de assinatura que
      // nenhuma minuta citava — removido em 13/09/2026 a pedido do Lucas. No texto do contrato ela
      // é COORDENADORA DE VENDAS e, junto com o corretor, INTERMEDIADORA. Ver o bloco de
      // corretagem em `lib/temis/blocos-prontos.ts`.
      //
      // ⚠️ E É A MESMA CHAVE QUE O CONTRATO IMPRIME. Ler daqui garante que a tela e o papel
      // dizem o mesmo nome; um segundo caminho até a coordenadora seria uma segunda verdade.
      campo(g, "nome_fantasia_coordenadora_vendas", "Coordenadora"),
    ],
    proponentes: dados.compradores.map((c) => ({
      campos: camposDoProponente(c),
      conjuge: camposDoConjuge(c),
      nome: String(c.valores.nome_cliente ?? c.valores.razao_social_cliente ?? "").trim() || "Sem nome",
    })),
    proposta: financeiro ? camposDaCarteira(g, carteira) : [
      campo(g, "preco_venda", "Valor da venda"),
      campo(g, "plano_nome", "Plano"),
      campo(g, "valor_entrada", "Entrada"),
      campo(g, "valor_divida_financiada", "A financiar"),
      campo(g, "prazo_meses_amortizacao", "Parcelas"),
      campo(g, "dia_vencimento", "Vencimento"),
    ],
    unidade: [
      campo(g, "empreendimento_nome", "Empreendimento"),
      campo(g, "unidade_quadra", "Quadra"),
      campo(g, "unidade_lote", "Lote"),
      campo(g, "area_lote", "Área"),
      campo(g, "numero_matricula", "Matrícula"),
    ],
  };
}
