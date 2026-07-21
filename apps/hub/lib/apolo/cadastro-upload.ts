// Agrupamento + upload dos documentos de um cadastro no drive da entidade.
//
// POR QUE EXISTE: o wizard manda os documentos como uma lista PLANA (categoria por arquivo), e
// as várias faces de um mesmo documento (RG frente+verso, contrato social com N páginas) devem
// virar UM arquivo no drive, não vários soltos. Essa lógica já existe inline em
// /api/apolo/cadastro/salvar (modo interno). O modo PÚBLICO precisa do MESMO comportamento, então
// ela foi isolada aqui para o público reusar SEM tocar na rota interna de produção (regra de ouro:
// modo interno intacto). A rota interna segue com a cópia dela; esta é a superfície partilhável.
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { PDFDocument } from "pdf-lib";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type DocumentoEntrada = {
  categoria?: string;
  extractedPayload?: unknown;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
};

// Categoria (document_type) -> rótulo legível ("Nome + categoria"). Espelha o mapa da rota interna.
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

// Documentos de sócio carregam o índice na categoria ("identificacao_socio_2"): sem o índice o
// agrupamento fundiria os documentos de todos os sócios num PDF só.
const SOCIO_CATEGORIA_RE = /^(identificacao|comprovante)_socio_(\d+)$/;

function rotuloCategoria(categoria: string): string {
  const socio = SOCIO_CATEGORIA_RE.exec(categoria);
  if (socio) {
    const tipo = socio[1] === "identificacao" ? "Identificação" : "Comprovante de endereço";
    return `${tipo} (sócio ${socio[2]})`;
  }
  return CATEGORIA_LABEL[categoria] ?? "Documento";
}

// Normaliza a categoria para o conjunto conhecido. "cad" nunca chega por aqui (a CAD é gerada no
// servidor); qualquer coisa fora do mapa vira "outros".
function normalizeCategoria(value: string | undefined): string {
  const key = (value ?? "").trim().toLowerCase();
  if (SOCIO_CATEGORIA_RE.test(key)) return key;
  return key in CATEGORIA_LABEL && key !== "cad" ? key : "outros";
}

function stripDataUrl(value: string): Buffer {
  const cru = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  return Buffer.from(cru, "base64");
}

// Junta os arquivos de UM documento num PDF único (imagem vira página do tamanho dela; PDF entra
// com as páginas copiadas). Idêntico ao juntarEmPdf da rota interna.
async function juntarEmPdf(arquivos: DocumentoEntrada[]): Promise<string> {
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

// Agrupa por categoria e sobe UM arquivo por documento. Best-effort: a entidade já existe, então
// falha de upload vira warning e não derruba o cadastro.
export async function agruparEUploadDocumentos(
  adminClient: AdminClient,
  input: {
    documentos: DocumentoEntrada[];
    entityId: string;
    nomeCliente: string;
    uploadedByName: string | null;
  },
): Promise<{ savedDocs: string[]; warnings: string[] }> {
  const savedDocs: string[] = [];
  const warnings: string[] = [];

  const porCategoria = new Map<string, DocumentoEntrada[]>();
  for (const doc of input.documentos.filter((d) => d?.fileBase64)) {
    const categoria = normalizeCategoria(doc.categoria);
    porCategoria.set(categoria, [...(porCategoria.get(categoria) ?? []), doc]);
  }

  for (const [categoria, arquivos] of porCategoria) {
    const rotulo = `${input.nomeCliente} - ${rotuloCategoria(categoria)}`;
    const varias = arquivos.length > 1;

    let fileBase64: string;
    let fileName: string;
    let mimeType: string | null;
    try {
      fileBase64 = varias ? await juntarEmPdf(arquivos) : (arquivos[0]?.fileBase64 as string);
      fileName = varias ? `${rotulo}.pdf` : arquivos[0]?.fileName || `${categoria}.pdf`;
      mimeType = varias ? "application/pdf" : arquivos[0]?.mimeType || null;
    } catch (error) {
      warnings.push(`documento ${categoria}: falha ao juntar as páginas (${(error as Error).message})`);
      continue;
    }

    const upload = await uploadApoloDocument({
      adminClient,
      documentType: categoria,
      extractedPayload: arquivos[0]?.extractedPayload,
      fileBase64,
      fileName,
      label: rotulo,
      mimeType,
      ownerId: input.entityId,
      scope: "entidade",
      uploadedByName: input.uploadedByName,
    });
    if (upload.ok) savedDocs.push(categoria);
    else warnings.push(`documento ${categoria}: ${upload.error}`);
  }

  return { savedDocs, warnings };
}
