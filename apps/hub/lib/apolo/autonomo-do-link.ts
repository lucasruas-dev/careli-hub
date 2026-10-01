// O CORRETOR AUTÔNOMO QUE SE CADASTRA PELO LINK PÚBLICO — o pedido, a fila e as três decisões.
//
// Lucas (01/10/2026): *"fizemos o processo de cadastro de corretor autonomo, mas ele seria para o time
// interno, preciso criar o link publico igual temos da cad, imobiliaria"*. E, na rodada de decisões do
// mesmo dia: validação numa tela nova do Apolo com as três ações da imobiliária (aprovar, pedir
// correção, indeferir); o autônomo INDICA empreendimentos de interesse, que viram só pedido; os
// documentos do link são identidade e comprovante de endereço, sem certidão de estado civil; e o
// cadastro novo avisa pelo sino do hub.
//
// ⚠️ A REGRA QUE NÃO PODE QUEBRAR: O LINK CAI NA MESMA ENTIDADE E NA MESMA VALIDAÇÃO. Nada de cadastro
// paralelo. A ficha nasce por `createApoloEntity`, com o papel `corretor`, como o cadastro interno
// (lib/apolo/cadastro-salvar.ts). O que separa os dois caminhos é QUEM preencheu, exatamente como na
// imobiliária ([[reference_apolo_validacao_imobiliaria_tres_acoes]]): o time valida ao cadastrar, o
// link espera alguém do time aprovar.
//
// ⚠️ A TRAVA É O CÓDIGO CA, E NÃO O STATUS DO PAPEL. Medido lendo o código (01/10/2026): TODO leitor de
// autônomo exige `apolo_entities.broker_code` (`lerAutonomo` e `lerCorretoresAutonomos` em
// lib/apolo/habilitacao-do-autonomo.ts), e é por eles que passam a CAD do cliente, a reserva, a
// habilitação e o envio ao C2X. Por isso o link grava SEM código, e o código só nasce na aprovação:
//   • quem é corretor de imobiliária (papel `corretor` já `active`) e pede para ser autônomo continua
//     sendo o que era; rebaixar o papel dele para `review` tiraria a imobiliária dele do ar;
//   • e mesmo que o papel fique `active` por qualquer caminho, sem código ele não é autônomo em lugar
//     nenhum. Aprovar = gerar o código e ativar o papel, que é o que o cadastro interno grava.
//
// ⚠️ ONDE O PEDIDO MORA: EM `apolo_audit_events`, E NÃO NO `metadata` DA FICHA. O sync do C2X substitui
// o jsonb INTEIRO da ficha que veio de lá (a lição da migration 0183), e o link reaproveita a ficha que
// a pessoa já tem. A trilha de eventos só cresce, ninguém a reescreve, e a fila sai dela: o estado de um
// pedido é a ÚLTIMA destas quatro ações na ficha. `action` é `text` sem CHECK (medido em 28/09/2026 e
// escrito em lib/apolo/autonomo-cadastro.ts), então NÃO PRECISA DE MIGRATION.
import {
  agruparEUploadDocumentos,
  type DocumentoEntrada,
} from "@/lib/apolo/cadastro-upload";
import {
  createApoloEntity,
  fichasDoDocumento,
  type CreateApoloEntityInput,
  type CreateApoloEntityResult,
} from "@/lib/apolo/cadastro-persist";
import { proximoCodigoDoCorretor } from "@/lib/apolo/codigo-do-corretor";
import {
  mensagemAutonomoAprovado,
  mensagemAutonomoCorrecao,
  mensagemAutonomoIndeferido,
} from "@/lib/apolo/credenciamento-mensagens";
import { enviarPeloRelacionamento } from "@/lib/apolo/disparo-credenciamento";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { publishHubNotification } from "@/lib/notifications/publish";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** `metadata.origem` da ficha que nasce pelo link, e a origem dos eventos do pedido. */
export const ORIGEM_DO_LINK_DO_AUTONOMO = "publico-autonomo";

/** O endereço do link, para a mensagem de correção dizer onde reenviar. */
export const LINK_DO_CADASTRO_DO_AUTONOMO = "https://c2x.app.br/publico/autonomo";

/**
 * As quatro ações da trilha do pedido.
 *
 * ⚠️ NENHUMA É `corretor_autonomo_habilitado`: aquela é a habilitação num EMPREENDIMENTO
 * (lib/apolo/autonomo-cadastro.ts), outra decisão, que continua sendo do time e produto a produto.
 */
export const ACOES_DO_PEDIDO = {
  aprovado: "corretor_autonomo_aprovado",
  correcao: "corretor_autonomo_correcao",
  indeferido: "corretor_autonomo_indeferido",
  solicitado: "corretor_autonomo_solicitado",
} as const;

