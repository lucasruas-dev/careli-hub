// CORREÇÃO DO TITULAR: põe cada pessoa no seu lugar, seguindo o formulário do Asana.
//
// O defeito: `lerDocumentosDoLote` para no PRIMEIRO anexo que devolve um CPF válido. No PDF do
// casal esse costuma ser o documento do CÔNJUGE, e a ficha nasce com a identidade dele —
// enquanto telefone, profissão e renda vêm do formulário e são do PROPONENTE. Ficha costurada
// de duas pessoas.
//
// A regra (Lucas, 21/jul): "se o formulário apontou o Mateus, vamos trazer o CPF do Mateus".
// O formulário diz QUEM é o titular; o documento diz os DADOS dele. Aqui procuramos, entre os
// anexos, o documento cujo nome bate com o proponente — e é dele que sai o CPF.
//
// ECONOMIA (o custo é real, R$ 0,506 por imagem):
//   · documento já lido antes não é cobrado de novo (dedup por SHA-256 do arquivo);
//   · a busca PARA assim que acha o documento do proponente;
//   · arquivo que não é imagem/PDF nem é enviado.
import { createHash } from "node:crypto";

import { normalizarNome, similaridade } from "@/lib/apolo/asana-import";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { extractDocument } from "@/lib/apolo/mostqi";
import { custoOcrImagem } from "@/lib/apolo/most-precos";
import { type createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Acima disto o nome do documento é a mesma pessoa do formulário. Alto de propósito: aqui a
// decisão define de quem é o CPF que vai para a ficha.
const LIMIAR_PESSOA = 0.82;

export type DocumentoLido = {
  cpf: string | null;
  dataNascimento?: string;
  nacionalidade?: string;
  naturalidade?: string;
  nome: string | null;
  nomeMae?: string;
  rg?: string;
};

export type ResultadoCorrecao = {
  conjugeEncontrado: DocumentoLido | null;
  custoBrl: number;
  imagensPagas: number;
  motivo: string;
  proponenteEncontrado: DocumentoLido | null;
  reaproveitadas: number;
};

function ehLegivel(nome: string): boolean {
  return /\.(jpe?g|png|pdf|webp|heic)$/i.test(nome);
}

function extrair(cadastro: Record<string, unknown> | undefined): DocumentoLido {
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    cpf: t(cadastro?.cpf)?.replace(/\D/g, "") ?? null,
    dataNascimento: t(cadastro?.dataNascimento),
    nacionalidade: t(cadastro?.nacionalidade),
    naturalidade: t(cadastro?.naturalidade),
    nome: t(cadastro?.nome) ?? null,
    nomeMae: t(cadastro?.nomeMae),
    rg: t(cadastro?.rg),
  };
}

function pessoaBate(nomeDoDocumento: string | null, nomeDoFormulario: string | null): number {
  if (!nomeDoDocumento || !nomeDoFormulario) return 0;
  const a = normalizarNome(nomeDoDocumento);
  const b = normalizarNome(nomeDoFormulario);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // Primeiro nome + último sobrenome: dentro de uma CAD só existem dois candidatos, e o que
  // separa marido de mulher é justamente o primeiro nome.
  const pa = a.split(" ").filter(Boolean);
  const pb = b.split(" ").filter(Boolean);
  const primeiro = similaridade(pa[0] ?? "", pb[0] ?? "");
  const ultimo = similaridade(pa[pa.length - 1] ?? "", pb[pb.length - 1] ?? "");
  return (primeiro * 2 + ultimo + similaridade(a, b)) / 4;
}

// Lê os documentos de UMA ficha procurando o do proponente. Devolve o que achou e quanto custou.
export async function acharDocumentosDoCasal(input: {
  client: AdminClient;
  conjugeNome: string | null;
  entityId: string;
  lidoPor?: string | null;
  proponenteNome: string;
}): Promise<ResultadoCorrecao> {
  const custoPorImagem = custoOcrImagem();
  const resultado: ResultadoCorrecao = {
    conjugeEncontrado: null,
    custoBrl: 0,
    imagensPagas: 0,
    motivo: "",
    proponenteEncontrado: null,
    reaproveitadas: 0,
  };

  const { data: docs } = await input.client
    .from("apolo_documents")
    .select("id, label, storage_bucket, storage_path, metadata")
    .eq("entity_id", input.entityId)
    .not("storage_path", "is", null);

  const lista = (docs ?? []) as {
    id: string;
    label: string | null;
    metadata: Record<string, unknown> | null;
    storage_bucket: string | null;
    storage_path: string;
  }[];

  if (lista.length === 0) {
    resultado.motivo = "Nenhum documento anexado nesta ficha.";
    return resultado;
  }

  for (const doc of lista) {
    // Já achei o proponente: paro. É a economia que mais pesa na conta.
    if (resultado.proponenteEncontrado) break;

    const nomeArquivo = String(doc.metadata?.fileName ?? doc.label ?? doc.storage_path);
    if (!ehLegivel(nomeArquivo)) continue;

    const { data: arquivo } = await input.client.storage
      .from(doc.storage_bucket ?? APOLO_DOCS_BUCKET)
      .download(doc.storage_path);
    if (!arquivo) continue;

    const buffer = Buffer.from(await arquivo.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex");

    // Já lemos este arquivo antes? Então a extração está salva e não se paga de novo.
    const { data: jaLido } = await input.client
      .from("apolo_ocr_reads")
      .select("extracao")
      .eq("file_sha256", hash)
      .maybeSingle();

    let cadastro: Record<string, unknown> | undefined;

    if (jaLido) {
      cadastro = (jaLido as { extracao: { cadastro?: Record<string, unknown> } }).extracao
        ?.cadastro;
      resultado.reaproveitadas += 1;
    } else {
      // ⚠️ AQUI É COBRADO.
      const extracao = await extractDocument({
        fileBase64: buffer.toString("base64"),
        fileName: nomeArquivo,
      });
      cadastro = extracao.cadastro as unknown as Record<string, unknown> | undefined;
      resultado.imagensPagas += 1;
      resultado.custoBrl += custoPorImagem;

      await input.client.from("apolo_ocr_reads").insert({
        confianca: extracao.confiancaDocumento ?? null,
        custo_brl: custoPorImagem,
        entity_id: input.entityId,
        extracao: {
          cadastro,
          cpf: String(cadastro?.cpf ?? "").replace(/\D/g, ""),
          documentType: extracao.documentType ?? null,
        },
        file_name: nomeArquivo,
        file_sha256: hash,
        lido_por: input.lidoPor ?? null,
        paginas: 1,
        provider: "mostqi",
        size_bytes: buffer.byteLength,
        source_id: doc.id,
        source_system: "apolo-documents",
        tipo: "iocr",
      });
    }

    const lido = extrair(cadastro);
    if (!lido.nome) continue;

    if (pessoaBate(lido.nome, input.proponenteNome) >= LIMIAR_PESSOA) {
      resultado.proponenteEncontrado = lido;
    } else if (
      input.conjugeNome &&
      pessoaBate(lido.nome, input.conjugeNome) >= LIMIAR_PESSOA
    ) {
      resultado.conjugeEncontrado = lido;
    }
  }

  resultado.motivo = resultado.proponenteEncontrado
    ? "Documento do proponente localizado."
    : `Nenhum documento anexado bate com "${input.proponenteNome}". Conferir a mao.`;

  return resultado;
}
