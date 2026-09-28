// A HABILITAÇÃO DO CORRETOR AUTÔNOMO — empreendimento a empreendimento, igual à imobiliária.
//
// Lucas (27/09/2026), perguntado se o autônomo vende em tudo ou só onde a coordenação liberar:
// *"Sim, empreendimento a empreendimento"*. E a regra que manda em tudo isto, do mesmo dia:
// *"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria, isso sera bem restrito"*.
//
// ⚠️ A MESMA ESTRUTURA DE VÍNCULO DA IMOBILIÁRIA SERVE, E ISSO ESTÁ MEDIDO. A habilitação é um
// `apolo_relationships` com `relationship_type = 'empreendimento'` e `status = 'verified'`, e em
// 28/09/2026, em produção (bxgukywoxgivlrhjkwjx):
//   • JÁ EXISTEM 170 vínculos desse tipo em entidade `pf` (169 entidades), e nenhum leitor do vínculo
//     filtra por `entity_kind` ou por papel antes de aceitá-lo. `empreendimentosCredenciados`
//     (lib/publico/cad/dados.ts:328) chama o parâmetro de `imobiliariaEntityId`, mas a consulta só usa
//     o id. Nada de PJ está pressuposto na estrutura;
//   • ⚠️ E É EXATAMENTE POR ISSO QUE LER O VÍNCULO CRU SERIA UM FURO: desses 170, 169 têm
//     `metadata.source = 'publico-cad'` e estão em ficha com papel `prospect`. Eles NÃO são
//     habilitação: são a marca de qual produto é a CAD daquele cliente. Ler o vínculo sem separar a
//     fonte daria autorização de venda a todo cliente que já mandou CAD.
//     SQL: `select r.metadata->>'source', count(*) from apolo_relationships r join apolo_entities e on
//     e.id = r.entity_id where r.relationship_type = 'empreendimento' and e.entity_kind = 'pf'
//     group by 1;` → publico-cad 169, apolo 1.
//
// ⚠️ DUAS CERCAS, E AS DUAS PRECISAM VALER:
//   1. A FONTE, E ELA É LISTA DE INCLUSÃO (revisão de 28/09/2026). A porta do autônomo grava
//      `source = 'apolo-corretor-autonomo'` (`FONTE_DA_HABILITACAO_DO_AUTONOMO`), e a leitura aceita
//      SÓ ESSA fonte, descartando todo o resto. A primeira versão fazia o contrário (descartava o que
//      `origemDoVinculo` chama de `cad` e aceitava o resto), e por ali o modal de relacionamento da
//      ficha habilitava o autônomo em silêncio, sem auditoria e sem aviso ao coordenador. Autorização
//      não se escreve por exclusão: cada `source` novo que alguém inventar entraria sozinho;
//   2. O CÓDIGO. Só é autônomo da casa quem tem `apolo_entities.broker_code` (migration 0193). Os 131
//      corretores que o sync do C2X trouxe sem código não são autônomos cadastrados: Lucas, sobre
//      eles, *"são resíduo do c2x, pode ignorar"*. Medido em 28/09/2026: `select count(*) from
//      apolo_entities where broker_code is not null;` → 0 (a fatia 1 ainda não foi publicada).
//
// ⚠️ PESSOA FÍSICA NUNCA ENTRA COMO IMOBILIÁRIA, E A LINHA DE DEFESA É O PAPEL. O seletor de
// imobiliária do wizard sai de `apolo_entity_profiles.profile = 'imobiliaria'` (lib/apolo/server.ts,
// `loadApoloImobiliarias`), e medido em 28/09/2026 há 483 linhas com esse papel, TODAS `pj`, contra 132
// com papel `corretor`, TODAS `pf`: ZERO entidade `pf` com papel de imobiliária. Por isso a lista de
// autônomos daqui RECUSA quem tenha o papel `imobiliaria`, mesmo com código: no dia em que alguém der
// esse papel a um autônomo para resolver a habilitação, ele aparece no seletor, na lista de
// imobiliárias e no relatório de 18h30. A cerca é o papel, não a coluna da esteira.
//
// ⚠️ FAIL-CLOSED. Habilitação é AUTORIZAÇÃO: toda falha de leitura recusa. É o oposto da doutrina de
// aviso (onde leitura falhada trata tudo como novo, porque aviso repetido se vê e aviso ausente não):
// aqui o erro para o lado frouxo é venda de quem a coordenação não liberou.
//
// ⚠️ O QUE ESTE MÓDULO NÃO FAZ: desabilitar. Tirar a habilitação é arquivar o vínculo, pelo caminho que
// já existe (`/api/apolo/relationships/archive`), e a leitura daqui só aceita `verified`.
import { expandirPeloCadastro } from "@/lib/apolo/habilitacao-pelo-cadastro";
import { enterpriseIdDoVinculo } from "@/lib/apolo/habilitada-sem-fila";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/**
 * `metadata.source` que a porta da habilitação do autônomo grava.
 *
 * ⚠️ FONTE PRÓPRIA, E NÃO `apolo`. `origemDoVinculo` classifica `apolo` COM autor como `interna`, o que
 * funcionaria, mas deixaria a habilitação do autônomo indistinguível da do wizard de imobiliária numa
 * consulta de banco. Com fonte própria, `select ... where metadata->>'source' = 'apolo-corretor-autonomo'`
 * responde "quem é autônomo habilitado onde" numa linha, e é isso que a coordenação vai perguntar.
 */
