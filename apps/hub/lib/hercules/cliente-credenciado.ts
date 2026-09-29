// A CAD DO TITULAR ESTÁ CREDENCIADA NESTE EMPREENDIMENTO? — a régua que deixa a reserva virar
// proposta.
//
// Lucas (04/09/2026): *"para virar proposta, a CAD do titular tem que estar credenciada naquele
// empreendimento"*.
//
// (26/09/2026) ⚠️ COM PJ, O TITULAR É A EMPRESA, e é a CAD DELA que vale — a mesma frase do Lucas,
// aplicada a quem consta na reserva. A CAD do sócio não substitui a da empresa: quem compra o lote
// é o CNPJ, e é ele que assina o contrato e responde pela dívida.
//
// ⚠️ SÓ LÊ, E RESPONDE UMA PERGUNTA SÓ. Duas telas fazem a mesma: a Venda, ao habilitar o botão
// "Gerar proposta", e a rota que grava a proposta depois. Se cada uma montasse a própria consulta,
// a segunda acabaria mais frouxa que a primeira — e é a segunda que grava.
//
// ⚠️ O ESCOPO DO EMPREENDIMENTO NÃO É SÓ O ID. `apolo_esteira.enterprise_id` guarda DOIS formatos:
// a divisão do C2X ("35") e o grupo do catálogo ("group:Vale do Ouro"), e há linha viva nas duas
// formas hoje. Esta função compara com TUDO que vier em `enterpriseIds`, sem interpretar o
// conteúdo — mas ela só enxerga o que o chamador colocou lá. Quem chama tem que expandir antes,
// com `familiaDoEmpreendimento` (pai e filhos) e `comIdsDoGrupo` (o grupo que as divisões cobrem),
// exatamente como a rota irmã `app/api/incorporador/venda/route.ts` já faz para contar as CADs do
// funil. Uma CAD gravada no grupo, lida sem essa expansão, volta como "não credenciado" e recusa
// um cliente credenciado na cara do corretor.
//
// ⚠️ ERRO DE LEITURA NÃO É RECUSA. Toda falha de banco sai daqui como `FalhaAoLerCredenciamento`,
// nunca como `credenciado: false`. Um blip de rede que virasse "este cliente não está credenciado"
// mandaria o corretor discutir com a coordenação um problema que é nosso — e a resposta certa para
// quem chama é 503, não uma frase sobre a CAD do cliente. É o mesmo fail-closed do
// `lerCadDaEsteira` (lib/apolo/esteira-cad.ts).
//
// (26/09/2026) ⚠️ A SEGUNDA PORTA: O COMPRADOR DA CARTEIRA. Lucas: *"tem um cliente que é
// comprador, mas não está dando para ele comprar mais uma unidade [...] temos que aproveitar esses
// cadastros de comprador"*. Quem NÃO TEM CAD NENHUMA no escopo, mas tem contrato ativo (faturado)
// numa unidade da MESMA família, passa como credenciado, com `origem: "comprador_da_carteira"`
// (ver `compra-ativa.ts`). A CAD real, quando existe, continua decidindo, inclusive para barrar: a
// carteira não é uma linha de CAD, é a prova que SUBSTITUI a CAD quando ela não existe. A porta vale
// para CPF e para CNPJ, pela mesma peça (`tipoDePessoa`/`namespaceDoHash`) que este portão usa; a
// medição que sustenta isso está em `compra-ativa.ts`.

import type { SupabaseClient } from "@supabase/supabase-js";

import { soDigitos } from "@/lib/apolo/documento";
import type { EtapaEsteira } from "@/lib/apolo/esteira";
import { hashIdentifier } from "@/lib/apolo/server";

import {
  type CompraAtiva,
  compraDaPessoa,
  lerContratosAtivos,
  ORIGEM_COMPRADOR_DA_CARTEIRA,
  resolverEntidadeDoContrato,
} from "./compra-ativa";
import { namespaceDoHash, rotuloDoDocumento, tipoDePessoa } from "./documento-do-comprador";

// Só o `from` é usado. Aceita tanto o admin client do Apolo quanto um SupabaseClient cru — os dois
// convivem nas libs do Hércules — e é o que permite testar com um cliente falso.
type ClienteDeLeitura = Pick<SupabaseClient, "from">;

/** A etapa que libera a proposta. Uma só, e é o fim da esteira. */
export const ETAPA_QUE_LIBERA = "credenciado";

// ⚠️ DUAS PORTAS E DOIS MODOS NA MESMA RÉGUA, E ELES NÃO SE MISTURAM (junção de 26/09/2026, deste
// arquivo com a v1.385.0). Escrito de uma vez para ninguém ter de reconstruir:
//   • `credenciado`        → A CAD ESTÁ APROVADA (ou a carteira a substituiu). É o que a BARRA DO
//                            CONTRATO lê (`cad-para-contrato.ts`).
//   • `podeGerarProposta`  → A PORTA DA PROPOSTA. Igual a `credenciado`, mais a CAD EM ANDAMENTO no
//                            modo do coordenador.
//   • `origem`             → por qual das duas portas a resposta saiu (`cad` ou a carteira).
//   • `compra`             → o contrato que substituiu a CAD, só quando não havia CAD nenhuma.
// A CARTEIRA e o MODO DO COORDENADOR nunca disputam a mesma linha: a carteira só é lida quando NÃO
// HÁ CAD NENHUMA no escopo, e o modo só mexe em CAD QUE EXISTE. Quem tem CAD em andamento é decidido
// pelo modo; quem não tem CAD nenhuma é decidido pela carteira; quem tem CAD indeferida é BARRADO
// pelas duas (a carteira nem é lida, e o mapa de etapas recusa).

// UMA RÉGUA, DOIS MODOS — E A CAD EM ANDAMENTO LIBERA O COORDENADOR.
//
// Lucas (26/09/2026): *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada.
// ela pode estar em validacao ou em qualquer outro estagio"*. Sobre o print da CAD do MATEUS COTTA
// SACCHETTO em `validacao` (lote EIRETAMA-14, Aldeia das Cachoeiras das Pedras, empreendimento 42):
// *"essa devia passar"*. A coordenadora, no próprio card: *"eu só posso lançar a proposta financeira
// depois que a CAD for aprovada? Normalmente, eu já tenho essas informações junto com o cadastro"*.
//
// ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026):
//   select etapa, count(*) from apolo_esteira group by 1 order by 2 desc;
//     → credenciado 662 · revisao 172 · correcao 6 · validacao 2
//   ZERO CADs em `indeferido`, `credito` ou `prevenda` hoje: a recusa que este mapa mantém não trava
//   ninguém agora, ela existe para o dia em que a coordenação reprovar alguém.
//   select etapa, enterprise_id, atualizado_em from apolo_esteira where etapa = 'validacao';
//     → enterprise_id 42, atualizado_em 2026-09-26 17:11:31+00 (a CAD do print) e uma no 20.
//
// ⚠️ `indeferido` CONTINUA BARRANDO, e é a segunda decisão do Lucas no mesmo dia. As demais etapas
// são uma CAD EM ANDAMENTO — a coordenação está com ela na mão, e a proposta financeira caminha em
// paralelo. `indeferido` é uma decisão JÁ TOMADA de reprovar o cliente: gerar proposta em cima dela
// é vender para quem a coordenação recusou.
//
// ⚠️ É UM `Record<EtapaEsteira, boolean>`, E NÃO UM `Set`, pelo mesmo motivo do `ROTULO_DA_ETAPA`
// abaixo: uma etapa nova na esteira quebra o TYPECHECK aqui, exigindo uma decisão explícita, em vez
// de nascer liberada (ou barrada) por descuido do lado que a régua chutar.
const LIBERA_COM_CAD_EM_ANDAMENTO_INTERNO: Record<EtapaEsteira, boolean> = {
  correcao: true,
  credenciado: true,
  credito: true,
  indeferido: false,
  prevenda: true,
  revisao: true,
  validacao: true,
};

