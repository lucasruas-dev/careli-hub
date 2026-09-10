import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { chaveDaLogo } from "@/lib/apolo/enterprise-logos";
import { montarCronograma } from "@/lib/hercules/cronograma";
import { abrirEspelho, ERRO_GENERICO } from "@/lib/hercules/espelho/abrir-espelho";
import { planosPublicos } from "@/lib/hercules/espelho/planos-publicos";
import { SEM_CACHE } from "@/lib/hercules/espelho/pecas-do-espelho";
import { montarPropostaPdf } from "@/lib/hercules/proposta-pdf";
import { montarFolhaDaProposta } from "@/lib/hercules/proposta-para-pdf";

// O PDF DA SIMULAÇÃO — a folha que o corretor encaminha ao cliente.
//
// Lucas (10/09/2026): *"monta um arquivo bonito, simulador de proposta, meio que parecido com a
// proposta mesmo, com a logo e tal"* · *"da uma caprichada"*.
//
// ⚠️ É O MESMO GERADOR DA PROPOSTA, e não um segundo desenho. `montarFolhaDaProposta` +
// `montarPropostaPdf` são as peças que produzem a proposta de verdade — A4, Helvetica, grafite
// com preto, logo do empreendimento no topo e a marca do C2X no rodapé. Uma segunda folha
// "parecida" divergiria da primeira no primeiro ajuste, e o cliente receberia dois documentos da
// mesma casa com aparências diferentes.
//
// ⚠️ E SAI COM A TARJA DE PRÉVIA (`previa: true`). O papel se denuncia: sem isso um PDF idêntico
// ao definitivo vira anexo de WhatsApp em dois toques, e do outro lado o cliente guarda como
// proposta um documento que não existe no sistema, com preço que ninguém reservou. A tarja é o
// que separa "simulei para você ver" de "está reservado".
//
// ⚠️ O SERVIDOR NÃO CONFIA NO PLANO QUE CHEGA. O corpo traz o NOME do plano; as condições (juros,
// índice, sistema, parcelas) são lidas de `temis_planos` aqui dentro. Aceitar juros do cliente
// deixaria qualquer um gerar uma folha com a marca da casa anunciando 0% ao mês.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Corpo = {
  anuaisQuantidade?: number;
  anuaisValor?: number;
  codigo?: string;
  entrada?: number;
  entradaVezes?: number;
  parcelas?: number;
  plano?: string;
  /** O valor negociado na tela (o de tabela, com o ajuste que o corretor aplicou). */
  valor?: number;
};

