import { NextResponse } from "next/server";

import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient, hashIdentifier } from "@/lib/apolo/server";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import {
  agruparPorProtocolo,
  caminhoDaUnidadeValido,
  conferirArquivo,
  type DocumentoDaVenda,
  nomeSeguroDeArquivo,
  prefixoDaUnidade,
  TAMANHO_MAXIMO,
  TAMANHO_MAXIMO_ESCRITO,
} from "@/lib/hercules/documentos-da-venda";

// OS DOCUMENTOS DE UMA VENDA — listar e receber.
//
// Lucas (06/09/2026): *"documentos é para transitar documentos referente àquela reserva, proposta
// de forma segura e formalizada (...) os documentos têm que ser agrupados por protocolo, código"*.
//
// ⚠️ O ESCOPO É CONFERIDO PELA UNIDADE, contra `idsDaSessao` — nunca pelo corpo. É a mesma regra
// das irmãs: unidade fora do escopo responde 404, e não 403, para o erro não virar oráculo de
// "existe, mas não é sua".
//
// ⚠️ O LINK DE LEITURA É ASSINADO NA HORA E NÃO SE GUARDA. Guardar a URL assinada na tabela faria o
// documento nascer com um endereço que expira — e um link expirado guardado é pior que link
// nenhum: ele parece funcionar até alguém clicar. O que fica gravado é o CAMINHO no bucket, e a
// pasta é a da UNIDADE (`prefixoDaUnidade`, na lib): o protocolo pode nascer entre assinar e
// registrar, e quem agrupa é a coluna.
//
// ⚠️ NADA SE APAGA AQUI. Documento formalizado existe para ser lido depois, inclusive contra quem o
// subiu. A tabela tem `removido_em` para quando isso for preciso, e vai exigir uma rota própria com
// motivo — não um DELETE que qualquer clique alcança.
//
// ⚠️ O ENVIO É EM DUAS ETAPAS, E O ARQUIVO NÃO PASSA POR AQUI. `preparar` assina a permissão de
// gravar um caminho (requisição minúscula), o navegador grava os bytes DIRETO no Storage, e
// `registrar` confere e vira linha. A primeira versão recebia multipart e por isso vivia debaixo do
// teto de 4,5 MB do corpo de uma função da Vercel — um limite de plataforma que eu tinha
// transformado em regra de produto, recusando boleto e contrato escaneado com uma frase nossa. O
// caminho certo já roda neste mesmo portal, com este mesmo cookie, na aba do LSoft.
//
// ⚠️ E O DOCUMENTO GUARDA O ELO COM O APOLO (Lucas: *"esses documentos também têm que existir no
// apolo"*). Os bytes já vivem no bucket `apolo-documents`; o que faltava era a ficha do cliente
// poder achá-los. Por isso a linha grava `cliente_entity_id` e `cliente_documento` — a entidade
// quando a proposta já existe, o CPF do titular quando só há reserva. O Apolo LÊ desta tabela; não
// há cópia de linha lá (ver a 0136 para os três motivos medidos).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const WORKSPACE = "careli";
/** Quanto tempo o link de leitura vale. Curto: ele é para abrir agora, não para colar num e-mail. */
const VALIDADE_DO_LINK = 60 * 10;

/** A unidade, conferida contra o escopo da sessão. `null` quando não é dele (ou não existe). */
async function unidadeDoEscopo(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  sessao: Parameters<typeof idsDaSessao>[0],
  unidadeId: string,
) {
  const permitidos = new Set(await idsDaSessao(sessao));
  const { data } = await admin
    .from("hercules_unidades")
    .select("id,enterprise_id")
    .eq("workspace_id", WORKSPACE)
    .eq("id", unidadeId)
    .maybeSingle();

  const unidade = data as null | { enterprise_id: string; id: string };
  if (!unidade || !permitidos.has(String(unidade.enterprise_id))) return null;
  return unidade;
}

