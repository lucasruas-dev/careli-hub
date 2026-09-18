// PLANOS COMERCIAIS DO TEMIS — a camada de dados.
//
// Pedido do Lucas (01/09/2026): *"vamos fazer tudo no panteon, vou cadastrar os planos dentro do
// panteon"*, e antes disso a regra que dá sentido ao módulo inteiro: *"o que define qual minuta
// usar é o plano de pagamento. na prática é a unidade x foi vendida no plano a, ae o contrato que
// vai ser gerado é do plano"*.
//
// A cadeia é: empreendimento → categoria (opcional) → plano → minuta.
//
// ⚠️ OS CAMPOS SÃO OS DE `lib/apolo/planos-comerciais.ts`, e a conversão para lá é feita por
// `paraCalculo` aqui embaixo. Aquele módulo calcula parcela e sinal com 27 testes medidos contra
// nove empreendimentos reais; manter dois formatos e traduzir na mão em cada leitura é como o
// número muda sem ninguém ver.
//
// ⚠️ `entradaPercentual` é 0 a 100, NUNCA fração. O banco tem CHECK, mas a checagem aqui existe
// para a mensagem ser útil: "20 significa 20%" resolve mais rápido que um erro de constraint.
import {
  calcularParcela,
  INDICES as ROTULOS_DE_INDICE,
  type NaturezaDaParcela,
  type PlanoComercial,
  type SlotDaPa,
} from "@/lib/apolo/planos-comerciais";
import { descontoDoPlano } from "@/lib/hercules/ajuste-de-preco";
import { temAnuaisCadastradas } from "@/lib/hercules/simulacao";
import { conferenciaDoPlano } from "@/lib/hercules/tabela-do-lote";

export type PlanoDoTemis = {
  /**
   * As anuais do plano (0138), quando ele tem. Nulo = sem anual. Andam em par.
   *
   * ⚠️ A ABA DE PLANOS DO APOLO PASSOU A LER (18/09/2026). Ela confere o plano contra o preço de uma
   * unidade, e sem as anuais a conferência do Investidor Parcelado do Garden anunciava R$ 4.383,14
   * enquanto a Mesa dizia outro número. Opcional no tipo porque quem monta um `PlanoDoTemis` à mão
   * (a prévia da tela, os testes) não precisa inventar o campo.
   */
  anuaisQuantidade?: null | number;
  anuaisValor?: null | number;
  ativo: boolean;
  categoriaId: null | string;
  categoriaNome: null | string;
  criadoEm: string;
  /**
   * O desconto do plano sobre o preço de tabela, 0 a menos de 100 (migration 0178). Zero = sem
   * desconto.
   *
   * ⚠️ OPCIONAL NO TIPO pelo mesmo motivo da ressalva: sem a 0178 a leitura volta sem a coluna, e
   * quem monta um `PlanoDoTemis` à mão (a prévia da tela, os testes) não precisa inventar o campo.
   */
  descontoPercentual?: null | number;
  entradaPercentual: number;
  id: string;
  indiceCorrecao: string;
  jurosConvencao: string;
  jurosPeriodicidade: string;
  jurosTaxa: null | number;
  /** A minuta que este plano usa. Nula = plano ainda não gera contrato. */
  minutaId: null | string;
  minutaNome: null | string;
  nome: string;
  observacao: null | string;
  ordem: number;
  parcelas: number;
  /**
   * A condição de disponibilidade ("válido para as próximas 16 unidades"), a etiqueta âmbar ao lado
   * do nome. Nulo = sem ressalva. Ver `limparRessalva` e a migration 0168.
   *
   * ⚠️ OPCIONAL NO TIPO, E NÃO SÓ NO BANCO: enquanto a 0168 não roda, a leitura volta sem a coluna,
   * e quem monta um `PlanoDoTemis` à mão (a prévia da tela, os testes) não precisa inventar o campo.
   */
  ressalva?: null | string;
  sistemaAmortizacao: string;
  slot: null | string;
};

export type CategoriaDoTemis = {
  ativa: boolean;
  id: string;
  nome: string;
  ordem: number;
  /** Quantos planos pendem dela. A tela avisa antes de deixar apagar. */
  planos: number;
};