function inteiro(v: unknown, padrao: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : padrao;
}

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("e");
  const aberto = await abrirEspelho(token);

  if (!aberto.ok) {
    return NextResponse.json(
      { error: ERRO_GENERICO },
      { headers: { "Cache-Control": SEM_CACHE }, status: aberto.erro === "sem_token" ? 401 : 503 },
    );
  }

  const { client, filhosC2xIds, nome, paiC2xId } = aberto.espelho;
  const corpo = (await request.json().catch(() => ({}))) as Corpo;

  const codigoDoLote = String(corpo.codigo ?? "").trim().toUpperCase();
  if (!codigoDoLote) {
    return NextResponse.json({ error: "Informe o lote." }, { status: 400 });
  }

  const ids = [paiC2xId, ...filhosC2xIds].filter(Boolean) as string[];

  // ⚠️ A UNIDADE VEM DO BANCO, e o que o cliente mandou serve só para ACHAR a linha. Área e
  // cidade impressas no papel saem daqui, nunca do corpo da requisição.
  const { data: unidade } = await client
    .from("hercules_unidades")
    .select("area, codigo, lote, preco_tabela, quadra, situacao")
    .in("enterprise_id", ids)
    .eq("codigo", codigoDoLote)
    .maybeSingle<{
      area: null | number | string;
      codigo: string;
      lote: null | string;
      preco_tabela: null | number | string;
      quadra: null | string;
      situacao: string;
    }>();

  if (!unidade) {
    return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });
  }

  const planos = await planosPublicos(client, ids);
  const plano = planos.find((p) => p.nome === corpo.plano) ?? planos[0];
  if (!plano) {
    return NextResponse.json(
      { error: "Este empreendimento ainda não tem planos cadastrados." },
      { status: 409 },
    );
  }

  const precoDeTabela = Number(unidade.preco_tabela ?? 0);
  const valor = inteiro(corpo.valor, precoDeTabela) || precoDeTabela;
  const entrada = Math.min(valor, inteiro(corpo.entrada, 0));

  try {
    const cronograma = montarCronograma({
      anuaisQuantidade: inteiro(corpo.anuaisQuantidade, plano.anuaisQuantidade),
      anuaisValor: inteiro(corpo.anuaisValor, plano.anuaisValor),
      // O dia é só o que o cronograma precisa para agendar; a folha da simulação não anuncia
      // vencimento (ver `validadeEmIso` nulo abaixo).
      diaDeVencimento: 10,
      entradaValor: entrada,
      entradaVezes: Math.max(1, inteiro(corpo.entradaVezes, 1)),
      parcelasMensais: Math.max(1, inteiro(corpo.parcelas, plano.parcelas)),
      plano: { ...plano, slot: null },
      primeiraParcelaDaEntrada: new Date().toISOString().slice(0, 10),
      valorNegociado: valor,
    });

    const folha = montarFolhaDaProposta({
      // ⚠️ TUDO NULO NO ATENDIMENTO. A folha pública não sabe quem é o corretor — a página não tem
      // sessão —, e inventar um nome ali seria pior do que deixar em branco.
      atendimento: { coordenador: null, corretor: null, imobiliaria: null, telefone: null },
      // Não há venda, então não há COD. O código do lote é o que identifica a folha.
      codigo: unidade.codigo,
      // Simulação não tem comprador: ninguém foi qualificado, nada foi assinado.
      compradores: [],
      cronograma,
      diaDeVencimento: 10,
      emitidaEmIso: new Date().toISOString(),
      empreendimento: nome,
      logoC2x: logoDoC2x(),
      logoEmpreendimento: await logoDoEmpreendimento(client, paiC2xId),
      plano: { ...plano, slot: null },
      // ⚠️ AQUI TAMBÉM, e não só no `montarPropostaPdf`: é `montarFolhaDaProposta` que escreve as
      // OBSERVAÇÕES do rodapé, e sem a bandeira elas continuavam falando em reajuste e proposta
      // numa folha que não tem nem um nem outro.
      simulacao: true,
      unidade: {
        area: unidade.area === null ? null : Number(unidade.area),
        cidade: null,
        nome: unidade.quadra
          ? `Quadra ${unidade.quadra} · Lote ${unidade.lote ?? ""}`.trim()
          : unidade.codigo,
        uf: null,
      },
      // ⚠️ NULO DE PROPÓSITO: simulação não promete prazo. Com data, o papel diria "vale até",
      // que é exatamente o que uma simulação não faz.
      validadeEmIso: null,
      valorNegociado: valor,
    });

    // `simulacao` cuida do título, do código, dos compradores e da tarja — ver o tipo em
    // `proposta-pdf.ts`. `previa` sai: as duas tarjas juntas se sobreporiam no pé da folha.
    const pdf = await montarPropostaPdf(folha);

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Cache-Control": SEM_CACHE,
        // O nome do arquivo: empreendimento - quadra - lote, como o Lucas pediu.
        "Content-Disposition": `attachment; filename="${nomeDoArquivo(nome, unidade.quadra, unidade.lote, unidade.codigo)}"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    console.error("[publico][espelho] falha ao montar o PDF da simulacao", error);

    return NextResponse.json(
      { error: "Não foi possível montar a simulação agora." },
      { status: 503 },
    );
  }
}

/** `Veredas do Ouro - Quadra 07 - Lote 34.pdf`, sem o que quebra nome de arquivo. */
function nomeDoArquivo(
  empreendimento: string,
  quadra: null | string,
  lote: null | string,
  codigo: string,
): string {
  const partes = [
    empreendimento,
    quadra ? `Quadra ${quadra}` : null,
    lote ? `Lote ${lote}` : codigo,
  ].filter(Boolean);

  return `${partes.join(" - ").replace(/["*/:<>?\\|]/g, "-")}.pdf`;
}

/**
 * A marca do C2X do rodapé.
 *
 * ⚠️ `public/` NÃO VAI SOZINHO PARA O FILESYSTEM DA FUNÇÃO — o rastreador do Next só inclui o que
 * vê importado, e esta rota precisa entrar em `outputFileTracingIncludes` (next.config.ts), como a
 * da proposta já está. Falhar aqui NÃO derruba o PDF: ele aceita logo nula e sai sem a marca.
 */
function logoDoC2x(): null | Uint8Array {
  try {
    return new Uint8Array(
      fs.readFileSync(path.join(process.cwd(), "public", "c2x-logo.png")),
    );
  } catch {
    return null;
  }
}

/** A logo do empreendimento, do mesmo lugar em que o Apolo a guarda. */
async function logoDoEmpreendimento(
  client: Parameters<typeof planosPublicos>[0],
  enterpriseId: null | string,
): Promise<null | Uint8Array> {
  if (!enterpriseId) return null;
  try {
    const { data, error } = await client.storage
      .from(APOLO_DOCS_BUCKET)
      .download(`enterprise-logos/${chaveDaLogo(enterpriseId)}`);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}
