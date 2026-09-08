import { casarTrecho } from "./casar-trecho";
import { acharVariavel, type VariavelDoContrato } from "./variaveis";

// O SUPER AGENTE DA MINUTA — lê o texto, entende como a Têmis monta um contrato, e propõe.
//
// Pedido do Lucas (07/09/2026): *"um super agente que consiga inserir as variáveis, olhar o texto e
// identificar onde as variáveis vão, e conhece todas as variáveis"*. E, no dia seguinte, vendo a
// primeira versão rodar, o escopo de verdade: *"ela precisa entender como eu coloco o comprador, a
// vendedora, as demais variáveis, ela tem que ler, interpretar e fazer"*, *"vindo colocando as
// quebras de páginas, inserir os negritos, os quadros quando precisar"*.
//
// Por isso uma proposta aqui não é só "este trecho é esta variável". São QUATRO coisas que o agente
// pode propor, e as três novas são o que separa "marcar variáveis" de "preparar a minuta":
//
//   variavel   o trecho vira `[nome]`                       (o CPF escrito vira [cpf_cliente])
//   envolver   o trecho entra num par de bloco              (a qualificação do cônjuge só sai
//                                                            quando há cônjuge — é assim que o
//                                                            comprador "se coloca" na Têmis)
//   quebra     uma quebra de página ANTES do trecho         (o contrato de corretagem começa em
//                                                            folha nova)
//   negrito    o trecho fica em negrito                     (títulos de cláusula que vieram do
//                                                            .docx sem marca nenhuma)
//
// ⚠️ O QUADRO NÃO ESTÁ NA LISTA, E É DE PROPÓSITO. Ele já existe como variável: `[tabela_geral_
// pagamentos]` é escrita pelo motor a partir do plano da venda. O agente propõe TROCAR o quadro
// datilografado pela variável — que é melhor do que redesenhar a tabela, porque o quadro passa a
// acompanhar o plano em vez de congelar os números do dia em que a minuta foi escrita.
//
// ⚠️ A IA PROPÕE, ELA NÃO REESCREVE. Esta é a decisão que sustenta tudo aqui, e ela é sobre o que
// pode dar errado num contrato:
//
//   Se a IA devolvesse o TEXTO REESCRITO, cada geração seria uma chance de ela mudar uma palavra do
//   instrumento — trocar "resolvido" por "rescindido", ajustar uma vírgula que muda quem paga o
//   ITBI, "melhorar" um parágrafo que o jurídico escolheu palavra por palavra. E ninguém iria
//   conferir 60 mil caracteres para achar a diferença. Pior: ela escreveria `[nome do cliente]` no
//   lugar de `[nome_cliente]`, que é exatamente como `[Nome]` e `[CPF]` entraram nas minutas
//   antigas e saíram impressos em contrato assinado.
//
//   Aqui ela devolve uma LISTA DE PROPOSTAS, cada uma apontando um trecho EXISTENTE do texto. O
//   texto jurídico é intocado; o que se aplica é uma operação com nome e limite. Toda proposta é
//   conferida contra o catálogo ANTES de existir na tela — proposta que não casa é descartada, não
//   corrigida.
//
// ⚠️ E O QUE ELA PROPÕE É REVERSÍVEL POR CONSTRUÇÃO: aplicar é uma edição pontual, o operador aceita
// uma a uma (ou todas de uma vez, sabendo que é isso que está fazendo), e o desfazer do editor
// desmancha. Nada entra na minuta sem alguém ter olhado.

/** O que a proposta manda fazer com o trecho. */
export type TipoDeProposta = "envolver" | "negrito" | "quebra" | "variavel";

/** Uma proposta da IA. */
export type Proposta = {
  /**
   * Um pedaço maior do texto, ÚNICO no documento, que contém o `trecho`.
   *
   * ⚠️ É O QUE SALVA A MINUTA DE LACUNAS. A do Jardim das Gerais chega com o lugar do dado em branco
   * ("inscrito no CPF sob o n.º ________________"), e o trecho a trocar — a lacuna — aparece
   * dezenas de vezes. Sem o contexto, essas propostas seriam todas recusadas por ambiguidade; com
   * ele, a busca acha primeiro o contexto e depois a lacuna dentro dele. A substituição continua
   * sendo só do trecho.
   */
  contexto?: string;
  /** Por que a IA acha isso — aparece na tela, para o operador decidir em segundos. */
  motivo: string;
  /**
   * `variavel`: o nome da variável, sem colchetes.
   * `envolver`: o nome do PAR, sem `inicio_`/`fim_` (ex.: `dados_conjuge`, `cada_comprador`).
   * Os outros tipos ignoram.
   */
  nome?: string;
  /** Ausente vale `variavel` — é o formato que a primeira versão do agente devolvia. */
  tipo?: TipoDeProposta;
  /** O trecho EXATO do texto sobre o qual a proposta age. */
  trecho: string;
};

export type PropostaValidada = Proposta & {
  /** Onde o trecho termina no texto (exclusivo). */
  fim: number;
  nome: string;
  /** Onde o trecho começa no texto. */
  posicao: number;
  tipo: TipoDeProposta;
  /** Só existe no tipo `variavel`. */
  variavel?: VariavelDoContrato;
};

