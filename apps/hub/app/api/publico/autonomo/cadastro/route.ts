import {
  registrarCadastroDoLink,
  situacaoDoCpf,
  MENSAGEM_DO_PORTAO,
  type CadastroDoLink,
} from "@/lib/apolo/autonomo-do-link";
import {
  validarCamposMinimos,
  validarDocumentosObrigatorios,
} from "@/lib/apolo/cadastro-obrigatorios";
import { documentoTemArquivo } from "@/lib/apolo/cadastro-upload";
import { listEmpreendimentosParaImobiliaria } from "@/lib/apolo/credenciamento";
import {
  APOLO_DOC_MAX_BYTES,
  MENSAGEM_DOCUMENTO_GRANDE,
  caminhoUploadDiretoValido,
  uploadApoloDocument,
} from "@/lib/apolo/documentos";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import { normalizarCpf, recusaPublicaDoCorretor } from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, recusar, responder } from "@/lib/publico/cad/rotas";
import { donoUploadPreAutonomo, preSessaoAutonomoDoRequest } from "@/lib/publico/cad/sessao";
import { montarCadPdf, type CadDoc } from "@/modules/apolo/blocks/cadastro/cad-pdf";

// O CADASTRO DO CORRETOR AUTÔNOMO PELO LINK PÚBLICO. Espelho gated de /api/apolo/cadastro/salvar para
// `role: "corretor"`, como /api/publico/imobiliaria/cadastro é para a imobiliária.
//
// ⚠️ A FICHA CAI NA MESMA ENTIDADE E NADA NASCE VALENDO. Quem grava é `registrarCadastroDoLink`
// (lib/apolo/autonomo-do-link.ts): papel `corretor` em análise, SEM o código CA, e o pedido na trilha
// que alimenta a fila do time. Sem código ele não abre CAD, não entra em reserva, não vai ao C2X nem ao
// Asaas: tudo isso lê o autônomo por `lerAutonomo`, que exige o código. O código nasce na aprovação.
//
// ⚠️ ANTI-TROCA: o CPF autorizado sai do TOKEN do portão. Se o CPF do documento divergir, recusa —
// senão o token de um CPF pagaria o OCR do cadastro de outra pessoa e gravaria a ficha errada.
//
// ⚠️ OS DOCUMENTOS DO LINK SÃO IDENTIDADE E COMPROVANTE DE ENDEREÇO (Lucas, 01/10/2026: *"os mesmos
// sem a necessidade de certidão estado civil"*). A trava é aqui, no servidor; a tela só ajuda.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILES = 20;
const MAX_BASE64 = 20_000_000; // ~15MB por arquivo

type Corpo = CadastroDoLink & {
  cad?: Omit<CadDoc, "autenticacao"> | null;
  /** Os empreendimentos de INTERESSE, só ids. O rótulo sai da lista do servidor. */
  empreendimentosDeInteresse?: unknown;
  persona?: unknown;
  role?: unknown;
};

const MENSAGEM_SESSAO =
  "Sua sessão expirou. Abra o link de novo e informe o seu CPF para continuar.";

