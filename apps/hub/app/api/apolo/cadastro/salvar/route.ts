import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  validarCamposMinimos,
  validarDocumentosObrigatorios,
} from "@/lib/apolo/cadastro-obrigatorios";
import {
  createApoloEntity,
  type ApoloBirthRole,
  type CreateApoloEntityInput,
} from "@/lib/apolo/cadastro-persist";
import {
  APOLO_DOC_MAX_BYTES,
  MENSAGEM_DOCUMENTO_GRANDE,
  caminhoUploadDiretoValido,
  documentoTemArquivo,
  donoUploadOperador,
  lerDocumentoDoStorage,
  removerDocumentoDoStorage,
  uploadApoloDocument,
} from "@/lib/apolo/documentos";
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
// ⚠️ A IMOBILIÁRIA CADASTRADA AQUI NASCE CREDENCIADA, e isso é REGRA, não esquecimento.
//
// Decisão do Lucas (17/08/2026): "cadastro feito pelo operador vale já como validação". Quem
// preenche este wizard é gente da Careli, com os documentos na mão — mandá-la para a fila de
// validação seria pedir que alguém revalide o que a própria casa acabou de conferir.
//
// Por isso este caminho NÃO rebaixa o papel, ao contrário dos dois portais PÚBLICOS
// (/api/publico/imobiliaria/cadastro e /credenciar), onde quem preenche é a própria imobiliária:
// lá o papel nasce `review` e os vínculos `pending` de propósito, e a liberação passa pela
// validação humana no Board.
//
// Uma revisão automática já apontou isto como defeito ("nasce credenciada sem validação"). Não é:
// a diferença entre os dois caminhos é QUEM preencheu.
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

// Teto para JUNTAR paginas baixando do Storage (gemeo do de lib/apolo/cadastro-upload.ts).
const TETO_JUNCAO_BYTES = 24 * 1024 * 1024;

type IncomingDoc = {
  categoria?: string;
  extractedPayload?: unknown;
  // Documento PEQUENO: o arquivo vem em base64 dentro do JSON (fluxo de sempre).
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  // Documento GRANDE: o browser ja gravou no bucket (via /api/apolo/cadastro/upload-url) e manda
  // so a referencia. A Vercel corta o corpo em ~4,5MB, entao acima disso nao ha como viajar aqui.
  sizeBytes?: number;
  storagePath?: string;
};

