import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { montarCadDeEntidade } from "@/lib/apolo/cad-de-entidade";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  MetaWhatsAppSendError,
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";
import { montarCadPdf } from "@/modules/apolo/blocks/cadastro/cad-pdf";

// Rota de TESTE (admin/operator): dispara os DOIS templates da reprovacao de
// credito para um numero informado, pra o dono conferir no WhatsApp dele antes
// de ligar o gatilho real.
//  1) `reprovacao_de_credito` (coordenador): header de DOCUMENTO (CAD em anexo)
//     + corpo com 3 variaveis (cliente, imobiliaria, corretor).
//  2) `credito_indeferido_corretor` (corretor): header de DOCUMENTO (a MESMA CAD)
//     + 1 variavel (cliente). E uma versao so da CAD, que vai pros dois.
//
// Com `entityId` no body, a CAD e a REAL: `montarCadDeEntidade` monta a mesma
// ficha do wizard a partir dos dados salvos, com a secao "Analise de credito"
// (so o status aprovado/reprovado + data). Sem `entityId`, cai numa AMOSTRA.
// O PDF sobe no bucket privado do Apolo com signed URL de 1h; a Meta baixa pela
// URL no disparo — por isso precisa ser HTTPS acessivel (a signed URL serve).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Numero 4143 (atendimento). O config base vem das env; so trocamos o
// phoneNumberId pra disparar pela WABA vinculada a esse numero (a mesma onde os
// templates foram criados).
const PHONE_NUMBER_ID_4143 = "1167201739813897";

const COORDENADOR_NAME = "reprovacao_de_credito";
const CORRETOR_NAME = "reprovacao_de_credito_corretor";
const TEMPLATE_LANGUAGE = "pt_BR";

// Defaults iguais aos exemplos usados na criacao dos templates.
const DEFAULT_CLIENTE = "MARCUS FLAVIO MORAIS ENOQUE";
const DEFAULT_IMOBILIARIA = "Imobiliaria Vale do Ouro";
const DEFAULT_CORRETOR = "Joao Silva";

// Validade da signed URL: 1h. Folga de sobra pra Meta baixar o PDF no disparo.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

type EnvioResultado = {
  error?: string;
  id?: string | null;
  ok: boolean;
};