export const FONTE_DA_HABILITACAO_DO_AUTONOMO = "apolo-corretor-autonomo";

/** O papel de nascimento do autônomo (fatia 1, lib/apolo/cadastro-tipos.ts). */
const PAPEL_DO_AUTONOMO = "corretor";
const PAPEL_DE_IMOBILIARIA = "imobiliaria";
const STATUS_VALIDO = "active";

// ⚠️ SEM JARGÃO. Quem lê estas frases é o operador do hub no meio de um cadastro, e a saída mais curta
// para ele, se a frase não explicar, é cadastrar a CAD como sendo de outra pessoa.
export const MENSAGEM_AUTONOMO_SEM_HABILITACAO =
  "Este corretor autônomo não está habilitado neste empreendimento, e sem isso a CAD do cliente dele " +
  "não pode ser aberta aqui. Peça a habilitação à coordenação do produto.";

/**
 * A MESMA FALTA, NA VENDA: a frase do portão da RESERVA, e não a da CAD (revisão de 28/09/2026).
 *
 * ⚠️ A FRASE DA CAD NO PORTÃO DA RESERVA MANDAVA O COORDENADOR PARA OUTRO MÓDULO. `podemVender`
 * devolvia `MENSAGEM_AUTONOMO_SEM_HABILITACAO` como motivo do 403 da reserva, e ela diz *"a CAD do
 * cliente dele não pode ser aberta aqui"*: quem está RESERVANDO um lote lê uma frase sobre abrir CAD,
 * que é outra tela e outro momento do processo. É o mesmo defeito que `RESERVA_SEM_QUEM_VENDE`
 * (lib/hercules/reserva.ts) foi criada para consertar duas linhas antes.
 *
 * ⚠️ O QUE MUDA É O EFEITO, NÃO O DIAGNÓSTICO: a falta é a mesma (vínculo de habilitação ausente) e o
 * caminho da solução é o mesmo (a coordenação do produto). Por isso as duas frases terminam igual.
 */
export const MENSAGEM_AUTONOMO_NAO_VENDE_AQUI =
  "Este corretor autônomo não está habilitado a vender neste empreendimento. Peça a habilitação à " +
  "coordenação do produto.";

export const MENSAGEM_NAO_E_AUTONOMO =
  "O corretor escolhido não é um corretor autônomo cadastrado pela Careli (ele não tem código). " +
  "Cadastre-o em Apolo > Cadastro > Corretor antes de abrir a CAD do cliente dele.";

export const MENSAGEM_FALHA_AO_LER_HABILITACAO =
  "Não foi possível conferir a habilitação do corretor autônomo agora. Tente de novo em instantes; " +
  "nada foi gravado.";

export type Autonomo = {
  /** `apolo_entities.broker_code`, o "CA-0001" da fatia 1. */
  codigo: string;
  entityId: string;
  nome: string;
};

export type RecusaDoAutonomo = {
  mensagem: string;
  motivo: "falha" | "nao-e-autonomo" | "nao-habilitado";
  ok: false;
};

