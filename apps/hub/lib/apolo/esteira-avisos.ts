// O AVISO DE CADA ETAPA DA ESTEIRA — corretor e coordenador, pelo número do RELACIONAMENTO.
//
// Regra do Lucas (21/08/2026): *"devemos comunicar em todas as etapas o corretor, coordenador"* e
// *"reforço que os disparos têm que ser feitos pelo número do relacionamento"*.
//
// ⚠️ ISTO NÃO EXISTIA. Medido em 21/08 antes de escrever: das 7 etapas da esteira, CINCO não
// avisavam ninguém (validacao, credito, correcao, credenciado, indeferido). A rota que move a
// etapa (`board/[id]/etapa/route.ts`, 88 linhas) gravava, auditava, regerava o PDF e retornava —
// sem um único import de disparo. E `apolo_disparos` tinha 2.249 linhas com ZERO do tipo
// `corretor`, porque o único código que tentava avisá-lo lia `apolo_relationships.metadata.phone`
// do vínculo do CLIENTE, campo vazio em 718 de 718 CADs: um ramo morto que falhava em silêncio.
//
// Por que pelo Evolution e não pela Meta: corretor e coordenador não mantêm janela de 24h aberta
// e não existe template para cada etapa. Pela Meta os avisos falham em massa (`imob_pix_enviado`:
// 178 falhas em 188). Pelo Relacionamento não há janela nem template — a mensagem chega.

import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import { telefoneParaEnvio } from "@/lib/apolo/disparo-credenciamento";
import {
  type DadosDaCad,
  mensagemCoordenadorCorrecao,
  mensagemCoordenadorCredenciada,
  mensagemCoordenadorEmCredito,
  mensagemCoordenadorIndeferido,
  mensagemCoordenadorPrevenda,
  mensagemCoordenadorRecebida,
  mensagemCoordenadorReprovado,
  mensagemCorretorCorrecao,
  mensagemCorretorCredenciada,
  mensagemCorretorEmCredito,
  mensagemCorretorIndeferido,
  mensagemCorretorPrevenda,
  mensagemCorretorRecebida,
  mensagemCorretorReprovado,
} from "@/lib/apolo/esteira-mensagens";
import { sendEvolutionDirectMedia, sendEvolutionDirectText } from "@/lib/iris/evolution-api";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient;

export type EtapaComAviso =
  | "correcao"
  | "credenciado"
  | "credito"
  | "indeferido"
  | "prevenda"
  | "revisao"
  | "validacao";

// A dupla de mensagens de cada etapa. Ter a tabela aqui, e não um `switch` espalhado, é o que
// permite responder "esta etapa avisa?" olhando um lugar só — que era exatamente a pergunta que
// ninguém conseguia responder antes ("revisa se todas as etapas temos os disparos sendo feitos").
const MENSAGENS: Record<
  EtapaComAviso,
  { coordenador: (i: DadosDaCad) => string; corretor: (i: DadosDaCad) => string }
> = {
  correcao: { coordenador: mensagemCoordenadorCorrecao, corretor: mensagemCorretorCorrecao },
  credenciado: { coordenador: mensagemCoordenadorCredenciada, corretor: mensagemCorretorCredenciada },
  credito: { coordenador: mensagemCoordenadorEmCredito, corretor: mensagemCorretorEmCredito },
  indeferido: { coordenador: mensagemCoordenadorIndeferido, corretor: mensagemCorretorIndeferido },
  prevenda: { coordenador: mensagemCoordenadorPrevenda, corretor: mensagemCorretorPrevenda },
  revisao: { coordenador: mensagemCoordenadorReprovado, corretor: mensagemCorretorReprovado },
  validacao: { coordenador: mensagemCoordenadorRecebida, corretor: mensagemCorretorRecebida },
};

export function etapaTemAviso(etapa: string): etapa is EtapaComAviso {
  return Object.prototype.hasOwnProperty.call(MENSAGENS, etapa);
}

export type ResultadoAviso = {
  destinatario: null | string;
  erro?: string;
  ok: boolean;
  // Para quem foi de fato: `corretor` quando o vínculo existe, `imobiliaria` quando ela entrou no
  // lugar dele. Sem isto, "avisado" na tela não distingue quem recebeu.
  papel?: "corretor" | "imobiliaria";
  telefone?: null | string;
};

export type ResultadoAvisoEtapa = {
  coordenador: ResultadoAviso;
  corretor: ResultadoAviso;
  etapa: string;
};