/**
 * A venda viva do lote — de onde saem o protocolo e o empreendimento do documento.
 *
 * ⚠️ A RESERVA CONTA TAMBÉM, e não só a proposta: o documento chega antes de a venda virar
 * proposta (é justamente o RG que se pede para abrir a CAD). Sem olhar a reserva, tudo o que
 * chegasse nessa fase cairia no grupo "sem protocolo" e o agrupamento perderia a razão de existir.
 */
async function vendaDoLote(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  unidadeId: string,
) {
  const { data: daProposta } = await admin
    .from("hercules_propostas")
    .select("id,protocolo_numero,empreendimento_codigo,cliente_entity_id,cliente_documento")
    .eq("workspace_id", WORKSPACE)
    .eq("unidade_id", unidadeId)
    .eq("origem", "panteon")
    .is("cancelada_em", null)
    .in("etapa", ["assinatura", "contrato", "faturado", "proposta"])
    .order("etapa_desde", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proposta = daProposta as null | {
    cliente_documento: null | string;
    cliente_entity_id: null | string;
    // (o CPF vira hash antes de ser gravado — ver `hashDoCpf` abaixo)
    empreendimento_codigo: null | string;
    id: string;
    protocolo_numero: null | number;
  };
  if (proposta) {
    return {
      // ⚠️ A ENTIDADE VEM DA PROPOSTA, E NÃO DE UMA BUSCA POR CPF. `cliente_entity_id` é a CAD que
      // DECIDIU o credenciamento; um CPF pode resolver para várias entidades (fichas duplicadas
      // existem, e há migration escrita para mesclá-las), e "a primeira" poria o documento na ficha
      // errada.
      clienteDocumentoHash: hashDoCpf(proposta.cliente_documento),
      clienteEntityId: proposta.cliente_entity_id,
      empreendimentoCodigo: proposta.empreendimento_codigo,
      propostaId: proposta.id,
      protocolo: proposta.protocolo_numero,
      reservaId: null as null | string,
    };
  }

  const { data: daReserva } = await admin
    .from("hercules_reservas")
    .select("id,protocolo_numero,proponentes")
    .eq("workspace_id", WORKSPACE)
    .eq("unidade_id", unidadeId)
    .eq("situacao", "ativa")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const reserva = daReserva as null | {
    id: string;
    proponentes: unknown;
    protocolo_numero: null | number;
  };
  // ⚠️ NA RESERVA SÓ HÁ O CPF, e é o suficiente: o leitor do Apolo casa pela entidade OU pelo
  // documento. Sem isto, o RG que se pede para abrir a CAD ficaria invisível na ficha do cliente
  // até a proposta nascer — e ninguém entenderia por quê.
  const lista = Array.isArray(reserva?.proponentes) ? reserva.proponentes : [];
  const primeiro = lista[0] as null | undefined | { cpf?: unknown };
  const cpf = typeof primeiro?.cpf === "string" ? primeiro.cpf.replace(/\D/g, "") : "";

  return {
    clienteDocumentoHash: hashDoCpf(cpf),
    clienteEntityId: null as null | string,
    empreendimentoCodigo: null,
    propostaId: null as null | string,
    protocolo: reserva?.protocolo_numero ?? null,
    reservaId: reserva?.id ?? null,
  };
}

export async function GET(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const url = new URL(request.url);
  const unidadeId = (url.searchParams.get("unidade") ?? "").trim();
  const baixar = (url.searchParams.get("baixar") ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Unidade não informada." }, { status: 400 });
  }

  try {
    const unidade = await unidadeDoEscopo(admin, auth.sessao, unidadeId);
    if (!unidade) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ── ABRIR UM DOCUMENTO ────────────────────────────────────────────────
    //
    // ⚠️ O ID VEM COM A UNIDADE, e a consulta exige as duas: sem isso, um id adivinhado abriria o
    // documento de qualquer venda da casa, porque o escopo foi conferido pela unidade e não pelo
    // arquivo.
    if (baixar) {
      const { data: linha, error } = await admin
        .from("hercules_documentos")
        .select("caminho,nome")
        .eq("workspace_id", WORKSPACE)
        .eq("id", baixar)
        .eq("unidade_id", unidade.id)
        .is("removido_em", null)
        .maybeSingle();

      if (error) throw new Error(error.message);
      const doc = linha as null | { caminho: string; nome: string };
      if (!doc) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });

      const assinada = await admin.storage
        .from(APOLO_DOCS_BUCKET)
        .createSignedUrl(doc.caminho, VALIDADE_DO_LINK, { download: doc.nome });

      const link = assinada.data?.signedUrl;
      if (!link) {
        return NextResponse.json({ error: "Não foi possível abrir o documento." }, { status: 503 });
      }
      return NextResponse.json({ data: { nome: doc.nome, url: link } });
    }

    const { data, error } = await admin
      .from("hercules_documentos")
      .select(
        "id,protocolo_numero,tipo,nome,mime,tamanho_bytes,enviado_por_nome,observacao,criado_em",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .is("removido_em", null)
      .order("criado_em", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    return NextResponse.json(
      { data: { grupos: agruparPorProtocolo((data ?? []) as DocumentoDaVenda[], codigoDaVenda) } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    console.error("[hercules][documentos] falha ao listar", erro);
    return NextResponse.json({ error: "Não foi possível carregar os documentos." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: {
    acao?: unknown;
    caminho?: unknown;
    nome?: unknown;
    observacao?: unknown;
    /** Só o `preparar` usa: no `registrar` quem mede é o Storage. */
    tamanho?: unknown;
    tipoDoArquivo?: unknown;
    unidadeId?: unknown;
  };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const unidadeId = String(corpo.unidadeId ?? "").trim();
  const nome = String(corpo.nome ?? "").trim();
  if (!unidadeId) return NextResponse.json({ error: "Unidade não informada." }, { status: 400 });

  try {
    const unidade = await unidadeDoEscopo(admin, auth.sessao, unidadeId);
    if (!unidade) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ── 1. ASSINAR ────────────────────────────────────────────────────────
    if (corpo.acao === "preparar") {
      const tamanho = Number(corpo.tamanho);
      const conferido = conferirArquivo({ nome, tamanho });
      if (!conferido.ok) {
        return NextResponse.json({ error: conferido.motivo }, { status: 422 });
      }

      // ⚠️ O TAMANHO É CONFERIDO ANTES DE ASSINAR, e o número vem do navegador. O bucket não tem
      // teto próprio: sem esta linha, um arquivo grande subiria inteiro e só seria recusado no
      // registro — e o objeto ficaria no bucket sem nenhuma linha apontando para ele, pago para
      // sempre. O registro confere de novo, porque o número do cliente pode mentir; esta checagem
      // resolve o caso honesto, que é o que acontece de verdade.
      const caminho = `${prefixoDaUnidade(unidade.id)}${crypto.randomUUID()}-${nomeSeguroDeArquivo(nome)}`;
      const assinada = await admin.storage.from(APOLO_DOCS_BUCKET).createSignedUploadUrl(caminho);
      if (assinada.error || !assinada.data) {
        throw new Error(assinada.error?.message ?? "não foi possível preparar o envio");
      }

      return NextResponse.json({
        data: {
          bucket: APOLO_DOCS_BUCKET,
          caminho: assinada.data.path,
          token: assinada.data.token,
        },
      });
    }

    // ── 2. REGISTRAR ──────────────────────────────────────────────────────
    const caminho = String(corpo.caminho ?? "").trim();
    if (!caminho) return NextResponse.json({ error: "Envio incompleto." }, { status: 422 });

    // ⚠️ O CAMINHO VOLTOU DO NAVEGADOR: sem esta conferência, um caminho forjado registraria nesta
    // venda um arquivo da pasta de outra — e a abertura confia na LINHA, entregando o documento
    // errado com cara de certo.
    if (!caminhoDaUnidadeValido(caminho, unidade.id)) {
      return NextResponse.json({ error: "Caminho do arquivo inválido." }, { status: 422 });
    }

    // ⚠️ O `.info()` É A PROVA DE QUE O ARQUIVO EXISTE, e não só a medida do tamanho. A primeira
    // versão caía no número que o NAVEGADOR declarou quando ele falhava — e aí um POST direto com
    // `acao: "registrar"`, um caminho inventado dentro da própria pasta e `tamanho: 1` criava a
    // linha SEM upload nenhum: um cartão "Distrato assinado.pdf" na aba, com autor e hora, que abre
    // em 503 mas que quem audita lê como documento existente. Sem `size` numérico não há registro.
    //
    // ⚠️ E O TETO DE 20 MB DEPENDE DELE. O bucket não tem limite próprio (conferido:
    // `file_size_limit` nulo), então esta é a única cobrança de tamanho que existe — aceitar o
    // número do cliente a tornava decorativa.
    const info = await admin.storage.from(APOLO_DOCS_BUCKET).info(caminho);
    const tamanho = !info.error && typeof info.data?.size === "number" ? info.data.size : -1;
    if (tamanho < 0) {
      return NextResponse.json(
        { error: "O arquivo não foi encontrado no armazenamento. Tente enviar de novo." },
        { status: 422 },
      );
    }
    if (tamanho > TAMANHO_MAXIMO) {
      await admin.storage.from(APOLO_DOCS_BUCKET).remove([caminho]);
      return NextResponse.json(
        { error: `Cada documento pode ter até ${TAMANHO_MAXIMO_ESCRITO}.` },
        { status: 422 },
      );
    }

    // ⚠️ A VENDA É LIDA AGORA, e não na assinatura: entre um passo e outro a reserva pode ter
    // virado proposta, e é o protocolo DESTE instante que agrupa o documento.
    const venda = await vendaDoLote(admin, unidade.id);
    const observacao = String(corpo.observacao ?? "").trim().slice(0, 500);

    const { data: criado, error } = await admin
      .from("hercules_documentos")
      .insert({
        caminho,
        cliente_documento_hash: venda.clienteDocumentoHash,
        cliente_entity_id: venda.clienteEntityId,
        empreendimento_codigo: venda.empreendimentoCodigo,
        enviado_por: auth.sessao.usuarioId ?? null,
        enviado_por_nome: auth.sessao.usuarioNome ?? null,
        mime: typeof corpo.tipoDoArquivo === "string" ? corpo.tipoDoArquivo.slice(0, 120) : null,
        nome: nome.slice(0, 200) || "arquivo",
        observacao: observacao || null,
        proposta_id: venda.propostaId,
        protocolo_numero: venda.protocolo,
        reserva_id: venda.reservaId,
        tamanho_bytes: tamanho,
        tipo: "documento",
        unidade_id: unidade.id,
        workspace_id: WORKSPACE,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // ⚠️ O ARQUIVO SAI JUNTO QUANDO A LINHA NÃO ENTRA. Objeto no bucket sem linha na tabela é um
      // documento que ninguém encontra e ninguém apaga — e conta como armazenamento pago para
      // sempre.
      await admin.storage.from(APOLO_DOCS_BUCKET).remove([caminho]);
      throw new Error(error.message);
    }

    return NextResponse.json({
      data: { codigo: codigoDaVenda(venda.protocolo) || null, id: (criado as { id: string }).id },
    });
  } catch (erro) {
    console.error("[hercules][documentos] falha ao guardar", erro);
    return NextResponse.json({ error: "Não foi possível guardar o documento." }, { status: 503 });
  }
}

/**
 * O CPF do cliente como o Apolo o guarda: HASH, nunca texto.
 *
 * ⚠️ O APOLO NÃO TEM CPF EM TEXTO PARA CASAR. `apolo_entities` guarda `document_hash` e
 * `document_masked` — não existe coluna com os dígitos. Guardar o CPF puro aqui daria um campo que
 * nunca casaria com nada do outro lado (e ainda seria dado sensível a mais numa tabela nova). O
 * hash é o mesmo de `hashIdentifier("cpf", ...)`, que é a chave que o dedup da casa já usa.
 */
function hashDoCpf(bruto: null | string): null | string {
  const digitos = String(bruto ?? "").replace(/\D/g, "");
  return digitos.length >= 11 ? hashIdentifier("cpf", digitos) : null;
}
