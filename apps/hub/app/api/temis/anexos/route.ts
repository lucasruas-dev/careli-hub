import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { APOLO_DOCS_BUCKET, MENSAGEM_DOCUMENTO_GRANDE } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  type AnexoDoContrato,
  caminhoDeAnexoValido,
  LIMITE_ANEXO_BYTES,
  posicaoValida,
  PREFIXO_ANEXO,
  PREFIXO_CAPA,
  sanitizarNomeDeAnexo,
  TIPO_DO_ANEXO,
  TIPOS_DA_CAPA,
} from "@/lib/temis/anexos";

// OS ANEXOS E A CAPA DO CONTRATO. Tabela e coluna na migration 0156.
//
// Lucas (13/09/2026): *"eu não vi onde vamos subir os anexos, a capa dos contratos"* e, na mesma
// tarde, *"tem que fazer o upload hoje / estamos montando os contratos hoje"*.
//
// ⚠️ ESTA ROTA NÃO RECEBE BYTES, e é o mesmo padrão do upload da mídia do editor e do documento
// grande do CAD: o navegador sobe direto para o Storage por URL assinada, e só o registro passa por
// aqui. Um PDF de 20MB atravessando a função serverless estoura o limite de corpo da Vercel.
//
//   POST { acao: "upload", ...alcance, fileName, contentType, size } → { bucket, path, token }
//   POST { acao: "confirmar", ...alcance, posicao, nome, path }      → { anexo }
//   POST { acao: "capa", minutaId, path, nome }                      → { ok: true }
//   GET  ?enterpriseId=&categoriaId=&unidadeId=                      → { anexos }
//   DELETE ?id=                                                      → desativa (não apaga)
//
// ⚠️ O CAMINHO É ESCOLHIDO AQUI, PELO SERVIDOR. Um corpo forjado não grava em cima de outra pasta,
// e o `confirmar` só aceita caminho dentro do prefixo.
//
// ⚠️ DESATIVA, NÃO APAGA. O arquivo continua no bucket e a linha continua na tabela com
// `ativo = false`. Um contrato já montado que cite aquele anexo precisa que a peça continue
// existindo; apagar o objeto deixaria o PDF do passado apontando para o vazio.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_CACHE = { "Cache-Control": "no-store" } as const;

type LinhaDoBanco = {
  arquivo_bytes: null | number;
  arquivo_nome: null | string;
  categoria_id: null | string;
  enterprise_id: null | string;
  id: string;
  nome: string;
  posicao: number;
  storage_path: string;
  unidade_id: null | string;
};

const COLUNAS =
  "id,enterprise_id,categoria_id,unidade_id,posicao,nome,storage_path,arquivo_nome,arquivo_bytes";

