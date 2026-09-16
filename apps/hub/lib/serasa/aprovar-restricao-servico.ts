import { registrarOverrideCredito } from "@/lib/apolo/credito-override";
import { destinoAposCredito } from "@/lib/apolo/destino-credito";
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import { atualizarEtapa } from "@/lib/apolo/esteira";
import { lerCadDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { resolverPrevendaHabilitada } from "@/lib/apolo/limite-credito";
import { comLimiteDeTempo, gerarESalvarCad } from "@/lib/apolo/salvar-cad";
import type { createApoloAdminClient } from "@/lib/apolo/server";

// Só TIPOS daqui: o serviço da consulta carrega o cliente do Serasa e o PDF do comprovante, e a rota
// de aprovação não usa nenhum dos dois (import de tipo some no build).
import type { AutorDoCredito, RespostaDoCredito } from "./consulta-servico";

// APROVAR COM RESTRIÇÃO, SEM A PORTA: o miolo de `/api/apolo/serasa/aprovar-restricao` (hub) e de
// `/api/incorporador/board/[id]/serasa/aprovar-restricao` (portal que opera sozinho).
//
// PROBLEMA 3 (Lucas, 04/08). Crédito reprovado no Serasa trava a ficha em `apolo_esteira.etapa =
// 'revisao'`. Este é o ÚNICO caminho legítimo para destravar por decisão humana: quem decide aprova
// "com restrição", ANEXA a evidência do de-acordo (PDF/PNG/JPEG, obrigatória), e a esteira segue o
// fluxo normal: prevenda se ligada, senão credenciado (PROBLEMA 1, respeitado no `atualizarEtapa`).
//
// É este serviço que passa `saidaDeRevisaoAutorizada` ao `atualizarEtapa`; sem ele, sair de
// "revisao" para avançar é BARRADO (PROBLEMA 2).
//
// QUEM DECIDE (16/09/2026). No hub, a coordenação (admin/leader), e a porta confere isso antes de
// chegar aqui. No portal que opera sozinho (Cecílio), qualquer conta do portal: decisão do Lucas, a
// equipe deles faz a análise de crédito e o credenciamento dos próprios clientes, então o de-acordo
// é da equipe deles. As regras (só sobre reprovado, evidência obrigatória, rastro) são as mesmas.
//
// ⚠️ NADA DE AUTENTICAÇÃO AQUI, como em `consulta-servico.ts`: a porta prova quem é e, no portal,
// confere o escopo da CAD antes.

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Só a evidência do de-acordo: PDF, PNG ou JPEG. O filtro é por extensão E pelo mimeType informado.
const MIME_PERMITIDO: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
};
const MIMES_VALIDOS = new Set(Object.values(MIME_PERMITIDO));

// Teto do upload. ⚠️ ELE PRECISA SER MENOR QUE O DA PLATAFORMA, não maior.
//
// O arquivo viaja em base64 dentro do JSON, o que INFLA ~33%, e a Vercel corta o body em ~4,5 MB
// (ver [[reference_apolo_upload_413]]). Um teto de 8 MB aqui era uma promessa que a rota não podia
// cumprir: a evidência de 5 MB morria com um 413 da plataforma, antes de chegar neste arquivo, e a
// coordenação via um erro sem explicação. 3 MB de arquivo = ~4 MB de base64, com folga.
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_FILE_MB = 3;

// Resolve o tipo da evidência a partir do mimeType informado e/ou da extensão. Devolve o mime
// normalizado quando é PDF/PNG/JPEG, senão null (recusa).
function tipoEvidencia(fileName: string, mimeType: null | string): null | string {
  const porMime = (mimeType ?? "").trim().toLowerCase();
  if (MIMES_VALIDOS.has(porMime)) return porMime;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_PERMITIDO[ext] ?? null;
}

export type CorpoDaAprovacao = {
  enterpriseId?: null | number | string;
  entityId?: string;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  motivo?: string;
};

