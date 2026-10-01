// O CORRETOR AUTÔNOMO QUE SE CADASTRA PELO LINK PÚBLICO — o pedido, a fila e as três decisões.
//
// Lucas (01/10/2026): *"fizemos o processo de cadastro de corretor autonomo, mas ele seria para o time
// interno, preciso criar o link publico igual temos da cad, imobiliaria"*. E, na rodada de decisões do
// mesmo dia: validação numa tela nova do Apolo com as três ações da imobiliária (aprovar, pedir
// correção, indeferir); o autônomo INDICA empreendimentos de interesse, que viram só pedido; os
// documentos do link são identidade e comprovante de endereço, sem certidão de estado civil; o cadastro
// novo avisa pelo sino do hub; e o link vai ao ar sem captcha, com teto geral por hora.
//
// ⚠️ A REGRA: O LINK NÃO GRAVA DADO NENHUM EM FICHA. NADA DO QUE CHEGA POR ELE VIRA DADO ANTES DE UMA
// PESSOA DO TIME APROVAR (segunda rodada de revisão, Publicação, 01/10/2026).
//
// A primeira versão criava ou "acrescentava" a ficha no envio. A revisão provou que acrescentar ainda é
// gravar: em ficha que já existe, o persist preenche os campos VAZIOS com o que foi digitado
// (qualificação, endereço primário, cônjuge `verified`), e esses campos alimentam o contrato da Têmis, a
// CAD, o C2X e o Board. Indeferir não desfazia. E o link não prova que quem digita é dono do CPF.
//
// Agora o envio grava só o PEDIDO, na trilha de `apolo_audit_events` (sem ficha: `entity_id` é nulo), com
// a proposta inteira, os documentos (no staging privado do bucket) e o interesse. A ficha só é tocada na
// APROVAÇÃO, e pelo MESMO caminho do cadastro interno: `createApoloEntity` com o papel `corretor`, o
// gerador do código CA e o modo `anexar` do hub. Quem aprova é uma pessoa da coordenação, e é isso que o
// cadastro interno já é (*"cadastro feito pelo operador vale já como validação"*). Mesma entidade, mesma
// validação, e nenhum cadastro paralelo.
//
// ⚠️ POR QUE NA TRILHA E NÃO NUMA TABELA NOVA: sem migration. `apolo_audit_events.entity_id` aceita nulo
// e `action` é `text` sem CHECK (medido em produção em 01/10/2026). A tabela tem RLS ligado e só a
// leitura de `authenticated` (usuário do hub), o mesmo nível das fichas do Apolo; o anônimo não lê.
import { createHash, randomUUID } from "node:crypto";

import {
  agruparEUploadDocumentos,
  type DocumentoEntrada,
} from "@/lib/apolo/cadastro-upload";
import {
  createApoloEntity,
  fichasDoDocumento,
  type CreateApoloEntityInput,
} from "@/lib/apolo/cadastro-persist";
import { proximoCodigoDoCorretor } from "@/lib/apolo/codigo-do-corretor";
import {
  mensagemAutonomoAprovado,
  mensagemAutonomoCorrecao,
} from "@/lib/apolo/credenciamento-mensagens";
import {
  enviarPeloRelacionamento,
  telefoneParaEnvio,
} from "@/lib/apolo/disparo-credenciamento";
import {
  APOLO_DOCS_BUCKET,
  prefixoUploadDireto,
  removerDocumentoDoStorage,
} from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { sendEvolutionDirectText } from "@/lib/iris/evolution-api";
import { publishHubNotification } from "@/lib/notifications/publish";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** A origem dos eventos do pedido e da ficha que nasce dele. */
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
const ACOES_DE_DECISAO = [
  ACOES_DO_PEDIDO.aprovado,
  ACOES_DO_PEDIDO.correcao,
  ACOES_DO_PEDIDO.indeferido,
];

export type EstadoDoPedido = "aprovado" | "correcao" | "em-analise" | "indeferido";

const ESTADO_DA_DECISAO: Record<string, EstadoDoPedido> = {
  [ACOES_DO_PEDIDO.aprovado]: "aprovado",
  [ACOES_DO_PEDIDO.correcao]: "correcao",
  [ACOES_DO_PEDIDO.indeferido]: "indeferido",
};

const PAPEL_DO_AUTONOMO = "corretor";
const PAPEL_DE_IMOBILIARIA = "imobiliaria";

// ⚠️ OS FREIOS DO ENVIO NÃO MORAM AQUI (terceira rodada de revisão, 01/10/2026). A versão anterior
// contava os pedidos da última hora e recusava acima de 40: não era atômico, e um IP só enchia a hora e
// barrava todo cadastro legítimo. Agora são três contadores atômicos na rota de envio, por IP, por CPF e
// o geral de emergência (lib/publico/cad/rate-limit.ts, `autonomoEnvio`, `autonomoCpf`, `autonomoGeral`),
// conferidos ANTES de qualquer documento ser guardado.

/** Acima disto, em 15 minutos, o sino para de tocar a cada pedido (a fila continua mostrando). */
const TETO_DO_SINO_EM_15_MIN = 5;

/** O resumo do CPF que a trilha guarda para achar os pedidos dele: o MESMO de `document_hash`. */
export function resumoDoCpf(cpf: string): string {
  const digitos = String(cpf ?? "").replace(/\D/g, "");
  return createHash("sha256").update(`apolo-identifier:cpf:${digitos}`).digest("hex");
}

/**
 * Celular com DDD: 10 ou mais DÍGITOS. É por ele que a Careli responde ao pedido.
 *
 * ⚠️ `\D`, e não `D`: a primeira versão tirava a letra "D" em vez dos não-dígitos, e qualquer texto com
 * 10 caracteres passava (achado da Publicação, 01/10/2026).
 */
export function celularValido(valor: unknown): boolean {
  return String(valor ?? "").replace(/\D/g, "").length >= 10;
}

export function cpfMascarado(cpf: string): string {
  const d = String(cpf ?? "").replace(/\D/g, "");
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "";
}

export type EventoDoPedido = {
  action: string;
  created_at: string;
  entity_id?: null | string;
  id?: string;
  metadata?: null | Record<string, unknown>;
};

/**
 * O estado de UM pedido: a última decisão que aponta para ele (`metadata.pedidoId`), ou em análise.
 */