/** O mapa, exposto só para a varredura que cobra uma decisão por etapa do vocabulário. */
export const LIBERA_COM_CAD_EM_ANDAMENTO: Readonly<Record<EtapaEsteira, boolean>> =
  LIBERA_COM_CAD_EM_ANDAMENTO_INTERNO;

/**
 * O MODO da régua — quem está perguntando, não o que se pergunta.
 *
 * ⚠️ O DEFAULT É O APERTADO, e isso é o contrato. `decidirPelasLinhas` é chamada sem modo pela busca
 * de proponentes (`app/api/incorporador/venda/proponentes/route.ts:186`), e o dia em que o default
 * virasse o frouxo essa lista passaria a oferecer como comprador quem ninguém liberou.
 */
export type ModoDaRegua = {
  /**
   * Uma CAD em andamento (validação, revisão, crédito, correção, pré-venda) já abre a porta?
   *
   * `true` só para o PORTAL COMERCIAL DA CARELI — o coordenador. O portal do Cecílio
   * (`cecilio-rocha`), que também opera a própria venda (`portalOperaVenda` em
   * `lib/apolo/incorporador/perfis-de-portal.ts:122`), continua precisando da CAD credenciada:
   * segunda decisão do Lucas em 26/09/2026.
   */
  cadEmAndamentoLibera?: boolean;
};

/**
 * A porta, dada a verdade sobre a CAD e o modo de quem pergunta.
 *
 * ⚠️ NÃO É `credenciado`, E É POR ISSO QUE EXISTE. Se o afrouxamento virasse `credenciado: true`, o
 * selo da ModalDeProposta escreveria "CAD credenciada neste empreendimento / A reserva pode virar
 * proposta" (`modules/incorporador/hercules/ModalDeProposta.tsx:1400`) em cima de uma CAD em
 * validação, e a tela passaria a MENTIR para o coordenador. `credenciado` continua significando a
 * verdade sobre a CAD; quem decide a porta é este campo, e a tela mostra os dois.
 */
function podeGerarProposta(etapa: string, credenciado: boolean, modo: ModoDaRegua): boolean {
  if (credenciado) return true;
  if (!modo.cadEmAndamentoLibera) return false;
  // A coluna é `text` sem CHECK (migration 0057): uma etapa fora do vocabulário NÃO abre porta só
  // por não estar na lista de recusa.
  return Object.hasOwn(LIBERA_COM_CAD_EM_ANDAMENTO_INTERNO, etapa)
    ? LIBERA_COM_CAD_EM_ANDAMENTO_INTERNO[etapa as EtapaEsteira]
    : false;
}

/**
 * Por qual porta a resposta saiu.
 *
 * • `cad`: uma CAD do escopo decidiu (liberando ou barrando).
 * • `comprador_da_carteira`: a pessoa tem contrato ativo na família. Vale tanto para quem ainda não
 *   tem CAD (a porta é a própria compra, e `compra` vem preenchida) quanto para a CAD credenciada que
 *   NASCEU da carteira (`apolo_esteira.origem = 'comprador_da_carteira'`): a tela diz "Comprador da
 *   carteira" nos dois casos, que é o mesmo fato.
 *
 * ⚠️ E TAMBÉM PARA A CAD DA CARTEIRA QUE NÃO ESTÁ MAIS CREDENCIADA (junção de 26/09/2026). Se alguém
 * mover no Board a CAD que nasceu da carteira para `revisao`, a resposta sai `credenciado: false` com
 * `origem: "comprador_da_carteira"`, e a tela mostra o selo âmbar "CAD em andamento" COM o chip
 * "Comprador da carteira". Sem isto a tela esquecia o fato no momento em que ele mais explica a
 * situação para o coordenador. ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT,
 * 26/09/2026): `select etapa, origem, count(*) from apolo_esteira group by 1,2` → 1 linha com
 * `origem = 'comprador_da_carteira'`, e ela está `credenciado`. Ou seja: ZERO pessoas caem neste
 * ramo hoje, ele existe para o primeiro Board que mexer nessa CAD.
 */
export type OrigemDoCredenciamento = "cad" | "comprador_da_carteira";