/** O que a tela manda ao criar ou editar. */
export type EntradaDePlano = {
  ativo?: boolean;
  categoriaId?: null | string;
  /**
   * O desconto do plano sobre a tabela, em percentual (8 = 8%). Ver a migration 0178.
   *
   * ⚠️ AUSENTE ≠ NULO, como na ressalva. Ausente = quem chamou não fala de desconto (a rota não
   * toca na coluna); nulo ou zero = plano sem desconto. É o que deixa um cliente antigo salvar o
   * plano sem apagar o desconto que outra pessoa cadastrou, e o que deixa salvar plano enquanto a
   * 0178 não roda.
   */
  descontoPercentual?: null | number;
  entradaPercentual: number;
  indiceCorrecao: string;
  jurosConvencao?: string;
  jurosPeriodicidade?: string;
  jurosTaxa: null | number;
  minutaId?: null | string;
  nome: string;
  observacao?: null | string;
  ordem?: number;
  parcelas: number;
  /**
   * ⚠️ AUSENTE ≠ NULO. Ausente = quem chamou não fala de ressalva (a rota não toca na coluna);
   * nulo ou vazio = apagar a ressalva. É o que deixa um cliente antigo, que não conhece o campo,
   * salvar o plano sem apagar a etiqueta que outra pessoa escreveu.
   */
  ressalva?: null | string;
  sistemaAmortizacao: string;
  slot?: null | string;
};

/**
 * O tamanho máximo da ressalva. É uma ETIQUETA ao lado do nome, não uma observação: a frase do
 * Garden tem 36 caracteres. O CHECK da migration 0168 usa o mesmo número.
 */
export const RESSALVA_MAXIMA = 80;

/**
 * A ressalva como ela deve ser gravada: aparada, com os espaços repetidos colapsados, e vazio
 * virando nulo.
 *
 * ⚠️ VAZIO VIRA NULO PORQUE A ETIQUETA É DESENHADA QUANDO HÁ TEXTO. Um "  " gravado desenharia um
 * chip âmbar sem nada dentro, na lista do Apolo e no portal do incorporador. `\s` do JavaScript já
 * cobre o espaço não separável (U+00A0) que chega colado de planilha.
 */
export function limparRessalva(valor: unknown): null | string {
  if (typeof valor !== "string") return null;
  const limpa = valor.replace(/\s+/g, " ").trim();
  return limpa ? limpa : null;
}

/**
 * O erro do Supabase é "a coluna `ressalva` ainda não existe" (migration 0168 pendente)?
 *
 * ⚠️ SÓ PARA ESTA COLUNA, e pelo nome dela na mensagem. `42703` (Postgres) e `PGRST204` (schema
 * cache do PostgREST) dizem "coluna não existe" para QUALQUER coluna: engolir os dois sem olhar o
 * nome faria um erro de digitação em outra coluna do select virar, calado, uma tela sem ressalva.
 * É a mesma cautela de `tabela-ausente.ts` com o `42703`.
 */
export function ehColunaDaRessalvaAusente(erro: unknown): boolean {
  return ehColunaAusente(erro, "ressalva");
}

/**
 * O erro do Supabase é "a coluna `desconto_percentual` ainda não existe" (migration 0178 pendente)?
 *
 * ⚠️ A MESMA CAUTELA DA RESSALVA: só esta coluna, pelo nome dela na mensagem. O código sobe antes
 * da 0178, e a Mesa, o espelho, o portal e a aba de planos repetem a leitura sem o desconto (plano
 * sem desconto, que é o que todo plano era até ela) em vez de cair.
 */
export function ehColunaDoDescontoAusente(erro: unknown): boolean {
  return ehColunaAusente(erro, "desconto_percentual");
}

/** `42703` (Postgres) ou `PGRST204` (schema cache do PostgREST) citando ESTA coluna. */
function ehColunaAusente(erro: unknown, coluna: string): boolean {
  if (!erro || typeof erro !== "object") return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  const mensagem = typeof message === "string" ? message.toLowerCase() : "";
  const codigoDeColuna = code === "42703" || code === "PGRST204";
  return codigoDeColuna && mensagem.includes(coluna);
}

/**
 * O desconto como ele deve ser gravado: número de 0 a menos de 100, com nulo e vazio virando zero.
 *
 * ⚠️ ZERO, E NÃO NULO: a coluna da 0178 é `not null default 0`, e "sem desconto" tem um número só.
 * Quem confere a faixa é `conferirPlano`; aqui o valor já chega aprovado.
 */