export function estadoDoPedido(pedidoId: string, eventos: EventoDoPedido[]): EstadoDoPedido {
  let ultima: EventoDoPedido | null = null;
  for (const evento of eventos) {
    if (!ESTADO_DA_DECISAO[evento.action]) continue;
    if (String(evento.metadata?.pedidoId ?? "") !== pedidoId) continue;
    if (!ultima || Date.parse(evento.created_at) > Date.parse(ultima.created_at)) ultima = evento;
  }
  return ultima ? (ESTADO_DA_DECISAO[ultima.action] ?? "em-analise") : "em-analise";
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
 * ⚠️ NENHUMA DAS FRASES DIZ NOME, E-MAIL OU QUALQUER DADO DA FICHA, e nenhuma promete aviso automático
 * (o aviso da decisão é best-effort). O teto do balde `autonomo` segura quem tenta varrer CPFs.
 *
 * ⚠️ SEM VOCABULÁRIO INTERNO ([[feedback_corretor_nao_ve_divisao_interna]]).
 */
export const MENSAGEM_DO_PORTAO: Record<Exclude<SituacaoNoPortao, "liberado">, string> = {
  "em-analise":
    "Já recebemos um cadastro com este CPF e ele está em análise. Assim que a análise terminar, a Careli entra em contato com você.",
  "ja-autonomo":
    "Este CPF já tem cadastro de corretor autônomo com a Careli. Se precisar atualizar algum dado, fale com a nossa central.",
};

/** O pedido mais recente deste CPF e as decisões que apontam para ele. */
async function ultimoPedidoDoCpf(
  client: AdminClient,
  resumo: string,
): Promise<{ ok: false } | { ok: true; pedido: EventoDoPedido | null; estado: EstadoDoPedido | null }> {
  const { data: pedidos, error } = await client
    .from("apolo_audit_events")
    .select("id, action, created_at, metadata")
    .eq("action", ACOES_DO_PEDIDO.solicitado)
    .eq("metadata->>cpfHash", resumo)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return { ok: false };
  const pedido = ((pedidos ?? []) as EventoDoPedido[])[0] ?? null;
  if (!pedido?.id) return { estado: null, ok: true, pedido: null };

  const { data: decisoes, error: erroDasDecisoes } = await client
    .from("apolo_audit_events")
    .select("action, created_at, metadata")
    .in("action", ACOES_DE_DECISAO)
    .eq("metadata->>pedidoId", pedido.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (erroDasDecisoes) return { ok: false };
  return {
    estado: estadoDoPedido(pedido.id, (decisoes ?? []) as EventoDoPedido[]),
    ok: true,
    pedido,
  };
}

export async function situacaoDoCpf(
  client: AdminClient,
  cpf: string,
): Promise<{ ok: false } | { ok: true; situacao: SituacaoNoPortao }> {
  const digitos = String(cpf ?? "").replace(/\D/g, "");
  const fichas = await fichasDoDocumento(client, "cpf", digitos);
  // ⚠️ "NÃO SEI" NÃO É "LIBERADO": liberar abriria o OCR pago para quem já é autônomo.
  if (fichas.falhou) return { ok: false };

  let temCodigo = false;
  if (fichas.ids.length > 0) {
    const { data, error } = await client
      .from("apolo_entities")
      .select("id, broker_code")
      .in("id", fichas.ids.slice(0, 100));
    if (error) return { ok: false };
    temCodigo = ((data ?? []) as Array<{ broker_code: null | string }>).some(
      (linha) => String(linha.broker_code ?? "").trim() !== "",
    );
  }

  const ultimo = await ultimoPedidoDoCpf(client, resumoDoCpf(digitos));
  if (!ultimo.ok) return { ok: false };
  return { ok: true, situacao: situacaoNoPortao({ estado: ultimo.estado, temCodigo }) };
}

// ---------------------------------------------------------------------------
// A PROPOSTA: o que o link guarda, por lista de inclusão
// ---------------------------------------------------------------------------

export type EmpreendimentoDeInteresse = { id: string; label: string };

const LIMITE_DE_CAMPO = 200;
const textoLimpo = (valor: unknown): string =>
  typeof valor === "string" ? valor.trim().slice(0, LIMITE_DE_CAMPO) : "";

const CAMPOS_DA_IDENTIDADE = [
  "cpf",
  "dataNascimento",
  "nacionalidade",
  "naturalidade",
  "nome",
  "nomeMae",
  "nomePai",
  "orgaoEmissor",
] as const;
const CAMPOS_DO_PERFIL = [
  "email",
  "escolaridadeId",
  "estadoCivilId",
  "profissaoId",
  "profissaoOutro",
  "rendaId",
  "sexoId",
  "telefone",
] as const;
const CAMPOS_DO_ENDERECO = [
  "bairro",
  "cep",
  "cidade",
  "complemento",
  "logradouro",
  "numero",
  "uf",
] as const;

function escolher<K extends string>(origem: unknown, campos: readonly K[]): Partial<Record<K, string>> {
  const fonte = (origem && typeof origem === "object" ? origem : {}) as Record<string, unknown>;
  const saida: Partial<Record<K, string>> = {};
  for (const campo of campos) {
    const valor = textoLimpo(fonte[campo]);
    if (valor) saida[campo] = valor;
  }
  return saida;
}

export type PropostaDoLink = {
  endereco: Partial<Record<(typeof CAMPOS_DO_ENDERECO)[number], string>>;
  identidade: Partial<Record<(typeof CAMPOS_DA_IDENTIDADE)[number], string>>;
  perfil: Partial<Record<(typeof CAMPOS_DO_PERFIL)[number], string>>;
};

/**
 * A proposta que fica guardada no pedido, por LISTA DE INCLUSÃO.
 *
 * ⚠️ NADA DO CORPO ESPALHADO, E NADA FORA DESTAS TRÊS SEÇÕES. O corpo vem de um formulário aberto ao
 * mundo: `empreendimentos` viraria HABILITAÇÃO, `corretores`/`empresa`/`vinculo` viriam de outro papel,
 * a imobiliária é o que o Lucas proibiu (*"nao quero ter a informacao que pode ter pessoa fisica como
 * imobiliaria"*), e o `conjuge` é dado de COMPRADOR, que a tela do link nunca manda (a revisão achou a
 * lista antiga deixando-o passar). Cada campo é texto com teto de tamanho.
 */
export function propostaDoLink(corpo: {
  endereco?: unknown;
  identidade?: unknown;
  perfil?: unknown;
}): PropostaDoLink {
  return {
    endereco: escolher(corpo.endereco, CAMPOS_DO_ENDERECO),
    identidade: escolher(corpo.identidade, CAMPOS_DA_IDENTIDADE),
    perfil: escolher(corpo.perfil, CAMPOS_DO_PERFIL),
  };
}

/**
 * O que vai para `createApoloEntity` NA APROVAÇÃO. É o cadastro interno do autônomo: papel `corretor`,
 * pessoa física, um CPF uma ficha (`dedupPorDocumento`), sem vínculo e sem imobiliária.
 */
export function entradaDaAprovacao(
  proposta: PropostaDoLink,
  autorUserId: null | string,
): CreateApoloEntityInput {
  return {
    conjuge: null,
    corretores: [],
    dedupPorDocumento: true,
    empreendimentos: [],
    endereco: proposta.endereco,
    enterpriseId: null,
    identidade: proposta.identidade,
    origem: ORIGEM_DO_LINK_DO_AUTONOMO,
    ownerUserId: autorUserId,
    perfil: { ...proposta.perfil, imobiliariaId: "", imobiliariaLabel: "" },
    persona: "pf",
    role: "corretor",
    socios: [],
  };
}

export type DocumentoDoPedido = {
  categoria: string;
  fileName: string;
  mimeType: null | string;
  sizeBytes: null | number;
  storagePath: string;
};

const CATEGORIAS_DO_LINK = new Set(["comprovante_endereco", "identificacao"]);

function nomeSeguro(nome: string): string {
  return (
    String(nome ?? "arquivo")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 80) || "arquivo"
  );
}

/**
 * OS DOCUMENTOS DO PEDIDO FICAM NO STAGING PRIVADO, e não na ficha.
 *
 * O que subiu direto (caminho do staging do dono deste CPF) fica onde está; o que veio em base64 no
 * corpo é gravado no mesmo staging. Na APROVAÇÃO, `agruparEUploadDocumentos` leva tudo para o drive da
 * ficha, como faz com o upload direto do cadastro interno. Antes disso, o time vê pela URL assinada.
 *
 * ⚠️ `extractedPayload` do corpo NÃO é guardado: é texto livre do formulário aberto, e na ficha ele
 * apareceria como "lido do documento".
 */
export async function guardarDocumentosDoPedido(
  client: AdminClient,
  input: { documentos: DocumentoEntrada[]; dono: string },
): Promise<{ documentos: DocumentoDoPedido[]; ok: true } | { ok: false }> {
  const guardados: DocumentoDoPedido[] = [];
  for (const doc of input.documentos) {
    const categoria = String(doc.categoria ?? "").trim().toLowerCase();
    if (!CATEGORIAS_DO_LINK.has(categoria)) continue;
    const fileName = nomeSeguro(String(doc.fileName ?? `${categoria}`));
    const caminhoDireto = String(doc.storagePath ?? "").trim();
    if (caminhoDireto) {
      guardados.push({
        categoria,
        fileName,
        mimeType: doc.mimeType ?? null,
        sizeBytes: doc.sizeBytes ?? null,
        storagePath: caminhoDireto,
      });
      continue;
    }
    const base64 = String(doc.fileBase64 ?? "");
    if (!base64) continue;
    const bytes = Buffer.from(base64.startsWith("data:") ? base64.slice(base64.indexOf(",") + 1) : base64, "base64");
    const caminho = `${prefixoUploadDireto(input.dono)}${randomUUID()}-${fileName}`;
    const { error } = await client.storage.from(APOLO_DOCS_BUCKET).upload(caminho, bytes, {
      contentType: doc.mimeType || "application/octet-stream",
      upsert: false,
    });
    if (error) {
      console.error("[apolo][autonomo-link] falha ao guardar documento do pedido", error.message);
      return { ok: false };
    }
    guardados.push({
      categoria,
      fileName,
      mimeType: doc.mimeType ?? null,
      sizeBytes: bytes.length,
      storagePath: caminho,
    });
  }
  return { documentos: guardados, ok: true };
}

// ---------------------------------------------------------------------------
// O ENVIO PELO LINK: grava SÓ o pedido
// ---------------------------------------------------------------------------

export type ResultadoDoPedido =
  | { ok: true; pedidoId: string }
  | { motivo: "falha"; ok: false };

/** Apaga do staging os documentos de um pedido (best-effort: arquivo que sobra não abre porta). */
async function apagarDocumentosDoPedido(
  client: AdminClient,
  documentos: unknown,
): Promise<void> {
  for (const doc of (Array.isArray(documentos) ? documentos : []) as DocumentoDoPedido[]) {
    const caminho = String(doc?.storagePath ?? "").trim();
    if (!caminho.startsWith("entidade/_pendente/")) continue;
    try {
      await removerDocumentoDoStorage(client, caminho);
    } catch (erro) {
      console.error("[apolo][autonomo-link] falha ao apagar documento do pedido", erro);
    }
  }
}

/**
 * REGISTRA O PEDIDO. Não lê nem escreve ficha: só o evento `corretor_autonomo_solicitado`. Os freios
 * (IP, CPF e geral) já foram conferidos pela rota, antes de qualquer documento ser guardado.
 */
export async function registrarPedidoDoLink(
  client: AdminClient,
  input: {
    documentos: DocumentoDoPedido[];
    empreendimentosDeInteresse: EmpreendimentoDeInteresse[];
    proposta: PropostaDoLink;
  },
): Promise<ResultadoDoPedido> {
  const cpf = String(input.proposta.identidade.cpf ?? "").replace(/\D/g, "");
  const nome = input.proposta.identidade.nome || "Corretor";
  // O pedido que este SUBSTITUI (o reenvio depois de "pedir correção", por exemplo).
  const anterior = await ultimoPedidoDoCpf(client, resumoDoCpf(cpf));
  const { data, error } = await client
    .from("apolo_audit_events")
    .insert({
      action: ACOES_DO_PEDIDO.solicitado,
      actor_user_id: null,
      entity_id: null,
      field_name: "cadastro_corretor_autonomo",
      metadata: {
        cpfHash: resumoDoCpf(cpf),
        cpfMascarado: cpfMascarado(cpf),
        documentos: input.documentos,
        empreendimentosDeInteresse: input.empreendimentosDeInteresse.slice(0, 30),
        origem: ORIGEM_DO_LINK_DO_AUTONOMO,
        proposta: input.proposta,
      },
      status: "mapped",
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data?.id) {
    console.error("[apolo][autonomo-link] falha ao registrar o pedido", error?.message);
    return { motivo: "falha", ok: false };
  }

  // ⚠️ OS DOCUMENTOS DO PEDIDO SUBSTITUÍDO SAEM DO STAGING (terceira rodada de revisão): o pedido novo
  // traz a proposta inteira, e o antigo não será mais decidido (`recusaDaDecisao`, "mais recente").
  if (anterior.ok && anterior.pedido && anterior.estado !== "aprovado") {
    await apagarDocumentosDoPedido(client, anterior.pedido.metadata?.documentos);
  }

  await avisarPedidoNovo(client, {
    interesse: input.empreendimentosDeInteresse,
    nome,
  });
  return { ok: true, pedidoId: data.id };
}

/**
 * O aviso do sino: administradores e líderes ativos (a coordenação, que é quem decide).
 *
 * ⚠️ NÃO EXISTE PERMISSÃO DO APOLO NO HUB (medido em 01/10/2026): o que separa quem decide é o papel.
 * ⚠️ O SINO NÃO INUNDA: com `TETO_DO_SINO_EM_15_MIN` pedidos nos últimos 15 minutos, ele para de tocar
 * a cada um. A fila mostra todos.
 */
async function avisarPedidoNovo(
  client: AdminClient,
  input: { interesse: EmpreendimentoDeInteresse[]; nome: string },
): Promise<void> {
  try {
    const quinzeMinutos = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await client
      .from("apolo_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("action", ACOES_DO_PEDIDO.solicitado)
      .gte("created_at", quinzeMinutos);
    if ((count ?? 0) > TETO_DO_SINO_EM_15_MIN) return;

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
    await publishHubNotification(
      {
        actionHref: "/apolo?tela=autonomos",
        body: interesse.length
          ? `${input.nome} pediu cadastro. Interesse em: ${interesse.join(", ")}.`
          : `${input.nome} pediu cadastro pelo link.`,
        context: { origem: ORIGEM_DO_LINK_DO_AUTONOMO },
        kind: "operacao",
        moduleId: "apolo",
        push: { tag: "autonomo-link" },
        recipientUserIds: destinatarios,
        severity: "info",
        title: "Novo corretor autônomo pelo link",
      },
      client,
    );
  } catch (erro) {
    console.error("[apolo][autonomo-link] falha ao avisar o pedido novo", erro);
  }
}

// ---------------------------------------------------------------------------
// A FILA DO TIME
// ---------------------------------------------------------------------------

export type ItemDaFilaDoAutonomo = {
  /** Código CA, quando aprovado. */
  codigo: null | string;
  cpfMascarado: null | string;
  decididoEm: null | string;
  documentos: Array<{ categoria: string; fileName: string }>;
  /** A ficha que a aprovação criou ou em que anexou (null antes de aprovar). */
  entityId: null | string;
  enviadoEm: string;
  estado: EstadoDoPedido;
  /**
   * A ficha que o CPF JÁ TEM e que a aprovação vai usar, com os papéis dela (null = CPF novo). Achada
   * pelas DUAS fontes (`document_hash` e o identificador do sync do C2X): a primeira versão olhava só a
   * primeira, e 20 CPFs com ficha só no identificador passavam como "novos".
   */
  fichaExistente: FichaDoCpf | null;
  interesse: EmpreendimentoDeInteresse[];
  motivos: string[];
  pedidoId: string;
  proposta: PropostaDoLink;
  /** O que a aprovação vai gravar, dito ANTES do clique. Ver `oQueSeraGravado`. */
  seraGravado: string[];
};

export type FichaDoCpf = { entityId: string; nome: string; papeis: string[] };

/**
 * Entre as fichas do mesmo CPF (as cópias do Asana existem), qual a aprovação usa. Pura.
 *
 * A que já tem o papel `corretor` (é onde o código faz sentido); senão a mais antiga, que é a original.
 */
export function escolherFicha<T extends { createdAt: string; entityId: string; papeis: string[] }>(
  fichas: T[],
): T | null {
  if (fichas.length === 0) return null;
  const ordenadas = [...fichas].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.entityId.localeCompare(b.entityId),
  );
  return ordenadas.find((ficha) => ficha.papeis.some((papel) => papel.startsWith("corretor"))) ?? ordenadas[0]!;
}

/**
 * O que a aprovação grava, em frases para a tela. Pura, e é a MESMA régua de `aprovarPedido`.
 *
 * ⚠️ EM FICHA QUE JÁ EXISTE, O QUE FOI DIGITADO NÃO ENTRA (terceira rodada de revisão, 01/10/2026). A
 * versão anterior acrescentava os campos vazios, e qualificação e endereço chegavam ao contrato da Têmis.
 */
export function oQueSeraGravado(input: { documentos: number; fichaExistente: boolean }): string[] {
  const documentos =
    input.documentos === 1 ? "1 documento no drive da ficha" : `${input.documentos} documentos no drive da ficha`;
  if (input.fichaExistente) {
    return [
      "Papel de corretor autônomo ativo, na ficha que já existe",
      "Código CA",
      documentos,
      "Os dados digitados NÃO entram na ficha: ficam aqui, como pendência",
    ];
  }
  return [
    "Ficha nova com os dados digitados (identificação, contato, endereço e qualificação)",
    "Papel de corretor autônomo ativo",
    "Código CA",
    documentos,
  ];
}

/** Quantos dias o que já foi DECIDIDO continua na tela (o mesmo corte do Board). */
const JANELA_DOS_DECIDIDOS_DIAS = 30;

/**
 * Monta a fila a partir da trilha, pura.
 *
 *   • UM ITEM POR CPF, o pedido mais recente: o reenvio depois de "pedir correção" é um pedido novo e
 *     substitui o anterior, com a proposta inteira de novo (a primeira versão "acrescentava" e o reenvio
 *     não atualizava nada);
 *   • em análise e em correção nunca saem por idade; aprovados e indeferidos saem depois de 30 dias.
 */
export function montarFila(
  eventos: EventoDoPedido[],
  agora: Date = new Date(),
): Array<Omit<ItemDaFilaDoAutonomo, "fichaExistente" | "seraGravado">> {
  const pedidos = eventos
    .filter((evento) => evento.action === ACOES_DO_PEDIDO.solicitado && evento.id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const vistos = new Set<string>();
  const corte = agora.getTime() - JANELA_DOS_DECIDIDOS_DIAS * 24 * 60 * 60 * 1000;
  const itens: Array<Omit<ItemDaFilaDoAutonomo, "fichaExistente" | "seraGravado">> = [];

  for (const pedido of pedidos) {
    const chave = String(pedido.metadata?.cpfHash ?? pedido.id);
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const pedidoId = String(pedido.id);
    const decisoes = eventos
      .filter(
        (evento) =>
          ESTADO_DA_DECISAO[evento.action] && String(evento.metadata?.pedidoId ?? "") === pedidoId,
      )
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const ultima = decisoes[0] ?? null;
    const estado = estadoDoPedido(pedidoId, decisoes);
    const decidido = estado === "aprovado" || estado === "indeferido";
    if (decidido && ultima && Date.parse(ultima.created_at) < corte) continue;

    const meta = pedido.metadata ?? {};
    const interesseBruto = Array.isArray(meta.empreendimentosDeInteresse)
      ? meta.empreendimentosDeInteresse
      : [];
    const documentosBrutos = Array.isArray(meta.documentos) ? meta.documentos : [];
    const motivosBrutos = Array.isArray(ultima?.metadata?.motivos) ? ultima.metadata.motivos : [];
    const observacao = String(ultima?.metadata?.observacao ?? "").trim();
    const motivos = motivosBrutos.filter(
      (m): m is string => typeof m === "string" && m.trim() !== "",
    );

    itens.push({
      codigo: estado === "aprovado" ? String(ultima?.metadata?.codigo ?? "") || null : null,
      cpfMascarado: String(meta.cpfMascarado ?? "") || null,
      decididoEm: ultima?.created_at ?? null,
      documentos: documentosBrutos.map((doc) => ({
        categoria: String((doc as { categoria?: unknown })?.categoria ?? ""),
        fileName: String((doc as { fileName?: unknown })?.fileName ?? ""),
      })),
      entityId: estado === "aprovado" ? (ultima?.entity_id ?? null) : null,
      enviadoEm: pedido.created_at,
      estado,
      interesse: interesseBruto
        .map((emp) => ({
          id: String((emp as { id?: unknown })?.id ?? ""),
          label: String((emp as { label?: unknown })?.label ?? ""),
        }))
        .filter((emp) => emp.id),
      motivos: estado === "em-analise" ? [] : observacao ? [...motivos, observacao] : motivos,
      pedidoId,
      proposta: propostaDoLink((meta.proposta ?? {}) as Record<string, unknown>),
    });
  }
  return itens;
}

const PAGINA_DA_FILA = 1000;
const TETO_DE_PAGINAS_DA_FILA = 20;

/**
 * As fichas de cada CPF (pelo resumo), nas DUAS fontes: `apolo_entities.document_hash` (quem nasce no
 * Apolo) e `apolo_entity_identifiers` (quem veio do sync do C2X). O resumo é o mesmo hash nas duas.
 */
async function fichasPorResumo(
  client: AdminClient,
  resumos: string[],
): Promise<
  | { ok: false }
  | {
      ok: true;
      porResumo: Map<string, Array<FichaDoCpf & { createdAt: string }>>;
    }
> {
  const resumoDaFicha = new Map<string, string>();
  for (let i = 0; i < resumos.length; i += 100) {
    const lote = resumos.slice(i, i + 100);
    const [porHash, porIdentificador] = await Promise.all([
      client.from("apolo_entities").select("id, document_hash").in("document_hash", lote),
      client
        .from("apolo_entity_identifiers")
        .select("entity_id, value_hash")
        .eq("identifier_type", "cpf")
        .in("value_hash", lote),
    ]);
    if (porHash.error || porIdentificador.error) return { ok: false };
    for (const linha of (porHash.data ?? []) as Array<{ document_hash: string; id: string }>) {
      resumoDaFicha.set(linha.id, linha.document_hash);
    }
    for (const linha of (porIdentificador.data ?? []) as Array<{ entity_id: string; value_hash: string }>) {
      resumoDaFicha.set(linha.entity_id, linha.value_hash);
    }
  }

  const ids = [...resumoDaFicha.keys()];
  const porResumo = new Map<string, Array<FichaDoCpf & { createdAt: string }>>();
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const [fichas, papeis] = await Promise.all([
      client.from("apolo_entities").select("id, display_name, created_at").in("id", lote),
      client.from("apolo_entity_profiles").select("entity_id, profile, status").in("entity_id", lote),
    ]);
    if (fichas.error || papeis.error) return { ok: false };
    const papeisDaFicha = new Map<string, string[]>();
    for (const linha of (papeis.data ?? []) as Array<{ entity_id: string; profile: string; status: string }>) {
      papeisDaFicha.set(linha.entity_id, [
        ...(papeisDaFicha.get(linha.entity_id) ?? []),
        `${linha.profile} (${linha.status})`,
      ]);
    }
    for (const linha of (fichas.data ?? []) as Array<{ created_at: string; display_name: null | string; id: string }>) {
      const resumo = resumoDaFicha.get(linha.id);
      if (!resumo) continue;
      porResumo.set(resumo, [
        ...(porResumo.get(resumo) ?? []),
        {
          createdAt: linha.created_at,
          entityId: linha.id,
          nome: String(linha.display_name ?? "").trim() || "Sem nome",
          papeis: papeisDaFicha.get(linha.id) ?? [],
        },
      ]);
    }
  }
  return { ok: true, porResumo };
}

/**
 * A FILA, sem teto escondido (terceira rodada de revisão).
 *
 * A primeira versão lia os 1.000 eventos mais recentes de todas as ações juntas: sob inundação, o pedido
 * legítimo de ontem saía da tela calado. Agora os PEDIDOS são paginados (até 20 mil) e as decisões são
 * lidas pelo id de cada pedido. Se o teto de páginas for atingido, a resposta diz (`truncado`).
 */
export async function filaDoLinkDoAutonomo(
  client: AdminClient,
): Promise<{ itens: ItemDaFilaDoAutonomo[]; ok: true; truncado: boolean } | { ok: false }> {
  const pedidos: EventoDoPedido[] = [];
  let truncado = false;
  for (let pagina = 0; ; pagina += 1) {
    if (pagina >= TETO_DE_PAGINAS_DA_FILA) {
      truncado = true;
      break;
    }
    const { data, error } = await client
      .from("apolo_audit_events")
      .select("id, action, created_at, entity_id, metadata")
      .eq("action", ACOES_DO_PEDIDO.solicitado)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(pagina * PAGINA_DA_FILA, pagina * PAGINA_DA_FILA + PAGINA_DA_FILA - 1);
    if (error) return { ok: false };
    const lidos = (data ?? []) as EventoDoPedido[];
    pedidos.push(...lidos);
    if (lidos.length < PAGINA_DA_FILA) break;
  }

  const idsDosPedidos = pedidos.map((pedido) => String(pedido.id)).filter(Boolean);
  const decisoes: EventoDoPedido[] = [];
  for (let i = 0; i < idsDosPedidos.length; i += 100) {
    const { data, error } = await client
      .from("apolo_audit_events")
      .select("id, action, created_at, entity_id, metadata")
      .in("action", ACOES_DE_DECISAO)
      .in("metadata->>pedidoId", idsDosPedidos.slice(i, i + 100));
    if (error) return { ok: false };
    decisoes.push(...((data ?? []) as EventoDoPedido[]));
  }

  const base = montarFila([...pedidos, ...decisoes]);
  const resumoDoPedido = new Map(
    pedidos.map((pedido) => [String(pedido.id), String(pedido.metadata?.cpfHash ?? "")]),
  );
  const resumos = [
    ...new Set(base.map((item) => resumoDoPedido.get(item.pedidoId) ?? "").filter(Boolean)),
  ];
  const fichas = await fichasPorResumo(client, resumos);
  if (!fichas.ok) return { ok: false };

  return {
    itens: base.map((item) => {
      const escolhida = escolherFicha(fichas.porResumo.get(resumoDoPedido.get(item.pedidoId) ?? "") ?? []);
      return {
        ...item,
        fichaExistente: escolhida
          ? { entityId: escolhida.entityId, nome: escolhida.nome, papeis: escolhida.papeis }
          : null,
        seraGravado: oQueSeraGravado({
          documentos: item.documentos.length,
          fichaExistente: Boolean(escolhida),
        }),
      };
    }),
    ok: true,
    truncado,
  };
}

/** As URLs assinadas (10 min) dos documentos de um pedido, para o time conferir antes de decidir. */
export async function documentosDoPedido(
  client: AdminClient,
  pedidoId: string,
): Promise<
  | { documentos: Array<{ categoria: string; fileName: string; url: null | string }>; ok: true }
  | { ok: false; status: number }
> {
  const { data, error } = await client
    .from("apolo_audit_events")
    .select("id, action, metadata")
    .eq("id", pedidoId)
    .eq("action", ACOES_DO_PEDIDO.solicitado)
    .maybeSingle<{ id: string; metadata: null | Record<string, unknown> }>();
  if (error) return { ok: false, status: 503 };
  if (!data) return { ok: false, status: 404 };
  const lista = (Array.isArray(data.metadata?.documentos) ? data.metadata.documentos : []) as
    DocumentoDoPedido[];
  const documentos = await Promise.all(
    lista.map(async (doc) => {
      const assinada = await client.storage
        .from(APOLO_DOCS_BUCKET)
        .createSignedUrl(String(doc.storagePath ?? ""), 60 * 10);
      return {
        categoria: String(doc.categoria ?? ""),
        fileName: String(doc.fileName ?? ""),
        url: assinada.error ? null : (assinada.data?.signedUrl ?? null),
      };
    }),
  );
  return { documentos, ok: true };
}

// ---------------------------------------------------------------------------
// AS TRÊS DECISÕES DO TIME
// ---------------------------------------------------------------------------

export type AcaoDoTime = "aprovar" | "correcao" | "indeferir";

export type DecisaoFeita = {
  aviso: { enviado: boolean; erro: null | string };
  codigo: null | string;
  /** Na aprovação: o que foi para o drive da ficha e o que falhou (para o time anexar pela ficha). */
  documentos: { falhas: string[]; salvos: number };
  estado: EstadoDoPedido;
  /** A ficha usada: a nova, ou a que o CPF já tinha. */
  entityId: null | string;
  ok: true;
};

export type RecusaDaDecisao = { mensagem: string; ok: false; status: number };

const MENSAGEM_FALHA_DA_DECISAO =
  "Não foi possível registrar a decisão agora. Tente de novo em instantes; nada foi gravado.";

/**
 * Pode decidir? Puro.
 *
 *   • decidido não se decide de novo (aprovado já tem código; indeferido volta pelo link);
 *   • só o pedido MAIS RECENTE do CPF se decide: um mais novo substitui o anterior;
 *   • pedir correção só vale para quem está em análise;
 *   • correção e indeferimento exigem motivo.
 */
export function recusaDaDecisao(input: {
  acao: AcaoDoTime;
  estado: EstadoDoPedido;
  maisRecente: boolean;
  motivos: string[];
}): null | RecusaDaDecisao {
  if (input.estado === "aprovado" || input.estado === "indeferido") {
    return { mensagem: "Este pedido já foi decidido. Atualize a tela.", ok: false, status: 409 };
  }
  if (!input.maisRecente) {
    return {
      mensagem: "Este CPF mandou um cadastro mais recente. Atualize a tela e decida o novo.",
      ok: false,
      status: 409,
    };
  }
  if (input.acao === "correcao" && input.estado !== "em-analise") {
    return {
      mensagem: "A correção já foi pedida. Espere o corretor reenviar pelo link.",
      ok: false,
      status: 409,
    };
  }
  if (input.acao !== "aprovar" && input.motivos.length === 0) {
    return { mensagem: "Diga o motivo: fica registrado no pedido.", ok: false, status: 400 };
  }
  return null;
}

/**
 * APLICA A DECISÃO DO TIME.
 *
 *   • APROVAR (`aprovarPedido`): CPF novo nasce pela porta do cadastro interno; CPF que já tem ficha
 *     recebe SÓ papel, código CA e documentos. Nenhuma habilitação nasce aqui.
 *   • PEDIR CORREÇÃO: só a trilha, e o aviso ao celular digitado com o link para reenviar.
 *   • INDEFERIR: só a trilha, e os documentos do pedido saem do staging. SEM WhatsApp (terceira rodada de
 *     revisão, 01/10/2026): o número foi digitado num formulário aberto e pode ser de qualquer pessoa, e
 *     uma recusa não tem o que pedir de volta. A tela diz que ninguém foi avisado.
 */
export async function decidirPedidoDoAutonomo(
  client: AdminClient,
  input: {
    acao: AcaoDoTime;
    autorNome: null | string;
    autorUserId: null | string;
    motivos?: string[];
    observacao?: null | string;
    pedidoId: string;
  },
): Promise<DecisaoFeita | RecusaDaDecisao> {
  const motivos = (input.motivos ?? [])
    .map((m) => String(m ?? "").trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 10);
  const observacao = String(input.observacao ?? "").trim().slice(0, 1000) || null;

  const { data: pedido, error: erroDoPedido } = await client
    .from("apolo_audit_events")
    .select("id, action, created_at, metadata")
    .eq("id", input.pedidoId)
    .eq("action", ACOES_DO_PEDIDO.solicitado)
    .maybeSingle<EventoDoPedido & { id: string }>();
  if (erroDoPedido) return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
  if (!pedido) return { mensagem: "Pedido não encontrado.", ok: false, status: 404 };

  const resumo = String(pedido.metadata?.cpfHash ?? "");
  const [decisoes, ultimo] = await Promise.all([
    client
      .from("apolo_audit_events")
      .select("action, created_at, metadata")
      .in("action", ACOES_DE_DECISAO)
      .eq("metadata->>pedidoId", pedido.id)
      .order("created_at", { ascending: false })
      .limit(20),
    ultimoPedidoDoCpf(client, resumo),
  ]);
  if (decisoes.error || !ultimo.ok) {
    return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
  }

  const estado = estadoDoPedido(pedido.id, (decisoes.data ?? []) as EventoDoPedido[]);
  const recusa = recusaDaDecisao({
    acao: input.acao,
    estado,
    maisRecente: ultimo.pedido?.id === pedido.id,
    motivos: observacao ? [...motivos, observacao] : motivos,
  });
  if (recusa) return recusa;

  const proposta = propostaDoLink((pedido.metadata?.proposta ?? {}) as Record<string, unknown>);
  const documentosDoPedido = (Array.isArray(pedido.metadata?.documentos)
    ? pedido.metadata.documentos
    : []) as DocumentoDoPedido[];
  const nome = proposta.identidade.nome || null;
  let codigo: null | string = null;
  let entityId: null | string = null;
  let fichaJaExistia = false;
  let documentos: DecisaoFeita["documentos"] = { falhas: [], salvos: 0 };
  let novoEstado: EstadoDoPedido;

  if (input.acao === "aprovar") {
    const aprovado = await aprovarPedido(client, {
      autorUserId: input.autorUserId,
      documentos: documentosDoPedido,
      proposta,
    });
    if (!aprovado.ok) return aprovado;
    codigo = aprovado.codigo;
    entityId = aprovado.entityId;
    fichaJaExistia = aprovado.fichaJaExistia;
    documentos = aprovado.documentos;
    novoEstado = "aprovado";
  } else {
    novoEstado = input.acao === "indeferir" ? "indeferido" : "correcao";
  }

  const { error: erroDoEvento } = await client.from("apolo_audit_events").insert({
    action:
      novoEstado === "aprovado"
        ? ACOES_DO_PEDIDO.aprovado
        : novoEstado === "indeferido"
          ? ACOES_DO_PEDIDO.indeferido
          : ACOES_DO_PEDIDO.correcao,
    actor_user_id: input.autorUserId,
    entity_id: entityId,
    field_name: "cadastro_corretor_autonomo",
    metadata: {
      autor: input.autorNome,
      ...(codigo ? { codigo } : {}),
      ...(novoEstado === "aprovado"
        ? {
            documentosComFalha: documentos.falhas,
            fichaJaExistia,
            // Em ficha que já existia, o que foi digitado NÃO entrou: fica aqui, no histórico da ficha,
            // como pendência para o time conferir e atualizar à mão se for o caso.
            ...(fichaJaExistia ? { propostaNaoGravada: proposta } : {}),
          }
        : {}),
      motivos,
      observacao,
      origem: ORIGEM_DO_LINK_DO_AUTONOMO,
      pedidoId: pedido.id,
    },
    status: "mapped",
  });
  if (erroDoEvento) {
    // Na aprovação a ficha e o código já valem. Um novo clique em Aprovar encontra o CPF com código e
    // recusa (a régua de "uma pessoa, um código"), e a ficha aparece no CRM com o código.
    console.error("[apolo][autonomo-link] falha ao registrar a decisao", erroDoEvento.message);
    return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
  }

  if (novoEstado === "indeferido") {
    await apagarDocumentosDoPedido(client, documentosDoPedido);
    return {
      aviso: { enviado: false, erro: "indeferimento não é avisado pelo WhatsApp" },
      codigo: null,
      documentos,
      entityId: null,
      estado: novoEstado,
      ok: true,
    };
  }

  // O AVISO vai para o celular DIGITADO no pedido: é quem pediu. Best-effort, com o resultado na tela.
  const texto =
    novoEstado === "aprovado"
      ? mensagemAutonomoAprovado({ corretor: nome })
      : mensagemAutonomoCorrecao({
          corretor: nome,
          linkDoCadastro: LINK_DO_CADASTRO_DO_AUTONOMO,
          motivos,
          observacao,
        });
  const aviso = await avisarCorretor(client, {
    entityId,
    nome,
    telefone: proposta.perfil.telefone || null,
    texto,
    tipo: novoEstado,
  });

  return { aviso, codigo, documentos, entityId, estado: novoEstado, ok: true };
}

async function aprovarPedido(
  client: AdminClient,
  input: { autorUserId: null | string; documentos: DocumentoDoPedido[]; proposta: PropostaDoLink },
): Promise<
  | {
      codigo: string;
      documentos: DecisaoFeita["documentos"];
      entityId: string;
      fichaJaExistia: boolean;
      ok: true;
    }
  | RecusaDaDecisao
> {
  const cpf = String(input.proposta.identidade.cpf ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) {
    return { mensagem: "O pedido não tem um CPF válido.", ok: false, status: 409 };
  }

  // As fichas do CPF nas DUAS fontes (`fichasDoDocumento`: document_hash e identificador do sync).
  const fichas = await fichasDoDocumento(client, "cpf", cpf);
  if (fichas.falhou) return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };

  let entityId: string;
  let fichaJaExistia = false;
  if (fichas.ids.length > 0) {
    const [entidades, papeis] = await Promise.all([
      client
        .from("apolo_entities")
        .select("id, broker_code, created_at, entity_kind")
        .in("id", fichas.ids.slice(0, 100)),
      client
        .from("apolo_entity_profiles")
        .select("entity_id, profile, status")
        .in("entity_id", fichas.ids.slice(0, 100)),
    ]);
    if (entidades.error || papeis.error) {
      return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
    }
    const linhas = (entidades.data ?? []) as Array<{
      broker_code: null | string;
      created_at: string;
      entity_kind: null | string;
      id: string;
    }>;
    const linhasDePapel = (papeis.data ?? []) as Array<{
      entity_id: string;
      profile: string;
      status: string;
    }>;

    // ⚠️ UMA PESSOA, UM CÓDIGO, e nunca uma ficha de imobiliária (*"nao quero ter a informacao que pode
    // ter pessoa fisica como imobiliaria"*). Medido no momento da decisão.
    const comCodigo = linhas.find((linha) => String(linha.broker_code ?? "").trim());
    if (comCodigo) {
      return {
        mensagem: `Esta pessoa já é corretor autônomo (código ${String(comCodigo.broker_code).trim()}). Indefira este pedido.`,
        ok: false,
        status: 409,
      };
    }
    if (
      linhas.some((linha) => String(linha.entity_kind ?? "") !== "pf") ||
      linhasDePapel.some((linha) => linha.profile === PAPEL_DE_IMOBILIARIA)
    ) {
      return {
        mensagem:
          "Este CPF está numa ficha que não pode virar corretor autônomo (empresa ou imobiliária). Indefira este pedido.",
        ok: false,
        status: 409,
      };
    }

    // ⚠️ FICHA QUE JÁ EXISTE NÃO RECEBE NADA DO QUE FOI DIGITADO (terceira rodada de revisão,
    // 01/10/2026). Nem pelo modo que acrescenta: ele preenchia os campos VAZIOS (qualificação, endereço),
    // e eles chegam ao contrato da Têmis. Aqui a ficha recebe só papel, código e documentos; a proposta
    // fica no evento da aprovação, como pendência. A ficha é a mesma que a tela mostrou antes do clique
    // (`escolherFicha`, a mesma régua da fila).
    const escolhida = escolherFicha(
      linhas.map((linha) => ({
        createdAt: linha.created_at,
        entityId: linha.id,
        papeis: linhasDePapel
          .filter((papel) => papel.entity_id === linha.id)
          .map((papel) => `${papel.profile} (${papel.status})`),
      })),
    );
    if (!escolhida) return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
    entityId = escolhida.entityId;
    fichaJaExistia = true;
  } else {
    // CPF NOVO: a ficha nasce pela porta do cadastro interno, inteira. O modo que acrescenta é só a rede
    // para a corrida em que outra ficha deste CPF nasce entre a leitura acima e esta gravação.
    const criado = await createApoloEntity(client, entradaDaAprovacao(input.proposta, input.autorUserId), {
      cadastroDeCorretorAutonomo: true,
      fichaExistente: "acrescentar",
    });
    if (!criado.ok) {
      return { mensagem: criado.error || MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 409 };
    }
    entityId = criado.entityId;
  }

  // O PAPEL ATIVO é a decisão de quem aprovou (`lerAutonomo` exige `corretor` ativo).
  const { error: erroDoPapel } = await client
    .from("apolo_entity_profiles")
    .upsert(
      { entity_id: entityId, profile: PAPEL_DO_AUTONOMO, status: "active" },
      { onConflict: "entity_id,profile" },
    );
  if (erroDoPapel) return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };

  // O CÓDIGO CA, da sequência do banco, só em ficha SEM código (`broker_code is null` no próprio UPDATE):
  // dois cliques em Aprovar não dão dois códigos. Quem perder a corrida lê o código que ficou.
  const sequencia = await proximoCodigoDoCorretor(client);
  if (!sequencia.ok) return { mensagem: sequencia.mensagem, ok: false, status: 503 };
  const { error: erroDoCodigo } = await client
    .from("apolo_entities")
    .update({ broker_code: sequencia.codigo, updated_at: new Date().toISOString() })
    .eq("id", entityId)
    .is("broker_code", null);
  if (erroDoCodigo) return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
  const { data: ficha, error: erroDaFicha } = await client
    .from("apolo_entities")
    .select("broker_code")
    .eq("id", entityId)
    .maybeSingle<{ broker_code: null | string }>();
  const codigo = String(ficha?.broker_code ?? "").trim();
  if (erroDaFicha || !codigo) {
    return { mensagem: MENSAGEM_FALHA_DA_DECISAO, ok: false, status: 503 };
  }

  // OS DOCUMENTOS vão do staging para o drive da ficha. A falha NÃO É DESCARTADA (terceira rodada de
  // revisão): volta na resposta e fica no evento, para o time anexar pela ficha.
  const nome = input.proposta.identidade.nome || "Corretor";
  let documentos: DecisaoFeita["documentos"] = { falhas: [], salvos: 0 };
  try {
    const enviados = await agruparEUploadDocumentos(client, {
      documentos: input.documentos.map((doc) => ({
        categoria: doc.categoria,
        fileName: doc.fileName,
        mimeType: doc.mimeType ?? undefined,
        sizeBytes: doc.sizeBytes ?? undefined,
        storagePath: doc.storagePath,
      })),
      entityId,
      nomeCliente: nome,
      uploadedByName: `${nome} (link público)`,
    });
    documentos = { falhas: enviados.warnings, salvos: enviados.savedDocs.length };
  } catch (erro) {
    documentos = { falhas: [`documentos: ${(erro as Error).message}`], salvos: 0 };
  }

  return { codigo, documentos, entityId, fichaJaExistia, ok: true };
}

