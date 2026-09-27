// A BUSCA DE PROPONENTE — quem pode entrar numa proposta junto com o titular.
//
// Lucas (05/09/2026), vendo o campo pedir nome e CPF digitados na mão: *"tem que buscar dentro da
// base, ou seja, a regra vale a mesma, se não tiver cad credenciado não tem como ir para
// proposta"*.
//
// ⚠️ DIGITAR CRIA UMA PESSOA QUE NÃO EXISTE. O campo antigo aceitava qualquer nome com qualquer
// CPF válido: bastava o dígito verificador fechar. Quem escrevesse "Beatriz Almeida" com o CPF
// certo criava um comprador que o Apolo nunca viu — sem CAD, sem crédito analisado, sem entidade —
// e ele entrava no PDF, na minuta e no contrato como se fosse cadastrado. A régua do titular era
// dura (CAD credenciada no empreendimento) e a do segundo comprador não existia, no MESMO papel.
//
// ⚠️ E A REGRA É A MESMA DOS DOIS LADOS. Não é "o titular é conferido e o resto é confiança": os
// dois assinam o contrato, os dois respondem pela dívida. Por isso a busca devolve a decisão de
// `decidirPelasLinhas` — a MESMA função que libera o titular —, e não uma segunda parecida.
//
// ⚠️ A BUSCA É DENTRO DO ESCOPO, e isso é privacidade, não preguiça. Procurar na base inteira do
// Apolo devolveria nome e CPF de qualquer pessoa da casa para qualquer corretor com acesso ao
// portal comercial. Aqui só aparece quem tem CAD NESTE empreendimento (ou na família dele) — o
// mesmo recorte que a tela Venda já lê para contar o funil.

import { soDigitos } from "@/lib/apolo/documento";

import { tipoDePessoa } from "./documento-do-comprador";

/** Como cada candidato volta para a tela. */
export type ProponenteEncontrado = {
  /**
   * `true` quando a CAD dele está credenciada. A VERDADE SOBRE A CAD, e só ela.
   *
   * ⚠️ NÃO É MAIS A PORTA — ver `podeGerarProposta`. Desde 26/09/2026 o coordenador monta a proposta
   * com a CAD EM ANDAMENTO, e este campo continua `false` nesse caso de propósito: é ele que diz à
   * tela se a frase da etapa é um MURO ou um AVISO.
   */
  credenciado: boolean;
  cpf: string;
  /** A etapa da CAD, quando ela não libera. */
  etapa: null | string;
  id: string;
  /** A frase que explica em que etapa a CAD está. `null` só quando ela está credenciada. */
  motivo: null | string;
  nome: string;
  /**
   * A PORTA: este candidato pode entrar na proposta?
   *
   * Lucas (26/09/2026): *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada.
   * ela pode estar em validacao ou em qualquer outro estagio"*. A proposta do casal é a proposta de
   * VERDADE: sem este campo o coordenador passava o titular e travava na esposa, e sobravam duas
   * saídas erradas — esperar a CAD (o que o pedido do Lucas queria destravar) ou gravar 100% no
   * titular, que muda quem assina o contrato e quem responde pela dívida.
   *
   * ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026):
   *   select count(*) as propostas,
   *          count(*) filter (where jsonb_array_length(compradores) > 1) as com_dois
   *     from hercules_propostas where compradores is not null;
   *     → 97 de 4.946 propostas têm dois ou mais compradores.
   *   select etapa, count(*) from apolo_esteira group by 1;
   *     → credenciado 662 · revisao 173 · correcao 6 · validacao 1 (ZERO em `indeferido`).
   * Com 173 CADs em `revisao` hoje, "casal com as duas CADs em andamento" é o caso que sobraria de
   * fora.
   *
   * ⚠️ E ELE NÃO MUDA QUEM APARECE NA LISTA. O filtro de quem entra na resposta é "tem CAD neste
   * escopo OU contrato ativo na família" (`porEntidade.has(c.id) || carteira.has(c.id)` em
   * `app/api/incorporador/venda/proponentes/route.ts`), não o credenciamento: a privacidade da busca
   * é o ESCOPO mais o documento inteiro, e ela não foi tocada por nenhum dos dois lotes de 26/09/2026.
   */
  podeGerarProposta: boolean;
  /**
   * Por qual porta a decisão saiu (26/09/2026): `cad` ou `comprador_da_carteira`. Opcional para a
   * tela aberta antes da subida continuar lendo a resposta; ausente = CAD.
   */
  origem?: null | "cad" | "comprador_da_carteira";
};