function paraATela(linha: LinhaDoBanco): AnexoDoContrato {
  return {
    arquivoBytes: linha.arquivo_bytes,
    arquivoNome: linha.arquivo_nome,
    categoriaId: linha.categoria_id,
    enterpriseId: linha.enterprise_id,
    id: linha.id,
    nome: linha.nome,
    posicao: linha.posicao,
    storagePath: linha.storage_path,
    unidadeId: linha.unidade_id,
  };
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * O alcance vindo do corpo, com a trava do "exatamente um".
 *
 * ⚠️ O BANCO TAMBÉM RECUSA (`temis_anexos_um_alcance`), e a conferência aqui existe para a mensagem:
 * um 400 com "escolha um alcance" é acionável; o erro cru da constraint não é.
 */
function lerAlcance(corpo: Record<string, unknown>): {
  campos?: { categoria_id: null | string; enterprise_id: null | string; unidade_id: null | string };
  erro?: string;
  pasta?: string;
} {
  const enterpriseId = texto(corpo.enterpriseId);
  const categoriaId = texto(corpo.categoriaId);
  const unidadeId = texto(corpo.unidadeId);
  const quantos = [enterpriseId, categoriaId, unidadeId].filter(Boolean).length;

  if (quantos !== 1) {
    return { erro: "Escolha exatamente um alcance: empreendimento, categoria ou unidade." };
  }
  if (unidadeId) {
    return {
      campos: { categoria_id: null, enterprise_id: null, unidade_id: unidadeId },
      pasta: `unidade/${unidadeId}`,
    };
  }
  if (categoriaId) {
    return {
      campos: { categoria_id: categoriaId, enterprise_id: null, unidade_id: null },
      pasta: `categoria/${categoriaId}`,
    };
  }
  return {
    campos: { categoria_id: null, enterprise_id: enterpriseId, unidade_id: null },
    pasta: `empreendimento/${enterpriseId}`,
  };
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const parametros = new URL(request.url).searchParams;
  const enterpriseId = (parametros.get("enterpriseId") ?? "").trim();
  const categoriaId = (parametros.get("categoriaId") ?? "").trim();
  const unidadeId = (parametros.get("unidadeId") ?? "").trim();

  if (!enterpriseId && !categoriaId && !unidadeId) {
    return NextResponse.json({ error: "Informe o alcance." }, { status: 400 });
  }

  // ⚠️ OS TRÊS NÍVEIS VÊM JUNTOS quando a tela pede os três, porque a precedência
  // (unidade > categoria > empreendimento) é resolvida por quem MONTA o contrato, não pelo banco.
  // Devolver só um nível esconderia do operador que a unidade dele sobrescreve a categoria.
  let consulta = admin.from("temis_anexos").select(COLUNAS).eq("ativo", true);
  const alvos: string[] = [];
  if (enterpriseId) alvos.push(`enterprise_id.eq.${enterpriseId}`);
  if (categoriaId) alvos.push(`categoria_id.eq.${categoriaId}`);
  if (unidadeId) alvos.push(`unidade_id.eq.${unidadeId}`);
  consulta = consulta.or(alvos.join(","));

  const { data, error } = await consulta.order("posicao", { ascending: true });
  if (error) {
    console.warn("[temis/anexos] leitura falhou:", error.message);
    return NextResponse.json({ error: "Nao foi possivel ler os anexos." }, { status: 500 });
  }

  return NextResponse.json(
    { anexos: ((data ?? []) as LinhaDoBanco[]).map(paraATela) },
    { headers: SEM_CACHE },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as null | Record<string, unknown>;
  if (!corpo) return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });

  const acao = texto(corpo.acao);

  // ── A CAPA: ela é da MINUTA, e não da tabela de anexos ────────────────────
  // Lucas (07/09/2026): *"estamos fazendo nossas capas no canvas"*. Uma por minuta, trocável, e a
  // variável `capa_contrato` lê daqui.
  if (acao === "capa") {
    const minutaId = texto(corpo.minutaId);
    const path = texto(corpo.path);
    if (!minutaId) return NextResponse.json({ error: "Minuta invalida." }, { status: 400 });
    if (path && !caminhoDeAnexoValido(path)) {
      return NextResponse.json({ error: "Caminho invalido." }, { status: 400 });
    }

    // `path` vazio TIRA a capa — é como o operador desfaz sem precisar de outra rota.
    const { error } = await admin
      .from("temis_minutas")
      .update({
        atualizado_em: new Date().toISOString(),
        capa_nome: path ? texto(corpo.nome) || null : null,
        capa_path: path || null,
      })
      .eq("id", minutaId);

    if (error) {
      console.warn("[temis/anexos] capa falhou:", error.message);
      return NextResponse.json({ error: "Nao foi possivel gravar a capa." }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
  }

  const alcance = lerAlcance(corpo);
  if (alcance.erro || !alcance.campos || !alcance.pasta) {
    return NextResponse.json({ error: alcance.erro ?? "Alcance invalido." }, { status: 400 });
  }

  // ── PASSO 1: a URL assinada de upload ─────────────────────────────────────
  if (acao === "upload") {
    const fileName = typeof corpo.fileName === "string" ? corpo.fileName : "";
    const contentType = texto(corpo.contentType).toLowerCase();
    const size =
      typeof corpo.size === "number" && Number.isFinite(corpo.size) ? corpo.size : -1;
    const ehCapa = corpo.capa === true;

    const aceitos: readonly string[] = ehCapa ? TIPOS_DA_CAPA : [TIPO_DO_ANEXO];
    if (!aceitos.includes(contentType)) {
      return NextResponse.json(
        {
          error: ehCapa
            ? "A capa aceita PDF, JPG ou PNG."
            : "O anexo do contrato tem de ser PDF: ele entra no documento como pagina pronta.",
        },
        { status: 415 },
      );
    }
    if (size < 0 || size > LIMITE_ANEXO_BYTES) {
      return NextResponse.json({ error: MENSAGEM_DOCUMENTO_GRANDE }, { status: 413 });
    }

    const prefixo = ehCapa ? PREFIXO_CAPA : PREFIXO_ANEXO;
    const caminho = `${prefixo}${alcance.pasta}/${crypto.randomUUID()}-${sanitizarNomeDeAnexo(fileName)}`;
    const assinada = await admin.storage
      .from(APOLO_DOCS_BUCKET)
      .createSignedUploadUrl(caminho);

    if (assinada.error || !assinada.data) {
      console.warn("[temis/anexos] createSignedUploadUrl falhou:", assinada.error?.message);
      return NextResponse.json(
        { error: "Nao foi possivel preparar o envio do arquivo." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { bucket: APOLO_DOCS_BUCKET, path: assinada.data.path, token: assinada.data.token },
      { headers: SEM_CACHE },
    );
  }

  // ── PASSO 2: o registro, depois que o arquivo já está no bucket ───────────
  if (acao === "confirmar") {
    const path = texto(corpo.path);
    const nome = texto(corpo.nome);
    const posicao = typeof corpo.posicao === "number" ? corpo.posicao : Number(corpo.posicao);

    if (!caminhoDeAnexoValido(path)) {
      return NextResponse.json({ error: "Caminho invalido." }, { status: 400 });
    }
    if (!nome) {
      return NextResponse.json(
        { error: "De um nome ao anexo: ele vira o titulo da linha no contrato." },
        { status: 400 },
      );
    }
    if (!posicaoValida(posicao)) {
      return NextResponse.json(
        { error: "A posicao vai de 1 a 99, e e ela que o texto cita como [anexo_N]." },
        { status: 400 },
      );
    }

    // Tamanho REAL do objeto. A trava do cliente pode ser burlada; esta não.
    const bucket = admin.storage.from(APOLO_DOCS_BUCKET);
    const info = await bucket.info(path);
    if (info.error || !info.data) {
      return NextResponse.json(
        { error: "Arquivo enviado nao foi encontrado no armazenamento." },
        { status: 404 },
      );
    }
    const tamanho = typeof info.data.size === "number" ? info.data.size : -1;
    if (tamanho > LIMITE_ANEXO_BYTES) {
      await bucket.remove([path]);
      return NextResponse.json({ error: MENSAGEM_DOCUMENTO_GRANDE }, { status: 413 });
    }

    const { data, error } = await admin
      .from("temis_anexos")
      .insert({
        ...alcance.campos,
        arquivo_bytes: tamanho > 0 ? tamanho : null,
        arquivo_mime: typeof info.data.contentType === "string" ? info.data.contentType : null,
        arquivo_nome: path.slice(path.lastIndexOf("/") + 1).replace(/^[0-9a-f-]{36}-/i, ""),
        criado_por: auth.userId ?? null,
        nome,
        posicao,
        storage_path: path,
      })
      .select(COLUNAS)
      .single<LinhaDoBanco>();

    if (error) {
      // ⚠️ 23505 É A TRAVA DA POSIÇÃO, e a mensagem precisa dizer isso em vez de "erro ao gravar":
      // o operador tem de saber que a posição já está ocupada NAQUELE alcance, e que trocar a peça
      // é desativar a antiga primeiro. Os índices únicos são por nível (0156).
      const ocupada = error.code === "23505";
      if (ocupada) await bucket.remove([path]);
      console.warn("[temis/anexos] insert falhou:", error.message);
      return NextResponse.json(
        {
          error: ocupada
            ? `A posicao ${posicao} ja esta ocupada neste alcance. Desative o anexo que esta la antes de por outro.`
            : "Nao foi possivel gravar o anexo.",
        },
        { status: ocupada ? 409 : 500 },
      );
    }

    return NextResponse.json({ anexo: paraATela(data) }, { headers: SEM_CACHE });
  }

  return NextResponse.json({ error: "Acao desconhecida." }, { status: 400 });
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Informe o anexo." }, { status: 400 });

  const { error } = await admin
    .from("temis_anexos")
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.warn("[temis/anexos] desativar falhou:", error.message);
    return NextResponse.json({ error: "Nao foi possivel desativar o anexo." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}