/**
 * O aviso ao corretor pelo celular do Relacionamento.
 *
 * Com ficha (aprovação), pelo `enviarPeloRelacionamento`, que registra em `apolo_disparos`. Sem ficha
 * (pedido de correção), direto pelo gateway: `apolo_disparos.entity_id` é NOT NULL, e o resultado fica na
 * resposta para a tela mostrar.
 */
async function avisarCorretor(
  client: AdminClient,
  input: {
    entityId: null | string;
    nome: null | string;
    telefone: null | string;
    texto: string;
    tipo: EstadoDoPedido;
  },
): Promise<DecisaoFeita["aviso"]> {
  try {
    if (input.entityId) {
      const envio = await enviarPeloRelacionamento(client, {
        destinatario: `autonomo:${input.nome ?? input.entityId}`,
        entityId: input.entityId,
        telefone: input.telefone,
        texto: input.texto,
        tipo: `autonomo_link_${input.tipo}`,
      });
      return envio.ok ? { enviado: true, erro: null } : { enviado: false, erro: envio.erro ?? null };
    }
    const numero = telefoneParaEnvio(input.telefone);
    if (!numero) return { enviado: false, erro: "sem telefone" };
    const envio = await sendEvolutionDirectText({ telefone: numero, text: input.texto });
    return envio.ok ? { enviado: true, erro: null } : { enviado: false, erro: envio.error ?? null };
  } catch (erro) {
    console.error("[apolo][autonomo-link] falha ao avisar o corretor", erro);
    return { enviado: false, erro: "falha no envio" };
  }
}