/** O mínimo que a busca precisa saber de uma pessoa da base. */
export type CandidatoDaBase = {
  documento: null | string;
  id: string;
  nome: null | string;
};

/**
 * Quantos candidatos a tela recebe.
 *
 * ⚠️ POUCOS DE PROPÓSITO. Uma lista longa de nomes e CPFs numa modal não ajuda a escolher e vira
 * exposição de dado pessoal a mais. Quem não achou em oito refina o termo — e digitar o CPF inteiro
 * sempre cai no alvo exato.
 */
export const MAXIMO_DE_CANDIDATOS = 8;

/**
 * Menos que isto não busca.
 *
 * ⚠️ DUAS LETRAS DEVOLVERIAM MEIA BASE, e a cada tecla. Três é o ponto em que a busca começa a
 * significar alguma coisa; para CPF a régua é outra (ver `termoDaBusca`), porque ninguém digita
 * três dígitos de um CPF esperando resultado útil.
 */
export const MINIMO_DE_LETRAS = 3;

// (26/09/2026) O termo de DOCUMENTO cobre CPF e CNPJ: Lucas, *"temos que habilitar pessoa fisica e
// pessoa juridica"*. Chamava-se "cpf" e levava onze dígitos.
export type TermoDaBusca =
  | { digitos: string; tipo: "documento" }
  | { texto: string; tipo: "nome" }
  | { tipo: "curto" };

/**
 * O que o corretor digitou: um CPF, um nome, ou pouco demais para procurar.
 *
 * ⚠️ O CPF É RECONHECIDO PELOS DÍGITOS, não pelo formato. O corretor cola "058.183.866-19" do
 * WhatsApp, digita "05818386619" no teclado numérico, ou traz "058 183 866 19" de uma planilha —
 * é a mesma pergunta. Só a partir de 4 dígitos: "058" ainda é gente demais.
 */
export function termoDaBusca(cru: string): TermoDaBusca {
  const texto = String(cru ?? "").trim();
  const digitos = soDigitos(texto);

  // ⚠️ SÓ VIRA CPF SE O QUE SOBROU FOR (QUASE) SÓ DÍGITO, e a régua é a PROPORÇÃO, não a presença
  // nem uma folga fixa. "Ana 3" tem um dígito em quatro caracteres e continua sendo um nome;
  // "058.183.866-19" tem onze em catorze e é documento. Uma folga de três caracteres (o primeiro
  // desenho) resolvia a pontuação do CPF mas quebrava em texto curto: "Ana 3" caía como documento
  // porque 1 ≥ 4 − 3.
  const semEspaco = texto.replace(/\s/g, "").length;
  const soDigito = digitos.length > 0 && digitos.length >= semEspaco * 0.6;
  if (soDigito) {
    // ⚠️ DÍGITO DE MENOS NÃO VIRA BUSCA POR NOME. "058" tem três caracteres e passaria na régua de
    // letras, indo procurar "058" dentro dos nomes — nenhum resultado, e o corretor concluindo que
    // o cliente não tem cadastro quando ele só não terminou de digitar o CPF.
    // ⚠️ CATORZE, E NÃO ONZE. Cortado em onze, um CNPJ colado casava por ACIDENTE pelos onze
    // primeiros dígitos (`startsWith` em `casa`), e as filiais 0001 e 0002 do mesmo CNPJ raiz
    // viravam o mesmo resultado — comprador trocado no PDF e no contrato.
    return digitos.length >= 4
      ? { digitos: digitos.slice(0, 14), tipo: "documento" }
      : { tipo: "curto" };
  }

  if (texto.length < MINIMO_DE_LETRAS) return { tipo: "curto" };
  return { texto, tipo: "nome" };
}

