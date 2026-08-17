import { createApoloEntity, type CreateApoloEntityInput } from "@/lib/apolo/cadastro-persist";
import {
  agruparEUploadDocumentos,
  documentoTemArquivo,
  type DocumentoEntrada,
} from "@/lib/apolo/cadastro-upload";
import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import {
  APOLO_DOC_MAX_BYTES,
  MENSAGEM_DOCUMENTO_GRANDE,
  caminhoUploadDiretoValido,
  uploadApoloDocument,
} from "@/lib/apolo/documentos";
import { normalizarCnpj } from "@/lib/publico/cad/regras";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import { erro, json, lerCorpo, prepararRota, recusar, responder } from "@/lib/publico/cad/rotas";
import { donoUploadPreImob, preSessaoImobDoRequest } from "@/lib/publico/cad/sessao";
import { montarCadPdf, type CadDoc } from "@/modules/apolo/blocks/cadastro/cad-pdf";

// Auto-cadastro PÚBLICO da imobiliária, agora pelo CadastroFlow COMPLETO (tipo="imobiliaria").
// Espelho gated de /api/apolo/cadastro/salvar para role="imobiliaria": aceita o MESMO
// SalvarPayload do wizard e devolve o MESMO shape (para o modal de sucesso funcionar).
//
// ⚠️ SEMÂNTICA DO CREDENCIAMENTO PRESERVADA (igual a /api/publico/imobiliaria/credenciar): a
// entidade NÃO se auto-credencia. `createApoloEntity` grava papel 'active' e habilitações
// 'verified'; aqui rebaixamos papel -> 'review' e empreendimentos/corretores -> 'pending'. Só a
// central promove para active/verified. Sem isso, um formulário aberto ao mundo se auto-aprovaria.
//
// ⚠️ ANTI-TROCA: o CNPJ autorizado sai do TOKEN (antessala). Se o cartão CNPJ do corpo divergir,
// recusa — senão o token de um CNPJ pagaria o OCR/enrich de outro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILES = 40;
const MAX_BASE64 = 20_000_000; // ~15MB por arquivo

type SalvarPayload = CreateApoloEntityInput & {
  cad?: Omit<CadDoc, "autenticacao"> | null;
  documentos?: DocumentoEntrada[];
};

