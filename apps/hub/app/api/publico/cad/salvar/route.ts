import { createApoloEntity, type CreateApoloEntityInput } from "@/lib/apolo/cadastro-persist";
import { agruparEUploadDocumentos, type DocumentoEntrada } from "@/lib/apolo/cadastro-upload";
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import {
  gravarVinculoEsteira,
  nomeDoEmpreendimento,
  registrarOrigemPublica,
} from "@/lib/publico/cad/dados";
import { protocoloDaAutenticacao } from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { sessaoDoRequest } from "@/lib/publico/cad/sessao";
import { montarCadPdf, type CadDoc } from "@/modules/apolo/blocks/cadastro/cad-pdf";

// S10 público — a CAD é gravada com o MESMO payload que o wizard COMPLETO monta (SalvarPayload) e
// devolve o MESMO shape que ele espera (autenticacao/entityId/cadBase64/savedDocs/warnings). Isso
// deixa o CadastroFlow rodar idêntico ao interno; o que muda é só a origem e — o ponto crítico —
// o VÍNCULO, que aqui nasce EXCLUSIVAMENTE do token assinado, nunca do corpo.
//
// ⚠️ NADA DE VÍNCULO VEM DO CORPO. Imobiliária, corretor e empreendimento saem do token
// (`sessaoDoRequest`). No formulário anônimo, confiar no corpo deixaria o corretor escolher em
// que imobiliária a CAD nasce vinculada. Substitui o antigo /api/publico/cad/enviar (que tinha
// corpo `{ ficha }` e resposta `{ protocolo }`, incompatíveis com o wizard completo).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Tetos do público: generosos o bastante para a CAD completa (RG frente+verso, comprovante,
// certidão, renda) mas ainda bem abaixo do interno, e sempre atrás da sessão + rate-limit.
const MAX_FILES = 24;
const MAX_BASE64 = 20_000_000; // ~15MB por arquivo

// O mesmo payload do wizard interno: entidade + CAD (estrutura, sem código) + documentos planos.
type SalvarPayload = CreateApoloEntityInput & {
  cad?: Omit<CadDoc, "autenticacao"> | null;
  documentos?: DocumentoEntrada[];
};