/** O que a porta do cadastro recebe: o autônomo conferido, com nome e código do SERVIDOR. */
export type HabilitacaoConferida = { autonomo: Autonomo; ok: true };

type LinhaDeVinculo = {
  entity_id: null | string;
  metadata: null | Record<string, unknown>;
};

type LinhaDeEntidade = {
  broker_code: null | string;
  display_name: null | string;
  entity_kind: null | string;
  id: string;
  legal_name: null | string;
};

/**
 * ESTA ENTIDADE É UM CORRETOR AUTÔNOMO DA CASA?
 *
 * Exige as três coisas juntas: código (`broker_code`), pessoa FÍSICA e papel `corretor` ativo. E recusa
 * quem tenha o papel `imobiliaria`, mesmo satisfazendo o resto — é a regra do Lucas de 27/09/2026
 * aplicada na leitura, e não só na escrita.
 */
export async function lerAutonomo(
  client: AdminClient,
  entityId: string,
): Promise<HabilitacaoConferida | RecusaDoAutonomo> {
  const id = String(entityId ?? "").trim();
  if (!id) return { mensagem: MENSAGEM_NAO_E_AUTONOMO, motivo: "nao-e-autonomo", ok: false };

  const [entidade, papeis] = await Promise.all([
    client
      .from("apolo_entities")
      .select("broker_code, display_name, entity_kind, id, legal_name")
      .eq("id", id)
      .maybeSingle<LinhaDeEntidade>(),
    client
      .from("apolo_entity_profiles")
      .select("profile, status")
      .eq("entity_id", id)
      .limit(50),
  ]);

  // ⚠️ ERRO DE LEITURA NÃO É "NÃO É AUTÔNOMO": seria a recusa errada, e o operador iria cadastrar o
  // autônomo de novo achando que o primeiro não ficou.
  if (entidade.error || papeis.error) {
    console.error(
      "[apolo][autonomo] falha ao ler a ficha do corretor autonomo",
      entidade.error?.message ?? papeis.error?.message,
    );
    return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
  }

  const ficha = entidade.data;
  const codigo = String(ficha?.broker_code ?? "").trim();
  if (!ficha || !codigo) {
    return { mensagem: MENSAGEM_NAO_E_AUTONOMO, motivo: "nao-e-autonomo", ok: false };
  }
  if (String(ficha.entity_kind ?? "").trim() !== "pf") {
    return { mensagem: MENSAGEM_NAO_E_AUTONOMO, motivo: "nao-e-autonomo", ok: false };
  }

  const linhas = (papeis.data ?? []) as Array<{ profile: null | string; status: null | string }>;
  const temPapelDeImobiliaria = linhas.some(
    (linha) => String(linha.profile ?? "").trim() === PAPEL_DE_IMOBILIARIA,
  );
  if (temPapelDeImobiliaria) {
    return { mensagem: MENSAGEM_NAO_E_AUTONOMO, motivo: "nao-e-autonomo", ok: false };
  }
  const corretorAtivo = linhas.some(
    (linha) =>
      String(linha.profile ?? "").trim() === PAPEL_DO_AUTONOMO &&
      String(linha.status ?? "").trim() === STATUS_VALIDO,
  );
  if (!corretorAtivo) {
    return { mensagem: MENSAGEM_NAO_E_AUTONOMO, motivo: "nao-e-autonomo", ok: false };
  }

  return {
    autonomo: {
      codigo,
      entityId: ficha.id,
      nome: String(ficha.display_name ?? "").trim() || String(ficha.legal_name ?? "").trim() || "Corretor",
    },
    ok: true,
  };
}

/**
 * Os `enterpriseId` em que este autônomo está HABILITADO.
 *
 * ⚠️ O VÍNCULO DE CAD FICA FORA, e é aqui que a cerca 1 mora: `origemDoVinculo(metadata) === "cad"`
 * marca o que o formulário público de CAD e o Mover CAD gravam (169 linhas assim em `pf` hoje). Sem
 * este filtro, um cliente com CAD no 37 "habilitaria" a si mesmo a vender lá.
 */