/**
 * Os textos do rastro por porta. O hub grava exatamente o que gravava; o portal diz que a decisão
 * foi do time do incorporador, para ninguém ler "coordenação" e procurar a decisão na Careli.
 */
/** O id que vai para `atualizado_por` e `aprovado_por` (a mesma regra de `idDoAutor` da consulta). */
function idDoAutor(autor: AutorDoCredito): string {
  return autor.tipo === "hub" ? autor.userId : autor.usuarioId;
}

function textosDoRastro(autor: AutorDoCredito): { label: string; quem: string } {
  return autor.tipo === "hub"
    ? { label: "Aprovação com restrição (coordenação)", quem: "pela coordenação" }
    : { label: "Aprovação com restrição (portal do incorporador)", quem: "pelo incorporador" };
}

export async function aprovarComRestricao(input: {
  autor: AutorDoCredito;
  client: AdminClient;
  corpo: CorpoDaAprovacao;
}): Promise<RespostaDoCredito> {
  const { autor, client, corpo } = input;

  const entityId = (corpo.entityId ?? "").trim();
  const enterpriseId = normalizarEnterpriseId(corpo.enterpriseId);
  const fileBase64 = (corpo.fileBase64 ?? "").trim();
  const fileName = (corpo.fileName ?? "").trim();
  const motivo = (corpo.motivo ?? "").trim() || null;

  if (!entityId) {
    return { corpo: { error: "Informe a ficha." }, status: 400 };
  }
  if (!fileBase64 || !fileName) {
    return {
      corpo: {
        error:
          autor.tipo === "hub"
            ? "Anexe a evidência do de-acordo da coordenação (PDF, PNG ou JPEG)."
            : "Anexe a evidência do de-acordo da sua equipe (PDF, PNG ou JPEG).",
      },
      status: 400,
    };
  }

  const mime = tipoEvidencia(fileName, corpo.mimeType ?? null);
  if (!mime) {
    return { corpo: { error: "A evidência precisa ser um arquivo PDF, PNG ou JPEG." }, status: 415 };
  }

  // Tamanho aproximado a partir do comprimento do base64 (sem decodificar duas vezes).
  const corpoBase64 =
    fileBase64.startsWith("data:") && fileBase64.includes(",")
      ? fileBase64.slice(fileBase64.indexOf(",") + 1)
      : fileBase64;
  const bytesAprox = Math.floor((corpoBase64.length * 3) / 4);
  if (bytesAprox > MAX_FILE_BYTES) {
    return {
      corpo: {
        error:
          `Evidência acima do limite de ${MAX_FILE_MB} MB. Se for um PDF grande, mande só a ` +
          `página do de-acordo, ou um print da tela.`,
      },
      status: 413,
    };
  }

  // SÓ FAZ SENTIDO SOBRE UM REPROVADO. Se a ficha não está em "revisao", não há crédito reprovado
  // para destravar: override aqui seria mexer numa ficha aprovada ou já credenciada. 409.
  const cad = await lerCadDaEsteira<{ enterprise_id: null | string; etapa: null | string }>(
    client,
    entityId,
    "enterprise_id, etapa",
    { enterpriseId },
  );
  if (cad?.etapa !== "revisao") {
    return {
      corpo: {
        error:
          "Esta ficha não está em revisão de crédito. O override só se aplica a crédito reprovado.",
      },
      status: 409,
    };
  }

  // Empreendimento efetivo: o informado manda; sem ele, o da CAD que acabamos de ler. É ele que
  // decide o toggle e carimba o registro; não pode ficar vazio.
  const enterpriseIdEfetivo = enterpriseId ?? normalizarEnterpriseId(cad.enterprise_id);

  // (portal) "REVISÃO" NÃO PROVA CRÉDITO REPROVADO (revisão de 16/09/2026). O portal grava
  // "revisao" à mão pela rota de etapa, e sem esta conferência um print qualquer credenciava a CAD
  // sem consulta ao Serasa. A prova é a consulta reprovada do titular (`creditoReprovadoDaCad`). O
  // hub não muda: lá quem aprova é a coordenação, a mesma que pode pôr a CAD em revisão.
  //
  // Import dinâmico: o serviço da consulta carrega o cliente do Serasa e o PDF do comprovante, e só o
  // portal precisa dele aqui.
  if (autor.tipo === "portal") {
    let reprovado: boolean;
    try {
      const { creditoReprovadoDaCad } = await import("./consulta-servico");
      reprovado = await creditoReprovadoDaCad({
        client,
        enterpriseId: enterpriseIdEfetivo,
        entityId,
        // (16/09/2026, revisão do conjunto) Só a consulta que ESTE portal fez prova a reprovação.
        incorporadorId: autor.incorporadorId,
      });
    } catch {
      return {
        corpo: {
          error: "Não foi possível conferir a análise de crédito desta CAD agora. Nada foi alterado. Tente de novo.",
        },
        status: 503,
      };
    }
    if (!reprovado) {
      return {
        corpo: {
          error:
            "Não há consulta ao Serasa reprovada nos últimos 30 dias nesta CAD. A aprovação com restrição só vale sobre um crédito reprovado: faça a consulta na análise de crédito antes.",
        },
        status: 409,
      };
    }
  }

  // Destino pela regra única (PROBLEMA 1): aprovado -> prevenda se ligada, senão credenciado.
  const prevendaHabilitada = await resolverPrevendaHabilitada(client, entityId, enterpriseIdEfetivo);
  const destino = destinoAposCredito({ aprovado: true, prevendaHabilitada });

  // Nome de quem está aprovando (para o rastro). Hub: o cadastro do hub, como sempre. Portal: o nome
  // da conta que viaja na sessão assinada, porque a conta do portal não está em `hub_users`.
  let aprovadoPorNome: null | string;
  if (autor.tipo === "hub") {
    const { data: operador } = await client
      .from("hub_users")
      .select("display_name, email")
      .eq("id", autor.userId)
      .maybeSingle<{ display_name: string | null; email: string | null }>();
    aprovadoPorNome = operador?.display_name ?? operador?.email ?? null;
  } else {
    aprovadoPorNome = autor.nome.trim() || null;
  }

  const textos = textosDoRastro(autor);

  // 1) A EVIDÊNCIA PRIMEIRO. Se o upload falhar, NÃO destrava: override sem evidência é o que a
  //    coordenação está justamente evitando.
  const upload = await uploadApoloDocument({
    adminClient: client,
    documentType: "aprovacao-credito-restricao",
    fileBase64,
    fileName,
    label: textos.label,
    metadataExtra:
      autor.tipo === "hub"
        ? { enterpriseId: enterpriseIdEfetivo, motivo, origem: "override-credito" }
        : {
            // (portal) Quem decidiu fica NA evidência também: é o documento que alguém abre quando
            // pergunta "quem aprovou isto".
            autorOrigem: "portal-incorporador",
            enterpriseId: enterpriseIdEfetivo,
            incorporadorId: autor.incorporadorId,
            motivo,
            origem: "override-credito",
            slug: autor.slug,
            usuarioId: autor.usuarioId,
          },
    mimeType: mime,
    ownerId: entityId,
    scope: "entidade",
    uploadedByName: aprovadoPorNome,
  });
  if (!upload.ok) {
    return {
      corpo: { error: upload.error ?? "Não foi possível salvar a evidência." },
      status: 500,
    };
  }

  // 2) DESTRAVA A ESTEIRA. `saidaDeRevisaoAutorizada` é o que libera o guard do PROBLEMA 2. O motivo
  //    SOBRESCREVE o motivo de reprovação velho (o do Ramon ficou "Crédito reprovado…" mesmo depois
  //    de movido) por "Aprovado com restrição pela coordenação".
  const motivoEsteira = motivo
    ? `Aprovado com restrição ${textos.quem}. ${motivo}`
    : `Aprovado com restrição ${textos.quem}.`;
  const transicao = await atualizarEtapa(client, entityId, destino, {
    atualizadoPor: idDoAutor(autor),
    enterpriseId: enterpriseIdEfetivo,
    motivo: motivoEsteira,
    saidaDeRevisaoAutorizada: true,
  });

  if (transicao.error) {
    // Evidência já subiu; a etapa não gravou (sem CAD, ou falha do banco). Devolve o erro para a
    // tela: a evidência fica na pasta do cliente e a decisão pode ser repetida.
    return {
      corpo: { error: transicao.error },
      status: transicao.semCad || transicao.bloqueado ? 409 : 500,
    };
  }

  // 3) RASTRO da decisão (quem/quando/por quê + evidência). A esteira já destravou, então uma falha
  //    aqui não desfaz nada, mas VOLTA para a tela em vez de virar um log que ninguém lê.
  const rastro = await registrarOverrideCredito({
    adminClient: client,
    aprovadoPor: idDoAutor(autor),
    aprovadoPorNome,
    destino: transicao.etapa,
    enterpriseId: enterpriseIdEfetivo ?? "",
    entityId,
    evidenciaDocId: upload.id ?? null,
    motivo,
    // (16/09/2026) A decisão do portal não se passa pela coordenação da Careli na auditoria. O hub
    // não manda o campo e continua gravando "override-coordenacao", como sempre.
    ...(autor.tipo === "portal" ? { origem: "override-portal" as const } : {}),
  });

  // (portal) A LINHA DO HISTÓRICO. O `credito_override_aprovado` acima já sai com a origem do
  // portal, mas o histórico do Board lê `etapa_change` (autorNome + origem): sem esta linha própria,
  // a decisão do time do incorporador não apareceria na trilha da CAD com quem decidiu.
  // Best-effort: a esteira já destravou e o registro estruturado já saiu.
  let rastroDoPortal: null | string = null;
  if (autor.tipo === "portal") {
    try {
      const { error } = await client.from("apolo_audit_events").insert({
        action: "etapa_change",
        actor_user_id: /^[0-9a-f-]{36}$/i.test(autor.usuarioId) ? autor.usuarioId : null,
        entity_id: entityId,
        field_name: "etapa",
        metadata: {
          autorNome: aprovadoPorNome,
          enterpriseId: enterpriseIdEfetivo,
          evidenciaDocId: upload.id ?? null,
          incorporadorId: autor.incorporadorId,
          motivo: motivoEsteira,
          origem: "portal-incorporador",
          para: transicao.etapa,
          slug: autor.slug,
          via: "aprovar-restricao",
        },
        status: "mapped",
      });
      if (error) rastroDoPortal = `auditoria do portal: ${error.message}`;
    } catch (erro) {
      rastroDoPortal = `auditoria do portal: ${(erro as Error).message}`;
    }
  }

  // CAD VIVA: regenera com a etapa nova, como o move de etapa do Board faz. Best-effort e com teto
  // de tempo: a etapa já gravou; sob C2X lento a CAD não pode segurar a resposta.
  try {
    await comLimiteDeTempo(
      gerarESalvarCad(client, entityId, {
        enterpriseId: enterpriseIdEfetivo,
        uploadedByName: aprovadoPorNome,
      }),
      15000,
    );
  } catch {
    /* segue */
  }

  const rastroIncompleto =
    [rastro.erro, rastroDoPortal].filter((parte): parte is string => Boolean(parte)).join(" · ") ||
    null;

  return {
    corpo: {
      data: {
        etapa: transicao.etapa,
        evidenciaDocId: upload.id ?? null,
        ok: true,
        // Null quando o rastro gravou nos dois lugares. Preenchido = a ficha destravou mas a decisão
        // ficou sem registro estruturado, e a tela avisa para alguém olhar.
        rastroIncompleto,
      },
    },
    status: 200,
  };
}