export type RecusaDeProposta = {
  motivo:
    | "fora_do_catalogo"
    | "ja_marcado"
    | "par_desconhecido"
    | "trecho_ambiguo"
    | "trecho_nao_encontrado";
  proposta: Proposta;
};

export type Triagem = {
  aceitas: PropostaValidada[];
  recusadas: RecusaDeProposta[];
};

const TIPOS: TipoDeProposta[] = ["envolver", "negrito", "quebra", "variavel"];

/**
 * O par de bloco existe no catálogo?
 *
 * ⚠️ OS DOIS LADOS TÊM DE EXISTIR. Um par com só o `inicio_` cadastrado abriria um bloco que nada
 * fecha — e o motor imprimiria daquele ponto até o fim do contrato o trecho que devia sumir. É o
 * defeito que `conferirBlocos` pega antes de publicar; aqui ele nem chega a nascer.
 */
function parDeBloco(nome: string): null | { fim: VariavelDoContrato; inicio: VariavelDoContrato } {
  const cru = nome.replace(/^(inicio|fim)_/, "");
  const inicio = acharVariavel(`inicio_${cru}`);
  const fim = acharVariavel(`fim_${cru}`);
  if (!inicio || !fim) return null;
  return { fim, inicio };
}

/**
 * Separa o que dá para aplicar do que não dá.
 *
 * ⚠️ AS RECUSAS SÃO O CORAÇÃO DA SEGURANÇA, e cada uma existe por um estrago diferente:
 *
 * - `fora_do_catalogo`: a IA inventou um nome. É o defeito mais provável de todos — o modelo vê
 *   "CPF do fiador" e propõe `[cpf_fiador]`, que não existe. Aplicar isso imprimiria `[cpf_fiador]`
 *   no contrato assinado.
 * - `par_desconhecido`: a IA quis envolver o trecho num bloco condicional que não existe. Mesmo
 *   estrago, com um agravante: um bloco aberto e não fechado vaza o trecho até o fim do documento.
 * - `trecho_nao_encontrado`: a IA "citou" um trecho que não está no texto (parafraseou, corrigiu uma
 *   palavra, inventou). Agir sobre o trecho aproximado mexeria no texto jurídico.
 * - `trecho_ambiguo`: o trecho aparece MAIS DE UMA VEZ. Num contrato com três compradores, "CPF
 *   n.º" aparece três vezes, e agir na primeira ocorrência marcaria a pessoa errada — em silêncio,
 *   porque o resultado parece certo.
 * - `ja_marcado`: o trecho já é uma variável. Marcar de novo produziria `[[nome_cliente]]`.
 *
 * ⚠️ O QUE NÃO É MAIS RECUSA: espaço duro do Word, espaço dobrado, aspas curvas e quebra de linha no
 * meio do trecho. Isso derrubava metade das propostas sem nenhum ganho de segurança — ver
 * `casar-trecho.ts`. Nenhuma delas muda uma letra do contrato.
 */
export function triarPropostas(texto: string, propostas: Proposta[]): Triagem {
  const aceitas: PropostaValidada[] = [];
  const recusadas: RecusaDeProposta[] = [];

  for (const proposta of propostas) {
    const tipo: TipoDeProposta = TIPOS.includes(proposta.tipo as TipoDeProposta)
      ? (proposta.tipo as TipoDeProposta)
      : "variavel";
    const nome = proposta.nome?.trim().replace(/^\[|\]$/g, "") ?? "";
    const trecho = proposta.trecho ?? "";

    let variavel: undefined | VariavelDoContrato;

    if (tipo === "variavel") {
      const achada = acharVariavel(nome);
      if (!achada) {
        recusadas.push({ motivo: "fora_do_catalogo", proposta });
        continue;
      }
      variavel = achada;
    }

    if (tipo === "envolver" && !parDeBloco(nome)) {
      recusadas.push({ motivo: "par_desconhecido", proposta });
      continue;
    }

    if (!trecho.trim()) {
      recusadas.push({ motivo: "trecho_nao_encontrado", proposta });
      continue;
    }

    // ⚠️ JÁ É VARIÁVEL NOSSA? `[nome_cliente]` proposto sobre `[nome_cliente]` daria
    // `[[nome_cliente]]`. Vale só para `variavel`: envolver ou pôr em negrito um trecho que contém
    // variável é legítimo.
    //
    // ⚠️ MAS COLCHETE NÃO É SINÔNIMO DE VARIÁVEL, e essa distinção salvou uma minuta inteira. A do
    // Aldeia da Cachoeira (Lucas, 08/09/2026) marca as LACUNAS com colchetes: `[NOME COMPLETO]`,
    // `[nacionalidade]`, `[estado civil e regime de bens]`, `[●]` — 51 delas. São exatamente os
    // lugares onde as nossas variáveis entram. Recusar tudo que está entre colchetes faria o agente
    // pular o documento todo e devolver zero proposta, sem nenhum sintoma além de um painel vazio.
    //
    // A pergunta certa não é "tem colchete?" e sim "esse nome existe no NOSSO catálogo?".
    if (tipo === "variavel") {
      const dentroDeColchetes = /^\[([A-Za-z0-9_]+)\]$/.exec(trecho.trim())?.[1];
      if (dentroDeColchetes && acharVariavel(dentroDeColchetes)) {
        recusadas.push({ motivo: "ja_marcado", proposta });
        continue;
      }
    }

    const achado = casarTrecho(texto, trecho, proposta.contexto);
    if (achado.situacao === "ambiguo") {
      recusadas.push({ motivo: "trecho_ambiguo", proposta });
      continue;
    }
    if (achado.situacao !== "achou") {
      recusadas.push({ motivo: "trecho_nao_encontrado", proposta });
      continue;
    }

    aceitas.push({
      ...proposta,
      fim: achado.casamento.fim,
      nome,
      posicao: achado.casamento.inicio,
      tipo,
      variavel,
    });
  }

  // Da última para a primeira: aplicar de trás para a frente mantém as posições das anteriores
  // válidas. Ordenar aqui poupa quem aplica de reordenar.
  aceitas.sort((a, b) => b.posicao - a.posicao);

  return { aceitas, recusadas };
}