const ACOES = Object.values(ACOES_DO_PEDIDO);

export type EstadoDoPedido = "aprovado" | "correcao" | "em-analise" | "indeferido";

const ESTADO_DA_ACAO: Record<string, EstadoDoPedido> = {
  [ACOES_DO_PEDIDO.aprovado]: "aprovado",
  [ACOES_DO_PEDIDO.correcao]: "correcao",
  [ACOES_DO_PEDIDO.indeferido]: "indeferido",
  [ACOES_DO_PEDIDO.solicitado]: "em-analise",
};

const PAPEL_DO_AUTONOMO = "corretor";
const PAPEL_DE_IMOBILIARIA = "imobiliaria";

export type EventoDoPedido = {
  action: string;
  created_at: string;
  entity_id: string;
  metadata?: null | Record<string, unknown>;
};

/**
 * O estado do pedido é a ÚLTIMA das quatro ações. `null` = a ficha nunca pediu pelo link.
 *
 * Empate de horário (dois eventos no mesmo milissegundo) resolve pela ordem que chegou, que é a do
 * banco: não acontece na prática, e o desempate não pode inventar uma decisão.
 */
export function estadoDoPedido(eventos: EventoDoPedido[]): EstadoDoPedido | null {
  let ultimo: EventoDoPedido | null = null;
  for (const evento of eventos) {
    if (!ESTADO_DA_ACAO[evento.action]) continue;
    if (!ultimo || Date.parse(evento.created_at) > Date.parse(ultimo.created_at)) ultimo = evento;
  }
  return ultimo ? (ESTADO_DA_ACAO[ultimo.action] ?? null) : null;
}

// ---------------------------------------------------------------------------
// O PORTÃO DO LINK: o CPF pode começar um cadastro?
// ---------------------------------------------------------------------------

export type SituacaoNoPortao = "em-analise" | "ja-autonomo" | "liberado";

/**
 * A decisão do portão, pura.
 *
 *   • tem código           → já é autônomo da casa: não há o que cadastrar de novo;
 *   • pedido em análise    → espera a resposta (reenviar só empilharia pedidos iguais);
 *   • o resto              → liberado. Inclui CORREÇÃO (é assim que ele corrige: reenvia pelo link) e
 *                            INDEFERIDO (pode tentar de novo; o time decide outra vez).
 */
export function situacaoNoPortao(input: {
  estado: EstadoDoPedido | null;
  temCodigo: boolean;
}): SituacaoNoPortao {
  if (input.temCodigo) return "ja-autonomo";
  if (input.estado === "em-analise") return "em-analise";
  return "liberado";
}

/**
 * O que o portão responde para fora.
 *
 * ⚠️ NENHUMA DAS FRASES DIZ NOME, E-MAIL OU QUALQUER DADO DA FICHA. O CPF digitado já é de quem digita
 * (ou de alguém cujo CPF ele tem), e a resposta conta só o que ele precisa para saber o que fazer.
 * O teto do balde `autonomo` (lib/publico/cad/rate-limit.ts) segura quem tenta varrer CPFs.
 *
 * ⚠️ SEM VOCABULÁRIO INTERNO ([[feedback_corretor_nao_ve_divisao_interna]]): nada de "fila", "Board",
 * "código CA" ou quem na Careli está com o pedido.
 */
export const MENSAGEM_DO_PORTAO: Record<Exclude<SituacaoNoPortao, "liberado">, string> = {
  "em-analise":
    "Já recebemos um cadastro com este CPF e ele está em análise. Assim que terminarmos, avisamos você pelo WhatsApp informado no cadastro.",
  "ja-autonomo":
    "Este CPF já tem cadastro de corretor autônomo com a Careli. Se precisar atualizar algum dado, fale com a nossa central.",
};

