import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  createApoloEntity,
  type ApoloBirthRole,
  type CreateApoloEntityInput,
} from "@/lib/apolo/cadastro-persist";
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { montarCadPdf, type CadDoc } from "@/modules/apolo/blocks/cadastro/cad-pdf";
import { PDFDocument } from "pdf-lib";

// Fecha o ciclo do cadastro: cria a ENTIDADE (papel de nascimento) e salva no drive os
// documentos anexados + o CAD em PDF. Uma chamada so, server-side (o wizard nao fala com o
// Supabase direto). Ver [[project_apolo_cadastro_prospect]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// So o processo do PROSPECT esta ligado; os demais papeis entram quando cada processo existir.
const ENABLED_ROLES: ApoloBirthRole[] = ["prospect", "imobiliaria"];

// Um documento pode ter varios arquivos (RG frente+verso, contrato social com N paginas) e o PJ
// ainda soma 2 documentos por socio -- uma empresa com 4 socios ja passa de 20.
const MAX_FILES = 40;
const MAX_BASE64_LENGTH = 28_000_000; // ~20MB por arquivo

// Categoria (document_type) -> rotulo legivel usado na nomeacao "Nome + categoria".
const CATEGORIA_LABEL: Record<string, string> = {
  cad: "CAD",
  certidao: "Certidão",
  comprovante_endereco: "Comprovante de endereço",
  contrato_social: "Contrato social",
  identificacao: "Identificação",
  identificacao_conjuge: "Identificação (cônjuge)",
  outros: "Outros",
  renda: "Renda",
};

// Documentos de socio carregam o indice na categoria ("identificacao_socio_2"): cada socio vira
// UM arquivo no drive. Sem o indice, o agrupamento por categoria fundiria os documentos de
// todos os socios num PDF so.
const SOCIO_CATEGORIA_RE = /^(identificacao|comprovante)_socio_(\d+)$/;

function rotuloCategoria(categoria: string): string {
  const socio = SOCIO_CATEGORIA_RE.exec(categoria);
  if (socio) {
    const tipo = socio[1] === "identificacao" ? "Identificação" : "Comprovante de endereço";
    return `${tipo} (sócio ${socio[2]})`;
  }
  return CATEGORIA_LABEL[categoria] ?? "Documento";
}

type IncomingDoc = {
  categoria?: string;
  extractedPayload?: unknown;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
};

// A CAD chega como ESTRUTURA (seções), não como PDF pronto: o PDF é montado aqui, no servidor,
// já com o código de autenticação impresso. Se o browser mandasse o PDF, o código não valeria
// nada (o forjador geraria o dele).
type SalvarPayload = CreateApoloEntityInput & {
  cad?: Omit<CadDoc, "autenticacao"> | null;
  documentos?: IncomingDoc[];
};