// A CAD chega como ESTRUTURA (seções), não como PDF pronto: o PDF é montado aqui, no servidor,
// já com o código de autenticação impresso. Se o browser mandasse o PDF, o código não valeria
// nada (o forjador geraria o dele).
type SalvarPayload = CreateApoloEntityInput & {
  cad?: Omit<CadDoc, "autenticacao"> | null;
  documentos?: IncomingDoc[];
  // Vínculo escolhido pelo operador no wizard (imobiliária -> empreendimento -> corretor). A
  // imobiliária vem em perfil.imobiliariaId; aqui vêm o empreendimento e o corretor. Grava a
  // esteira igual ao portal público, para a CAD manual NÃO nascer órfã de empreendimento.
  vinculo?: {
    corretorEmail?: string;
    corretorEntityId?: string;
    corretorNome?: string;
    empreendimentoNome?: string;
    enterpriseId?: string;
  };
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

  // Documento anexado em QUALQUER uma das duas formas: base64 no corpo (pequeno) ou caminho de
  // arquivo ja gravado no bucket (grande, upload direto).
  const documentos = (payload.documentos ?? []).filter(documentoTemArquivo);
  const cad = payload.cad?.secoes?.length ? payload.cad : null;
  const totalFiles = documentos.length + (cad ? 1 : 0);
  if (totalFiles > MAX_FILES) {
    return NextResponse.json(
      { error: `Maximo de ${MAX_FILES} arquivos por cadastro.` },
      { status: 413 },
    );
  }
  const donoUpload = donoUploadOperador(authorization.userId);
  for (const doc of documentos) {
    const caminho = (doc.storagePath ?? "").trim();
    if (caminho) {
      // O caminho tem que ser um que ESTE operador recebeu para gravar (rota /upload-url): sem
      // isso um corpo forjado apontaria a linha do documento para o arquivo de outra pessoa.
      if (!caminhoUploadDiretoValido(caminho, donoUpload)) {
        return NextResponse.json(
          { error: "Arquivo enviado nao confere com esta sessao." },
          { status: 400 },
        );
      }
      if ((doc.sizeBytes ?? 0) > APOLO_DOC_MAX_BYTES) {
        return NextResponse.json({ error: MENSAGEM_DOCUMENTO_GRANDE }, { status: 413 });
      }
      continue;
    }
    if ((doc.fileBase64?.length ?? 0) > MAX_BASE64_LENGTH) {
      return NextResponse.json({ error: MENSAGEM_DOCUMENTO_GRANDE }, { status: 413 });
    }
  }

  // 🔒 MESMA TRAVA DE OBRIGATÓRIOS DO PORTAL PÚBLICO (incidente 04/08). Esta rota interna também
  // só validava quantidade/tamanho de arquivo: o mesmo furo. O wizard interno já trava por etapa,
  // mas a validação de cliente pode ser burlada, então a barra de verdade fica aqui. Exige o
  // ARQUIVO anexado, nunca o sucesso do OCR (v1.105.0 — [[project_apolo_most_sem_trava]]).
  // Ver lib/apolo/cadastro-obrigatorios.ts.
  const campos = validarCamposMinimos({
    empresa: payload.empresa,
    identidade: payload.identidade,
    persona: payload.persona,
  });
  if (!campos.ok) {
    return NextResponse.json({ error: campos.mensagem }, { status: 400 });
  }
  const obrigatorios = validarDocumentosObrigatorios({
    documentos,
    perfil: payload.perfil,
    persona: payload.persona,
  });
  if (!obrigatorios.ok) {
    return NextResponse.json({ error: obrigatorios.mensagem }, { status: 400 });
  }

  // Autor do cadastro (nome do operador).
  const { data: operator } = await adminClient
    .from("hub_users")
    .select("display_name, email")
    .eq("id", authorization.userId)
    .maybeSingle<{ display_name: string | null; email: string | null }>();
  const uploadedByName = operator?.display_name ?? operator?.email ?? null;

  // 1) Cria a entidade coordenadamente — com DEDUP por documento (não cria 2ª ficha do mesmo CPF).
  const result = await createApoloEntity(adminClient, {
    ...payload,
    dedupPorDocumento: true,
    // A duplicidade é POR EMPREENDIMENTO: quem já tem CAD no Vale do Ouro pode abrir CAD em
    // outro loteamento. Sem este campo o dedup barra tudo (era o 409 que travava o time).
    enterpriseId: payload.vinculo?.enterpriseId ?? null,
    origem: payload.origem || "cadastro-formulario",
    ownerUserId: authorization.userId,
  });

  if (!result.ok) {
    // Documento já tem ficha: NÃO cria uma segunda (era a causa dos "dois Pedro"); devolve o id da
    // ficha existente para a tela abrir/avisar em vez de duplicar a pessoa no mesmo empreendimento.
    if (result.entityIdExistente) {
      return NextResponse.json(
        { entityIdExistente: result.entityIdExistente, error: result.error, jaExiste: true },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const entityId = result.entityId;
  const nomeCliente =
    payload.persona === "pj"
      ? payload.empresa?.razaoSocial?.trim() || "Empresa"
      : payload.identidade?.nome?.trim() || "Cliente";

  // Avisos acumulados (esteira + documentos): a entidade já existe, então falhas aqui viram aviso.
  const uploadWarnings: string[] = [];
  const savedDocs: string[] = [];

  // 1b) VÍNCULO na esteira (empreendimento + imobiliária + corretor), como o portal público faz —
  // para a CAD manual entrar na fila COM empreendimento e não nascer órfã (o bug das órfãs). Só
  // grava quando o operador escolheu o empreendimento no wizard; best-effort com aviso.
  //
  // ⚠️ CORRETOR NÃO ENTRA NA ESTEIRA (regra do Lucas, 05/08). A esteira existe para VALIDAR
  // DOCUMENTO DE COMPRADOR: validação, análise de crédito, pré-venda, credenciamento. O corretor
  // não compra nada, então não há o que validar: ele é cadastrado, vinculado à imobiliária, e
  // acabou. Antes esta condição olhava só empreendimento + imobiliária, e como o cadastro de
  // corretor também tem os dois, ele caía na fila de Validação junto com os clientes.
  //
  // A IMOBILIÁRIA continua entrando de propósito: ela TEM documento para validar (contrato social,
  // ficha dos sócios). Só o corretor está fora.
  const vinculo = payload.vinculo;
  const imobiliariaId = payload.perfil?.imobiliariaId?.trim();
  if (role !== "corretor" && vinculo?.enterpriseId && imobiliariaId) {
    const imobiliariaNome = await nomeDaImobiliaria(
      adminClient,
      imobiliariaId,
      payload.perfil?.imobiliariaLabel,
    );
    const { error: esteiraError } = await adminClient.from("apolo_esteira").upsert(
      {
        chegou_em: new Date().toISOString(),
        corretor: vinculo.corretorNome?.trim() || null,
        corretor_email: vinculo.corretorEmail?.trim() || null,
        corretor_entity_id:
          vinculo.corretorEntityId && UUID_RE.test(vinculo.corretorEntityId)
            ? vinculo.corretorEntityId
            : null,
        empreendimento: vinculo.empreendimentoNome?.trim() || null,
        enterprise_id: vinculo.enterpriseId,
        entity_id: entityId,
        etapa: "validacao",
        imobiliaria: imobiliariaNome || null,
        imobiliaria_entity_id: UUID_RE.test(imobiliariaId) ? imobiliariaId : null,
        origem: "cadastro-manual",
      },
      // A chave da esteira é `(entity_id, enterprise_id)` desde a 0080: uma CAD por pessoa POR
      // EMPREENDIMENTO. `enterprise_id` já vai no registro acima (o `if` acima garante), então
      // este upsert cria a CAD nova do loteamento sem tocar na CAD que a pessoa tem em outro.
      { onConflict: "entity_id,enterprise_id" },
    );
    if (esteiraError) {
      uploadWarnings.push(`esteira: ${esteiraError.message}`);
    }
  }

  // 2) Sobe os documentos anexados + o CAD pro drive da entidade. Best-effort: falha de upload
  // vira warning (a entidade ja existe), nao derruba o cadastro.

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
    const primeiro = arquivos[0];

    // Documento de arquivo UNICO que subiu direto: a linha so aponta pro arquivo que ja esta no
    // bucket. Nada e baixado nem re-enviado -- e o caminho dos arquivos grandes.
    if (!varias && primeiro && (primeiro.storagePath ?? "").trim()) {
      const upload = await uploadApoloDocument({
        adminClient,
        documentType: categoria,
        extractedPayload: primeiro.extractedPayload,
        fileName: primeiro.fileName || `${categoria}.pdf`,
        label: rotulo,
        mimeType: primeiro.mimeType || null,
        ownerId: entityId,
        scope: "entidade",
        sizeBytes: primeiro.sizeBytes ?? null,
        storagePath: primeiro.storagePath,
        uploadedByName,
      });
      if (upload.ok) savedDocs.push(categoria);
      else uploadWarnings.push(`documento ${categoria}: ${upload.error}`);
      continue;
    }

    // Documento com VARIAS paginas em que alguma subiu direto: pra virar UM PDF so (o que o time ve
    // no drive hoje) o servidor precisa dos bytes, entao baixa do Storage. Acima do teto, guarda
    // uma pagina por arquivo em vez de estourar a memoria da function.
    const algumDireto = arquivos.some((a) => (a.storagePath ?? "").trim());
    const soma = arquivos.reduce((total, a) => total + tamanhoAproximado(a), 0);
    if (varias && algumDireto && soma > TETO_JUNCAO_BYTES) {
      uploadWarnings.push(
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
          ownerId: entityId,
          scope: "entidade",
          sizeBytes: arquivo.sizeBytes ?? null,
          storagePath: arquivo.storagePath ?? null,
          uploadedByName,
        });
        if (upload.ok) savedDocs.push(categoria);
        else uploadWarnings.push(`documento ${categoria}: ${upload.error}`);
      }
      continue;
    }

    let fileBase64: string;
    let fileName: string;
    let mimeType: string | null;

    try {
      fileBase64 = varias
        ? await juntarEmPdf(adminClient, arquivos)
        : (primeiro?.fileBase64 as string);
      fileName = varias
        ? `${rotulo}.pdf`
        : primeiro?.fileName || `${categoria}.pdf`;
      mimeType = varias ? "application/pdf" : primeiro?.mimeType || null;
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
      extractedPayload: primeiro?.extractedPayload,
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

    // As paginas que subiram direto viraram parte do PDF unico: os originais no staging nao tem
    // mais dono. Limpeza best-effort, pra nao deixar arquivo orfao no bucket.
    if (upload.ok && algumDireto) {
      for (const arquivo of arquivos) {
        const caminho = (arquivo.storagePath ?? "").trim();
        if (caminho) await removerDocumentoDoStorage(adminClient, caminho);
      }
    }
  }

  // 3) Monta a CAD aqui (com o codigo de autenticacao impresso) e salva no drive. O mesmo PDF
  //    volta pro operador baixar -- o que ele baixa e exatamente o que ficou guardado.
  let cadBase64: string | null = null;

  if (cad) {
    try {
      // ⚠️ A imobiliaria impressa e RESOLVIDA AQUI, sobrescrevendo o que veio no payload. O
      // `cad` inteiro (inclusive `vinculo`) e montado no BROWSER e a rota so repassava: quem
      // envia ditava o que sai impresso na propria CAD. Agora o nome sai do id que o operador
      // autenticado escolheu (perfil.imobiliariaId).
      // O `corretor` fica vazio no fluxo interno: o wizard de operador nao coleta corretor
      // hoje. Quem preenche os dois e o formulario publico (/api/publico/cad/enviar).
      const imobiliariaNome = await nomeDaImobiliaria(
        adminClient,
        payload.perfil?.imobiliariaId,
        payload.perfil?.imobiliariaLabel,
      );
      const bytes = await montarCadPdf({
        ...cad,
        autenticacao: result.autenticacao,
        imobiliaria: imobiliariaNome || cad.vinculo || "",
      });
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

// Nome da imobiliaria a partir do ID escolhido pelo operador. Cai no rotulo que o wizard
// mandou quando o id nao for um uuid (o seletor permite texto livre em imobiliaria nova).
async function nomeDaImobiliaria(
  adminClient: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  imobiliariaId: string | undefined,
  imobiliariaLabel: string | undefined,
): Promise<string> {
  const id = (imobiliariaId ?? "").trim();
  if (!UUID_RE.test(id)) return (imobiliariaLabel ?? "").trim();

  const { data, error } = await adminClient
    .from("apolo_entities")
    .select("display_name, legal_name")
    .eq("id", id)
    .maybeSingle<{ display_name: string | null; legal_name: string | null }>();

  if (error || !data) return (imobiliariaLabel ?? "").trim();
  return data.legal_name || data.display_name || (imobiliariaLabel ?? "").trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCategoria(value: string | undefined): string {
  const key = (value ?? "").trim().toLowerCase();
  if (SOCIO_CATEGORIA_RE.test(key)) return key;
  return key in CATEGORIA_LABEL && key !== "cad" ? key : "outros";
}

function stripDataUrl(value: string): Buffer {
  const cru = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  return Buffer.from(cru, "base64");
}

// Bytes de UM arquivo do payload, venha ele em base64 no corpo (fluxo de sempre) ou ja gravado no
// bucket (upload direto). So e chamado no agrupamento: documento de arquivo unico que subiu direto
// nem baixa nem re-sobe.
async function bytesDoArquivo(
  adminClient: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  arquivo: IncomingDoc,
): Promise<Buffer> {
  const caminho = (arquivo.storagePath ?? "").trim();
  if (caminho) {
    const bytes = await lerDocumentoDoStorage(adminClient, caminho);
    if (!bytes) throw new Error("arquivo enviado não foi encontrado no armazenamento");
    return bytes;
  }
  return stripDataUrl(arquivo.fileBase64 as string);
}

// Tamanho aproximado de um arquivo do payload, pra decidir se da pra juntar em memoria.
function tamanhoAproximado(arquivo: IncomingDoc): number {
  if ((arquivo.storagePath ?? "").trim()) return arquivo.sizeBytes ?? 0;
  return Math.floor(((arquivo.fileBase64 ?? "").length * 3) / 4);
}

// Junta os arquivos de UM documento (RG frente+verso, contrato social com N paginas) num PDF
// unico: o drive guarda 1 arquivo por documento em vez de varios soltos. Imagem vira pagina do
// tamanho dela; PDF entra com as paginas copiadas.
async function juntarEmPdf(
  adminClient: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  arquivos: IncomingDoc[],
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