export function descontoParaGravar(valor: unknown): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** O maior desconto que um plano aceita, exclusive: 100% não é desconto, é lote de graça. */
export const DESCONTO_MAXIMO = 100;

/**
 * ⚠️ DERIVADA, E NAO COPIADA. Ate 13/09/2026 esta lista era escrita a mao aqui, e era uma de CINCO
 * copias da mesma verdade no repo (mais o CHECK do banco). Elas ja discordavam entre si. A fonte e
 * a tabela `temis_indices` (migration 0154); `INDICES` em `planos-comerciais.ts` e o espelho dela
 * em tempo de compilacao, e e dele que esta lista sai agora.
 */
const INDICES = new Set(Object.keys(ROTULOS_DE_INDICE));
const SISTEMAS = new Set(["price", "sac", "sacoc"]);
const SLOTS = new Set(["avista", "curto", "investidor", "normal"]);
const PERIODICIDADES = new Set(["anual", "mensal"]);
const CONVENCOES = new Set(["equivalente", "proporcional"]);

/**
 * Confere a entrada ANTES de tocar no banco, para a tela poder dizer o que está errado.
 *
 * Devolve a lista de problemas em português. Vazia = pode gravar.
 */
export function conferirPlano(entrada: EntradaDePlano): string[] {
  const problemas: string[] = [];

  if (!entrada.nome?.trim()) problemas.push("O plano precisa de um nome.");
  if (!Number.isInteger(entrada.parcelas) || entrada.parcelas <= 0) {
    problemas.push(
      "O número de parcelas precisa ser um inteiro maior que zero.",
    );
  }

  const entradaPct = Number(entrada.entradaPercentual);
  if (!Number.isFinite(entradaPct) || entradaPct < 0 || entradaPct > 100) {
    problemas.push(
      "A entrada é um percentual de 0 a 100 — 20 significa 20%, não 0,20.",
    );
  }

  if (entrada.jurosTaxa !== null && entrada.jurosTaxa !== undefined) {
    const j = Number(entrada.jurosTaxa);
    if (!Number.isFinite(j) || j < 0)
      problemas.push("A taxa de juros não pode ser negativa.");
    // ⚠️ 12 aqui significa 12% ao ano, não 1200%. O engano é o mesmo da entrada e custa caro:
    // uma taxa mil vezes maior passa despercebida na tela e explode no cálculo da parcela.
    if (Number.isFinite(j) && j > 100) {
      problemas.push(
        "A taxa parece alta demais — informe em percentual (12 = 12%).",
      );
    }
  }

  if (!INDICES.has(entrada.indiceCorrecao))
    problemas.push("Índice de correção desconhecido.");
  if (!SISTEMAS.has(entrada.sistemaAmortizacao))
    problemas.push("Sistema de amortização desconhecido.");
  if (entrada.slot && !SLOTS.has(entrada.slot))
    problemas.push("Posição na proposta desconhecida.");
  if (
    entrada.jurosPeriodicidade &&
    !PERIODICIDADES.has(entrada.jurosPeriodicidade)
  ) {
    problemas.push("Periodicidade dos juros deve ser anual ou mensal.");
  }
  if (entrada.jurosConvencao && !CONVENCOES.has(entrada.jurosConvencao)) {
    problemas.push("Convenção de juros deve ser equivalente ou proporcional.");
  }

  // ⚠️ O DESCONTO É PERCENTUAL, e o engano mais caro é o mesmo da entrada: 0,08 digitado como "8%"
  // vira oito centésimos de por cento e o plano sai sem desconto nenhum; 8 é 8%. 100 ou mais não é
  // desconto de plano, é lote de graça — o CHECK da 0178 recusa também.
  if (entrada.descontoPercentual !== undefined && entrada.descontoPercentual !== null) {
    const d = Number(entrada.descontoPercentual);
    if (!Number.isFinite(d) || d < 0 || d >= DESCONTO_MAXIMO) {
      problemas.push(
        "O desconto do plano é um percentual de 0 a menos de 100: 8 significa 8%.",
      );
    }
  }

  if (
    entrada.ressalva !== undefined &&
    entrada.ressalva !== null &&
    typeof entrada.ressalva !== "string"
  ) {
    problemas.push("A ressalva de disponibilidade precisa ser um texto.");
  }
  const ressalva = limparRessalva(entrada.ressalva);
  if (ressalva && ressalva.length > RESSALVA_MAXIMA) {
    problemas.push(
      `A ressalva de disponibilidade tem no máximo ${RESSALVA_MAXIMA} caracteres: ela aparece como etiqueta ao lado do nome do plano.`,
    );
  }

  return problemas;
}