// Telefone de uma entidade do Apolo. `is_primary` primeiro, depois o mais recente: quem cadastrou
// um número novo quer ser achado nele.
async function telefoneDaEntidade(client: Client, entityId: null | string): Promise<null | string> {
  if (!entityId) return null;

  const { data } = await client
    .from("apolo_contacts")
    .select("value, is_primary, created_at")
    .eq("entity_id", entityId)
    .in("contact_type", ["phone", "whatsapp", "mobile", "telefone"])
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);

  for (const linha of (data ?? []) as { value: null | string }[]) {
    const numero = telefoneParaEnvio(linha.value);
    if (numero) return numero;
  }

  return null;
}

type CadDoAviso = {
  cliente: string;
  corretorEntityId: null | string;
  corretorNome: null | string;
  empreendimento: null | string;
  enterpriseId: null | string;
  imobiliariaEntityId: null | string;
  imobiliariaNome: null | string;
  motivo: null | string;
};

async function lerCad(
  client: Client,
  entityId: string,
  enterpriseId: null | string,
): Promise<CadDoAviso | null> {
  let q = client
    .from("apolo_esteira")
    .select("corretor, corretor_entity_id, empreendimento, enterprise_id, imobiliaria, imobiliaria_entity_id, motivo")
    .eq("entity_id", entityId);

  if (enterpriseId) q = q.eq("enterprise_id", enterpriseId);

  const { data } = await q.order("atualizado_em", { ascending: false }).limit(1);
  const linha = (data ?? [])[0] as
    | undefined
    | {
        corretor: null | string;
        corretor_entity_id: null | string;
        empreendimento: null | string;
        enterprise_id: null | string;
        imobiliaria: null | string;
        imobiliaria_entity_id: null | string;
        motivo: null | string;
      };

  if (!linha) return null;

  const { data: entidade } = await client
    .from("apolo_entities")
    .select("display_name, legal_name")
    .eq("id", entityId)
    .maybeSingle<{ display_name: null | string; legal_name: null | string }>();

  return {
    cliente: (entidade?.legal_name || entidade?.display_name || "").trim() || "Cliente",
    corretorEntityId: linha.corretor_entity_id,
    corretorNome: linha.corretor,
    empreendimento: linha.empreendimento,
    enterpriseId: linha.enterprise_id,
    imobiliariaEntityId: linha.imobiliaria_entity_id,
    imobiliariaNome: linha.imobiliaria,
    motivo: linha.motivo,
  };
}

// O COORDENADOR do empreendimento desta CAD. Mesmo caminho já provado em produção (185 mensagens
// lidas): enterprise_id -> `apolo_enterprise_settings.code` -> C2X `players.coordenador_vendas`.
//
// ⚠️ DEPENDE DO C2X, que é read-only e às vezes não tem o dado. Quando não tem, devolve o MOTIVO
// em vez de null puro: "sem coordenador" e "coordenador sem telefone" mandam o operador para
// lugares diferentes, e o registro de falha precisa dizer qual dos dois foi.
async function coordenadorDaCad(
  client: Client,
  enterpriseId: null | string,
): Promise<{ motivo?: string; nome: null | string; telefone: null | string }> {
  if (!enterpriseId) {
    return { motivo: "CAD sem empreendimento: não dá para identificar o coordenador.", nome: null, telefone: null };
  }

  const { data } = await client
    .from("apolo_enterprise_settings")
    .select("code")
    .eq("enterprise_id", enterpriseId)
    .maybeSingle<{ code: null | string }>();

  const code = (data?.code ?? "").trim();
  if (!code) {
    return { motivo: "Empreendimento sem sigla cadastrada no Apolo.", nome: null, telefone: null };
  }

  const cadastro = await loadApoloEnterpriseCadastro([code]);
  if (!cadastro.ok) {
    return { motivo: "Não foi possível ler o cadastro do empreendimento no C2X.", nome: null, telefone: null };
  }

  const coordenador = cadastro.cadastros[0]?.players.find((p) => p.relation === "coordenador_vendas");
  if (!coordenador) {
    return { motivo: "Empreendimento sem coordenador de vendas no C2X.", nome: null, telefone: null };
  }

  const telefone = telefoneParaEnvio(coordenador.phone);
  return telefone
    ? { nome: coordenador.name, telefone }
    : { motivo: "Coordenador sem telefone no C2X.", nome: coordenador.name, telefone: null };
}