/**
 * O termo é o documento INTEIRO (onze dígitos de CPF ou catorze de CNPJ)? É a chave que abre o
 * espelho do pai e o comprador da carteira na busca (26/09/2026): confirmação do que o corretor já
 * tem na mão, e não lista. A tela usa a mesma função para dizer quando vale digitar o documento
 * inteiro, e a rota a usa para as duas portas: uma pergunta, uma resposta.
 *
 * ⚠️ SEM DÍGITO VERIFICADOR, de propósito: a base tem documento torto vindo da carga do C2X, e quem
 * digitou o documento inteiro de um cliente que existe tem de achá-lo. O tamanho é de
 * `tipoDePessoa`, a peça única (a varredura de `documento-do-comprador.varredura.test.ts` cobra).
 */
export function ehDocumentoInteiro(
  termo: TermoDaBusca,
): termo is { digitos: string; tipo: "documento" } {
  return termo.tipo === "documento" && tipoDePessoa(termo.digitos) !== null;
}

/**
 * Texto comparável: sem acento, sem caixa, sem espaço repetido.
 *
 * ⚠️ SEM ISTO, "JOAO" NÃO ACHA "João". A base tem nome vindo do C2X em caixa alta e sem acento,
 * nome digitado na CAD com acento, e nome de planilha com espaço duplo — a mesma pessoa escrita de
 * três jeitos. Quem busca digita um quarto.
 */
export function comparavel(valor: null | string): string {
  return String(valor ?? "")
    .normalize("NFD")
    // Os diacríticos combinantes, escritos por código: o intervalo literal é invisível no editor e
    // já chegou a ser quebrado por uma edição automática neste mesmo arquivo.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Este candidato casa com o termo?
 *
 * ⚠️ TODA PALAVRA DO TERMO TEM QUE APARECER, em qualquer ordem. "silva maria" acha "MARIA DA
 * SILVA", que é como as pessoas procuram — sobrenome primeiro quando é o que lembram. Exigir a
 * frase inteira na ordem faria "maria silva" não achar "Maria da Silva", pelo "da" no meio.
 */
export function casa(candidato: CandidatoDaBase, termo: TermoDaBusca): boolean {
  if (termo.tipo === "curto") return false;

  if (termo.tipo === "documento") {
    return soDigitos(candidato.documento ?? "").startsWith(termo.digitos);
  }

  const nome = comparavel(candidato.nome);
  if (!nome) return false;
  return comparavel(termo.texto)
    .split(" ")
    .every((palavra) => nome.includes(palavra));
}

/**
 * A ordem em que os candidatos aparecem.
 *
 * ⚠️ QUEM PODE ENTRAR VEM PRIMEIRO, e não alfabético puro: enterrá-los no meio de homônimos que a
 * tela não deixa escolher faz o corretor concluir que "não tem". Depois, nome.
 *
 * ⚠️ A ORDEM SEGUE A PORTA, E NÃO `credenciado`, desde 26/09/2026. Ordenar pela verdade sobre a CAD
 * mandaria para o fim da lista exatamente quem o coordenador ACABOU de ser liberado a escolher (a
 * CAD em validação), e a lista tem teto de 8 candidatos: o afrouxamento existiria e ficaria
 * escondido abaixo do corte.
 */
export function ordenar(a: ProponenteEncontrado, b: ProponenteEncontrado): number {
  if (a.podeGerarProposta !== b.podeGerarProposta) return a.podeGerarProposta ? -1 : 1;
  return comparavel(a.nome).localeCompare(comparavel(b.nome), "pt-BR");
}

/**
 * Este CPF já está entre os compradores?
 *
 * ⚠️ COMPARA POR DÍGITOS. O titular vem do banco cru ("52998224725") e o candidato vem formatado
 * ("529.982.247-25"): comparar texto deixaria a MESMA pessoa entrar duas vezes, e a soma das
 * participações fecharia 100% com um comprador repetido — que vira contrato com uma pessoa que não
 * existe.
 */
export function jaEstaNaLista(cpf: string, jaEscolhidos: string[]): boolean {
  const alvo = soDigitos(cpf);
  return jaEscolhidos.some((c) => soDigitos(c) === alvo);
}