export async function idsHabilitadosDoAutonomo(
  client: AdminClient,
  entityId: string,
): Promise<RecusaDoAutonomo | { ids: string[]; ok: true }> {
  const { data, error } = await client
    .from("apolo_relationships")
    .select("created_at, entity_id, metadata")
    .eq("entity_id", String(entityId ?? "").trim())
    .eq("relationship_type", "empreendimento")
    .eq("status", "verified")
    .limit(500);

  if (error) {
    console.error("[apolo][autonomo] falha ao ler as habilitacoes do corretor autonomo", error.message);
    return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
  }

  const linhas = (data ?? []) as Array<{
    created_at: null | string;
    entity_id: null | string;
    metadata: null | Record<string, unknown>;
  }>;
  const ids: string[] = [];
  for (const linha of linhas) {
    // ⚠️ SÓ A FONTE DA PORTA NOVA AUTORIZA, E ISSO É LISTA DE INCLUSÃO (revisão de 28/09/2026).
    // A primeira versão descartava o que `origemDoVinculo` classificava como `cad` e aceitava TODO
    // O RESTO, que é escrever autorização por exclusão. `origemDoVinculo` só devolve `cad` para
    // `source = 'publico-cad'` e `origem = 'mover-cad'` (lib/apolo/habilitada-sem-fila.ts:88):
    // qualquer outra coisa caía em `interna` ou `fila` e virava habilitação.
    // ⚠️ O FURO ESTAVA NO AR E ESTÁ MEDIDO: `/api/apolo/relationships/create` (route.ts:114-126)
    // grava o vínculo `empreendimento` `verified` com `source: "apolo"` + `createdBy`, sem olhar
    // papel nem `entity_kind`, e por ali `habilitacaoPeloVinculo` devolve `nao-e-habilitacao` (exige
    // papel `imobiliaria` ativo), ou seja: o modal da ficha habilitava o autônomo EM SILÊNCIO, sem
    // auditoria `corretor_autonomo_habilitado` e sem aviso ao coordenador. É o silêncio que o Lucas
    // proibiu em 24/09/2026 ("3 - Isso ae"). Em produção (bxgukywoxgivlrhjkwjx, 28/09/2026) já
    // existe UMA linha assim em `pf`: `select e.entity_kind, r.metadata->>'source', r.status,
    // count(*) from apolo_relationships r join apolo_entities e on e.id = r.entity_id where
    // r.relationship_type = 'empreendimento' and e.entity_kind = 'pf' group by 1,2,3;` →
    // publico-cad/verified 168, publico-cad/archived 1, apolo/verified 1.
    // A checagem de CAD continua valendo de graça: `publico-cad` nunca é igual à fonte nova.
    const fonte = String(linha.metadata?.source ?? "").trim();
    if (fonte !== FONTE_DA_HABILITACAO_DO_AUTONOMO) continue;
    const id = enterpriseIdDoVinculo(linha.metadata);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return { ids, ok: true };
}

/**
 * ESTE AUTÔNOMO PODE ABRIR CAD NESTE EMPREENDIMENTO?
 *
 * ⚠️ O PAI E O GRUPO CONTAM, pela MESMA peça que a habilitação da imobiliária usa
 * (`expansorDeEmpreendimentos`, lib/apolo/habilitacao-pelo-cadastro.ts): habilitar o Vale do Ouro
 * ("35") cobre as divisões (36, 37, 41), e uma CAD gravada em `group:Lagoa Bonita` casa com a
 * habilitação numa das glebas. Sem isso a régua recusaria um autônomo habilitado de verdade, que é o
 * erro que o corretor não tem como discutir com a tela (foi o caso DANY CASTRO no portal público).
 *
 * `expandir` é injetável só para o teste; em produção o cadastro do Panteon é lido AQUI
 * (`carregarCadastroDeEmpreendimentos`) e a leitura que falha RECUSA com `motivo: "falha"`, nunca cai
 * na identidade. Ver o comentário no corpo.
 */
export async function conferirHabilitacaoDoAutonomo(
  client: AdminClient,
  params: {
    enterpriseId: string;
    entityId: string;
    expandir?: (id: string) => string[];
  },
): Promise<HabilitacaoConferida | RecusaDoAutonomo> {
  const enterpriseId = String(params.enterpriseId ?? "").trim();
  if (!enterpriseId) {
    return { mensagem: MENSAGEM_AUTONOMO_SEM_HABILITACAO, motivo: "nao-habilitado", ok: false };
  }

  const autonomo = await lerAutonomo(client, params.entityId);
  if (!autonomo.ok) return autonomo;

  const habilitados = await idsHabilitadosDoAutonomo(client, params.entityId);
  if (!habilitados.ok) return habilitados;
  if (habilitados.ids.length === 0) {
    return { mensagem: MENSAGEM_AUTONOMO_SEM_HABILITACAO, motivo: "nao-habilitado", ok: false };
  }

  // ⚠️ AQUI NÃO ENTRA O EXPANSOR TOLERANTE (revisão de 28/09/2026). `expansorDeEmpreendimentos`
  // (lib/apolo/habilitacao-pelo-cadastro.ts:147-158) devolve a IDENTIDADE quando a leitura do cadastro
  // do Panteon falha, e a justificativa escrita lá vale para o uso ORIGINAL dela, que é decidir se
  // AVISA o coordenador: *"pior caso, um aviso repetido, nunca um salvamento derrubado"*. Numa régua de
  // AUTORIZAÇÃO ela erra para o outro lado: com a identidade, a habilitação no PAI 35 deixa de cobrir a
  // divisão 37 e esta função recusaria um autônomo habilitado DE VERDADE, com a frase que manda o
  // operador pedir habilitação à coordenação, que já existe. É o erro que o corretor não tem como
  // discutir com a tela (foi o caso DANY CASTRO), e o diagnóstico sairia errado: o problema é leitura,
  // não autorização. Leitura que falha vira `falha` (503, "tente de novo"), como as duas leituras acima.
  let expandir: (id: string) => string[];
  if (params.expandir) {
    expandir = params.expandir;
  } else {
    try {
      const cadastro = await carregarCadastroDeEmpreendimentos();
      expandir = (id: string) => expandirPeloCadastro(id, cadastro);
    } catch (erro) {
      console.error(
        "[apolo][autonomo] falha ao ler o cadastro de empreendimentos da habilitacao",
        erro,
      );
      return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
    }
  }
  const permitidos = new Set<string>();
  for (const id of habilitados.ids) {
    permitidos.add(id);
    for (const coberto of expandir(id)) permitidos.add(coberto);
  }
  const alvo = [enterpriseId, ...expandir(enterpriseId)];
  if (!alvo.some((id) => permitidos.has(id))) {
    return { mensagem: MENSAGEM_AUTONOMO_SEM_HABILITACAO, motivo: "nao-habilitado", ok: false };
  }

  return autonomo;
}

/**
 * OS AUTÔNOMOS HABILITADOS NESTE ESCOPO DE EMPREENDIMENTOS — o inverso de `idsHabilitadosDoAutonomo`.
 *
 * É a consulta que alimenta o seletor da reserva (`quemPodeVender`) e o portão do POST
 * (`podemVender`). Lucas (28/09/2026), sobre a reserva do autônomo: *"pode fazer, exige um dos dois"*.
 *
 * ⚠️ CONSULTA PRÓPRIA, E ISSO É REGRA E NÃO ARRUMAÇÃO. `lerImobiliariasVinculadas` tem QUATRO outros
 * consumidores fora do Hércules (`/api/apolo/imobiliarias`, `/api/incorporador/crm`,
 * `/api/incorporador/produto/imobiliarias`, `/api/incorporador/produto/resumo`): um autônomo
 * acrescentado ali apareceria no CRM, na aba do produto e no resumo. Lucas (27/09/2026): *"nao quero
 * ter a informacao que pode ter pessoa fisica como imobiliaria, isso sera bem restrito"*.
 *
 * ⚠️ O ESCOPO É O MESMO QUE AS IMOBILIÁRIAS RECEBEM (`escopoDeQuemVende`): a família do
 * empreendimento mais o grupo do catálogo. Com o id cru, o autônomo habilitado no pai 35 desapareceria
 * no lote do 37 — é o bug da MORVIAN repetido.
 *
 * ⚠️ AS DUAS CERCAS DA FATIA 2 CONTINUAM VALENDO, E ELAS SÃO O MOTIVO DE ESTA FUNÇÃO NÃO LER O VÍNCULO
 * CRU: a fonte é LISTA DE INCLUSÃO (`FONTE_DA_HABILITACAO_DO_AUTONOMO`), e a lista de pessoas vem de
 * `listarCorretoresAutonomos`, que exige código + `pf` + papel `corretor` ativo e RECUSA quem tenha
 * papel `imobiliaria`. Sem a primeira, os 169 vínculos `publico-cad` em `pf` medidos em produção
 * dariam autorização de venda a todo cliente que já mandou CAD.
 *
 * ⚠️ FAIL-CLOSED NO PORTÃO, MAS FALHA NÃO É VAZIO (revisão de 28/09/2026). Esta função devolve
 * resultado DISCRIMINADO, como `idsHabilitadosDoAutonomo` já fazia, e por dois motivos:
 *   1. o PORTÃO (`podemVender`) precisa recusar na falha — e recusar com a frase da falha e 503, não
 *      com "não está habilitado" e 403, que manda o coordenador pedir à coordenação uma habilitação
 *      que já existe (é o erro de diagnóstico do caso DANY CASTRO, de novo);
 *   2. a LISTA (`quemPodeVender`) precisa DIZER que não conseguiu carregar, exatamente como já diz
 *      quando `lerImobiliariasVinculadas` falha. Devolver `[]` na falha desenhava uma lista curta como
 *      se fosse completa, e a tela escrevia "Ninguém habilitado a vender neste empreendimento" de um
 *      empreendimento onde o autônomo está habilitado. A doutrina já estava escrita em `lerAutonomo`:
 *      *"ERRO DE LEITURA NÃO É NÃO É AUTÔNOMO"*.
 *
 * ⚠️ O `try/catch` COBRE O QUE O `error` DO PostgREST NÃO COBRE. Esta função roda dentro de um
 * `Promise.all` junto com a leitura das imobiliárias (lib/hercules/quem-pode-vender.ts): uma EXCEÇÃO
 * aqui (rede, timeout, qualquer throw nos lotes de `lerCorretoresAutonomos`) rejeitava o `Promise.all`
 * e o GET inteiro virava 503, derrubando a modal de reserva até para quem só vende por imobiliária.
 */
export async function autonomosHabilitadosNoEmpreendimento(
  client: AdminClient,
  enterpriseIds: string[],
): Promise<RecusaDoAutonomo | { autonomos: Autonomo[]; ok: true }> {
  const escopo = new Set(
    (enterpriseIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean),
  );
  // Escopo vazio não é "qualquer empreendimento": é pergunta sem alvo, e a resposta é ninguém.
  if (escopo.size === 0) return { autonomos: [], ok: true };

  try {
    const vinculos = await vinculosDaHabilitacaoDoAutonomo(client);
    if (!vinculos.ok) return vinculos;

    const habilitados = new Set<string>();
    for (const linha of vinculos.linhas) {
      const enterpriseId = enterpriseIdDoVinculo(linha.metadata);
      if (!enterpriseId || !escopo.has(enterpriseId)) continue;
      const entityId = String(linha.entity_id ?? "").trim();
      if (entityId) habilitados.add(entityId);
    }
    if (habilitados.size === 0) return { autonomos: [], ok: true };

    const todos = await lerCorretoresAutonomos(client);
    if (!todos.ok) return todos;
    return {
      autonomos: todos.autonomos.filter((autonomo) => habilitados.has(autonomo.entityId)),
      ok: true,
    };
  } catch (erro) {
    console.error("[apolo][autonomo] excecao ao ler as habilitacoes do escopo", erro);
    return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
  }
}

/**
 * OS VÍNCULOS DE HABILITAÇÃO DO AUTÔNOMO — a fonte filtrada NO SERVIDOR, e paginada.
 *
 * ⚠️ A FONTE VAI NO SQL, E NÃO EM JAVASCRIPT DEPOIS (revisão de 28/09/2026). A primeira versão lia
 * TODOS os vínculos `empreendimento`/`verified` com `.limit(2000)` e separava a fonte em JS. O
 * `.limit(2000)` não levanta nada: o teto do PostgREST neste projeto é de 1.000 linhas por página, e é
 * o que a própria casa escreve em cinco arquivos (lib/apolo/carteira-da-venda.ts:159,
 * lib/apolo/board-do-servidor.ts:918, lib/apolo/incorporador/assinaturas.ts:1378,
 * lib/apolo/arquivos-do-produto-servidor.ts:290, lib/apolo/incorporador/imobiliarias-do-produto.ts:436).
 * Passado o teto, o corte volta CALADO — sem erro e sem log — e a habilitação do autônomo, que é UMA
 * linha nesse mar, é a primeira candidata a ficar fora.
 *
 * ⚠️ E O TETO ESTÁ PERTO, MEDIDO em produção (bxgukywoxgivlrhjkwjx, 28/09/2026, só SELECT):
 * `select count(*) from apolo_relationships where relationship_type='empreendimento'` → 612, das quais
 * 605 `verified` (61% do teto); e o crescimento por mês de criação é 25 em julho, 325 em agosto e 262
 * em setembro, porque cada CAD do formulário público grava uma dessas linhas. Nesse ritmo o teto cai em
 * cerca de um mês e meio. Com a fonte no SQL a resposta tem HOJE zero linhas
 * (`... and metadata->>'source' = 'apolo-corretor-autonomo'` → 0, a fatia 1 ainda não foi publicada) e
 * amanhã dezenas: é a consulta barata, e é justamente para isso que a fonte própria foi criada.
 *
 * ⚠️ O FILTRO DE jsonb NÃO É NOVIDADE NESTA CASA: `.eq("metadata->>source", …)` já roda em produção em
 * lib/apolo/board-do-servidor.ts:348 e :372 e em lib/apolo/c2x-write-server.ts:1935, e `.or` com
 * `metadata->>habilitadoEm` na MESMA tabela em lib/apolo/board-do-servidor.ts:948.
 *
 * ⚠️ A REDE DUPLA É A PAGINAÇÃO, com `order` estável, como `habilitacoesRecentes` já faz na MESMA
 * tabela (lib/apolo/board-do-servidor.ts:938-953). Sem `order`, o que sobra de um corte é a ordem
 * física, que não é ordem nenhuma. E página que enlouquece não prende a leitura: o teto de páginas é
 * a saída.
 *
 * ⚠️ O TETO DE PÁGINAS ATINGIDO É FALHA, E NÃO RESPOSTA. Habilitação é autorização: devolver a lista
 * cortada aqui seria repetir o silêncio que esta função existe para fechar.
 */
async function vinculosDaHabilitacaoDoAutonomo(
  client: AdminClient,
): Promise<RecusaDoAutonomo | { linhas: LinhaDeVinculo[]; ok: true }> {
  const PAGINA = 1000;
  const TETO_DE_PAGINAS = 10;
  const linhas: LinhaDeVinculo[] = [];

  for (let pagina = 0; pagina < TETO_DE_PAGINAS; pagina += 1) {
    const { data, error } = await client
      .from("apolo_relationships")
      .select("entity_id, metadata")
      .eq("relationship_type", "empreendimento")
      .eq("status", "verified")
      .eq("metadata->>source", FONTE_DA_HABILITACAO_DO_AUTONOMO)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);

    if (error) {
      console.error("[apolo][autonomo] falha ao ler as habilitacoes do escopo", error.message);
      return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
    }
    const lidas = (data ?? []) as LinhaDeVinculo[];
    linhas.push(...lidas);
    if (lidas.length < PAGINA) return { linhas, ok: true };
  }

  console.error(
    "[apolo][autonomo] teto de paginas atingido lendo as habilitacoes do escopo",
    { paginas: TETO_DE_PAGINAS, porPagina: PAGINA },
  );
  return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
}

