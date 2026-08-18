// Agrupamento + upload dos documentos de um cadastro no drive da entidade.
//
// POR QUE EXISTE: o wizard manda os documentos como uma lista PLANA (categoria por arquivo), e
// as várias faces de um mesmo documento (RG frente+verso, contrato social com N páginas) devem
// virar UM arquivo no drive, não vários soltos. Essa lógica já existe inline em
// /api/apolo/cadastro/salvar (modo interno). O modo PÚBLICO precisa do MESMO comportamento, então
// ela foi isolada aqui para o público reusar SEM tocar na rota interna de produção (regra de ouro:
// modo interno intacto). A rota interna segue com a cópia dela; esta é a superfície partilhável.
import { COMPROVANTE_RENDA_LABELS } from "@/lib/apolo/cadastro-obrigatorios";
import {
  documentoTemArquivo,
  lerDocumentoDoStorage,
  removerDocumentoDoStorage,
  uploadApoloDocument,
} from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { PDFDocument } from "pdf-lib";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type DocumentoEntrada = {
  categoria?: string;
  extractedPayload?: unknown;
  // Documento PEQUENO: o arquivo vem em base64 dentro do JSON (fluxo de hoje).
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  // Documento GRANDE: o browser já gravou o arquivo no bucket e manda só a referência.
  sizeBytes?: number;
  storagePath?: string;
};

// Só o que TEM arquivo entra (nas duas formas). Reexportado para as rotas usarem a MESMA regra.
export { documentoTemArquivo };

// Teto para JUNTAR páginas baixando do Storage. Só entra em jogo quando uma categoria tem mais de
// um arquivo E pelo menos um deles subiu direto: aí o servidor precisa dos bytes para montar o PDF
// único. Acima disso a function estouraria memória, então cada página vira um arquivo no drive e o
// operador recebe o aviso.
const TETO_JUNCAO_BYTES = 24 * 1024 * 1024;