export async function POST(request: Request) {
  const pre = preSessaoAutonomoDoRequest(request);
  if (!pre.ok) return recusar(request, erro(MENSAGEM_SESSAO, 401));

  anotarContexto(request, { corretorCpf: pre.pre.cpf });

  const preparo = await prepararRota(request, "enviar");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<Corpo>(request);
  if (!corpo?.identidade) {
    return responder(request, inicio, erro("Preencha os seus dados antes de enviar."));
  }
  if (corpo.persona !== undefined && corpo.persona !== "pf") {
    return responder(request, inicio, erro("O cadastro de corretor autônomo é só de pessoa física."));
  }
  if (corpo.role !== undefined && corpo.role !== "corretor") {
    return responder(request, inicio, erro("Este formulário só faz cadastro de corretor autônomo."));
  }

  // Anti-troca.
  if (normalizarCpf(corpo.identidade.cpf) !== pre.pre.cpf) {
    return responder(
      request,
      inicio,
      erro("O CPF do documento não confere com o CPF informado no início."),
    );
  }

  const documentos = (corpo.documentos ?? []).filter(documentoTemArquivo);
  if (documentos.length > MAX_FILES) {
    return responder(request, inicio, erro(`Envie no máximo ${MAX_FILES} arquivos.`, 413));
  }
  for (const doc of documentos) {
    const caminho = (doc.storagePath ?? "").trim();
    if (caminho) {
      // O caminho tem que ser um que ESTA pré-sessão recebeu para gravar (rota /upload-url).
      if (!caminhoUploadDiretoValido(caminho, donoUploadPreAutonomo(pre.pre))) {
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

  const campos = validarCamposMinimos({ identidade: corpo.identidade, persona: "pf" });
  if (!campos.ok) return responder(request, inicio, erro(campos.mensagem));
  const obrigatorios = validarDocumentosObrigatorios({
    documentos,
    perfil: corpo.perfil,
    persona: "pf",
    semEstadoCivil: true,
  });
  if (!obrigatorios.ok) return responder(request, inicio, erro(obrigatorios.mensagem));

  try {
    // O PORTÃO DE NOVO, no envio. O token vale 90 minutos: nesse meio-tempo o mesmo CPF pode ter sido
    // aprovado pelo time, ou ter mandado outro cadastro numa segunda aba.
    const situacao = await situacaoDoCpf(adminClient, pre.pre.cpf);
    if (!situacao.ok) return responder(request, inicio, erro(undefined, 503));
    if (situacao.situacao !== "liberado") {
      return responder(request, inicio, erro(MENSAGEM_DO_PORTAO[situacao.situacao], 409));
    }

    // O INTERESSE É LIDO CONTRA A VITRINE DO SERVIDOR (o mesmo portão da imobiliária: master +
    // `recepcao_imobiliaria`). Id que não está lá é descartado em silêncio, e o rótulo sai da lista,
    // nunca do corpo. É só um pedido: não vira vínculo, não habilita nada.
    const vitrine = await listEmpreendimentosParaImobiliaria(adminClient).catch(() => []);
    const rotulos = new Map(vitrine.map((emp) => [String(emp.id), emp.name]));
    const pedidos = Array.isArray(corpo.empreendimentosDeInteresse)
      ? corpo.empreendimentosDeInteresse.map((id) => String(id ?? ""))
      : [];
    const interesse = [...new Set(pedidos)]
      .filter((id) => rotulos.has(id))
      .slice(0, 30)
      .map((id) => ({ id, label: rotulos.get(id) ?? "Empreendimento" }));

    const gravado = await registrarCadastroDoLink(adminClient, {
      corpo: {
        conjuge: corpo.conjuge,
        documentos,
        endereco: corpo.endereco,
        identidade: corpo.identidade,
        perfil: corpo.perfil,
      },
      empreendimentosDeInteresse: interesse,
    });

    if (!gravado.ok) {
      // Só o que a pessoa consegue CONSERTAR ganha texto próprio (o e-mail em uso por outra pessoa),
      // e sem dizer de quem é. O resto é o genérico, de propósito (ver lib/publico/cad/rotas.ts).
      const traducao = recusaPublicaDoCorretor(gravado.recusa?.motivo);
      return responder(
        request,
        inicio,
        erro(traducao.mensagem, traducao.status),
        { motivo: gravado.recusa?.motivo ?? "falha-ao-gravar" },
      );
    }

    // A FICHA EM PDF com o código de autenticação, como a do cadastro interno. Best-effort.
    const warnings = [...gravado.warnings];
    const savedDocs = [...gravado.savedDocs];
    let cadBase64: null | string = null;
    const nome = String(corpo.identidade.nome ?? "").trim() || "Corretor";
    const cadStruct = corpo.cad?.secoes?.length ? corpo.cad : null;
    if (cadStruct) {
      try {
        const bytes = await montarCadPdf({
          ...cadStruct,
          autenticacao: gravado.autenticacao,
          // A ficha do corretor não tem "o" empreendimento, e o corpo não pode forjar a linha.
          empreendimento: undefined,
        });
        cadBase64 = Buffer.from(bytes).toString("base64");
        const cadUpload = await uploadApoloDocument({
          adminClient,
          documentType: "cad",
          fileBase64: cadBase64,
          fileName: `Corretor - ${nome}.pdf`,
          label: `Corretor - ${nome}`,
          mimeType: "application/pdf",
          ownerId: gravado.entityId,
          scope: "entidade",
          uploadedByName: `${nome} (auto-cadastro)`,
        });
        if (cadUpload.ok) savedDocs.push("cad");
        else warnings.push(`CAD: ${cadUpload.error}`);
      } catch (falha) {
        warnings.push(`CAD: falha ao gerar o PDF (${(falha as Error).message})`);
      }
    }

    if (warnings.length) console.warn("[publico-autonomo-cadastro] avisos", warnings);

    // ⚠️ SEM `entityId`: o id da ficha não sai para a rota pública. O wizard aceita o código de
    // autenticação como comprovante (`salvarPublico` em cadastro-flow.tsx). Os avisos internos
    // (`warnings`) também não saem: falam de Storage e de papel, que não são assunto de quem preencheu.
    return responder(
      request,
      inicio,
      json({ autenticacao: gravado.autenticacao, cadBase64, savedDocs, warnings: [] }, 201),
    );
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