/**
 * OS CORRETORES AUTÔNOMOS DA CASA, para o seletor do wizard e para a tela de habilitação.
 *
 * ⚠️ ESTA LISTA NÃO É, E NUNCA PODE SER, UMA LISTA DE IMOBILIÁRIAS. Ela é lida por rota própria
 * (`/api/apolo/corretores-autonomos`), separada de `/api/apolo/imobiliarias`, exatamente para que
 * nenhuma tela que pede imobiliárias receba uma pessoa física de volta.
 *
 * ⚠️ FALHA DE LEITURA DEVOLVE VAZIO, e não uma lista pela metade: meia lista faria o operador concluir
 * que o autônomo não está cadastrado e cadastrá-lo de novo, queimando um número da sequência.
 *
 * ⚠️ QUEM PRECISA SABER SE FOI FALHA OU SE NÃO HÁ NINGUÉM usa `lerCorretoresAutonomos`, abaixo. Esta
 * casca fina existe porque a rota do seletor do wizard (`/api/apolo/corretores-autonomos`) e a tela de
 * habilitação só sabem desenhar uma lista.
 */
export async function listarCorretoresAutonomos(client: AdminClient): Promise<Autonomo[]> {
  const lidos = await lerCorretoresAutonomos(client);
  return lidos.ok ? lidos.autonomos : [];
}