// ⚠️ REGISTRA A FALHA, NÃO PULA EM SILÊNCIO. O comportamento antigo marcava "pulado" quando não
// havia telefone, e por isso 718 CADs sem corretor vinculado nunca apareceram como problema em
// lugar nenhum. Falha registrada é falha que a tela de status mostra e alguém conserta.
async function registrar(
  client: Client,
  input: {
    destinatario: null | string;
    entityId: string;
    erro?: null | string;
    origem: string;
    telefone: null | string;
    tipo: string;
  },
): Promise<void> {
  try {
    await client.from("apolo_disparos").insert({
      destinatario: input.destinatario,
      entity_id: input.entityId,
      erro: input.erro ?? null,
      // ⚠️ NÃO EXISTE COLUNA `canal`: o canal vive dentro da `origem`, que é NOT NULL. O prefixo
      // `relacionamento:` é o que separa, na consulta, o que saiu do celular do que saiu da Meta.
      origem: input.origem,
      status: input.erro ? "falhou" : "enviado",
      telefone: input.telefone,
      tipo: input.tipo,
    });
  } catch {
    // Best-effort: o registro nunca derruba o aviso, que já saiu.
  }
}

// A CAD EM PDF, assinada, para ir junto do aviso de reprovação.
//
// ⚠️ ISTO NÃO É ENFEITE: o coordenador decide olhando a CAD, não o texto. O aviso de reprovação
// que existia antes (pela Meta) mandava o PDF no cabeçalho do template, e migrar para o
// Relacionamento sem trazer o anexo teria custado exatamente a informação que embasa a decisão.
//
// Import dinâmico porque monta PDF: as outras seis etapas não pagam esse custo.
async function anexoDaCad(
  client: Client,
  entityId: string,
  enterpriseId: null | string,
  cliente: string,
): Promise<null | { fileName: string; url: string }> {
  try {
    const [{ montarCadDeEntidade }, { montarCadPdf }, { APOLO_DOCS_BUCKET }] = await Promise.all([
      import("@/lib/apolo/cad-de-entidade"),
      import("@/modules/apolo/blocks/cadastro/cad-pdf"),
      import("@/lib/apolo/documentos"),
    ]);

    const cad = await montarCadDeEntidade(client, entityId, { enterpriseId });
    if (!cad) return null;

    const bytes = await montarCadPdf(cad);
    const bucket = process.env.APOLO_DOCS_BUCKET ?? APOLO_DOCS_BUCKET;
    const path = `aviso-etapa/${entityId}.pdf`;

    const up = await client.storage
      .from(bucket)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) return null;

    // 1h de folga para o gateway baixar o arquivo.
    const assinada = await client.storage.from(bucket).createSignedUrl(path, 60 * 60);
    const url = assinada.data?.signedUrl;

    return url ? { fileName: `CAD-${cliente}.pdf`, url } : null;
  } catch {
    return null;
  }
}

async function enviar(
  client: Client,
  input: {
    // Documento que vai junto. Sem ele, texto puro.
    anexo?: null | { fileName: string; url: string };
    destinatario: null | string;
    entityId: string;
    origem: string;
    telefone: null | string;
    texto: string;
    tipo: string;
    // Motivo de já nascer falho (sem vínculo, sem telefone). Vem antes do envio.
    impedimento?: string;
  },
): Promise<ResultadoAviso> {
  if (input.impedimento || !input.telefone) {
    const erro = input.impedimento ?? "sem telefone";
    await registrar(client, { ...input, erro });
    return { destinatario: input.destinatario, erro, ok: false };
  }

  const r = input.anexo
    ? await sendEvolutionDirectMedia({
        caption: input.texto,
        fileName: input.anexo.fileName,
        mimeType: "application/pdf",
        telefone: input.telefone,
        url: input.anexo.url,
      })
    : await sendEvolutionDirectText({ telefone: input.telefone, text: input.texto });
  await registrar(client, { ...input, erro: r.ok ? null : r.error });

  return r.ok
    ? { destinatario: input.destinatario, ok: true, telefone: input.telefone }
    : { destinatario: input.destinatario, erro: r.error, ok: false, telefone: input.telefone };
}

/**
 * Avisa corretor e coordenador de que a CAD mudou de etapa.
 *
 * ⚠️ SÓ DISPARA QUANDO A ETAPA MUDOU DE VERDADE. `atualizarEtapa` faz upsert e é chamada por
 * caminhos que regravam a mesma etapa (reconsulta de Serasa, clique repetido, importação). Sem
 * comparar com a etapa anterior, cada regravação viraria uma mensagem nova no WhatsApp de quem
 * não teve nenhuma novidade.
 *
 * Nunca lança: um aviso que falha não pode derrubar a gravação da etapa, que já aconteceu.
 */