/**
 * Converte o plano guardado para o formato que `lib/apolo/planos-comerciais.ts` calcula.
 *
 * ⚠️ É esta função que impede a duplicação de regra. Quem precisar de parcela, sinal ou natureza da
 * parcela passa por aqui e usa o módulo que já tem teste — nunca recalcula.
 */
export function paraCalculo(plano: PlanoDoTemis): PlanoComercial {
  return {
    entradaPercentual: plano.entradaPercentual,
    indiceCorrecao: plano.indiceCorrecao as PlanoComercial["indiceCorrecao"],
    jurosConvencao: plano.jurosConvencao as PlanoComercial["jurosConvencao"],
    jurosPeriodicidade:
      plano.jurosPeriodicidade as PlanoComercial["jurosPeriodicidade"],
    jurosTaxa: plano.jurosTaxa,
    nome: plano.nome,
    parcelas: plano.parcelas,
    sistemaAmortizacao:
      plano.sistemaAmortizacao as PlanoComercial["sistemaAmortizacao"],
    slot: (plano.slot as null | SlotDaPa) ?? null,
  };
}

/** O que a linha do plano (e a prévia do formulário) anuncia para uma unidade. */
export type ConferenciaNaUnidade = {
  /** As anuais que cabem no prazo. Zero e zero fora do plano com anuais cadastradas. */
  anuais: { quantidade: number; valor: number };
  /** O desconto do plano, já normalizado (0 quando não tem). */
  descontoPercentual: number;
  /** O sinal, em reais. */
  entrada: number;
  naturezaDaParcela: NaturezaDaParcela;
  parcela: number;
  parcelas: number;
  /** A tabela com o desconto do plano (a própria tabela quando não há desconto). */
  precoDoPlano: number;
};

/**
 * O plano do cadastro conferido contra o preço de uma unidade.
 *
 * Lucas (18/09/2026): *"tem que ser igual o mmendes"*. A aba de planos do Apolo conferia o plano com
 * `calcularParcela`, que não conhece anual nem desconto: no Investidor Parcelado do Garden, lote de
 * R$ 435.000, ela anunciava R$ 4.383,14 enquanto a Mesa dizia R$ 3.192,67. No plano com anuais
 * CADASTRADAS ou com desconto (hoje, os três do Garden), a conta é a da Mesa, `conferenciaDoPlano`
 * (`lib/hercules/tabela-do-lote.ts`): desconto do plano, entrada com o piso do empreendimento,
 * anuais que cabem no prazo e a parcela de `montarProposta`.
 *
 * ⚠️ NO RESTO, `calcularParcela`, A CONTA DE SEMPRE (Lucas, 18/09/2026, sobre a mudança de conta
 * desta rodada: *"So no Garden"*). A primeira versão usava a conta da Mesa em todo plano, e mudou o
 * número da aba em 19 dos 40 planos de fora do Garden (revisão de 18/09/2026): o sinal passou a ter
 * o piso do empreendimento e a ser arredondado para cima no real (no Investidor do 20, de R$ 0,00
 * para R$ 9.290,00; no INVESTIDOR do 19, de R$ 21.306,40 para R$ 21.307,00). A conta da Mesa
 * concorda com o que a Mesa vende; levá-la para os outros empreendimentos é decisão do Lucas.
 *
 * ⚠️ UMA FUNÇÃO SÓ PARA A LINHA DO PLANO E PARA A PRÉVIA DO FORMULÁRIO, e fora do componente para o
 * teste alcançar a conta que a tela faz. Preço nulo (campo vazio) = nada a conferir.
 */