export type CredenciamentoDoTitular = {
  /**
   * O contrato ativo que liberou a pessoa, SÓ quando não havia CAD nenhuma no escopo.
   *
   * ⚠️ É ELE QUE MANDA A GRAVAÇÃO DA PROPOSTA ABRIR A CAD (`cad-do-comprador.ts`). Quando a CAD da
   * carteira já existe, este campo é `null` e nada é escrito de novo.
   */
  compra: CompraAtiva | null;
  /**
   * A CAD ESTÁ CREDENCIADA NESTE EMPREENDIMENTO? A verdade sobre a CAD, e só ela — ou a carteira que
   * a SUBSTITUI quando ela não existe.
   *
   * ⚠️ NÃO É A PORTA DA PROPOSTA — ver `podeGerarProposta`. Desde 26/09/2026 o coordenador gera
   * proposta com a CAD em andamento, e este campo continua `false` nesse caso de propósito: é ele que
   * a tela usa para escrever o selo, e um `true` aqui faria a tela dizer "CAD credenciada" sobre uma
   * CAD em validação.
   *
   * ⚠️ E É ELE QUE A BARRA DO CONTRATO LÊ (`cad-para-contrato.ts`, Lucas 26/09/2026: *"faz uma barra,
   * para enviar para contrato precisa da cad validada"*). Logo, o COMPRADOR DA CARTEIRA PASSA PELA
   * BARRA DO CONTRATO, porque para ele este campo é `true`. Isso é decisão declarada na barra, não
   * acidente desta linha: ver `A_CARTEIRA_VALE_PARA_O_CONTRATO` em `cad-para-contrato.ts`.
   */
  credenciado: boolean;
  /**
   * Desde quando a CAD encontrada está assim, em ISO.
   *
   * ⚠️ É `atualizado_em`, E ELE NÃO É "ENTRADA NA ETAPA". A esteira não guarda a data de cada
   * transição: `atualizado_em` muda em QUALQUER escrita da linha (o analista trocou o corretor, o
   * sync mexeu no empreendimento). Serve para a frase "desde 02/09" porque é a melhor aproximação
   * que existe, e é preciso saber disso antes de usá-lo como prova de prazo.
   *
   * ⚠️ `null` NA PORTA DA CARTEIRA SEM CAD (26/09/2026). Não há CAD para datar, e a data do contrato
   * antigo (que fica em `compra.desde`) não é da conta de quem abre a modal: o GET a mandaria ao
   * portal que não é a Careli, inclusive a de contrato do espelho do pai, que é dividido com o Lino.
   */
  desde: null | string;
  /**
   * A entidade do Apolo dona da CAD encontrada — a que decidiu a resposta.
   *
   * ⚠️ COM UMA EXCEÇÃO: quando não há CAD nenhuma neste escopo não existe linha para decidir nada,
   * e este campo vira só a primeira das entidades do CPF, por ordem fixa de id. É um ponto de
   * partida para quem for abrir a CAD, não a entidade que respondeu.
   */
  entityId: null | string;
  /**
   * A etapa em que a CAD está, mesmo quando ela não libera.
   *
   * ⚠️ É `string`, NÃO `EtapaEsteira`: a coluna é `text` sem CHECK (migration 0057, "a app impõe,
   * o banco não tem"). Tipar como a união faria o TypeScript prometer o que o banco não garante, e
   * a tela renderizaria `undefined` no dia em que aparecesse uma etapa fora da lista.
   */
  etapa: null | string;
  /** A frase para o corretor. `null` quando está credenciado — aí não há o que explicar. */
  motivo: null | string;
  /** Por qual porta a resposta saiu. `null` quando não houve porta nenhuma (sem CAD e sem compra). */
  origem: null | OrigemDoCredenciamento;
  /**
   * A PORTA DA PROPOSTA: esta reserva pode virar proposta?
   *
   * Igual a `credenciado` no modo de sempre — e portanto `true` também para o COMPRADOR DA CARTEIRA,
   * que entra por `credenciado`. No modo do coordenador (Lucas, 26/09/2026) ele é `true` também com a
   * CAD EM ANDAMENTO — e aí `credenciado` é `false` e `motivo` traz a frase da etapa, que a tela
   * mostra como AVISO com o botão liberado. É este campo que o GET manda para a tela e que o POST usa
   * para recusar com 403.
   */
  podeGerarProposta: boolean;
};

/**
 * A leitura falhou. NÃO é "o cliente não está credenciado".
 *
 * Existe como classe para quem chama poder separar os dois com `instanceof` e responder 503 em vez
 * de reprovar o cliente: a diferença entre "o sistema não sabe" e "a resposta é não" é a diferença
 * entre um retry e um telefonema para a coordenação.
 */
export class FalhaAoLerCredenciamento extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "FalhaAoLerCredenciamento";
  }
}

/**
 * Como cada etapa é dita ao corretor.
 *
 * ⚠️ TIPADO POR `EtapaEsteira` DE PROPÓSITO: uma etapa nova na esteira quebra o typecheck aqui, em
 * vez de chegar à tela como uma frase genérica. O tipo entra por `import type` — não arrasta o
 * `lib/apolo/esteira.ts` (e o admin client dele) para dentro deste módulo.
 */
const ROTULO_DA_ETAPA: Record<EtapaEsteira, string> = {
  correcao: "com o cadastro em correção",
  credenciado: "credenciado",
  credito: "em análise de crédito",
  indeferido: "com o cadastro indeferido",
  prevenda: "em pré-venda, aguardando o pagamento",
  revisao: "em revisão pela coordenação",
  validacao: "em validação de cadastro",
};

const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

export type LinhaDaEsteira = {
  atualizado_em: null | string;
  chegou_em: null | string;
  created_at: null | string;
  enterprise_id: null | string;
  entity_id: string;
  etapa: null | string;
  /** De onde a CAD veio. Opcional: só é lido para dizer "Comprador da carteira" na tela. */
  origem?: null | string;
};

/**
 * Este documento (CPF ou CNPJ) pode ser titular de uma proposta neste empreendimento?
 *
 * `enterpriseIds` é o escopo JÁ EXPANDIDO (família + grupo) — ver o aviso no topo do arquivo.
 *
 * ⚠️ A COMPRA SÓ É LIDA QUANDO NÃO HÁ CAD NENHUMA NO ESCOPO. O caminho comum (quem tem CAD) não
 * ganha leitura nenhuma; só a pergunta que hoje terminaria em "Este cliente não tem CAD neste
 * empreendimento" vai aos contratos da família antes de responder.
 *
 * @throws {FalhaAoLerCredenciamento} quando o banco não respondeu, ou quando o escopo veio vazio.
 */