/**
 * Aplica as propostas aceitas sobre o TEXTO, devolvendo o texto marcado.
 *
 * ⚠️ ESTA É A APLICAÇÃO EM TEXTO, e o editor não usa: lá a aplicação acontece no DOCUMENTO, para não
 * perder negrito, tabela e alinhamento (ver `modules/temis/plugins/achar-trecho.ts`). Esta serve à
 * conferência e aos testes — é onde se prova, em texto puro, que a operação faz o que diz.
 *
 * ⚠️ DE TRÁS PARA A FRENTE. Substituir da primeira para a última muda o comprimento do texto e
 * invalida todas as posições seguintes — o clássico. Como `triarPropostas` já ordena decrescente,
 * aqui é só percorrer.
 *
 * ⚠️ E SÓ APLICA O QUE FOI ESCOLHIDO. Recebe as aceitas que o operador aprovou, não a lista inteira:
 * o gesto de aceitar é dele, não do modelo.
 */
export function aplicarPropostas(texto: string, aceitas: PropostaValidada[]): string {
  let saida = texto;

  for (const p of [...aceitas].sort((a, b) => b.posicao - a.posicao)) {
    const alvo = saida.slice(p.posicao, p.fim);
    // Reconfere no texto ATUAL: se outra proposta já mexeu ali, esta não se aplica.
    if (alvo.trim() === "") continue;

    const antes = saida.slice(0, p.posicao);
    const depois = saida.slice(p.fim);

    switch (p.tipo) {
      case "envolver": {
        const cru = p.nome.replace(/^(inicio|fim)_/, "");
        saida = `${antes}[inicio_${cru}]${alvo}[fim_${cru}]${depois}`;
        break;
      }
      // ⚠️ NEGRITO NÃO EXISTE EM TEXTO PURO. No editor ele é uma marca no nó; aqui não há onde
      // guardá-lo, e inventar `**` viraria asterisco impresso no contrato. A proposta é registrada,
      // aplicada no documento, e ignorada nesta conversão.
      case "negrito":
        break;
      case "quebra":
        saida = `${antes}\n${alvo}${depois}`;
        break;
      default:
        saida = `${antes}[${p.nome}]${depois}`;
    }
  }

  return saida;
}

/** O que a proposta vai fazer, em português, para a tela. */
export function descreverProposta(p: { nome?: string; tipo?: TipoDeProposta }): string {
  switch (p.tipo) {
    case "envolver":
      return `Envolver no bloco [inicio_${(p.nome ?? "").replace(/^(inicio|fim)_/, "")}]`;
    case "negrito":
      return "Pôr em negrito";
    case "quebra":
      return "Quebra de página antes deste trecho";
    default:
      return `Marcar como [${p.nome ?? ""}]`;
  }
}

/** O texto da recusa, para a tela dizer por que aquela proposta não entrou. */
export function motivoDaRecusa(recusa: RecusaDeProposta): string {
  switch (recusa.motivo) {
    case "fora_do_catalogo":
      return `"${recusa.proposta.nome}" não existe no catálogo — o Panteon não saberia preencher.`;
    case "ja_marcado":
      return "Esse trecho já é uma variável.";
    case "par_desconhecido":
      return `Não existe o par de bloco "${recusa.proposta.nome}" (precisa de inicio_ e fim_).`;
    case "trecho_ambiguo":
      return `"${cortar(recusa.proposta.trecho)}" aparece mais de uma vez no texto: não dá para saber qual.`;
    default:
      return `"${cortar(recusa.proposta.trecho)}" não foi encontrado no texto.`;
  }
}

function cortar(t: string): string {
  const limpo = (t ?? "").replace(/\s+/g, " ").trim();
  return limpo.length > 48 ? `${limpo.slice(0, 48)}…` : limpo;
}