export async function avisarEtapa(
  client: Client,
  input: {
    // Limita a UM destinatário. É o botão de reenvio individual do Board: reenviar para o
    // coordenador não pode disparar de novo para o corretor, que já recebeu.
    apenas?: "coordenador" | "corretor";
    enterpriseId?: null | number | string;
    entityId: string;
    etapa: string;
    etapaAnterior?: null | string;
    // Reenvio MANUAL: pula a trava de repetição. Quem clica em "reenviar" está pedindo a
    // repetição de propósito — é o caso em que o aviso automático falhou.
    forcar?: boolean;
    // `automatico` (Serasa, pagamento) ou `board` (o operador moveu). Vai para a origem do
    // registro: é por ela que se separa o que a máquina mandou do que alguém mandou.
    origem?: "automatico" | "board";
  },
): Promise<null | ResultadoAvisoEtapa> {
  const { entityId, etapa } = input;

  if (!etapaTemAviso(etapa)) return null;
  if (!input.forcar && input.etapaAnterior && input.etapaAnterior === etapa) return null;

  const enterpriseId =
    input.enterpriseId === null || input.enterpriseId === undefined
      ? null
      : String(input.enterpriseId).trim() || null;

  try {
    const cad = await lerCad(client, entityId, enterpriseId);
    if (!cad) return null;

    const dados: DadosDaCad = {
      cliente: cad.cliente,
      corretor: cad.corretorNome,
      empreendimento: cad.empreendimento,
      imobiliaria: cad.imobiliariaNome,
      motivo: cad.motivo,
    };

    const molde = MENSAGENS[etapa];
    const origem = `relacionamento:whatsapp:${input.origem ?? "automatico"}`;

    // ── CORRETOR, com a IMOBILIÁRIA como segunda opção ────────────────────────────────────────
    //
    // ⚠️ A IMOBILIÁRIA ENTRA NO LUGAR DELE, e não além dele. Medido em 21/08: das 195 CADs vivas,
    // 45 têm corretor vinculado e 92 têm imobiliária — o resíduo do import do Asana (jul/2026)
    // nasceu com o corretor só como texto. Mandar para os dois sempre seria mensagem duplicada
    // onde os dois existem; mandar só para o corretor deixaria 47 CADs sem ninguém avisado.
    const telCorretor = await telefoneDaEntidade(client, cad.corretorEntityId);
    const telImob = telCorretor ? null : await telefoneDaEntidade(client, cad.imobiliariaEntityId);
    const alvo = telCorretor
      ? { nome: cad.corretorNome, papel: "corretor" as const, telefone: telCorretor }
      : { nome: cad.imobiliariaNome, papel: "imobiliaria" as const, telefone: telImob };

    const pulado: ResultadoAviso = { destinatario: null, erro: "não solicitado", ok: false };

    const impedimentoCorretor = alvo.telefone
      ? undefined
      : cad.corretorEntityId
        ? "Corretor vinculado, mas sem telefone no cadastro."
        : "CAD sem corretor vinculado e sem imobiliária com telefone.";

    const corretor = input.apenas === "coordenador" ? pulado : await enviar(client, {
      destinatario: alvo.nome,
      entityId,
      impedimento: impedimentoCorretor,
      origem,
      telefone: alvo.telefone,
      texto: molde.corretor(dados),
      tipo: `etapa_${etapa}_${alvo.papel}`,
    });

    // ── COORDENADOR ───────────────────────────────────────────────────────────────────────────
    const coord = await coordenadorDaCad(client, cad.enterpriseId ?? enterpriseId);

    // ⚠️ O PDF SÓ VAI NA REPROVAÇÃO, E SÓ PARA O COORDENADOR. É ele quem decide se a CAD segue, e
    // decide lendo a ficha. Mandar a CAD do cliente para o corretor em toda etapa seria espalhar
    // documento pessoal por WhatsApp sem necessidade nenhuma.
    const anexo =
      etapa === "revisao" && coord.telefone && input.apenas !== "corretor"
        ? await anexoDaCad(client, entityId, cad.enterpriseId ?? enterpriseId, cad.cliente)
        : null;

    const coordenador = input.apenas === "corretor" ? pulado : await enviar(client, {
      anexo,
      destinatario: coord.nome,
      entityId,
      impedimento: coord.motivo,
      origem,
      telefone: coord.telefone,
      texto: molde.coordenador(dados),
      tipo: `etapa_${etapa}_coordenador`,
    });

    return {
      coordenador,
      corretor: { ...corretor, papel: alvo.papel },
      etapa,
    };
  } catch {
    // A etapa já está gravada. Um aviso que explode não pode desfazer isso nem virar 500.
    return null;
  }
}
