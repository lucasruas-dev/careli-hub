import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { analiseDoTrabalho } from "@/lib/temis/analise-do-trabalho";
import { contratosDaProposta } from "@/lib/temis/contrato-guardado-db";
import {
  autorizarEmissaoDeContrato,
  autorizarLeituraDeContrato,
} from "@/lib/temis/autorizacao";
import { nomeDaEtapaGravada } from "@/lib/temis/historico-de-etapas";
import { conferirIndeferimento } from "@/lib/temis/indeferimento";
import { registrarPassagemDeEtapa } from "@/lib/temis/passagem-de-etapa-db";

// A TELA DE TRABALHO DE UM CARD — o que abre quando o operador clica no quadro.
//
// Lucas (09/09/2026): *"ao clicar no card abrisse uma tela de trabalho. primeiro, na primeira
// etapa, acho que deveria trazer os dados dos proponentes, imobiliaria, a proposta"*.
//
// ⚠️ LER É LEITURA, DECIDIR É COORDENAÇÃO. O GET usa `autorizarLeituraDeContrato` (a mesma régua
// de quem abre um contrato já gerado); o POST usa `autorizarEmissaoDeContrato`, que é o recorte
// estreito da coordenação — as duas ações que ele expõe (indeferir e devolver para correção)
// mexem no caminho do trabalho e devolvem o processo a quem vendeu, então não são ato de quem só
// consulta.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// `dadosDaProposta` faz ~10 consultas ao Supabase. Folga para o pior caso.
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Informe o trabalho." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { data: card, error } = await sb
    .from("temis_trabalhos")
    .select(
      // ⚠️ OS NOMES SÃO `enterprise_*` E `cliente_cpf`, conferidos no schema. A primeira versão
      // pediu `empreendimento_codigo`, `empreendimento_nome` e `cliente_documento` — nomes que não
      // existem —, e o PostgREST devolveu erro para a linha inteira: a tela abria dizendo "Nao foi
      // possivel abrir" sem dizer por quê. O `select` é string, então o typecheck não alcança;
      // quem confere é o schema.
      // ⚠️ `observacao` É O PEDIDO INTEIRO, e faltava. Num cancelamento ela guarda o motivo, o
      // COD do contrato, o que o sistema apurou sobre assinatura e pagamento e a classificação
      // que decidiu entre cancelamento e distrato. Sem ela a etapa 1 mostrava a proposta
      // comercial da venda e mais nada — Lucas (10/09/2026): *"faltou o motivo do cancelamento
      // e eu preciso saber o que é, quando abro a tela eu não identifiquei que era um
      // cancelamento"*.
      "id, tipo, estagio, estagio_desde, proposta_id, cliente_nome, cliente_cpf, unidade, enterprise_codigo, enterprise_nome, indeferido_em, indeferido_motivo, indeferido_observacao, indeferido_por_nome, arrependimento_inicio, observacao",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[temis][trabalho] falha ao ler o card", error);
    // ⚠️ A MENSAGEM DO BANCO VAI JUNTO. Esta rota é interna (só coordenação chega nela), e uma
    // frase muda como "Nao foi possivel abrir" custou uma investigação inteira: o erro real era
    // nome de coluna errado, e a tela não tinha como dizer isso.
    return NextResponse.json(
      { error: `Não foi possível abrir: ${error.message}` },
      { status: 503 },
    );
  }
  if (!card) return NextResponse.json({ error: "Trabalho nao encontrado." }, { status: 404 });

  // ⚠️ CARD SEM PROPOSTA NÃO É ERRO. Os quatro cards antigos (Garden e Lavra) nasceram antes da
  // migration 0134 e têm `proposta_id` nulo: a tela abre com o cabeçalho e diz que não há venda
  // ligada, em vez de mostrar blocos vazios como se fosse cadastro incompleto.
  // A análise e os contratos vão juntos: a etapa 1 usa a primeira, a etapa 2 a segunda, e a tela
  // troca de painel sem ir buscar de novo.
  const [analise, contratos] = card.proposta_id
    ? await Promise.all([
        analiseDoTrabalho(sb, String(card.proposta_id)).catch((e: unknown) => {
          console.error("[temis][trabalho] falha ao montar a analise", e);
          return null;
        }),
        contratosDaProposta(sb, String(card.proposta_id)).catch((e: unknown) => {
          console.error("[temis][trabalho] falha ao ler os contratos", e);
          return [];
        }),
      ])
    : [null, []];

  // ⚠️ SEM ISTO, O PAINEL DE ASSINATURA NASCE MOSTRANDO ERRO PARA QUEM SÓ LÊ. Este GET autoriza
  // com a régua de LEITURA; o preparo da assinatura, com a da EMISSÃO. Enquanto o preparo só era
  // buscado no clique do botão, a diferença não aparecia — com o painel inline na etapa Contrato,
  // todo leitor que abrir um card dispara uma chamada de coordenação e recebe a recusa na cara,
  // sem ter feito nada.
  //
  // ⚠️ E É UMA SEGUNDA CHECAGEM, NÃO UMA SEGUNDA TRAVA: quem fecha a porta continua sendo cada
  // rota de escrita. Aqui só se decide o que a tela pode oferecer. O molde é
  // `/api/temis/contrato/previa` (linha 73), que já faz exatamente isto.
  const podeEmitir = (await autorizarEmissaoDeContrato(request)).ok;

  return NextResponse.json(
    { data: { analise, card: { ...card, contratos }, podeEmitir } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** O que as duas decisões precisam saber do card antes de mexer nele. */
type CardDaDecisao = {
  estagio: string;
  id: string;
  proposta_id: null | string;
  tipo: string;
};

/**
 * AS DUAS DECISÕES DA COORDENAÇÃO SOBRE UM CARD.
 *
 * `indeferir` — a Têmis recusa o trabalho e devolve a quem vendeu.
 *
 * ⚠️ NÃO É REPROVA DE CRÉDITO (Lucas, 10/09/2026: *"credito? não tem credito na temis"*). Crédito
 * mora no Apolo. Aqui se recusa o TRABALHO: falta documento, dado divergente, condição que não
 * confere.
 *
 * ⚠️ O AVISO PARA CORRETOR E IMOBILIÁRIA AINDA NÃO SAI DAQUI. Lucas pediu que o indeferimento
 * chegue neles pela central de Relacionamento, e no coordenador dentro do Panteon. Esta rota
 * GRAVA a decisão com motivo; o disparo entra em seguida, e é por isso que o motivo já é
 * obrigatório no banco: sem ele, a mensagem sairia dizendo "recusado" e nada mais.
 *
 * `voltar_para_analise` — o contrato volta uma etapa para ser corrigido. Lucas (11/09/2026), sobre
 * a etapa de organizar as assinaturas: *"caso queira fazer algum ajuste no contrato, podemos ter um
 * botão para voltar o contrato a etapa anterior, corrigir e mandar para assinatura"*.
 *
 * ⚠️ AÇÃO AUSENTE É `indeferir`, e isso é compatibilidade deliberada: a tela de hoje manda
 * `{ id, motivo, observacao }` sem `acao` nenhuma, e ela continua funcionando igual até ser
 * atualizada. O dia em que ninguém mais mandar sem `acao`, o padrão pode cair.
 */
export async function POST(request: Request) {
  const auth = await autorizarEmissaoDeContrato(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => ({}))) as {
    acao?: string;
    id?: string;
    motivo?: string;
    observacao?: string;
  };

  const id = String(corpo.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Informe o trabalho." }, { status: 400 });

  const acao = String(corpo.acao ?? "").trim() || "indeferir";
  if (acao !== "indeferir" && acao !== "voltar_para_analise") {
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  // ⚠️ LER ANTES DE ESCREVER, E NÃO SÓ PARA A REGRA DE "VOLTAR". O estágio de ONDE o card sai é o
  // que o histórico grava — e ele deixa de existir no banco no instante do `update`, porque
  // `temis_trabalhos.estagio` guarda só o presente. Sem esta leitura a passagem nasceria sem
  // origem, e `de` nulo significa "card recém-aberto" (migration 0153), que seria mentira.
  const { data: card, error: erroDaLeitura } = await sb
    .from("temis_trabalhos")
    .select("estagio, id, proposta_id, tipo")
    .eq("id", id)
    .maybeSingle<CardDaDecisao>();

  if (erroDaLeitura) {
    console.error("[temis][trabalho] falha ao ler o card antes da decisão", erroDaLeitura);
    return NextResponse.json({ error: "Nao foi possivel abrir o trabalho." }, { status: 503 });
  }
  if (!card) return NextResponse.json({ error: "Trabalho nao encontrado." }, { status: 404 });

  const quemNome = await nomeDeQuemClicou(sb, auth.userId);

  if (acao === "voltar_para_analise") {
    return voltarParaAnalise(sb, {
      card,
      observacao: String(corpo.observacao ?? "").trim() || null,
      quem: auth.userId,
      quemNome,
    });
  }

  return indeferir(sb, {
    card,
    motivo: String(corpo.motivo ?? ""),
    observacao: String(corpo.observacao ?? ""),
    quem: auth.userId,
    quemNome,
  });
}

/**
 * O NOME DE QUEM CLICOU — acessório, e por isso nunca derruba a ação.
 *
 * ⚠️ Mesmo desenho de `nomeDoUsuario` em `/api/temis/contrato/gerar`: falha na leitura vira `null`,
 * e o registro sai sem o nome em vez de não sair.
 *
 * ⚠️ `try/catch`, E NÃO `.catch()`: o builder do Supabase é um `PromiseLike`, não uma Promise — ele
 * tem `.then` mas não `.catch`, e o typecheck pega isso.
 */
async function nomeDeQuemClicou(
  sb: SupabaseClient,
  userId: string,
): Promise<null | string> {
  try {
    const r = await sb
      .from("hub_users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle<{ display_name: null | string }>();
    return r.data?.display_name ?? null;
  } catch {
    return null;
  }
}

async function indeferir(
  sb: SupabaseClient,
  decisao: {
    card: CardDaDecisao;
    motivo: string;
    observacao: string;
    quem: string;
    quemNome: null | string;
  },
): Promise<NextResponse> {
  const conferido = conferirIndeferimento({
    motivo: decisao.motivo,
    observacao: decisao.observacao,
  });
  if (!conferido.ok) {
    return NextResponse.json({ error: conferido.erro }, { status: 400 });
  }

  const agora = new Date().toISOString();
  const { data: mexidos, error } = await sb
    .from("temis_trabalhos")
    .update({
      atualizado_em: agora,
      estagio: "indeferido",
      // ⚠️ `estagio_desde` ANDA AQUI, e isso é diferente da tradução de nomes da migration 0150.
      // Indeferir é um movimento de verdade: o card entra numa situação nova, e o relógio dessa
      // situação começa agora.
      estagio_desde: agora,
      indeferido_em: agora,
      indeferido_motivo: conferido.motivo,
      indeferido_observacao: conferido.observacao,
      indeferido_por: decisao.quem,
      indeferido_por_nome: decisao.quemNome,
    })
    .eq("id", decisao.card.id)
    // Faturado é o fim: um contrato que já virou venda não volta para indeferido.
    .neq("estagio", "faturado")
    // ⚠️ O `.select()` EXISTE PARA SABER SE PEGOU ALGUMA LINHA. Sem ele, o `update` que o `.neq`
    // barra volta sem erro e sem linha — a rota respondia `ok` e a tela dizia "indeferido" sobre um
    // card faturado que não se moveu. Pior, o histórico gravaria a passagem que não aconteceu.
    .select("id");

  if (error) {
    console.error("[temis][trabalho] falha ao indeferir", error);
    return NextResponse.json({ error: "Nao foi possivel indeferir." }, { status: 503 });
  }

  if (!mexidos || mexidos.length === 0) {
    return NextResponse.json(
      { error: "Este trabalho já foi faturado e não pode ser indeferido." },
      { status: 409 },
    );
  }

  await registrarPassagemDeEtapa(sb, {
    de: decisao.card.estagio,
    motivo: conferido.motivo,
    observacao: conferido.observacao,
    origem: "indeferimento",
    para: "indeferido",
    propostaId: decisao.card.proposta_id,
    quem: decisao.quem,
    quemNome: decisao.quemNome,
    trabalhoId: decisao.card.id,
    trabalhoTipo: decisao.card.tipo,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * DEVOLVER O CONTRATO PARA A ANÁLISE, para corrigir e mandar de novo.
 *
 * ⚠️ SÓ DE "CONTRATO" PARA TRÁS, e a leitura é feita antes justamente para recusar em português em
 * vez de deixar o `update` não pegar linha nenhuma e responder "pronto". Um card em assinatura não
 * volta por aqui: o envelope já existe na Clicksign e cobrando, e desfazer isso é outra conversa,
 * com outro botão.
 *
 * ⚠️ `estagio_desde` ANDA AQUI, E É A ÚNICA VEZ EM QUE ELE ANDA PARA TRÁS NO MÓDULO. A regra da
 * casa é que ele não volta quando só o RÓTULO da etapa muda (migration 0150) — ali um card que
 * estava em Confecção há seis dias continua há seis dias em Contrato. Aqui é o contrário: o card
 * REENTROU na análise, de verdade, e o prazo daquela etapa recomeça agora. Deixar o carimbo velho
 * faria a análise nascer atrasada de dias que ela não teve, e o quadro cobraria do analista um
 * atraso que é da correção.
 *
 * ⚠️ O CONTRATO JÁ GERADO NÃO É APAGADO. Ele continua na lista de versões de `hercules_documentos`
 * (regra da 0136: versão não se apaga), e a próxima geração vira v+1 e aposenta a anterior sozinha
 * — quem decide qual vale é `contratoVigente`, sempre a mais nova. Apagar o PDF aqui destruiria a
 * prova do que foi enviado para conferência antes da correção.
 */
async function voltarParaAnalise(
  sb: SupabaseClient,
  decisao: {
    card: CardDaDecisao;
    observacao: null | string;
    quem: string;
    quemNome: null | string;
  },
): Promise<NextResponse> {
  if (decisao.card.estagio !== "contrato") {
    return NextResponse.json(
      {
        error: `Só dá para devolver para a análise um trabalho que está na etapa Contrato. Este está em "${nomeDaEtapaGravada(decisao.card.estagio, decisao.card.tipo)}".`,
      },
      { status: 409 },
    );
  }

  const agora = new Date().toISOString();
  const { data: mexidos, error } = await sb
    .from("temis_trabalhos")
    .update({
      atualizado_em: agora,
      estagio: "analise",
      estagio_desde: agora,
    })
    .eq("id", decisao.card.id)
    // ⚠️ O `.eq` NO ESTÁGIO É A COMPARAÇÃO-E-TROCA. Entre a leitura e esta linha alguém pode ter
    // mandado o mesmo contrato para assinatura; sem ele, o card voltaria para a análise com o
    // envelope já aberto na Clicksign. E o `.select()` é o que permite PERCEBER que isso
    // aconteceu: `update` que não pega linha nenhuma volta sem erro.
    .eq("estagio", "contrato")
    .select("id");

  if (error) {
    console.error("[temis][trabalho] falha ao devolver para a análise", error);
    return NextResponse.json(
      { error: "Nao foi possivel devolver para a analise." },
      { status: 503 },
    );
  }

  if (!mexidos || mexidos.length === 0) {
    return NextResponse.json(
      { error: "Este trabalho saiu da etapa Contrato enquanto a tela estava aberta. Abra de novo." },
      { status: 409 },
    );
  }

  await registrarPassagemDeEtapa(sb, {
    de: decisao.card.estagio,
    observacao: decisao.observacao,
    origem: "retorno_para_correcao",
    para: "analise",
    propostaId: decisao.card.proposta_id,
    quem: decisao.quem,
    quemNome: decisao.quemNome,
    trabalhoId: decisao.card.id,
    trabalhoTipo: decisao.card.tipo,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
