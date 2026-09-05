// A CAD DO TITULAR ESTÁ CREDENCIADA NESTE EMPREENDIMENTO? — a régua que deixa a reserva virar
// proposta.
//
// Lucas (04/09/2026): *"para virar proposta, a CAD do titular tem que estar credenciada naquele
// empreendimento"*.
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

import type { SupabaseClient } from "@supabase/supabase-js";

import { soDigitos } from "@/lib/apolo/documento";
import type { EtapaEsteira } from "@/lib/apolo/esteira";
import { hashIdentifier } from "@/lib/apolo/server";

// Só o `from` é usado. Aceita tanto o admin client do Apolo quanto um SupabaseClient cru — os dois
// convivem nas libs do Hércules — e é o que permite testar com um cliente falso.
type ClienteDeLeitura = Pick<SupabaseClient, "from">;

/** A etapa que libera a proposta. Uma só, e é o fim da esteira. */
export const ETAPA_QUE_LIBERA = "credenciado";

export type CredenciamentoDoTitular = {
  credenciado: boolean;
  /**
   * Desde quando a CAD encontrada está assim, em ISO.
   *
   * ⚠️ É `atualizado_em`, E ELE NÃO É "ENTRADA NA ETAPA". A esteira não guarda a data de cada
   * transição: `atualizado_em` muda em QUALQUER escrita da linha (o analista trocou o corretor, o
   * sync mexeu no empreendimento). Serve para a frase "desde 02/09" porque é a melhor aproximação
   * que existe, e é preciso saber disso antes de usá-lo como prova de prazo.
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

type LinhaDaEsteira = {
  atualizado_em: null | string;
  chegou_em: null | string;
  created_at: null | string;
  enterprise_id: null | string;
  entity_id: string;
  etapa: null | string;
};

/**
 * Este CPF pode ser titular de uma proposta neste empreendimento?
 *
 * `enterpriseIds` é o escopo JÁ EXPANDIDO (família + grupo) — ver o aviso no topo do arquivo.
 *
 * @throws {FalhaAoLerCredenciamento} quando o banco não respondeu, ou quando o escopo veio vazio.
 */
export async function credenciadoParaVender(
  admin: ClienteDeLeitura,
  alvo: { cpf: string; enterpriseIds: string[] },
): Promise<CredenciamentoDoTitular> {
  // ⚠️ NORMALIZAR ANTES DE HASHEAR. O CPF chega como o corretor digitou ("529.982.247-25") e como a
  // reserva gravou ("52998224725"); `hashIdentifier` não normaliza nada, então os dois formatos
  // gerariam hashes diferentes e o mesmo cliente ora seria achado, ora não.
  const digitos = soDigitos(alvo.cpf);

  // Não vale o dígito verificador aqui: o CPF do titular já passou pelo `cpfValido` da reserva, e
  // repetir a régua só criaria um segundo lugar para ela divergir. O que interessa é ter documento
  // suficiente para procurar.
  if (digitos.length !== 11) {
    return {
      credenciado: false,
      desde: null,
      entityId: null,
      etapa: null,
      motivo: "Informe o CPF do titular para conferir o credenciamento.",
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

  if (entityIds.length === 0) {
    return {
      credenciado: false,
      desde: null,
      entityId: null,
      etapa: null,
      motivo: "Este CPF não tem cadastro no Apolo. Abra a CAD antes de gerar a proposta.",
    };
  }

  const linhas = await lerEsteira(admin, entityIds, escopo);

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
      credenciado: true,
      desde: dataDaLinha(credenciada),
      entityId: credenciada.entity_id,
      etapa: ETAPA_QUE_LIBERA,
      motivo: null,
    };
  }

  // ⚠️ A ETAPA VOLTA MESMO SEM LIBERAR, e é o principal serviço desta função quando a resposta é
  // não: "em análise de crédito desde 02/09" é uma conversa (o corretor cobra a coordenação);
  // "não credenciado" é um muro. Entre várias CADs não credenciadas vale a MAIS RECENTE, com
  // desempate explícito — é a que a pessoa está mexendo, e sem ordem fixa a mesma pergunta daria
  // respostas diferentes a cada clique (o mesmo motivo do `order` de `lib/apolo/esteira-cad.ts`).
  const escolhida = maisRecente(decisivas);

  if (!escolhida) {
    return {
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
    };
  }

  const etapa = normalizarEtapa(escolhida.etapa);
  const desde = dataDaLinha(escolhida);

  return {
    credenciado: false,
    desde,
    entityId: escolhida.entity_id,
    etapa: etapa || null,
    motivo: motivoDaEtapa(etapa, desde),
  };
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
  // O tipo do documento já está DENTRO do hash (`apolo-identifier:cpf:...`), então não há filtro
  // de `identifier_type` a fazer: um hash de CPF nunca casa com uma linha de CNPJ.
  const hash = hashIdentifier("cpf", digitos);

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
    .select("atualizado_em, chegou_em, created_at, enterprise_id, entity_id, etapa")
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
    const chave = `${linha.entity_id} ${String(linha.enterprise_id ?? "")}`;
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