/**
 * A MESMA LISTA, DIZENDO SE A LEITURA DEU CERTO — o que o portão da reserva e o seletor precisam.
 *
 * ⚠️ FALHA E VAZIO NÃO PODEM SER A MESMA RESPOSTA (revisão de 28/09/2026). Os três `return []` de erro
 * que moravam aqui (papéis e fichas) chegavam ao portão da reserva como "não está habilitado" e à modal
 * como "ninguém habilitado a vender", que são afirmações FALSAS sobre o cadastro: uma instabilidade de
 * dez segundos no Supabase fazia o coordenador ligar para a coordenação pedindo uma habilitação que já
 * existe, e são dias de espera para uma reserva que sairia no minuto seguinte com um F5.
 */
async function lerCorretoresAutonomos(
  client: AdminClient,
): Promise<RecusaDoAutonomo | { autonomos: Autonomo[]; ok: true }> {
  const { data: papeis, error: erroDosPapeis } = await client
    .from("apolo_entity_profiles")
    .select("entity_id, profile, status")
    .in("profile", [PAPEL_DO_AUTONOMO, PAPEL_DE_IMOBILIARIA])
    .limit(5000);

  if (erroDosPapeis) {
    console.error("[apolo][autonomo] falha ao ler os papeis dos corretores", erroDosPapeis.message);
    return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
  }

  const linhas = (papeis ?? []) as Array<{
    entity_id: null | string;
    profile: null | string;
    status: null | string;
  }>;
  const comPapelDeImobiliaria = new Set<string>();
  const corretoresAtivos = new Set<string>();
  for (const linha of linhas) {
    const id = String(linha.entity_id ?? "").trim();
    if (!id) continue;
    const papel = String(linha.profile ?? "").trim();
    if (papel === PAPEL_DE_IMOBILIARIA) comPapelDeImobiliaria.add(id);
    if (papel === PAPEL_DO_AUTONOMO && String(linha.status ?? "").trim() === STATUS_VALIDO) {
      corretoresAtivos.add(id);
    }
  }
  const candidatos = [...corretoresAtivos].filter((id) => !comPapelDeImobiliaria.has(id));
  if (candidatos.length === 0) return { autonomos: [], ok: true };

  // Em lotes de 100: o `.in()` do PostgREST vai na URL, e a lista inteira de corretores a estouraria
  // (é o mesmo teto que o Board já respeita em `lerEntidadesEmLotes`).
  const autonomos: Autonomo[] = [];
  for (let i = 0; i < candidatos.length; i += 100) {
    const { data, error } = await client
      .from("apolo_entities")
      .select("broker_code, display_name, entity_kind, id, legal_name")
      .in("id", candidatos.slice(i, i + 100))
      .not("broker_code", "is", null)
      .limit(100);
    if (error) {
      console.error("[apolo][autonomo] falha ao ler as fichas dos autonomos", error.message);
      return { mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO, motivo: "falha", ok: false };
    }
    for (const ficha of (data ?? []) as LinhaDeEntidade[]) {
      const codigo = String(ficha.broker_code ?? "").trim();
      if (!codigo) continue;
      if (String(ficha.entity_kind ?? "").trim() !== "pf") continue;
      autonomos.push({
        codigo,
        entityId: ficha.id,
        nome:
          String(ficha.display_name ?? "").trim() ||
          String(ficha.legal_name ?? "").trim() ||
          "Corretor",
      });
    }
  }

  return { autonomos: autonomos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), ok: true };
}