export async function POST(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let payload: SalvarPayload;
  try {
    payload = (await request.json()) as SalvarPayload;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  const role = payload.role;
  if (!role || !ENABLED_ROLES.includes(role)) {
    return NextResponse.json(
      { error: "Processo de cadastro ainda nao disponivel para este papel." },
      { status: 400 },
    );
  }
  if (payload.persona !== "pf" && payload.persona !== "pj") {
    return NextResponse.json({ error: "Informe se e PF ou PJ." }, { status: 400 });
  }

  const documentos = (payload.documentos ?? []).filter((doc) => doc?.fileBase64);
  const cad = payload.cad?.secoes?.length ? payload.cad : null;
  const totalFiles = documentos.length + (cad ? 1 : 0);
  if (totalFiles > MAX_FILES) {
    return NextResponse.json(
      { error: `Maximo de ${MAX_FILES} arquivos por cadastro.` },
      { status: 413 },
    );
  }
  for (const doc of documentos) {
    if ((doc.fileBase64?.length ?? 0) > MAX_BASE64_LENGTH) {
      return NextResponse.json({ error: "Arquivo acima do limite de 20MB." }, { status: 413 });
    }
  }

  // Autor do cadastro (nome do operador).
  const { data: operator } = await adminClient
    .from("hub_users")
    .select("display_name, email")
    .eq("id", authorization.userId)
    .maybeSingle<{ display_name: string | null; email: string | null }>();
  const uploadedByName = operator?.display_name ?? operator?.email ?? null;

  // 1) Cria a entidade coordenadamente.
  const result = await createApoloEntity(adminClient, {
    ...payload,
    origem: payload.origem || "cadastro-formulario",
    ownerUserId: authorization.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const entityId = result.entityId;
  const nomeCliente =
    payload.persona === "pj"
      ? payload.empresa?.razaoSocial?.trim() || "Empresa"
      : payload.identidade?.nome?.trim() || "Cliente";

  // 2) Sobe os documentos anexados + o CAD pro drive da entidade. Best-effort: falha de upload
  // vira warning (a entidade ja existe), nao derruba o cadastro.
  const uploadWarnings: string[] = [];
  const savedDocs: string[] = [];

  // Agrupa por documento: as varias faces/paginas de um mesmo documento viram UM arquivo no
  // drive (frente+verso do RG, contrato social inteiro), em vez de varios soltos.
  const porCategoria = new Map<string, IncomingDoc[]>();
  for (const doc of documentos) {
    const categoria = normalizeCategoria(doc.categoria);
    porCategoria.set(categoria, [...(porCategoria.get(categoria) ?? []), doc]);
  }

  for (const [categoria, arquivos] of porCategoria) {
    const rotulo = `${nomeCliente} - ${rotuloCategoria(categoria)}`;
    const varias = arquivos.length > 1;

    let fileBase64: string;
    let fileName: string;
    let mimeType: string | null;

    try {
      fileBase64 = varias
        ? await juntarEmPdf(arquivos)
        : (arquivos[0]?.fileBase64 as string);
      fileName = varias
        ? `${rotulo}.pdf`
        : arquivos[0]?.fileName || `${categoria}.pdf`;
      mimeType = varias ? "application/pdf" : arquivos[0]?.mimeType || null;
    } catch (error) {
      uploadWarnings.push(
        `documento ${categoria}: falha ao juntar as páginas (${(error as Error).message})`,
      );
      continue;
    }

    const upload = await uploadApoloDocument({
      adminClient,
      documentType: categoria,
      // A leitura guardada e a da primeira face (e onde estao os dados do titular).
      extractedPayload: arquivos[0]?.extractedPayload,
      fileBase64,
      fileName,
      label: rotulo,
      mimeType,
      ownerId: entityId,
      scope: "entidade",
      uploadedByName,
    });
    if (upload.ok) {
      savedDocs.push(categoria);
    } else {
      uploadWarnings.push(`documento ${categoria}: ${upload.error}`);
    }
  }

  // 3) Monta a CAD aqui (com o codigo de autenticacao impresso) e salva no drive. O mesmo PDF
  //    volta pro operador baixar -- o que ele baixa e exatamente o que ficou guardado.
  let cadBase64: string | null = null;

  if (cad) {
    try {
      const bytes = await montarCadPdf({ ...cad, autenticacao: result.autenticacao });
      cadBase64 = Buffer.from(bytes).toString("base64");

      const upload = await uploadApoloDocument({
        adminClient,
        documentType: "cad",
        fileBase64: cadBase64,
        fileName: `${cad.arquivo || `CAD - ${nomeCliente}`}.pdf`,
        label: `CAD - ${nomeCliente}`,
        mimeType: "application/pdf",
        ownerId: entityId,
        scope: "entidade",
        uploadedByName,
      });
      if (upload.ok) {
        savedDocs.push("cad");
      } else {
        uploadWarnings.push(`CAD: ${upload.error}`);
      }
    } catch (error) {
      uploadWarnings.push(`CAD: falha ao gerar o PDF (${(error as Error).message})`);
    }
  }

  return NextResponse.json(
    {
      autenticacao: result.autenticacao,
      cadBase64,
      entityId,
      ok: true,
      savedDocs,
      warnings: [...result.warnings, ...uploadWarnings],
    },
    { status: 201 },
  );
}

function normalizeCategoria(value: string | undefined): string {
  const key = (value ?? "").trim().toLowerCase();
  if (SOCIO_CATEGORIA_RE.test(key)) return key;
  return key in CATEGORIA_LABEL && key !== "cad" ? key : "outros";
}

function stripDataUrl(value: string): Buffer {
  const cru = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  return Buffer.from(cru, "base64");
}

// Junta os arquivos de UM documento (RG frente+verso, contrato social com N paginas) num PDF
// unico: o drive guarda 1 arquivo por documento em vez de varios soltos. Imagem vira pagina do
// tamanho dela; PDF entra com as paginas copiadas.
async function juntarEmPdf(arquivos: IncomingDoc[]): Promise<string> {
  const doc = await PDFDocument.create();

  for (const arquivo of arquivos) {
    const bytes = stripDataUrl(arquivo.fileBase64 as string);
    const nome = (arquivo.fileName ?? "").toLowerCase();
    const mime = (arquivo.mimeType ?? "").toLowerCase();
    const ehPdf = mime.includes("pdf") || nome.endsWith(".pdf");

    if (ehPdf) {
      const origem = await PDFDocument.load(bytes);
      const paginas = await doc.copyPages(origem, origem.getPageIndices());
      for (const pagina of paginas) doc.addPage(pagina);
      continue;
    }

    const ehPng = mime.includes("png") || nome.endsWith(".png");
    const imagem = ehPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const pagina = doc.addPage([imagem.width, imagem.height]);
    pagina.drawImage(imagem, { height: imagem.height, width: imagem.width, x: 0, y: 0 });
  }

  return Buffer.from(await doc.save()).toString("base64");
}