// Normaliza um telefone BR para o formato E.164 sem "+": so digitos, com DDI 55.
// Ex.: "31983013616" -> "5531983013616"; "(31) 98301-3616" -> "5531983013616".
// Numeros que ja chegam com 55 sao mantidos.
function normalizarTelefoneBr(value: string): string | null {
  const digits = value.replace(/\D/g, "");

  if (digits.length < 10) {
    return null;
  }

  if (digits.startsWith("55") && digits.length >= 12) {
    return digits;
  }

  // 10 (fixo + DDD) ou 11 (celular + DDD) digitos: prefixa o DDI 55.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

// CAD de exemplo (1 pagina A4). NAO e a CAD real: so um documento fake com o
// nome do cliente/imobiliaria/corretor pra validar o anexo no WhatsApp.
async function gerarCadExemplo(input: {
  cliente: string;
  corretor: string;
  imobiliaria: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 retrato.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 48;
  let cursorY = 792;

  const tinta = rgb(0.051, 0.078, 0.11);
  const cinza = rgb(0.36, 0.4, 0.46);

  page.drawText("CAD - Cadastro do cliente (AMOSTRA)", {
    color: tinta,
    font: fontBold,
    size: 20,
    x: marginX,
    y: cursorY,
  });
  cursorY -= 24;

  page.drawText(
    "Documento de teste gerado pelo Apolo para conferencia do disparo.",
    { color: cinza, font, size: 11, x: marginX, y: cursorY },
  );
  cursorY -= 36;

  const linha = (rotulo: string, valor: string) => {
    page.drawText(rotulo, {
      color: cinza,
      font: fontBold,
      size: 11,
      x: marginX,
      y: cursorY,
    });
    page.drawText(valor, {
      color: tinta,
      font,
      size: 13,
      x: marginX,
      y: cursorY - 16,
    });
    cursorY -= 44;
  };

  linha("CLIENTE", input.cliente);
  linha("IMOBILIARIA", input.imobiliaria);
  linha("CORRETOR", input.corretor);
  linha("CPF", "000.000.000-00");
  linha("EMPREENDIMENTO", "Residencial Exemplo - Quadra 1, Lote 2");
  linha("STATUS DA ANALISE", "Credito reprovado (amostra de teste)");
  linha(
    "GERADO EM",
    new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  );

  return doc.save();
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) {
    return auth.response;
  }

  let telefone: string | null = null;
  let entityId: string | null = null;
  let cpf: string | null = null;
  let cliente = DEFAULT_CLIENTE;
  let imobiliaria = DEFAULT_IMOBILIARIA;
  let corretor = DEFAULT_CORRETOR;

  try {
    const input = (await request.json()) as {
      cliente?: unknown;
      corretor?: unknown;
      cpf?: unknown;
      entityId?: unknown;
      imobiliaria?: unknown;
      telefone?: unknown;
    };

    telefone = typeof input.telefone === "string" ? input.telefone.trim() : null;
    entityId =
      typeof input.entityId === "string" && input.entityId.trim()
        ? input.entityId.trim()
        : null;
    // CPF só dígitos: quando vem, acha a ficha e usa a CAD REAL do cliente.
    const cpfDigitos = typeof input.cpf === "string" ? input.cpf.replace(/\D/g, "") : "";
    cpf = cpfDigitos.length >= 11 ? cpfDigitos.slice(0, 11) : null;

    if (typeof input.cliente === "string" && input.cliente.trim()) {
      cliente = input.cliente.trim();
    }
    if (typeof input.imobiliaria === "string" && input.imobiliaria.trim()) {
      imobiliaria = input.imobiliaria.trim();
    }
    if (typeof input.corretor === "string" && input.corretor.trim()) {
      corretor = input.corretor.trim();
    }
  } catch {
    telefone = null;
  }

  if (!telefone) {
    return NextResponse.json(
      { error: "Informe o telefone de destino." },
      { status: 400 },
    );
  }

  const to = normalizarTelefoneBr(telefone);
  if (!to) {
    return NextResponse.json(
      { error: "Telefone invalido. Use DDD + numero (ex.: 31983013616)." },
      { status: 400 },
    );
  }

  const config = {
    ...getMetaWhatsAppOutboundConfig(),
    phoneNumberId: PHONE_NUMBER_ID_4143,
  };

  // --- Passo 1 + 2: gera a CAD de exemplo, sobe no storage e assina a URL -----
  const bucket = process.env.APOLO_DOCS_BUCKET ?? APOLO_DOCS_BUCKET;
  let signedUrl: string | null = null;
  let uploadError: string | null = null;

  const adminClient = createApoloAdminClient();

  if (!adminClient) {
    uploadError = "Configuracao server-side do Supabase ausente.";
  } else {
    try {
      // Sem entityId mas com CPF: acha a ficha pelo documento (com ou sem mascara) pra usar a
      // CAD REAL do cliente.
      if (!entityId && cpf) {
        const cpfMascarado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
        const { data: achada } = await adminClient
          .from("apolo_entities")
          .select("id")
          .or(`document_masked.eq.${cpf},document_masked.eq.${cpfMascarado}`)
          .limit(1)
          .maybeSingle<{ id: string }>();
        entityId = achada?.id ?? null;
      }

      // Com entityId, a CAD e a REAL (mesma do wizard, com a secao "Analise de credito").
      // Se a entidade nao existir, `montarCadDeEntidade` devolve null e caimos na amostra.
      // Quando temos a CAD real, o nome do cliente e a imobiliaria/corretor do template passam
      // a vir dela (defaults de texto valem so pro caso sem entityId).
      const cadReal = entityId ? await montarCadDeEntidade(adminClient, entityId) : null;
      if (cadReal) {
        cliente = cadReal.nome.trim() || cliente;
        imobiliaria = cadReal.imobiliaria?.trim() || imobiliaria;
        corretor = cadReal.corretor?.trim() || corretor;
      }

      const pdfBytes = cadReal
        ? await montarCadPdf(cadReal)
        : await gerarCadExemplo({ cliente, corretor, imobiliaria });
      const storagePath = `teste-disparo/${Date.now()}.pdf`;

      const upload = await adminClient.storage
        .from(bucket)
        .upload(storagePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (upload.error) {
        uploadError = `Falha ao subir a CAD de teste: ${upload.error.message}`;
      } else {
        const signed = await adminClient.storage
          .from(bucket)
          .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

        if (signed.error || !signed.data?.signedUrl) {
          uploadError = "Nao foi possivel gerar o link assinado da CAD de teste.";
        } else {
          signedUrl = signed.data.signedUrl;
        }
      }
    } catch (error) {
      uploadError =
        error instanceof Error
          ? error.message
          : "Falha ao preparar a CAD de teste.";
    }
  }

  // --- Passo 3: coordenador (header de documento + 3 variaveis) --------------
  let coordenador: EnvioResultado;

  if (!signedUrl) {
    coordenador = {
      error:
        uploadError ??
        "CAD de teste indisponivel: nao ha link para anexar no template do coordenador.",
      ok: false,
    };
  } else {
    try {
      const result = await sendMetaWhatsAppTemplateMessage({
        bodyParameters: [cliente, imobiliaria, corretor],
        config,
        headerMedia: {
          fileName: `CAD-${cliente}.pdf`,
          link: signedUrl,
          type: "document",
        },
        language: TEMPLATE_LANGUAGE,
        name: COORDENADOR_NAME,
        to,
      });
      coordenador = { id: result.messageId, ok: true };
    } catch (error) {
      coordenador = {
        error:
          error instanceof MetaWhatsAppSendError
            ? error.message
            : "Falha no envio do template do coordenador.",
        ok: false,
      };
    }
  }

  // --- Passo 4: corretor (header de documento + 1 variavel) ------------------
  // A MESMA CAD (versao com status, sem valores) tambem vai pro corretor. Quando a signed URL
  // esta disponivel, anexa o documento; se o template do corretor ainda nao tiver header de
  // documento aprovado, a Meta rejeita o envio — o erro e capturado e reportado como os demais.
  let corretorResultado: EnvioResultado;

  try {
    const result = await sendMetaWhatsAppTemplateMessage({
      bodyParameters: [cliente],
      config,
      ...(signedUrl
        ? {
            headerMedia: {
              fileName: `CAD-${cliente}.pdf`,
              link: signedUrl,
              type: "document" as const,
            },
          }
        : {}),
      language: TEMPLATE_LANGUAGE,
      name: CORRETOR_NAME,
      to,
    });
    corretorResultado = { id: result.messageId, ok: true };
  } catch (error) {
    corretorResultado = {
      error:
        error instanceof MetaWhatsAppSendError
          ? error.message
          : "Falha no envio do template do corretor.",
      ok: false,
    };
  }

  return NextResponse.json(
    {
      data: {
        coordenador,
        corretor: corretorResultado,
        signedUrl,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