export async function POST(request: Request) {
  const verificacao = sessaoDoRequest(request);
  if (!verificacao.ok) return erro("Sua sessão expirou. Informe o CPF novamente.", 401);
  const sessao = verificacao.sessao;

  // Sem empreendimento escolhido não existe CAD (mesma regra da CHECK constraint da 0061).
  if (!sessao.enterpriseId) {
    return erro("Escolha o empreendimento antes de enviar a CAD.", 400);
  }

  const preparo = await prepararRota(request, "enviar");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const payload = await lerCorpo<SalvarPayload>(request);
  if (!payload?.identidade && !payload?.empresa) {
    return responder(inicio, erro("Preencha os dados do cliente."));
  }
  // O papel é FORÇADO para prospect adiante; aqui só recusamos um corpo que peça outra coisa,
  // para a mensagem ser clara (o formulário público de CAD só cria prospect).
  if (payload.role && payload.role !== "prospect") {
    return responder(inicio, erro("Este formulário só cria CAD de prospect."));
  }

  const documentos = (payload.documentos ?? []).filter((doc) => doc?.fileBase64);
  if (documentos.length > MAX_FILES) {
    return responder(inicio, erro(`Envie no máximo ${MAX_FILES} arquivos por CAD.`, 413));
  }
  for (const doc of documentos) {
    if ((doc.fileBase64?.length ?? 0) > MAX_BASE64) {
      return responder(inicio, erro("Uma das fotos ficou grande demais. Tire outra com menos zoom.", 413));
    }
  }

  try {
    const empreendimentoNome =
      (await nomeDoEmpreendimento(adminClient, sessao.enterpriseId)) || "Empreendimento";

    // 1) A entidade. `role`/`ownerUserId` forçados; a imobiliária vem do TOKEN, sobrescrevendo o
    //    corpo — é o ponto exato que fecha o furo do formulário anônimo.
    const criado = await createApoloEntity(adminClient, {
      ...payload,
      origem: "publico-cad",
      ownerUserId: null,
      perfil: {
        ...(payload.perfil ?? {}),
        imobiliariaId: sessao.imobiliariaEntityId,
        imobiliariaLabel: sessao.imobiliariaNome,
      },
      role: "prospect",
    });
    if (!criado.ok) return responder(inicio, erro(undefined, 500));

    const nomeCliente =
      payload.persona === "pj"
        ? payload.empresa?.razaoSocial?.trim() || "Empresa"
        : payload.identidade?.nome?.trim() || "Cliente";

    const vinculo = {
      corretorEmail: sessao.corretorEmail,
      corretorEntityId: sessao.corretorEntityId,
      corretorNome: sessao.corretorNome,
      empreendimentoNome,
      enterpriseId: sessao.enterpriseId,
      imobiliariaEntityId: sessao.imobiliariaEntityId,
      imobiliariaNome: sessao.imobiliariaNome,
      prospectEntityId: criado.entityId,
      sessaoId: sessao.sessaoId,
    };

    // 2) O VÍNCULO na esteira. NÃO é best-effort: se falhar, a CAD não é aceita.
    const esteira = await gravarVinculoEsteira(adminClient, vinculo);
    if (!esteira.ok) return responder(inicio, erro(undefined, 500));

    // 3) O empreendimento no grafo (verified). Checa error.
    const { error: relError } = await adminClient.from("apolo_relationships").insert({
      entity_id: criado.entityId,
      label: empreendimentoNome,
      metadata: {
        enterpriseId: sessao.enterpriseId,
        kind: "trabalho",
        role: "empreendimento",
        source: "publico-cad",
      },
      related_entity_id: null,
      relationship_type: "empreendimento",
      status: "verified",
    });
    if (relError) return responder(inicio, erro(undefined, 500));

    // 4) O corretor no grafo do prospect: quem trouxe este cliente (verified). Checa error.
    const { error: corretorError } = await adminClient.from("apolo_relationships").insert({
      entity_id: criado.entityId,
      label: sessao.corretorNome,
      metadata: { kind: "trabalho", role: "corretor", source: "publico-cad" },
      related_entity_id: sessao.corretorEntityId,
      relationship_type: "corretor",
      status: "verified",
    });
    if (corretorError) return responder(inicio, erro(undefined, 500));

    const warnings: string[] = [...criado.warnings];
    const protocolo = protocoloDaAutenticacao(criado.autenticacao) || criado.autenticacao;
    const trilha = await registrarOrigemPublica(adminClient, vinculo, protocolo);
    if (trilha) warnings.push(trilha);

    // 5) Documentos: best-effort, agrupados por documento (RG frente+verso vira 1 PDF).
    const upload = await agruparEUploadDocumentos(adminClient, {
      documentos,
      entityId: criado.entityId,
      nomeCliente,
      uploadedByName: `${sessao.corretorNome} (${sessao.imobiliariaNome})`,
    });
    const savedDocs = [...upload.savedDocs];
    warnings.push(...upload.warnings);

    // 6) A CAD em PDF, montada AQUI com o código de autenticação e a imobiliária/corretor do TOKEN
    //    (nunca do corpo). Best-effort: a entidade e o vínculo já existem.
    let cadBase64: string | null = null;
    const cadStruct = payload.cad?.secoes?.length ? payload.cad : null;
    if (cadStruct) {
      try {
        const bytes = await montarCadPdf({
          ...cadStruct,
          autenticacao: criado.autenticacao,
          corretor: sessao.corretorNome,
          imobiliaria: sessao.imobiliariaNome,
        });
        cadBase64 = Buffer.from(bytes).toString("base64");

        const cadUpload = await uploadApoloDocument({
          adminClient,
          documentType: "cad",
          fileBase64: cadBase64,
          fileName: `${cadStruct.arquivo || `CAD - ${nomeCliente}`}.pdf`,
          label: `CAD - ${nomeCliente}`,
          mimeType: "application/pdf",
          ownerId: criado.entityId,
          scope: "entidade",
          uploadedByName: `${sessao.corretorNome} (${sessao.imobiliariaNome})`,
        });
        if (cadUpload.ok) savedDocs.push("cad");
        else warnings.push(`CAD: ${cadUpload.error}`);
      } catch (error) {
        warnings.push(`CAD: falha ao gerar o PDF (${(error as Error).message})`);
      }
    }

    // `warnings` fica no log do servidor E volta pro modal do wizard (o operador/corretor revisa).
    if (warnings.length) console.warn("[publico-cad-salvar] avisos", warnings);

    return responder(
      inicio,
      json(
        { autenticacao: criado.autenticacao, cadBase64, entityId: criado.entityId, savedDocs, warnings },
        201,
      ),
    );
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}