export function conferirNaUnidade(
  plano: PlanoDoTemis,
  preco: null | number,
  entradaMinimaPercentual: null | number,
): ConferenciaNaUnidade | null {
  if (preco === null) return null;
  const doCadastro = {
    ...paraCalculo(plano),
    anuaisQuantidade: plano.anuaisQuantidade ?? null,
    anuaisValor: plano.anuaisValor ?? null,
    descontoPercentual: plano.descontoPercentual ?? null,
  };

  // O MESMO critério da conta do Garden em toda a casa: as anuais cadastradas no plano
  // (`temAnuaisCadastradas`) e, aqui, também o desconto do plano, que só o Garden tem.
  if (temAnuaisCadastradas(doCadastro) || descontoDoPlano(doCadastro.descontoPercentual) > 0) {
    return conferenciaDoPlano({ entradaMinimaPercentual, plano: doCadastro, precoDeTabela: preco });
  }

  const deSempre = calcularParcela(doCadastro, preco);
  // Com preço, `calcularParcela` sempre devolve sinal e parcela; nulo aqui é a linha que a aba não
  // mostrava, e continua sem mostrar.
  if (deSempre.sinal === null || deSempre.parcela === null) return null;
  return {
    anuais: { quantidade: 0, valor: 0 },
    descontoPercentual: 0,
    entrada: deSempre.sinal,
    naturezaDaParcela: deSempre.naturezaDaParcela,
    parcela: deSempre.parcela,
    parcelas: deSempre.parcelas,
    precoDoPlano: preco,
  };
}

/**
 * O plano que uma venda deve usar, dado o empreendimento e o plano escolhido.
 *
 * ⚠️ NÃO ESCOLHE POR APROXIMAÇÃO. Se o plano não estiver na lista, devolve null e a venda não
 * acontece — melhor travar que gerar contrato com o plano errado. Foi a regra que o Lucas definiu
 * para a cadeia inteira: sem combinação, não gera.
 */
export function acharPlano(
  planos: PlanoDoTemis[],
  planoId: string,
): null | PlanoDoTemis {
  return planos.find((p) => p.id === planoId && p.ativo) ?? null;
}

/**
 * Os planos prontos para gerar contrato, e os que ainda não estão.
 *
 * A tela usa isto para mostrar o que falta antes de o empreendimento poder vender: plano sem minuta
 * é plano que trava a venda no último passo, e é melhor o operador saber disso no cadastro.
 */
export function separarPorProntidao(planos: PlanoDoTemis[]): {
  prontos: PlanoDoTemis[];
  semMinuta: PlanoDoTemis[];
} {
  const ativos = planos.filter((p) => p.ativo);
  return {
    prontos: ativos.filter((p) => p.minutaId),
    semMinuta: ativos.filter((p) => !p.minutaId),
  };
}

/**
 * Rótulo curto do índice, para a tabela.
 *
 * ⚠️ O MAPA SAIU DAQUI (13/09/2026): ele era a segunda cópia dos mesmos textos, e o código
 * desconhecido caía no `?? indice`, imprimindo `POUPANCA` em maiúsculas para o operador. Agora sai
 * da lista única, e o fallback continua existindo só para o dia em que a tabela tiver um código que
 * o build ainda não conhece.
 */
export function rotuloDoIndice(indice: string): string {
  return ROTULOS_DE_INDICE[indice as keyof typeof ROTULOS_DE_INDICE] ?? indice;
}

/**
 * Rótulo da tabela de amortização, com o que ela significa para a parcela.
 *
 * ⚠️ "TABELA", E NÃO "SISTEMA" (Lucas, 08/09/2026: *"aproveita e troca, em vez de sistema,
 * tabela"*). É a palavra do contrato — o do Aldeia escreve "TABELA PRICE – SISTEMA FRANCÊS DE
 * AMORTIZAÇÃO" — e é a que o corretor usa na frente do cliente. A coluna do banco continua
 * `sistema_amortizacao`: renomeá-la mexeria em migration, rota e três telas para trocar uma palavra
 * que só aparece para gente.
 */
export function rotuloDoSistema(sistema: string): string {
  const mapa: Record<string, string> = {
    price: "Tabela Price — parcela fixa",
    sac: "Tabela SAC — parcela decrescente",
    sacoc: "Tabela SACOC — amortização pura",
  };
  return mapa[sistema] ?? sistema;
}

/** Onde o plano aparece na folha da proposta. */
export function rotuloDoSlot(slot: null | string): string {
  if (!slot) return "não vai à proposta";
  const mapa: Record<string, string> = {
    avista: "À vista",
    curto: "Curto",
    investidor: "Investidor",
    normal: "Normal",
  };
  return mapa[slot] ?? slot;
}