export async function credenciadoParaVender(
  admin: ClienteDeLeitura,
  alvo: {
    /** Falso desliga a porta da carteira (só a CAD vale). Ausente = ligada. */
    compradorDaCarteira?: boolean;
    /** CPF ou CNPJ, com ou sem máscara (ver `documento-do-comprador.ts`). */
    documento: string;
    enterpriseIds: string[];
  },
  // ⚠️ O MODO É O TERCEIRO PARÂMETRO, E NÃO UM CAMPO DE `alvo`: `alvo` é O QUE se pergunta (o
  // documento, o escopo, e se a carteira conta como prova); o modo é QUEM pergunta. Omitido, vale o
  // apertado de sempre. ⚠️ `compradorDaCarteira` FICA EM `alvo` de propósito, e não aqui: ela é uma
  // FONTE DE PROVA sobre a pessoa, não o perfil de quem pergunta — todo portal enxerga a mesma
  // carteira, e o que varia por portal é só a etapa da CAD que abre a porta.
  modo: ModoDaRegua = {},
): Promise<CredenciamentoDoTitular> {
  // ⚠️ NORMALIZAR ANTES DE HASHEAR. O CPF chega como o corretor digitou ("529.982.247-25") e como a
  // reserva gravou ("52998224725"); `hashIdentifier` não normaliza nada, então os dois formatos
  // gerariam hashes diferentes e o mesmo cliente ora seria achado, ora não.
  const digitos = soDigitos(alvo.documento);

  // ⚠️ CPF **OU** CNPJ (Lucas, 26/09/2026: *"temos que habilitar pessoa fisica e pessoa juridica,
  // hoje só atende pessoa fisica"*). Até 26/09/2026 o portão era `digitos.length !== 11`: uma
  // reserva de PJ nascia e travava aqui, com uma frase sobre CPF em cima de uma empresa.
  //
  // MEDIDO em 26/09/2026 (produção, só SELECT): existem 11 CADs de entidade `pj` na esteira, 9 na
  // etapa `credenciado`, e as 11 têm identificador `cnpj` cujo `value_hash` é igual ao
  // `document_hash` da entidade em 11 de 11 casos. O caminho da empresa EXISTE no dado.
  //
  // ⚠️ NÃO VALE O DÍGITO VERIFICADOR AQUI, e isso é a decisão de 04/09/2026 mantida de propósito
  // (ela foi apagada por engano na primeira versão deste lote): o documento do titular já passou
  // pela régua de ENTRADA (`conferirReserva` e `conferirProposta`, que usam
  // `documentoDeCompradorValido`), e repetir a régua aqui só criaria um segundo lugar para ela
  // divergir. O que interessa neste portão é ter documento SUFICIENTE PARA PROCURAR — a mesma
  // pergunta, e a mesma régua, que a busca de proponentes faz em
  // `app/api/incorporador/venda/proponentes/route.ts` pelo mesmo motivo escrito lá: a base tem
  // documento torto vindo da carga do C2X.
  //
  // E a premissa contrária é falsa numa das portas: `lib/prometeu/reservas-evento.ts` grava o
  // documento do credenciado do salão SEM validador nenhum (`validarProponentes` em
  // `lib/prometeu/cupom.ts` só confere quantidade, repetição e percentual). Exigir DV aqui
  // barraria um lote que a régua antiga deixava andar: a reserva nasce (criarReservaNoHercules não
  // valida documento), trava o lote pelos dois índices, e o botão Gerar proposta nunca acenderia.
  //
  // MEDIDO em 26/09/2026 (produção `bxgukywoxgivlrhjkwjx`, só SELECT, DV calculado no SQL): as 32
  // reservas de `hercules_reservas` têm titular de 11 dígitos, e 0 de 32 falham no dígito
  // verificador; em `prometeu_credenciados`, 0 de 668 documentos de 11 dígitos falham. Ou seja, hoje
  // não há vítima — a trava seria do próximo evento, e ela seria calada.
  if (tipoDePessoa(digitos) === null) {
    return {
      compra: null,
      credenciado: false,
      desde: null,
      entityId: null,
      etapa: null,
      motivo: "Informe o CPF ou o CNPJ do titular para conferir o credenciamento.",
      origem: null,
      // ⚠️ NÃO É ETAPA E NÃO É PESSOA, ENTÃO NEM O MODO DO COORDENADOR NEM A CARTEIRA ALCANÇAM.
      // Documento insuficiente para procurar continua barrando: sem ele não há pessoa para conferir,
      // e nem contrato para procurar (`compraDaPessoa` exige CPF ou CNPJ).
      podeGerarProposta: false,
    };
  }

  const escopo = [
    ...new Set(alvo.enterpriseIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];

  // ⚠️ ESCOPO VAZIO É ERRO, NÃO RECUSA. Sem empreendimento a pergunta não tem resposta possível —
  // e responder "não credenciado" seria transformar um bug do chamador (unidade sem
  // empreendimento, sessão sem produto) numa acusação contra o cliente.
  if (escopo.length === 0) {
    throw new FalhaAoLerCredenciamento(
      "credenciamento: escopo de empreendimento vazio, não dá para decidir",
    );
  }

  const entityIds = await entidadesDoDocumento(admin, digitos);

  // ⚠️ SEM ENTIDADE NO APOLO, A RESPOSTA CONTINUA A DE HOJE, mesmo para quem tem contrato: a CAD da
  // carteira precisa de uma entidade para nascer, e os 2.037 faturados medidos têm o titular ligado
  // a uma entidade sincronizada em 100% dos casos. Quem cair aqui é dado quebrado, não comprador.
  //
  // ⚠️ É AQUI QUE PARA A MAIOR PARTE DA PJ DA CARTEIRA (medido em 26/09/2026, produção, só SELECT):
  // dos 68 faturados ativos de CNPJ (40 CNPJs), 63 têm a entidade ligada ao usuário do C2X SEM
  // identificador `cnpj` e sem `document_hash` — o sync do C2X não gravou o documento da empresa —,
  // então o hash do CNPJ não acha ninguém e a resposta é "Este CNPJ não tem cadastro no Apolo",
  // com ou sem porta da carteira. Não é a porta que barra a empresa: é a ficha dela que não existe.
  if (entityIds.length === 0) {
    return {
      compra: null,
      credenciado: false,
      desde: null,
      entityId: null,
      etapa: null,
      motivo: `Este ${rotuloDoDocumento(digitos)} não tem cadastro no Apolo. Abra a CAD antes de gerar a proposta.`,
      origem: null,
      // ⚠️ SEM ENTIDADE NO APOLO O MODO DO COORDENADOR NÃO ALCANÇA (Lucas, 26/09/2026: a CAD precisa
      // EXISTIR; o que foi afrouxado é a ETAPA dela). Sem entidade não há pessoa conferida — e a
      // carteira também para aqui, pelo motivo escrito acima deste `if`.
      podeGerarProposta: false,
    };
  }

  const linhas = await lerEsteira(admin, entityIds, escopo);

  // ⚠️ A CARTEIRA SÓ É LIDA QUANDO NÃO HÁ CAD NENHUMA, E É ISSO QUE FAZ AS DUAS PORTAS CONVIVEREM
  // (junção de 26/09/2026). Com CAD no escopo, quem decide é a CAD mais o MODO: em andamento ela abre
  // a proposta para o coordenador, indeferida ela BARRA, e em nenhum dos dois casos o contrato antigo
  // é consultado. É por aqui que "CAD indeferida com contrato ativo" continua barrada: a leitura da
  // compra nem acontece.
  if (linhas.length > 0 || alvo.compradorDaCarteira === false) {
    return decidirPelasLinhas(linhas, entityIds, { modo });
  }

  const compra = await compraNaFamilia(admin, { documento: digitos, entityIds, escopo });
  return decidirPelasLinhas(linhas, entityIds, { compra, modo });
}

/**
 * O contrato ativo desta pessoa na família, já com a entidade em que a CAD nasceria.
 *
 * ⚠️ QUALQUER ERRO VIRA `FalhaAoLerCredenciamento`, como a leitura da esteira: "o sistema não
 * conseguiu ler os contratos" não é "este cliente não tem CAD".
 */
async function compraNaFamilia(
  admin: ClienteDeLeitura,
  alvo: { documento: string; entityIds: string[]; escopo: string[] },
): Promise<CompraAtiva | null> {
  try {
    const contratos = await lerContratosAtivos(admin, alvo.escopo);
    const compra = compraDaPessoa(contratos, alvo);
    return compra ? await resolverEntidadeDoContrato(admin, compra, alvo.entityIds) : null;
  } catch (erro) {
    throw new FalhaAoLerCredenciamento(
      `carteira: leitura falhou (${erro instanceof Error ? erro.message : String(erro)})`,
    );
  }
}

/**
 * A RÉGUA, separada da leitura: dadas as linhas de esteira de UMA pessoa, ela está credenciada?
 *
 * ⚠️ EXTRAÍDA PARA QUE A BUSCA DE PROPONENTES USE EXATAMENTE ESTA, e não uma segunda parecida.
 * A tela de proposta pergunta por uma pessoa de cada vez; a busca pergunta por dezenas ao mesmo
 * tempo, e escrever a decisão de novo lá seria criar duas réguas que envelhecem separadas — a
 * segunda liberando quem a primeira barra, no mesmo empreendimento e no mesmo dia.
 *
 * `entityIds` serve só para o caso "achei a pessoa mas ela não tem CAD nenhuma neste escopo":
 * a resposta carrega um id para a tela conseguir abrir a ficha dela mesmo assim.
 *
 * `compra` (26/09/2026) é o contrato ativo da pessoa na família, quando existe. ⚠️ ELA SÓ ENTRA NO
 * RAMO "SEM CAD NO ESCOPO". Qualquer CAD do escopo continua decidindo, inclusive a indeferida e a
 * em revisão, pelos quatro motivos abaixo:
 *   1. "A decisão de ontem vence a de junho" é regra DENTRO da mesma CAD (`maisRecentePorCad`) e
 *      continua valendo como está. A carteira não é uma linha de CAD: é a prova que substitui a CAD
 *      quando ela não existe, e não uma decisão de crédito mais nova que a da coordenação.
 *   2. Revisão e indeferimento são crédito reprovado, e esse só a coordenação destrava, com
 *      evidência, pelo override (esteira.ts; Lucas, 04/08).
 *   3. A CAD da carteira não pode sobrescrever a existente, e o Board mostraria "revisão" ao lado de
 *      uma proposta viva.
 *   4. O custo é medido e pequeno: 5 compradores com CAD em revisão na família (26/09/2026, 2
 *      titulares e 3 co-compradores, contratos do VOC e do VOL, todos faturados depois da última
 *      escrita da CAD), e
 *      para eles a saída é o override. Ponto levado ao Lucas.
 *
 * `modo` (26/09/2026) é quem pergunta — ver `ModoDaRegua`. ⚠️ OS DOIS NÃO SE CRUZAM NUNCA: `compra`
 * só é lida no ramo "sem CAD no escopo", e `modo` só mexe em CAD QUE EXISTE. É por isso que a ordem
 * dos ramos aqui embaixo é credenciada → recusa → carteira → sem CAD → etapa em andamento.
 *
 * ⚠️ O TERCEIRO PARÂMETRO É UM OBJETO, E NÃO DOIS POSICIONAIS (junção de 26/09/2026): o lado da CAD
 * em andamento chegou com `modo` no terceiro lugar e o lado da carteira com `compra`. Dois posicionais
 * fariam `decidirPelasLinhas(linhas, ids, algo)` compilar com o significado trocado em metade das
 * chamadas. Com chaves, cada lado se nomeia, e a terceira prova que aparecer entra como chave nova.
 */
export function decidirPelasLinhas(
  linhas: LinhaDaEsteira[],
  entityIds: string[],
  extras: { compra?: CompraAtiva | null; modo?: ModoDaRegua } = {},
): CredenciamentoDoTitular {
  const compra = extras.compra ?? null;
  const modo = extras.modo ?? {};
  // A régua tem DUAS METADES, e trocar a ordem delas quebra uma das duas:
  //
  // 1) ⚠️ DENTRO DA MESMA CAD, A LINHA MAIS RECENTE MANDA — por isso o corte por CAD vem
  //    ANTES do filtro por etapa. Procurar "alguma linha credenciada" primeiro é o único jeito de
  //    esta função errar para o lado frouxo: uma CAD credenciada em junho e INDEFERIDA em setembro
  //    ainda tem a linha de junho, e a proposta nasceria para um cliente reprovado no crédito. A
  //    decisão de ontem vence a de junho.
  //
  // 2) ⚠️ ENTRE ENTIDADES, QUALQUER UMA SERVE. A mesma pessoa tem mais de uma entidade no Apolo
  //    com o mesmo documento (619 documentos duplicados medidos): tipicamente uma veio do sync do
  //    C2X e outra nasceu numa importação. A CAD credenciada mora em UMA delas, e escolher "a
  //    entidade certa" antes de olhar a esteira é escolher errado metade das vezes — por isso a
  //    busca é por documento e a decisão é pelo conjunto das mais-recentes, não por uma só. O
  //    mesmo vale entre EMPREENDIMENTOS da família: a CAD credenciada pode estar no pai enquanto
  //    um irmão tem uma CAD recém-aberta, e a nova não pode apagar a que já passou.
  const decisivas = maisRecentePorCad(linhas);

  const credenciada = maisRecente(
    decisivas.filter((l) => normalizarEtapa(l.etapa) === ETAPA_QUE_LIBERA),
  );

  if (credenciada) {
    return {
      compra: null,
      credenciado: true,
      desde: dataDaLinha(credenciada),
      entityId: credenciada.entity_id,
      etapa: ETAPA_QUE_LIBERA,
      motivo: null,
      origem: origemDaLinha(credenciada),
      podeGerarProposta: true,
    };
  }

  // ⚠️ NO MODO DO COORDENADOR, A RECUSA É PROCURADA NO ESCOPO INTEIRO — e não na linha mais nova.
  //
  // Esta varredura ESPELHA o "qualquer uma serve" do `credenciado` acima com um "qualquer recusa
  // barra", e é o que torna a segunda decisão do Lucas de 26/09/2026 verdadeira de fato:
  // *"indeferido não"*, porque *"é uma decisão já tomada de reprovar o cliente"*. Sem ela,
  // `indeferido` só barrava quando por acaso era a linha com o `atualizado_em` MAIOR de todo o
  // escopo: qualquer segunda CAD do mesmo CPF em etapa em andamento passava por cima da recusa.
  //
  // ⚠️ MEDIDO POR MIM EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026 18h), e é o que
  // diz o tamanho do risco:
  //   select etapa, count(*) from apolo_esteira group by 1;
  //     → credenciado 662 · revisao 173 · correcao 6 · validacao 1 · ZERO `indeferido`
  //   select count(*) from (select value_hash from apolo_entity_identifiers
  //     group by 1 having count(distinct entity_id) > 1) d;                            → 806
  //   select count(*) from (select i.value_hash from apolo_esteira e
  //     join apolo_entity_identifiers i on i.entity_id = e.entity_id
  //     group by 1 having count(distinct e.etapa) > 1) x;                              → 16
  //   select count(*) from (select entity_id from apolo_esteira
  //     group by 1 having count(distinct enterprise_id) > 1) y;                        → 7
  // NÃO HÁ VÍTIMA HOJE, porque não existe CAD indeferida. Mas a FORMA já está no dado: 16 documentos
  // já têm CADs em etapas DIFERENTES, 7 entidades têm CAD em mais de um empreendimento, e a etapa é
  // gravada por TELA — a ordem dos `atualizado_em` é acidente, não decisão de ninguém.
  //
  // ⚠️ MEDIDO ANTES DA CORREÇÃO (`npx tsx` chamando esta função de verdade, modo
  // `{cadEmAndamentoLibera: true}`, 26/09/2026): `indeferido` no 42 em 20/09 mais `revisao` no 43 em
  // 26/09 devolvia `{"podeGerarProposta":true,"etapa":"revisao"}`, e entidade A `indeferido` no 42
  // em 20/09 mais entidade B `validacao` no 42 em 26/09 devolvia
  // `{"podeGerarProposta":true,"etapa":"validacao"}`. Nos dois a proposta nascia para quem a
  // coordenação REPROVOU, e a tela escrevia "CAD em andamento" sem citar o indeferimento.
  //
  // ⚠️ E É O ESCOPO QUE FAZ ISSO SER COMUM, não um caso de laboratório. O que chega aqui vem
  // EXPANDIDO (família inteira mais os ids de grupo, `escopoDoTitular(escopoDaEsteiraDoPortal(...))`
  // em `app/api/incorporador/venda/proposta/route.ts:585`), e as duas portas estão escritas neste
  // arquivo: `apolo_esteira.enterprise_id` guarda a divisão E o grupo do catálogo (topo do arquivo),
  // e o mesmo CPF tem mais de uma entidade no Apolo (`maisRecentePorCad`). Abrir CAD nova é trivial;
  // indeferir exige motivo escrito e é etapa FINAL (`ETAPAS_FINAIS`,
  // `lib/apolo/incorporador/resumo-do-produto.ts`). Sem a varredura, a etapa mais nova ganharia por
  // acidente de ordem de escrita, não por decisão de ninguém.
  //
  // ⚠️ DEPOIS DO RAMO DO `credenciado`, DE PROPÓSITO: uma CAD credenciada em OUTRA entidade do
  // mesmo CPF continua valendo exatamente como antes deste lote. Apertar isso aqui recusaria quem
  // hoje passa, e esse é o erro caro — o corretor ouve "não credenciado" sobre alguém que está.
  //
  // ⚠️ SÓ NO MODO FROUXO, também de propósito: no modo apertado a porta já era `false` sem
  // `credenciado`, então a varredura não mudaria decisão nenhuma — mudaria só a FRASE que o portal
  // do Cecílio e a busca de proponentes mostram, e mexer no que ninguém pediu é outro lote.
  //
  // ⚠️ A RECUSA É LIDA DO MESMO MAPA que abre a porta (`LIBERA_COM_CAD_EM_ANDAMENTO_INTERNO`), e não
  // de um `=== "indeferido"` escrito à mão: no dia em que a esteira ganhar uma segunda etapa de
  // recusa, ela barra aqui sem precisar de um segundo lugar para lembrar disso.
  const recusa = modo.cadEmAndamentoLibera
    ? maisRecente(
        decisivas.filter((l) => {
          const etapaDaLinha = normalizarEtapa(l.etapa);
          return (
            Object.hasOwn(LIBERA_COM_CAD_EM_ANDAMENTO_INTERNO, etapaDaLinha) &&
            !LIBERA_COM_CAD_EM_ANDAMENTO_INTERNO[etapaDaLinha as EtapaEsteira]
          );
        }),
      )
    : null;

  // ⚠️ A ETAPA VOLTA MESMO SEM LIBERAR, e é o principal serviço desta função quando a resposta é
  // não: "em análise de crédito desde 02/09" é uma conversa (o corretor cobra a coordenação);
  // "não credenciado" é um muro. Entre várias CADs não credenciadas vale a MAIS RECENTE, com
  // desempate explícito — é a que a pessoa está mexendo, e sem ordem fixa a mesma pergunta daria
  // respostas diferentes a cada clique (o mesmo motivo do `order` de `lib/apolo/esteira-cad.ts`).
  //
  // ⚠️ A RECUSA VEM PRIMEIRO QUANDO EXISTE, e é isso que faz a tela NÃO MENTIR POR OMISSÃO: é ela
  // que vai para `entityId`, `etapa` e `motivo`, então o coordenador lê "está com o cadastro
  // indeferido desde 20/09/2026" em vez de "em revisão desde 26/09/2026" sobre um cliente reprovado.
  const escolhida = recusa ?? maisRecente(decisivas);

  // ⚠️ SEM CAD NENHUMA, MAS COM CONTRATO ATIVO NA FAMÍLIA: É O COMPRADOR DA CARTEIRA. Credenciado,
  // sem etapa (ainda não há CAD; ela nasce na gravação da proposta, nunca na leitura), e com a
  // entidade DO CONTRATO, que é onde a CAD vai nascer e a que a proposta aponta. Sem `desde`: não
  // há CAD para datar, e a data do contrato antigo fica dentro de `compra` (ver o tipo).
  if (!escolhida && compra) {
    return {
      compra,
      credenciado: true,
      desde: null,
      entityId: compra.entityIdDoContrato ?? entityIds[0] ?? null,
      etapa: null,
      motivo: null,
      origem: "comprador_da_carteira",
      // ⚠️ A CARTEIRA ABRE AS DUAS PORTAS, E ISSO É A PERGUNTA QUE A JUNÇÃO DE 26/09/2026 OBRIGOU A
      // RESPONDER — escrita aqui porque é aqui que ela é decidida.
      //
      // A proposta: `true` por `credenciado`, que é o pedido do Lucas (*"temos que aproveitar esses
      // cadastros de comprador"*). O CONTRATO: a barra lê `credenciado` (`cad-para-contrato.ts`,
      // *"faz uma barra, para enviar para contrato precisa da cad validada"*), e ela também passa.
      // É a leitura coerente com as duas frases, e é a que este arquivo já declarava no topo: a
      // carteira *"é a prova que SUBSTITUI a CAD quando ela não existe"*. Somado a isso, a CAD desta
      // pessoa NASCE `credenciado` na gravação da proposta (`cad-do-comprador.ts:114`): quando a barra
      // do contrato roda, dias depois, ela encontra uma CAD credenciada de verdade e diria sim de
      // qualquer modo. Recusar aqui só criaria uma incoerência entre os dois instantes.
      //
      // ⚠️ MEDIDO, porque o tamanho da decisão é parte dela (`bxgukywoxgivlrhjkwjx`, só SELECT,
      // 26/09/2026): 1.476 pessoas têm contrato faturado ativo numa família e NENHUMA CAD nessa
      // família — são elas que entram por aqui, de agora em diante.
      //
      // ⚠️ E OITO PROPOSTAS VIVAS JÁ ESTÃO NESTE RAMO, não zero — a versão anterior desta linha dizia
      // ZERO e estava errada. Das 7 em etapa `proposta`, 3 são barradas pela barra do contrato e
      // nenhuma das 3 entra por aqui (2 não têm CAD NEM faturado ativo na família: CDJ0403 no 22 e
      // MDB1306 no 21; a terceira TEM faturado ativo mas tem CAD em `revisao`, então quem decide é a
      // CAD e este ramo nem é alcançado). Mas das 422 em `assinatura`, OITO têm faturado ativo na
      // família e ZERO CAD no escopo: as do CNPJ da PREMOLL no empreendimento 30
      // (ADTC0704/0705/0706/0707/0801/0802/0803/0813). Elas só não chegam aqui hoje porque a entidade
      // do CNPJ não existe no Apolo e a função para no `if` de `entityIds.length === 0` — um sync de
      // CNPJ de distância. O SQL, o motivo e o gatilho estão em `A_CARTEIRA_VALE_PARA_O_CONTRATO`
      // (`cad-para-contrato.ts`), onde a barra mora.
      //
      // ⚠️ QUEM QUISER INVERTER ISSO NÃO MEXE AQUI: é um booleano na barra do contrato
      // (`A_CARTEIRA_VALE_PARA_O_CONTRATO`), de propósito, porque a pergunta é da barra e não da
      // régua. Pergunta ABERTA para o Lucas, relatada e não decidida por mim.
      podeGerarProposta: true,
    };
  }

  if (!escolhida) {
    return {
      compra: null,
      credenciado: false,
      desde: null,
      // ⚠️ AQUI O ID NÃO DECIDIU A RESPOSTA — não há CAD neste escopo, então não há linha para
      // decidir nada, e este é só o primeiro dos ids do CPF. Ele vem ordenado de
      // `entidadesDoDocumento` porque as duas consultas de lá voltam do PostgREST sem `order`: sem
      // ordem fixa, o mesmo clique devolveria ora a entidade fantasma, ora a real, e a tela
      // mostraria um id diferente a cada tentativa da mesma pergunta.
      entityId: entityIds[0] ?? null,
      etapa: null,
      motivo: "Este cliente não tem CAD neste empreendimento.",
      origem: null,
      // ⚠️ "SEM CAD NESTE EMPREENDIMENTO" NÃO É ETAPA, e continua barrando o coordenador (Lucas,
      // 26/09/2026). Sem linha na esteira não há CAD para estar em andamento — e, chegando aqui, a
      // carteira também já disse não (o ramo dela é o `if` logo acima).
      podeGerarProposta: false,
    };
  }

  const etapa = normalizarEtapa(escolhida.etapa);
  const desde = dataDaLinha(escolhida);

  return {
    compra: null,
    credenciado: false,
    desde,
    entityId: escolhida.entity_id,
    etapa: etapa || null,
    // ⚠️ A FRASE DA ETAPA CONTINUA VINDO, inclusive quando a porta abre. É ela que a tela mostra
    // como AVISO ("A CAD deste cliente está em validação de cadastro desde 26/09/2026") com o botão
    // liberado — o coordenador precisa continuar LENDO em que etapa a CAD está.
    motivo: motivoDaEtapa(etapa, desde),
    // ⚠️ A ORIGEM VEM DA LINHA ESCOLHIDA, E NÃO É UM `"cad"` FIXO (junção de 26/09/2026). A CAD que
    // nasceu da carteira e depois foi mexida no Board sai daqui, e a tela precisa continuar dizendo
    // "Comprador da carteira" ao lado do selo âmbar "CAD em andamento": é justamente o dado que
    // explica ao coordenador por que aquela pessoa tem CAD sem ter passado pela esteira. Ver
    // `OrigemDoCredenciamento` (zero linhas assim hoje, medido).
    origem: origemDaLinha(escolhida),
    podeGerarProposta: podeGerarProposta(etapa, false, modo),
  };
}

/**
 * Por qual porta esta LINHA de esteira nasceu: a carteira ou a esteira de sempre.
 *
 * ⚠️ `origem` É `text` LIVRE NA COLUNA, e há OITO valores vivos mais o nulo (medido em 26/09/2026:
 * `asana` 575, `publico-cad` 173, `teste-panteon-nivea` 36, `cadastro-manual` 38, `teste-hercules` 8,
 * `teste-hercules-villa-paris` 6, `manual` 1, `comprador_da_carteira` 1, e 4 linhas com `null`).
 * Qualquer valor que não seja o da carteira é `"cad"`: quem lê isto só quer saber se a prova foi um
 * contrato antigo, e inventar um terceiro rótulo põe nome de ferramenta interna na tela do corretor.
 */
function origemDaLinha(linha: LinhaDaEsteira): OrigemDoCredenciamento {
  return normalizarEtapa(linha.origem ?? null) === ORIGEM_COMPRADOR_DA_CARTEIRA
    ? "comprador_da_carteira"
    : "cad";
}

/**
 * Todas as entidades do Apolo que carregam este documento.
 *
 * ⚠️ DUAS FONTES, E AS DUAS SÃO OBRIGATÓRIAS. `apolo_entities.document_hash` só é preenchido por
 * quem NASCE no Apolo (eram 153 de 4.286); o sync do C2X grava `null` ali de propósito e guarda o
 * CPF em `apolo_entity_identifiers.value_hash`. Procurar só na primeira coluna é ser cego para a
 * quase totalidade da base — a pessoa existe, está credenciada, e a proposta é recusada.
 *
 * ⚠️ SEM `.limit(1)`. Os outros lugares do repo que fazem esta busca querem UMA entidade (para
 * deduplicar um cadastro novo); aqui queremos TODAS, porque basta uma delas estar credenciada.
 */
async function entidadesDoDocumento(
  admin: ClienteDeLeitura,
  digitos: string,
): Promise<string[]> {
  // ⚠️ O TIPO DO DOCUMENTO ESTÁ DENTRO DO HASH (`apolo-identifier:cpf:...`), e é exatamente por
  // isso que o namespace TEM DE VIR DO DOCUMENTO: um hash de CPF nunca casa com uma linha de CNPJ.
  // Até 26/09/2026 esta linha era `hashIdentifier("cpf", digitos)` fixo, e por isso nenhuma CAD de
  // empresa podia ser achada — a consulta ia ao banco, voltava vazia e a recusa saía sem erro
  // nenhum no log. Quem decide é `namespaceDoHash`.
  const hash = hashIdentifier(namespaceDoHash(digitos), digitos);

  const [porColuna, porIdentificador] = await Promise.all([
    admin.from("apolo_entities").select("id").eq("document_hash", hash),
    admin.from("apolo_entity_identifiers").select("entity_id").eq("value_hash", hash),
  ]);

  if (porColuna.error) {
    throw new FalhaAoLerCredenciamento(
      `apolo_entities: leitura falhou (${porColuna.error.message})`,
    );
  }
  if (porIdentificador.error) {
    throw new FalhaAoLerCredenciamento(
      `apolo_entity_identifiers: leitura falhou (${porIdentificador.error.message})`,
    );
  }

  const ids = new Set<string>();
  for (const linha of (porColuna.data ?? []) as Array<{ id: null | string }>) {
    if (linha.id) ids.add(linha.id);
  }
  for (const linha of (porIdentificador.data ?? []) as Array<{ entity_id: null | string }>) {
    if (linha.entity_id) ids.add(linha.entity_id);
  }

  // ⚠️ ORDENADO, e não na ordem em que o banco entregou. Nenhuma das duas consultas acima tem
  // `order`, e o PostgREST não promete ordem estável: sem o `sort` o conjunto é o mesmo, mas o
  // PRIMEIRO id muda de um clique para o outro — e é ele que a resposta devolve quando não existe
  // CAD no escopo. O próprio id serve de desempate final porque é único.
  return [...ids].sort();
}

/**
 * As CADs dessas pessoas DENTRO deste escopo.
 *
 * ⚠️ O FILTRO DE EMPREENDIMENTO É DO BANCO, não da memória. Ler a esteira inteira da pessoa e
 * escolher depois é o caminho que erra: quem já comprou no Vale do Ouro e abriu CAD nova no Garden
 * tem duas linhas, e a credenciada do Vale do Ouro liberaria a proposta de um lote do Garden.
 *
 * O `.in()` cabe numa URL porque os dois lados são curtos — a família de um empreendimento tem uma
 * mão-cheia de ids e um CPF tem duas ou três entidades. Se algum dia um deles crescer, isto precisa
 * de lotes (o PostgREST estoura o tamanho da URL sem dizer o motivo).
 */
async function lerEsteira(
  admin: ClienteDeLeitura,
  entityIds: string[],
  escopo: string[],
): Promise<LinhaDaEsteira[]> {
  const { data, error } = await admin
    .from("apolo_esteira")
    .select("atualizado_em, chegou_em, created_at, enterprise_id, entity_id, etapa, origem")
    .in("entity_id", entityIds)
    .in("enterprise_id", escopo);

  if (error) {
    throw new FalhaAoLerCredenciamento(`apolo_esteira: leitura falhou (${error.message})`);
  }

  return (data ?? []) as LinhaDaEsteira[];
}

/** A coluna é `text` livre: sem isto, um " Credenciado" gravado à mão nunca libera ninguém. */
function normalizarEtapa(valor: null | string): string {
  return String(valor ?? "").trim().toLowerCase();
}

/**
 * Ordem "mais recente primeiro", para `sort`.
 *
 * Mesmo critério do `order` da esteira: `atualizado_em`, depois `created_at`, depois o id do
 * empreendimento — e, por último, o `entity_id`, que é único e fecha o desempate. Sem esse último
 * critério duas CADs iguais em tudo ficariam na ordem em que o PostgREST as entregou, e a mesma
 * pergunta responderia coisas diferentes a cada clique.
 */
function doMaisRecente(a: LinhaDaEsteira, b: LinhaDaEsteira): number {
  const texto = (v: null | string) => v ?? "";

  return (
    texto(b.atualizado_em).localeCompare(texto(a.atualizado_em)) ||
    texto(b.created_at).localeCompare(texto(a.created_at)) ||
    texto(b.enterprise_id).localeCompare(texto(a.enterprise_id)) ||
    texto(b.entity_id).localeCompare(texto(a.entity_id))
  );
}

/**
 * A linha mais recente, ou `null` se não houver nenhuma.
 *
 * Devolver `null` em vez de assumir lista cheia é o que dispensa um `!` — e é o `null` que separa
 * "não tem CAD aqui" de "tem, e está nesta etapa".
 */
function maisRecente(linhas: LinhaDaEsteira[]): null | LinhaDaEsteira {
  return [...linhas].sort(doMaisRecente)[0] ?? null;
}

/**
 * Uma linha por CAD: a mais recente de cada `(entity_id, enterprise_id)`.
 *
 * ⚠️ A CHAVE É O PAR, E NÃO A ENTIDADE SOZINHA. Uma CAD é a ficha de uma PESSOA num
 * EMPREENDIMENTO — é essa a chave desde a migration 0080, e é com ela que o upsert da esteira grava
 * (`onConflict: "entity_id,enterprise_id"` em `lib/apolo/esteira.ts`). Agrupar só por entidade
 * parece equivalente e não é: o escopo que chega aqui vem EXPANDIDO pela família
 * (`familiaDoEmpreendimento` devolve VLO + VOL + VOC), então uma CAD nova num irmão apagaria a CAD
 * credenciada do pai, e a função recusaria um cliente credenciado. Foi o que uma versão anterior
 * fez, e errar para o lado apertado é o erro caro: o corretor ouve "não credenciado" sobre alguém
 * que está.
 *
 * ⚠️ AS DUAS METADES DA REGRA. Dentro da MESMA CAD, a decisão de ontem vence a de junho — é o que
 * impede um `credenciado` antigo de sobreviver a um `indeferido` recente. Entre CADs diferentes
 * (outra entidade do mesmo CPF, outro empreendimento da família), cada uma conta por si: a
 * credenciada pode estar em qualquer uma, e são 619 documentos duplicados no Apolo.
 */
function maisRecentePorCad(linhas: LinhaDaEsteira[]): LinhaDaEsteira[] {
  const porCad = new Map<string, LinhaDaEsteira>();

  for (const linha of linhas) {
    // ⚠️ SEPARADOR IMPRIMÍVEL, E DE PROPÓSITO. Aqui já houve um `\0` cru — que funciona em
    // JavaScript, mas faz o grep e o ripgrep classificarem o ARQUIVO INTEIRO como binário e
    // pularem: procurar `maisRecentePorCad` devolvia "Binary file matches", sem a linha. Este é o
    // portão que decide se a CAD do cliente está credenciada, e a auditoria desta casa é busca por
    // texto — um arquivo que a busca não enxerga é um arquivo que toda varredura futura declara
    // inexistente. `::` não aparece em uuid nem em `group:Nome`, então separa igual.
    const chave = `${linha.entity_id}::${String(linha.enterprise_id ?? "")}`;
    const atual = porCad.get(chave);

    if (!atual || doMaisRecente(linha, atual) < 0) {
      porCad.set(chave, linha);
    }
  }

  return [...porCad.values()];
}

/** `atualizado_em` é a data boa; `chegou_em` e `created_at` só existem para não devolver nada. */
function dataDaLinha(linha: LinhaDaEsteira): null | string {
  return linha.atualizado_em ?? linha.chegou_em ?? linha.created_at ?? null;
}

/**
 * A frase que a tela mostra.
 *
 * ⚠️ COM A DATA, e com o ANO. "Em análise de crédito desde 02/09" tranquiliza; a mesma frase sobre
 * uma CAD parada desde setembro do ano passado esconde justamente o que o corretor precisa ver.
 */
function motivoDaEtapa(etapa: string, desdeIso: null | string): string {
  const rotulo = Object.hasOwn(ROTULO_DA_ETAPA, etapa)
    ? ROTULO_DA_ETAPA[etapa as EtapaEsteira]
    : null;

  if (!rotulo) {
    return "A CAD deste cliente ainda não está credenciada neste empreendimento.";
  }

  const quando = desdeIso ? new Date(desdeIso) : null;
  const data = quando && !Number.isNaN(quando.getTime()) ? ` desde ${DIA.format(quando)}` : "";

  return `A CAD deste cliente está ${rotulo}${data}.`;
}