export async function situacaoDoCpf(
  client: AdminClient,
  cpf: string,
): Promise<{ ok: false } | { ok: true; situacao: SituacaoNoPortao }> {
  const digitos = String(cpf ?? "").replace(/\D/g, "");
  const fichas = await fichasDoDocumento(client, "cpf", digitos);
  // ⚠️ "NÃO SEI" NÃO É "LIBERADO". Com a leitura falhando, liberar abriria o OCR pago para quem já é
  // autônomo e empilharia pedido em ficha que já tem código.
  if (fichas.falhou) return { ok: false };
  if (fichas.ids.length === 0) return { ok: true, situacao: "liberado" };

  const [entidades, eventos] = await Promise.all([
    client.from("apolo_entities").select("id, broker_code").in("id", fichas.ids.slice(0, 100)),
    client
      .from("apolo_audit_events")
      .select("action, created_at, entity_id")
      .in("entity_id", fichas.ids.slice(0, 100))
      .in("action", ACOES)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (entidades.error || eventos.error) return { ok: false };

  const temCodigo = ((entidades.data ?? []) as Array<{ broker_code: null | string }>).some(
    (linha) => String(linha.broker_code ?? "").trim() !== "",
  );
  const estado = estadoDoPedido((eventos.data ?? []) as EventoDoPedido[]);
  return { ok: true, situacao: situacaoNoPortao({ estado, temCodigo }) };
}

// ---------------------------------------------------------------------------
// O CADASTRO QUE CHEGA PELO LINK
// ---------------------------------------------------------------------------

export type EmpreendimentoDeInteresse = { id: string; label: string };

/** O corpo que o wizard manda, no que importa aqui. */
export type CadastroDoLink = Pick<
  CreateApoloEntityInput,
  "conjuge" | "endereco" | "identidade" | "perfil"
> & {
  documentos?: DocumentoEntrada[];
};

/**
 * O que vai para `createApoloEntity`, por LISTA DE INCLUSÃO.
 *
 * ⚠️ NADA DO CORPO ESPALHADO. As rotas públicas antigas fazem `{ ...payload, ... }`; aqui o corpo vem
 * de um formulário aberto ao mundo e pode trazer `empreendimentos` (que viraria vínculo de
 * empreendimento, ou seja, HABILITAÇÃO), `corretores`, `empresa`, `socios` ou `vinculo`. Só entra o
 * que a ficha de uma pessoa física precisa, e o papel, a persona e a origem são do servidor.
 *
 * ⚠️ E A IMOBILIÁRIA SAI LIMPA: *"nao quero ter a informacao que pode ter pessoa fisica como
 * imobiliaria"* (Lucas, 27/09/2026). O persist cria o vínculo de imobiliária por PRESENÇA do campo.
 */
export function entradaDaFichaDoLink(corpo: CadastroDoLink): CreateApoloEntityInput {
  return {
    conjuge: corpo.conjuge ?? null,
    corretores: [],
    // ⚠️ UMA FICHA POR PESSOA: o mesmo CPF NÃO ganha uma segunda ficha. Sem isto o INSERT do persist é
    // cego (a migration 0026 tirou o índice único de document_hash) e quem já tem ficha, como o
    // comprador de um lote ou o corretor de uma imobiliária, nasceria duplicado: era a "mesma
    // entidade" virando duas. O cadastro interno liga o mesmo dedup (lib/apolo/cadastro-salvar.ts), e
    // com `cadastroDeCorretorAutonomo` o persist ANEXA na ficha existente em vez de recusar.
    dedupPorDocumento: true,
    empreendimentos: [],
    endereco: corpo.endereco ?? null,
    enterpriseId: null,
    identidade: corpo.identidade ?? null,
    origem: ORIGEM_DO_LINK_DO_AUTONOMO,
    ownerUserId: null,
    perfil: { ...(corpo.perfil ?? {}), imobiliariaId: "", imobiliariaLabel: "" },
    persona: "pf",
    role: "corretor",
    socios: [],
  };
}

/**
 * O status que o papel `corretor` deve ter depois que o link grava.
 *
 * ⚠️ `createApoloEntity` grava o papel `active` (é o que o cadastro do time quer). Pelo link:
 *   • quem JÁ era corretor ativo (de uma imobiliária) continua ativo: rebaixar tiraria do ar a
 *     imobiliária dele, e quem ainda não é autônomo continua não sendo, porque não tem código;
 *   • quem não tinha o papel, ou o tinha parado (`review`, `blocked`), fica `review`: é um pedido.
 */
export function statusDoPapelDepoisDoLink(statusAntes: null | string): "active" | "review" {
  return String(statusAntes ?? "").trim() === "active" ? "active" : "review";
}

export type ResultadoDoCadastroDoLink =
  | { autenticacao: string; entityId: string; ok: true; savedDocs: string[]; warnings: string[] }
  | { ok: false; recusa: Extract<CreateApoloEntityResult, { ok: false }> }
  | { ok: false; recusa: null };

/**
 * GRAVA O CADASTRO DO LINK: a ficha, o papel em análise, o pedido na trilha, os documentos e o aviso.
 *
 * O que é OBRIGATÓRIO dar certo (senão a resposta é falha e a pessoa reenvia): a ficha e o evento do
 * pedido, porque sem o evento a ficha existe e ninguém a vê. Documentos, PDF e aviso são best-effort e
 * viram `warnings`, como no auto-cadastro da imobiliária.
 */
export async function registrarCadastroDoLink(
  client: AdminClient,
  input: {
    corpo: CadastroDoLink;
    empreendimentosDeInteresse: EmpreendimentoDeInteresse[];
  },
): Promise<ResultadoDoCadastroDoLink> {
  const entrada = entradaDaFichaDoLink(input.corpo);
  const cpf = String(entrada.identidade?.cpf ?? "").replace(/\D/g, "");

  // O papel que cada ficha deste CPF tinha ANTES. `createApoloEntity` escolhe em qual ficha anexar;
  // lendo todas, a regra vale para a escolhida, seja ela qual for.
  const fichas = await fichasDoDocumento(client, "cpf", cpf);
  if (fichas.falhou) return { ok: false, recusa: null };
  const papelAntes = new Map<string, string>();
  if (fichas.ids.length > 0) {
    const { data, error } = await client
      .from("apolo_entity_profiles")
      .select("entity_id, status")
      .in("entity_id", fichas.ids.slice(0, 100))
      .eq("profile", PAPEL_DO_AUTONOMO);
    if (error) return { ok: false, recusa: null };
    for (const linha of (data ?? []) as Array<{ entity_id: string; status: null | string }>) {
      papelAntes.set(linha.entity_id, String(linha.status ?? ""));
    }
  }

  // A FICHA, pelo mesmo caminho do cadastro interno.
  //
  // ⚠️ `cadastroDeCorretorAutonomo: true` SEM GERADOR DE CÓDIGO. A opção solta as duas travas que só
  // fazem sentido para comprador (a CAD que a pessoa tem em outro loteamento não barra o cadastro dela
  // como corretor, e o e-mail dela na cópia da própria ficha não conta contra ela), sem dar código: o
  // código é da aprovação. Entre pessoas DIFERENTES, o e-mail repetido continua recusando
  // ([[reference_email_unico_barra_dono_da_imobiliaria]]).
  const criado = await createApoloEntity(client, entrada, {
    cadastroDeCorretorAutonomo: true,
    fichaExistente: "anexar",
  });
  if (!criado.ok) return { ok: false, recusa: criado };
  const entityId = criado.entityId;
  const warnings: string[] = [...criado.warnings];

  // O PAPEL EM ANÁLISE.
  const alvo = statusDoPapelDepoisDoLink(papelAntes.get(entityId) ?? null);
  if (alvo === "review") {
    const { error } = await client
      .from("apolo_entity_profiles")
      .update({ status: "review" })
      .eq("entity_id", entityId)
      .eq("profile", PAPEL_DO_AUTONOMO);
    // Sem código ele não é autônomo em lugar nenhum, então a falha aqui não abre porta: vira aviso.
    if (error) warnings.push(`papel: ${error.message}`);
  }

  // O PEDIDO NA TRILHA. Este é obrigatório: é a fila.
  const nome = String(entrada.identidade?.nome ?? "").trim() || "Corretor";
  const { error: erroDoPedido } = await client.from("apolo_audit_events").insert({
    action: ACOES_DO_PEDIDO.solicitado,
    actor_user_id: null,
    entity_id: entityId,
    field_name: "cadastro_corretor_autonomo",
    metadata: {
      autenticacao: criado.autenticacao,
      empreendimentosDeInteresse: input.empreendimentosDeInteresse.slice(0, 30),
      origem: ORIGEM_DO_LINK_DO_AUTONOMO,
    },
    status: "mapped",
  });
  if (erroDoPedido) {
    console.error("[apolo][autonomo-link] falha ao registrar o pedido", erroDoPedido.message);
    return { ok: false, recusa: null };
  }

  // DOCUMENTOS (best-effort, agrupados por documento, como no auto-cadastro da imobiliária).
  const upload = await agruparEUploadDocumentos(client, {
    documentos: input.corpo.documentos ?? [],
    entityId,
    nomeCliente: nome,
    uploadedByName: `${nome} (auto-cadastro)`,
  });
  warnings.push(...upload.warnings);

  // O AVISO NO SINO (Lucas, 01/10/2026). Best-effort: o aviso nunca derruba o cadastro.
  await avisarCadastroNovo(client, { entityId, interesse: input.empreendimentosDeInteresse, nome });

  return {
    autenticacao: criado.autenticacao,
    entityId,
    ok: true,
    savedDocs: upload.savedDocs,
    warnings,
  };
}

/**
 * Quem recebe o aviso do sino: administradores e líderes ativos do hub.
 *
 * ⚠️ NÃO EXISTE PERMISSÃO DO APOLO NO HUB. Medido em produção (01/10/2026): `hub_permissions` não tem
 * nenhuma do Apolo, e o que separa quem decide é o papel (`authorizeApoloCoordenacao` = admin +
 * leader). São 7 das 10 pessoas ativas. O analista (`operator`) vê a fila na tela, sem o sino.
 */
async function avisarCadastroNovo(
  client: AdminClient,
  input: { entityId: string; interesse: EmpreendimentoDeInteresse[]; nome: string },
): Promise<void> {
  try {
    const { data, error } = await client
      .from("hub_users")
      .select("id")
      .eq("status", "active")
      .in("role", ["admin", "leader"])
      .limit(100);
    if (error) return;
    const destinatarios = ((data ?? []) as Array<{ id: string }>).map((linha) => linha.id);
    if (destinatarios.length === 0) return;

    const interesse = input.interesse.map((emp) => emp.label).filter(Boolean);
    await publishHubNotification({
      actionHref: "/apolo?tela=autonomos",
      body: interesse.length
        ? `${input.nome} pediu cadastro. Interesse em: ${interesse.join(", ")}.`
        : `${input.nome} pediu cadastro pelo link.`,
      context: { entityId: input.entityId, origem: ORIGEM_DO_LINK_DO_AUTONOMO },
      kind: "operacao",
      moduleId: "apolo",
      push: { tag: `autonomo-link-${input.entityId}` },
      recipientUserIds: destinatarios,
      severity: "info",
      title: "Novo corretor autônomo pelo link",
    }, client);
  } catch (erro) {
    console.error("[apolo][autonomo-link] falha ao avisar o cadastro novo", erro);
  }
}

// ---------------------------------------------------------------------------
// A FILA DO TIME
// ---------------------------------------------------------------------------

export type ItemDaFilaDoAutonomo = {
  codigo: null | string;
  cpfMascarado: null | string;
  /** O pedido mais recente (data do último envio pelo link). */
  enviadoEm: string;
  entityId: string;
  estado: EstadoDoPedido;
  /** Quando a última decisão aconteceu (null em análise). */
  decididoEm: null | string;
  email: null | string;
  interesse: EmpreendimentoDeInteresse[];
  motivos: string[];
  nome: string;
  telefone: null | string;
};

/** Quantos dias o que já foi DECIDIDO continua na tela (o mesmo corte do Board). */
const JANELA_DOS_DECIDIDOS_DIAS = 30;

/**
 * Monta a fila a partir da trilha, pura: o estado de cada ficha, o interesse do último pedido e o
 * motivo da última decisão.
 *
 * ⚠️ EM ANÁLISE E EM CORREÇÃO NUNCA SAEM POR IDADE: são trabalho em aberto. Só o que já foi aprovado
 * ou indeferido some depois de 30 dias, como no Board.
 */
export function montarFila(
  eventos: EventoDoPedido[],
  agora: Date = new Date(),
): Array<
  Pick<ItemDaFilaDoAutonomo, "decididoEm" | "enviadoEm" | "entityId" | "estado" | "interesse" | "motivos">
> {
  const porFicha = new Map<string, EventoDoPedido[]>();
  for (const evento of eventos) {
    if (!ESTADO_DA_ACAO[evento.action]) continue;
    porFicha.set(evento.entity_id, [...(porFicha.get(evento.entity_id) ?? []), evento]);
  }

  const corte = agora.getTime() - JANELA_DOS_DECIDIDOS_DIAS * 24 * 60 * 60 * 1000;
  const itens: ReturnType<typeof montarFila> = [];
  for (const [entityId, lista] of porFicha) {
    const ordenados = [...lista].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const ultimo = ordenados[0];
    const estado = estadoDoPedido(ordenados);
    if (!ultimo || !estado) continue;
    const pedido = ordenados.find((evento) => evento.action === ACOES_DO_PEDIDO.solicitado);
    // Ficha que só tem decisão e nenhum pedido pelo link não é deste fluxo.
    if (!pedido) continue;

    const decidido = estado === "aprovado" || estado === "indeferido";
    if (decidido && Date.parse(ultimo.created_at) < corte) continue;

    const interesseBruto = pedido.metadata?.empreendimentosDeInteresse;
    const interesse = Array.isArray(interesseBruto)
      ? interesseBruto
          .map((emp) => ({
            id: String((emp as { id?: unknown })?.id ?? ""),
            label: String((emp as { label?: unknown })?.label ?? ""),
          }))
          .filter((emp) => emp.id)
      : [];
    const motivosBrutos = estado === "em-analise" ? [] : ultimo.metadata?.motivos;
    const motivos = Array.isArray(motivosBrutos)
      ? motivosBrutos.filter((m): m is string => typeof m === "string" && m.trim() !== "")
      : [];
    const observacao =
      estado === "em-analise" ? "" : String(ultimo.metadata?.observacao ?? "").trim();

    itens.push({
      decididoEm: estado === "em-analise" ? null : ultimo.created_at,
      enviadoEm: pedido.created_at,
      entityId,
      estado,
      interesse,
      motivos: observacao ? [...motivos, observacao] : motivos,
    });
  }

  return itens.sort((a, b) => Date.parse(b.enviadoEm) - Date.parse(a.enviadoEm));
}

export async function filaDoLinkDoAutonomo(
  client: AdminClient,
): Promise<{ itens: ItemDaFilaDoAutonomo[]; ok: true } | { ok: false }> {
  const { data: eventos, error } = await client
    .from("apolo_audit_events")
    .select("action, created_at, entity_id, metadata")
    .in("action", ACOES)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return { ok: false };

  const base = montarFila((eventos ?? []) as EventoDoPedido[]);
  if (base.length === 0) return { itens: [], ok: true };

  const ids = base.map((item) => item.entityId).slice(0, 300);
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) lotes.push(ids.slice(i, i + 100));

  const [entidades, contatos] = await Promise.all([
    Promise.all(
      lotes.map((lote) =>
        client
          .from("apolo_entities")
          .select("id, broker_code, display_name, document_masked")
          .in("id", lote),
      ),
    ),
    Promise.all(
      lotes.map((lote) =>
        client
          .from("apolo_contacts")
          .select("entity_id, contact_type, normalized_value, is_primary")
          .in("entity_id", lote)
          .in("contact_type", ["email", "phone"]),
      ),
    ),
  ]);
  if (entidades.some((r) => r.error)) return { ok: false };

  const fichaPorId = new Map<
    string,
    { broker_code: null | string; display_name: null | string; document_masked: null | string }
  >();
  for (const resposta of entidades) {
    for (const linha of (resposta.data ?? []) as Array<{
      broker_code: null | string;
      display_name: null | string;
      document_masked: null | string;
      id: string;
    }>) {
      fichaPorId.set(linha.id, linha);
    }
  }
  const contatoPorId = new Map<string, { email: null | string; telefone: null | string }>();
  for (const resposta of contatos) {
    for (const linha of (resposta.data ?? []) as Array<{
      contact_type: string;
      entity_id: string;
      is_primary: boolean | null;
      normalized_value: null | string;
    }>) {
      const atual = contatoPorId.get(linha.entity_id) ?? { email: null, telefone: null };
      const valor = String(linha.normalized_value ?? "").trim() || null;
      if (linha.contact_type === "email" && (!atual.email || linha.is_primary)) atual.email = valor;
      if (linha.contact_type === "phone" && (!atual.telefone || linha.is_primary)) {
        atual.telefone = valor;
      }
      contatoPorId.set(linha.entity_id, atual);
    }
  }

  return {
    itens: base.map((item) => {
      const ficha = fichaPorId.get(item.entityId);
      const contato = contatoPorId.get(item.entityId);
      return {
        ...item,
        codigo: String(ficha?.broker_code ?? "").trim() || null,
        cpfMascarado: ficha?.document_masked ?? null,
        email: contato?.email ?? null,
        nome: String(ficha?.display_name ?? "").trim() || "Corretor",
        telefone: contato?.telefone ?? null,
      };
    }),
    ok: true,
  };
}

// ---------------------------------------------------------------------------
// AS TRÊS DECISÕES DO TIME
// ---------------------------------------------------------------------------

export type AcaoDoTime = "aprovar" | "correcao" | "indeferir";

export type DecisaoFeita = {
  aviso: { enviado: boolean; erro: null | string };
  codigo: null | string;
  estado: EstadoDoPedido;
  ok: true;
};

export type RecusaDaDecisao = { mensagem: string; ok: false; status: number };

const MENSAGEM_FALHA_DA_DECISAO =
  "Não foi possível registrar a decisão agora. Tente de novo em instantes; nada foi gravado.";

/**
 * Pode decidir? Puro: recebe o estado do pedido e o que a ficha é.
 *
 *   • só decide quem PEDIU pelo link (sem pedido, a ficha não é deste fluxo);
 *   • decidido não se decide de novo: aprovado já tem código, indeferido volta pelo link;
 *   • aprovar e indeferir valem para EM ANÁLISE e para EM CORREÇÃO (a resposta pode vir por outro
 *     canal); pedir correção só vale para quem está em análise.
 *   • ⚠️ A REGRA DO LUCAS DE 27/09/2026 VALE AQUI TAMBÉM: pessoa física nunca é imobiliária. Ficha que
 *     não é `pf`, ou que tem o papel `imobiliaria`, não vira autônomo.
 */
export function recusaDaDecisao(input: {
  acao: AcaoDoTime;
  entityKind: null | string;
  estado: EstadoDoPedido | null;
  motivos: string[];
  temPapelDeImobiliaria: boolean;
}): null | RecusaDaDecisao {
  if (!input.estado) {
    return { mensagem: "Esta ficha não tem pedido de cadastro pelo link.", ok: false, status: 404 };
  }
  if (String(input.entityKind ?? "").trim() !== "pf" || input.temPapelDeImobiliaria) {
    return {
      mensagem:
        "Esta ficha não pode virar corretor autônomo: só pessoa física, e nunca uma ficha de imobiliária.",
      ok: false,
      status: 409,
    };
  }
  if (input.estado === "aprovado" || input.estado === "indeferido") {
    return { mensagem: "Este pedido já foi decidido.", ok: false, status: 409 };
  }
  if (input.acao === "correcao" && input.estado !== "em-analise") {
    return {
      mensagem: "A correção já foi pedida. Espere o corretor reenviar pelo link.",
      ok: false,
      status: 409,
    };
  }
  if (input.acao !== "aprovar" && input.motivos.length === 0) {
    return {
      mensagem: "Diga o motivo: é o que o corretor vai ler.",
      ok: false,
      status: 400,
    };
  }
  return null;
}

/**
 * APLICA A DECISÃO DO TIME.
 *
 * APROVAR faz o que o cadastro interno faz ao salvar: dá o código CA (da sequência do banco, nunca
 * inventado) e o papel `corretor` ativo. A habilitação em empreendimento NÃO acontece aqui: é a outra
 * porta (`habilitarAutonomoNoEmpreendimento`), produto a produto, com auditoria e aviso ao coordenador.
 *
 * ⚠️ O CÓDIGO SÓ É GRAVADO EM FICHA SEM CÓDIGO (`broker_code is null` no próprio UPDATE). Dois cliques em
 * Aprovar ao mesmo tempo não dão dois códigos à mesma pessoa: o segundo não acha linha e recusa. O
 * número que ele tirou da sequência vira buraco, que é o preço barato já aceito
 * (lib/apolo/codigo-do-corretor.ts).
 */
export async function decidirPedidoDoAutonomo(
  client: AdminClient,
  input: {
    acao: AcaoDoTime;
    autorNome: null | string;
    autorUserId: null | string;
    entityId: string;
    motivos?: string[];
    observacao?: null | string;
  },
): Promise<DecisaoFeita | RecusaDaDecisao> {
  const entityId = String(input.entityId ?? "").trim();
  const motivos = (input.motivos ?? [])
    .map((m) => String(m ?? "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const observacao = String(input.observacao ?? "").trim().slice(0, 1000) || null;

  const [entidade, papeis, eventos, contatos] = await Promise.all([
    client
      .from("apolo_entities")
      .select("id, broker_code, display_name, entity_kind")
      .eq("id", entityId)
      .maybeSingle<{
        broker_code: null | string;
        display_name: null | string;
        entity_kind: null | string;
        id: string;
      }>(),
    client.from("apolo_entity_profiles").select("profile, status").eq("entity_id", entityId),
    client
      .from("apolo_audit_events")
      .select("action, created_at, entity_id")
      .eq("entity_id", entityId)
      .in("action", ACOES)
      .order("created_at", { ascending: false })
      .limit(100),
    client
      .from("apolo_contacts")
      .select("normalized_value, is_primary")
      .eq("entity_id", entityId)
      .eq("contact_type", "phone"),
  ]);
  if (entidade.error || papeis.error || eventos.error) {
    return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
  }
  if (!entidade.data) {
    return { mensagem: "Ficha não encontrada.", ok: false, status: 404 };
  }

  const linhasDePapel = (papeis.data ?? []) as Array<{ profile: null | string; status: null | string }>;
  const estado = estadoDoPedido((eventos.data ?? []) as EventoDoPedido[]);
  const recusa = recusaDaDecisao({
    acao: input.acao,
    entityKind: entidade.data.entity_kind,
    estado,
    motivos: observacao ? [...motivos, observacao] : motivos,
    temPapelDeImobiliaria: linhasDePapel.some(
      (linha) => String(linha.profile ?? "").trim() === PAPEL_DE_IMOBILIARIA,
    ),
  });
  if (recusa) return recusa;

  const nome = String(entidade.data.display_name ?? "").trim() || null;
  let codigo: null | string = String(entidade.data.broker_code ?? "").trim() || null;
  let novoEstado: EstadoDoPedido;

  if (input.acao === "aprovar") {
    // A ficha pode já ter código de uma aprovação que caiu no meio (o código gravou e o papel não).
    // Nesse caso não se gera outro: termina o que faltou.
    if (!codigo) {
      const sequencia = await proximoCodigoDoCorretor(client);
      if (!sequencia.ok) return { mensagem: sequencia.mensagem, ok: false, status: 503 };
      const { data: gravadas, error } = await client
        .from("apolo_entities")
        .update({ broker_code: sequencia.codigo, updated_at: new Date().toISOString() })
        .eq("id", entityId)
        .is("broker_code", null)
        .select("id");
      if (error) return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
      if (!Array.isArray(gravadas) || gravadas.length === 0) {
        return {
          mensagem: "Outra pessoa acabou de decidir este pedido. Atualize a tela.",
          ok: false,
          status: 409,
        };
      }
      codigo = sequencia.codigo;
    }
    const { error: erroDoPapel } = await client
      .from("apolo_entity_profiles")
      .upsert(
        { entity_id: entityId, profile: PAPEL_DO_AUTONOMO, status: "active" },
        { onConflict: "entity_id,profile" },
      );
    if (erroDoPapel) return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
    novoEstado = "aprovado";
  } else if (input.acao === "indeferir") {
    // O papel que o LINK pôs em análise vira `blocked`. O que já era ativo (corretor de imobiliária)
    // não é tocado: indeferir o pedido de autônomo não tira ninguém da imobiliária dele.
    const emAnalise = linhasDePapel.some(
      (linha) =>
        String(linha.profile ?? "").trim() === PAPEL_DO_AUTONOMO &&
        String(linha.status ?? "").trim() === "review",
    );
    if (emAnalise) {
      const { error } = await client
        .from("apolo_entity_profiles")
        .update({ status: "blocked" })
        .eq("entity_id", entityId)
        .eq("profile", PAPEL_DO_AUTONOMO)
        .eq("status", "review");
      if (error) return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
    }
    novoEstado = "indeferido";
  } else {
    novoEstado = "correcao";
  }

  const acaoDoEvento =
    novoEstado === "aprovado"
      ? ACOES_DO_PEDIDO.aprovado
      : novoEstado === "indeferido"
        ? ACOES_DO_PEDIDO.indeferido
        : ACOES_DO_PEDIDO.correcao;
  const { error: erroDoEvento } = await client.from("apolo_audit_events").insert({
    action: acaoDoEvento,
    actor_user_id: input.autorUserId,
    entity_id: entityId,
    field_name: "cadastro_corretor_autonomo",
    metadata: {
      autor: input.autorNome,
      ...(codigo && novoEstado === "aprovado" ? { codigo } : {}),
      motivos,
      observacao,
      origem: ORIGEM_DO_LINK_DO_AUTONOMO,
    },
    status: "mapped",
  });
  if (erroDoEvento) {
    // Na aprovação o código e o papel já valem; sem o evento a fila mostraria o pedido em análise,
    // e um novo clique em Aprovar termina sem gerar outro código (o ramo `codigo` já preenchido).
    console.error("[apolo][autonomo-link] falha ao registrar a decisao", erroDoEvento.message);
    return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
  }

  // O AVISO AO CORRETOR, pelo celular do Relacionamento. Best-effort: a decisão já está gravada, e a
  // falha vira linha `falhou` em `apolo_disparos` com o motivo, que é o que a tela de status mostra.
  const telefones = (contatos.data ?? []) as Array<{
    is_primary: boolean | null;
    normalized_value: null | string;
  }>;
  const telefone =
    telefones.find((linha) => linha.is_primary)?.normalized_value ??
    telefones[0]?.normalized_value ??
    null;
  const texto =
    novoEstado === "aprovado"
      ? mensagemAutonomoAprovado({ corretor: nome })
      : novoEstado === "indeferido"
        ? mensagemAutonomoIndeferido({ corretor: nome, motivos, observacao })
        : mensagemAutonomoCorrecao({
            corretor: nome,
            linkDoCadastro: LINK_DO_CADASTRO_DO_AUTONOMO,
            motivos,
            observacao,
          });
  let aviso: DecisaoFeita["aviso"] = { enviado: false, erro: null };
  try {
    const envio = await enviarPeloRelacionamento(client, {
      destinatario: `autonomo:${nome ?? entityId}`,
      entityId,
      telefone,
      texto,
      tipo: `autonomo_link_${novoEstado}`,
    });
    aviso = envio.ok ? { enviado: true, erro: null } : { enviado: false, erro: envio.erro ?? null };
  } catch (erro) {
    console.error("[apolo][autonomo-link] falha ao avisar o corretor", erro);
    aviso = { enviado: false, erro: "falha no envio" };
  }

  return { aviso, codigo: novoEstado === "aprovado" ? codigo : null, estado: novoEstado, ok: true };
}