// Categoria (document_type) -> rótulo legível ("Nome + categoria"). Espelha o mapa da rota interna.
const CATEGORIA_LABEL: Record<string, string> = {
  cad: "CAD",
  certidao: "Certidão",
  comprovante_endereco: "Comprovante de endereço",
  // As TRÊS formas do comprovante de renda (extrato / contracheque / IRPF). O rótulo carrega a
  // forma entregue: é ele que vira o nome do documento na aba Documentos da ficha, e "Comprovante
  // de renda" sem a forma faria o validador abrir o arquivo para descobrir o que recebeu.
  ...COMPROVANTE_RENDA_LABELS,
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

// Bytes de UM arquivo do payload, venha ele como base64 no corpo (fluxo de hoje) ou já gravado no
// bucket (upload direto). Só é chamado no agrupamento: documento de arquivo único que subiu direto
// nem baixa nem re-sobe.
async function bytesDoArquivo(
  adminClient: AdminClient,
  arquivo: DocumentoEntrada,
): Promise<Buffer> {
  const caminho = (arquivo.storagePath ?? "").trim();
  if (caminho) {
    const bytes = await lerDocumentoDoStorage(adminClient, caminho);
    if (!bytes) throw new Error("arquivo enviado não foi encontrado no armazenamento");
    return bytes;
  }
  return stripDataUrl(arquivo.fileBase64 as string);
}

// Tamanho aproximado de um arquivo do payload, para decidir se dá para juntar em memória.
function tamanhoAproximado(arquivo: DocumentoEntrada): number {
  if ((arquivo.storagePath ?? "").trim()) return arquivo.sizeBytes ?? 0;
  return Math.floor(((arquivo.fileBase64 ?? "").length * 3) / 4);
}

// Junta os arquivos de UM documento num PDF único (imagem vira página do tamanho dela; PDF entra
// com as páginas copiadas). Idêntico ao juntarEmPdf da rota interna.
async function juntarEmPdf(
  adminClient: AdminClient,
  arquivos: DocumentoEntrada[],
): Promise<string> {
  const doc = await PDFDocument.create();
  for (const arquivo of arquivos) {
    const bytes = await bytesDoArquivo(adminClient, arquivo);
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
  for (const doc of input.documentos.filter(documentoTemArquivo)) {
    const categoria = normalizeCategoria(doc.categoria);
    porCategoria.set(categoria, [...(porCategoria.get(categoria) ?? []), doc]);
  }

  for (const [categoria, arquivos] of porCategoria) {
    const rotulo = `${input.nomeCliente} - ${rotuloCategoria(categoria)}`;
    const varias = arquivos.length > 1;
    const primeiro = arquivos[0];

    // Documento de arquivo ÚNICO que subiu direto: a linha só aponta para o arquivo que já está no
    // bucket. Nada é baixado nem re-enviado — é o caminho dos arquivos grandes.
    if (!varias && primeiro && (primeiro.storagePath ?? "").trim()) {
      const upload = await uploadApoloDocument({
        adminClient,
        documentType: categoria,
        extractedPayload: primeiro.extractedPayload,
        fileName: primeiro.fileName || `${categoria}.pdf`,
        label: rotulo,
        mimeType: primeiro.mimeType || null,
        ownerId: input.entityId,
        scope: "entidade",
        sizeBytes: primeiro.sizeBytes ?? null,
        storagePath: primeiro.storagePath,
        uploadedByName: input.uploadedByName,
      });
      if (upload.ok) savedDocs.push(categoria);
      else warnings.push(`documento ${categoria}: ${upload.error}`);
      continue;
    }

    // Documento com VÁRIAS páginas em que alguma subiu direto: para virar UM PDF só (o que o time
    // vê no drive hoje) o servidor precisa dos bytes, então baixa do Storage. Acima do teto,
    // guarda uma página por arquivo em vez de estourar a memória da function.
    const algumDireto = arquivos.some((a) => (a.storagePath ?? "").trim());
    const soma = arquivos.reduce((total, a) => total + tamanhoAproximado(a), 0);
    if (varias && algumDireto && soma > TETO_JUNCAO_BYTES) {
      warnings.push(
        `documento ${categoria}: as páginas somam ${(soma / 1_048_576).toFixed(1)}MB e ficaram como arquivos separados no drive`,
      );
      for (const arquivo of arquivos) {
        const upload = await uploadApoloDocument({
          adminClient,
          documentType: categoria,
          extractedPayload: arquivo.extractedPayload,
          fileBase64: arquivo.fileBase64 ?? null,
          fileName: arquivo.fileName || `${categoria}.pdf`,
          label: rotulo,
          mimeType: arquivo.mimeType || null,
          ownerId: input.entityId,
          scope: "entidade",
          sizeBytes: arquivo.sizeBytes ?? null,
          storagePath: arquivo.storagePath ?? null,
          uploadedByName: input.uploadedByName,
        });
        if (upload.ok) savedDocs.push(categoria);
        else warnings.push(`documento ${categoria}: ${upload.error}`);
      }
      continue;
    }

    let fileBase64: string;
    let fileName: string;
    let mimeType: string | null;
    try {
      fileBase64 = varias ? await juntarEmPdf(adminClient, arquivos) : (primeiro?.fileBase64 as string);
      fileName = varias ? `${rotulo}.pdf` : primeiro?.fileName || `${categoria}.pdf`;
      mimeType = varias ? "application/pdf" : primeiro?.mimeType || null;
    } catch (error) {
      warnings.push(`documento ${categoria}: falha ao juntar as páginas (${(error as Error).message})`);
      continue;
    }

    const upload = await uploadApoloDocument({
      adminClient,
      documentType: categoria,
      extractedPayload: primeiro?.extractedPayload,
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

    // As páginas que subiram direto viraram parte do PDF único: os originais no staging não têm
    // mais dono. Limpeza best-effort, para não deixar arquivo órfão no bucket.
    if (upload.ok && algumDireto) {
      for (const arquivo of arquivos) {
        const caminho = (arquivo.storagePath ?? "").trim();
        if (caminho) await removerDocumentoDoStorage(adminClient, caminho);
      }
    }
  }

  return { savedDocs, warnings };
}
