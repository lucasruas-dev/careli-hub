import {
  celularValido,
  guardarDocumentosDoPedido,
  propostaDoLink,
  registrarPedidoDoLink,
  situacaoDoCpf,
} from "@/lib/apolo/autonomo-do-link";
import {
  validarCamposMinimos,
  validarDocumentosObrigatorios,
} from "@/lib/apolo/cadastro-obrigatorios";
import { documentoTemArquivo, type DocumentoEntrada } from "@/lib/apolo/cadastro-upload";
import { listEmpreendimentosParaImobiliaria } from "@/lib/apolo/credenciamento";
import {
  APOLO_DOC_MAX_BYTES,
  MENSAGEM_DOCUMENTO_GRANDE,
  caminhoUploadDiretoValido,
} from "@/lib/apolo/documentos";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import { normalizarCpf } from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, recusar, responder } from "@/lib/publico/cad/rotas";
import { donoUploadPreAutonomo, preSessaoAutonomoDoRequest } from "@/lib/publico/cad/sessao";

// O ENVIO DO CADASTRO DO CORRETOR AUTÔNOMO PELO LINK PÚBLICO.
//
// ⚠️ ESTA ROTA NÃO GRAVA FICHA. Grava só o PEDIDO (`registrarPedidoDoLink`, lib/apolo/autonomo-do-link.ts):
// a proposta, os documentos no staging privado e o interesse. A ficha nasce, ou é acrescentada, só na
// APROVAÇÃO, pela mesma porta do cadastro interno. Segunda rodada de revisão (01/10/2026): gravar no
// envio punha o que um estranho digitou como dado real na ficha de quem já existia.
//
// ⚠️ ANTI-TROCA: o CPF autorizado sai do TOKEN do portão. Se o CPF do documento divergir, recusa.
//
// ⚠️ A RESPOSTA NÃO REVELA NADA DA BASE. Como nada é gravado em ficha aqui, não existe a recusa de
// "e-mail em outro cadastro". E um CPF que virou autônomo ou entrou em análise depois do portão
// recebe a MESMA resposta de sucesso, sem que um segundo pedido seja empilhado: o portão já disse o
// que tinha a dizer, e o envio não vira um segundo oráculo.
//
// ⚠️ DOCUMENTOS DO LINK: identidade e comprovante de endereço, sem certidão (Lucas, 01/10/2026).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILES = 20;
const MAX_BASE64 = 20_000_000; // ~15MB por arquivo

type Corpo = {
  documentos?: DocumentoEntrada[];
  /** Os empreendimentos de INTERESSE, só ids. O rótulo sai da lista do servidor. */
  empreendimentosDeInteresse?: unknown;
  endereco?: unknown;
  identidade?: { cpf?: string; naturalidade?: string; nome?: string } & Record<string, unknown>;
  perfil?: { estadoCivilId?: string; telefone?: string } & Record<string, unknown>;
  persona?: unknown;
  role?: unknown;
};

const MENSAGEM_SESSAO =
  "Sua sessão expirou. Abra o link de novo e informe o seu CPF para continuar.";

const MENSAGEM_TETO =
  "Recebemos muitos cadastros agora. Tente de novo em alguns minutos ou fale com a nossa central.";

/** O mesmo corpo de sucesso para todo envio aceito: sem código, sem id, sem PDF. */
const RECEBIDO = { autenticacao: "", cadBase64: null, recebido: true, savedDocs: [], warnings: [] };

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

  const dono = donoUploadPreAutonomo(pre.pre);
  const documentos = (corpo.documentos ?? []).filter(documentoTemArquivo);
  if (documentos.length > MAX_FILES) {
    return responder(request, inicio, erro(`Envie no máximo ${MAX_FILES} arquivos.`, 413));
  }
  for (const doc of documentos) {
    const caminho = (doc.storagePath ?? "").trim();
    if (caminho) {
      // O caminho tem que ser um que ESTA pré-sessão recebeu para gravar (rota /upload-url).
      if (!caminhoUploadDiretoValido(caminho, dono)) {
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

  const campos = validarCamposMinimos({
    identidade: {
      cpf: corpo.identidade.cpf,
      naturalidade: corpo.identidade.naturalidade,
      nome: corpo.identidade.nome,
    },
    persona: "pf",
  });
  if (!campos.ok) return responder(request, inicio, erro(campos.mensagem));
  // O CELULAR É OBRIGATÓRIO NO LINK: é por ele que a Careli responde ao pedido.
  if (!celularValido(corpo.perfil?.telefone)) {
    return responder(request, inicio, erro("Informe o seu celular com DDD para enviar o cadastro."));
  }
  const obrigatorios = validarDocumentosObrigatorios({
    documentos,
    perfil: corpo.perfil,
    persona: "pf",
    semEstadoCivil: true,
  });
  if (!obrigatorios.ok) return responder(request, inicio, erro(obrigatorios.mensagem));

  try {
    // O PORTÃO DE NOVO, no envio: o token vale 90 minutos. Quem não está mais liberado recebe a
    // mesma resposta de sucesso, e nada é gravado (ver o cabeçalho).
    const situacao = await situacaoDoCpf(adminClient, pre.pre.cpf);
    if (!situacao.ok) return responder(request, inicio, erro(undefined, 503));
    if (situacao.situacao !== "liberado") return responder(request, inicio, json(RECEBIDO, 201));

    // O INTERESSE é lido contra a vitrine do servidor; o rótulo sai da lista, nunca do corpo.
    const vitrine = await listEmpreendimentosParaImobiliaria(adminClient).catch(() => []);
    const rotulos = new Map(vitrine.map((emp) => [String(emp.id), emp.name]));
    const pedidos = Array.isArray(corpo.empreendimentosDeInteresse)
      ? corpo.empreendimentosDeInteresse.map((id) => String(id ?? ""))
      : [];
    const interesse = [...new Set(pedidos)]
      .filter((id) => rotulos.has(id))
      .slice(0, 30)
      .map((id) => ({ id, label: rotulos.get(id) ?? "Empreendimento" }));

    const guardados = await guardarDocumentosDoPedido(adminClient, { documentos, dono });
    if (!guardados.ok) return responder(request, inicio, erro(undefined, 500));

    const registrado = await registrarPedidoDoLink(adminClient, {
      documentos: guardados.documentos,
      empreendimentosDeInteresse: interesse,
      proposta: propostaDoLink(corpo),
    });
    if (!registrado.ok) {
      return responder(
        request,
        inicio,
        registrado.motivo === "teto" ? erro(MENSAGEM_TETO, 429) : erro(undefined, 500),
      );
    }

    return responder(request, inicio, json(RECEBIDO, 201));
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