export async function POST(request: Request) {
  const pre = preSessaoImobDoRequest(request);
  if (!pre.ok) {
    return recusar(request, erro("Confirme o CNPJ da imobiliária antes de continuar.", 401));
  }

  anotarContexto(request, { imobiliariaCnpj: pre.pre.cnpj });

  const preparo = await prepararRota(request, "imobiliaria");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const payload = await lerCorpo<SalvarPayload>(request);
  if (!payload?.empresa) {
    return responder(request, inicio, erro("Preencha os dados da imobiliária."));
  }
  if (payload.persona && payload.persona !== "pj") {
    return responder(request, inicio, erro("A imobiliária é sempre pessoa jurídica."));
  }
  if (payload.role && payload.role !== "imobiliaria") {
    return responder(request, inicio, erro("Este formulário só cria imobiliária."));
  }

  // Anti-troca: o cartão CNPJ tem que ser o mesmo que passou pela antessala.
  const cnpjCorpo = normalizarCnpj(payload.empresa?.cnpj);
  if (cnpjCorpo !== pre.pre.cnpj) {
    return responder(request, inicio, erro("O CNPJ do cartão não confere com o informado no início."));
  }

  // Duas formas de anexo (ver /api/publico/cad/salvar): base64 no corpo para documento pequeno,
  // caminho de arquivo já gravado no bucket para documento grande.
  const documentos = (payload.documentos ?? []).filter(documentoTemArquivo);
  if (documentos.length > MAX_FILES) {
    return responder(request, inicio, erro(`Envie no máximo ${MAX_FILES} arquivos por cadastro.`, 413));
  }
  for (const doc of documentos) {
    const caminho = (doc.storagePath ?? "").trim();
    if (caminho) {
      // O caminho tem que ser um que ESTA pré-sessão recebeu para gravar (rota /upload-url).
      if (!caminhoUploadDiretoValido(caminho, donoUploadPreImob(pre.pre))) {
        return responder(request, inicio, erro("Arquivo enviado não confere com esta sessão.", 400));
      }
      if ((doc.sizeBytes ?? 0) > APOLO_DOC_MAX_BYTES) {
        return responder(request, inicio, erro(MENSAGEM_DOCUMENTO_GRANDE, 413));
      }
      continue;
    }
    if ((doc.fileBase64?.length ?? 0) > MAX_BASE64) {
      return responder(request, inicio, erro("Um dos arquivos ficou grande demais. Envie um menor.", 413));
    }
  }

  try {
    // Só empreendimentos ATIVOS entram; o resto o servidor descarta em silêncio (mesma regra do
    // credenciar). O `label` sai da lista de ativos, não do que o cliente mandou.
    const ativos = await listEmpreendimentosAtivos(adminClient);
    const permitidos = new Map(ativos.map((emp) => [String(emp.id), emp.name]));
    const empreendimentos = (payload.empreendimentos ?? [])
      .map((e) => String(e?.id ?? ""))
      .filter((id) => permitidos.has(id))
      .slice(0, 30)
      .map((id) => ({ id, label: permitidos.get(id) ?? "Empreendimento" }));

    // 1) A entidade. `role`/`persona`/`ownerUserId` forçados; origem carimbada.
    const criado = await createApoloEntity(adminClient, {
      ...payload,
      empreendimentos,
      origem: "publico-imobiliaria",
      ownerUserId: null,
      persona: "pj",
      role: "imobiliaria",
    });
    if (!criado.ok) return responder(request, inicio, erro(undefined, 500));

    const nomeCliente = payload.empresa?.razaoSocial?.trim() || "Imobiliária";

    // 2) REBAIXA o papel para 'review' (createApoloEntity grava 'active', que é lido como
    //    "credenciada"). Esta é a trava do auto-cadastro. NÃO é best-effort.
    const { error: papelError } = await adminClient
      .from("apolo_entity_profiles")
      .update({ status: "review" })
      .eq("entity_id", criado.entityId)
      .eq("profile", "imobiliaria");
    if (papelError) return responder(request, inicio, erro(undefined, 500));

    // 3) Habilitações de empreendimento -> 'pending' ('verified' significaria auto-habilitação).
    const { error: empError } = await adminClient
      .from("apolo_relationships")
      .update({ status: "pending" })
      .eq("entity_id", criado.entityId)
      .eq("relationship_type", "empreendimento");
    if (empError) return responder(request, inicio, erro(undefined, 500));

    // 4) Corretores (relacionamento de contato) -> 'pending' pela mesma razão: nada num
    //    formulário aberto nasce aprovado.
    const { error: corretorError } = await adminClient
      .from("apolo_relationships")
      .update({ status: "pending" })
      .eq("entity_id", criado.entityId)
      .eq("relationship_type", "corretor");
    if (corretorError) return responder(request, inicio, erro(undefined, 500));

    const warnings: string[] = [...criado.warnings];

    // 5) Documentos (cartão CNPJ, contrato social, sócios): best-effort, agrupados por documento.
    const upload = await agruparEUploadDocumentos(adminClient, {
      documentos,
      entityId: criado.entityId,
      nomeCliente,
      uploadedByName: `${nomeCliente} (auto-cadastro)`,
    });
    const savedDocs = [...upload.savedDocs];
    warnings.push(...upload.warnings);

    // 6) A CAD/ficha em PDF com o código de autenticação. Best-effort.
    let cadBase64: string | null = null;
    const cadStruct = payload.cad?.secoes?.length ? payload.cad : null;
    if (cadStruct) {
      try {
        const bytes = await montarCadPdf({ ...cadStruct, autenticacao: criado.autenticacao });
        cadBase64 = Buffer.from(bytes).toString("base64");
        const cadUpload = await uploadApoloDocument({
          adminClient,
          documentType: "cad",
          fileBase64: cadBase64,
          fileName: `${cadStruct.arquivo || `Imobiliaria - ${nomeCliente}`}.pdf`,
          label: `Imobiliaria - ${nomeCliente}`,
          mimeType: "application/pdf",
          ownerId: criado.entityId,
          scope: "entidade",
          uploadedByName: `${nomeCliente} (auto-cadastro)`,
        });
        if (cadUpload.ok) savedDocs.push("cad");
        else warnings.push(`CAD: ${cadUpload.error}`);
      } catch (error) {
        warnings.push(`CAD: falha ao gerar o PDF (${(error as Error).message})`);
      }
    }

    if (warnings.length) console.warn("[publico-imobiliaria-cadastro] avisos", warnings);

    return responder(
      request,
      inicio,
      json(
        { autenticacao: criado.autenticacao, cadBase64, entityId: criado.entityId, savedDocs, warnings },
        201,
      ),
    );
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
