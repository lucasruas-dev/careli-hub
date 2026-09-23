import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { chaveDaLogo } from "@/lib/apolo/enterprise-logos";
import { montarCronograma } from "@/lib/hercules/cronograma";
import { abrirEspelho, ERRO_GENERICO } from "@/lib/hercules/espelho/abrir-espelho";
import { estadoDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import { pisoDeEntradaPublico, planosPublicos } from "@/lib/hercules/espelho/planos-publicos";
import { SEM_CACHE } from "@/lib/hercules/espelho/pecas-do-espelho";
import { valoresDaSimulacaoPublica } from "@/lib/hercules/espelho/simulacao-publica";
import {
  lerComColunasDoApartamento,
  nomeDaUnidade,
  tipoDaUnidade,
} from "@/lib/hercules/nome-da-unidade";
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
  /**
   * A data escolhida para cada parcela da entrada (`AAAA-MM-DD` ou nulo na posição).
   *
   * ⚠️ O CAMPO DE DATA APARECE JUNTO COM A MONTAGEM, e não some no modo simulação como o bloco
   * "Cobrança". Sem ele aqui, escolher "a segunda cai em janeiro" não mudava nada no papel.
   */
  entradaDatas?: (null | string)[];
  /**
   * Os valores das parcelas da entrada, quando o corretor as montou à mão na tela.
   *
   * ⚠️ O BOTÃO "MONTAR VALORES" EXISTE AQUI, e não só na Mesa de Venda: ele aparece no espelho
   * público sempre que a entrada tem mais de uma parcela. Sem este campo a folha saía com a divisão
   * igual, e quem montou 10.000 + 7.000 + 7.000 + 7.000 encaminhava um papel dizendo 4 × R$ 7.750.
   */
  entradaParcelas?: number[];
  entradaVezes?: number;
  parcelas?: number;
  plano?: string;
  /** O valor negociado na tela (o de tabela, com o ajuste que o corretor aplicou). */
  valor?: number;
};

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
  // ⚠️ SÓ OBJETO É CORPO (revisão de 18/09/2026). `null`, número ou lista são JSON válido, e com eles
  // `corpo.codigo` derrubava a rota com uma exceção não tratada (500). Fora de objeto, o corpo é
  // vazio, e a resposta é a mesma de quem não mandou o lote.
  const bruto: unknown = await request.json().catch(() => null);
  const corpo = (
    bruto !== null && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}
  ) as Corpo;

  const codigoDoLote = String(corpo.codigo ?? "").trim().toUpperCase();
  if (!codigoDoLote) {
    return NextResponse.json({ error: "Informe o lote." }, { status: 400 });
  }

  const ids = [paiC2xId, ...filhosC2xIds].filter(Boolean) as string[];

  // ⚠️ A UNIDADE VEM DO BANCO, e o que o cliente mandou serve só para ACHAR a linha. Área e
  // cidade impressas no papel saem daqui, nunca do corpo da requisição.
  //
  // ⚠️ E COM AS COLUNAS DO APARTAMENTO (revisão de 16/09/2026). Sem torre e apartamento a folha do
  // prédio saía com o código cru e falando em lote. `lerComColunasDoApartamento` repete a leitura
  // sem elas quando a 0171 ainda não foi aplicada, e aí não existe apartamento nenhum.
  const { data: unidade } = await lerComColunasDoApartamento((extras) =>
    client
      .from("hercules_unidades")
      .select(`area,codigo,lote,preco_tabela,quadra,situacao${extras}`)
      .in("enterprise_id", ids)
      .eq("codigo", codigoDoLote)
      .maybeSingle<{
        apartamento?: null | string;
        area: null | number | string;
        codigo: string;
        lote: null | string;
        preco_tabela: null | number | string;
        quadra: null | string;
        situacao: string;
        torre?: null | string;
      }>(),
  );

  if (!unidade) {
    return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });
  }

  // ⚠️ SÓ SE SIMULA O QUE ESTÁ À VENDA (18/09/2026). A tela só abre o simulador no lote verde, mas o
  // corpo da requisição se escreve à mão: sem esta conferência qualquer pessoa com o link baixava uma
  // folha com a marca da casa para um lote vendido ou reservado. A régua é a MESMA que pinta o
  // espelho (`estadoDoEspelho` → `situacaoDoLoteReal`: processo do Panteon primeiro, depois o
  // cadastro, e só o valor exato `disponivel` passa), e o preço é o que a tela mostra para o lote.
  // Falha de leitura é recusa: nunca "na dúvida, deixa".
  const loteNoEspelho = await estadoDoEspelho(client, {
    enterpriseIdDoPai: paiC2xId,
    enterpriseIdsDosFilhos: filhosC2xIds,
  })
    .then((estado) => estado.lotes.find((l) => l.codigo === codigoDoLote) ?? null)
    .catch((erro: unknown) => {
      console.error("[publico][espelho] situacao do lote para a simulacao", erro);
      return null;
    });
  if (!loteNoEspelho || loteNoEspelho.situacao !== "disponivel" || !loteNoEspelho.preco) {
    return NextResponse.json(
      { error: "Este lote não está disponível para simulação." },
      { status: 409 },
    );
  }

  const [planos, entradaMinimaPercentual] = await Promise.all([
    planosPublicos(client, ids),
    // O piso do empreendimento, o mesmo que a tela recebeu na rota da situação.
    pisoDeEntradaPublico(client, ids),
  ]);
  const plano = planos.find((p) => p.nome === corpo.plano) ?? planos[0];
  if (!plano) {
    return NextResponse.json(
      { error: "Este empreendimento ainda não tem planos cadastrados." },
      { status: 409 },
    );
  }

  // ⚠️ O PREÇO É O DO ESPELHO, E O CORPO SÓ ESCOLHE DENTRO DA RÉGUA DO PLANO ESCOLHIDO
  // (`valoresDaSimulacaoPublica`, revisão 3 de 18/09/2026): o valor nunca abaixo da tabela com o
  // desconto DESTE plano no prazo pedido (fora do prazo do plano, desconto zero) nem acima da tabela;
  // a entrada é a QUE ESTÁ NA TELA, inclusive zero (só a chave ausente cai na sugestão do plano),
  // com as parcelas montadas à mão quando elas fecham com ela; as anuais até uma por aniversário; a
  // entrada em no máximo `ENTRADA_VEZES_MAXIMA` vezes. Prazo além do plano é recusado com a frase.
  const precoDeTabela = loteNoEspelho.preco;
  const aceita = valoresDaSimulacaoPublica({
    anuaisPedidas: { quantidade: corpo.anuaisQuantidade, valor: corpo.anuaisValor },
    entradaMinimaPercentual,
    entradaDatasPedidas: corpo.entradaDatas,
    entradaParcelasPedidas: corpo.entradaParcelas,
    entradaPedida: corpo.entrada,
    entradaVezesPedidas: corpo.entradaVezes,
    parcelasPedidas: corpo.parcelas,
    plano,
    planos,
    precoDeTabela,
    valorPedido: corpo.valor,
  });
  if (!aceita.ok) {
    return NextResponse.json(
      { error: aceita.mensagem },
      { headers: { "Cache-Control": SEM_CACHE }, status: 422 },
    );
  }
  const { anuais, entrada, entradaDatas, entradaParcelas, entradaVezes, parcelas, valor } =
    aceita;

  // ⚠️ A COMPOSIÇÃO QUE NÃO FECHA É 422 COM A FRASE, E NÃO 503. `montarCronograma` quebra de
  // propósito quando entrada e anuais valem mais que o valor (um corpo com anual de R$ 400 mil, por
  // exemplo); é a mesma escolha da rota da proposta. O 503 diria "tente de novo" a um pedido que
  // nunca vai fechar.
  let cronograma: ReturnType<typeof montarCronograma>;
  try {
    cronograma = montarCronograma({
      anuaisQuantidade: anuais.quantidade,
      anuaisValor: anuais.valor,
      // O dia é só o que o cronograma precisa para agendar; a folha da simulação não anuncia
      // vencimento (ver `validadeEmIso` nulo abaixo).
      diaDeVencimento: 10,
      entradaValor: entrada,
      // Nulo aqui é a data calculada, uma a uma: só sobe o que alguém escolheu de fato.
      entradaDatas,
      // Nulo aqui é a divisão igual de sempre; a lista só chega quando FECHA com a entrada aceita
      // (`parcelasDaEntradaAceitas`), para o destaque da folha não brigar com o próprio fluxo.
      entradaParcelas,
      entradaVezes,
      parcelasMensais: parcelas,
      plano: { ...plano, slot: null },
      primeiraParcelaDaEntrada: new Date().toISOString().slice(0, 10),
      valorNegociado: valor,
    });
  } catch (erro) {
    // ⚠️ SÓ A FRASE DO MOTOR VAI AO VISITANTE. A recusa de `montarCronograma` é um `Error` com a
    // explicação para quem monta a condição; um `RangeError` ou `TypeError` é defeito interno (era o
    // "Invalid array length" que 1e10 vezes de entrada devolviam), e a mensagem dele não é do cliente.
    return NextResponse.json(
      {
        error:
          erro instanceof Error && erro.constructor === Error
            ? erro.message
            : "Estas condições não fecham uma simulação.",
      },
      { headers: { "Cache-Control": SEM_CACHE }, status: 422 },
    );
  }

  try {

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
      // ⚠️ A TABELA VAI SEMPRE QUE O VALOR FICOU ABAIXO DELA (18/09/2026): a folha diz "valor de
      // tabela" e "desconto" com o número de verdade. No espelho não há desconto à mão, então isso só
      // acontece no plano com desconto (o Investidor Parcelado do Garden) ou num corpo escrito à mão
      // que escolheu outro preço dentro da régua; nos outros empreendimentos a folha sai igual.
      precoDeTabela: valor < precoDeTabela ? precoDeTabela : null,
      // ⚠️ AQUI TAMBÉM, e não só no `montarPropostaPdf`: é `montarFolhaDaProposta` que escreve as
      // OBSERVAÇÕES do rodapé, e sem a bandeira elas continuavam falando em reajuste e proposta
      // numa folha que não tem nem um nem outro.
      simulacao: true,
      // O tipo decide só palavra na folha (tarja "a unidade", área privativa); a conta é a mesma.
      tipoProduto: tipoDaUnidade(unidade),
      unidade: {
        area: unidade.area === null ? null : Number(unidade.area),
        cidade: null,
        // A MESMA frase do WhatsApp e da proposta: "Quadra 03 · Lote 07" ou "Torre A · Apto 304".
        nome: nomeDaUnidade(unidade),
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
        // O nome do arquivo: empreendimento - quadra - lote, como o Lucas pediu (no prédio, torre e
        // apartamento).
        "Content-Disposition": `attachment; filename="${nomeDoArquivo(nome, unidade)}"`,
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

/**
 * `Veredas do Ouro - Quadra 07 - Lote 34.pdf`, sem o que quebra nome de arquivo. No prédio,
 * `Ed. Jade - Torre A - Apto 304.pdf`, pela mesma frase da folha.
 */
function nomeDoArquivo(
  empreendimento: string,
  unidade: Parameters<typeof nomeDaUnidade>[0],
): string {
  const partes =
    tipoDaUnidade(unidade) === "vertical"
      ? [empreendimento, nomeDaUnidade(unidade).replace(/ · /g, " - ")]
      : [
          empreendimento,
          unidade.quadra ? `Quadra ${unidade.quadra}` : null,
          unidade.lote ? `Lote ${unidade.lote}` : unidade.codigo,
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
