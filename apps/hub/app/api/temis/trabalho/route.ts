import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { type EnvelopeDaProposta, envelopeQueSegura } from "@/lib/assinatura/envio-db";
import type { EstadoDaAssinatura } from "@/lib/assinatura/tipos";
import { rotuloDoEstado } from "@/lib/assinatura/traduzir";
import { analiseDoTrabalho } from "@/lib/temis/analise-do-trabalho";
import { contratosDaProposta } from "@/lib/temis/contrato-guardado-db";
import {
  autorizarEmissaoDeContrato,
  autorizarLeituraDeContrato,
} from "@/lib/temis/autorizacao";
import { conferirIndeferimento } from "@/lib/temis/indeferimento";
import { registrarPassagemDeEtapa } from "@/lib/temis/passagem-de-etapa-db";
import { retornarParaAnalise } from "@/lib/temis/retorno-para-correcao";

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
//
// ⚠️ 60 PORQUE AGORA HÁ CHAMADA EXTERNA NO CAMINHO. O POST deixou de ser só banco: voltar um card
// de "em assinatura" CANCELA o envelope na Clicksign, e o cliente dela espera até 15 s por chamada
// (`lib/assinatura/clicksign/cliente.ts`). Com os 30 de antes, uma Clicksign lenta somada às
// leituras do card e dos envelopes acabaria cortada pela Vercel — e o corte cai justamente no pior
// lugar: ninguém saberia se o envelope morreu antes de a função ser morta. O envio para assinatura,
// que faz 16 chamadas, já declara 120 pelo mesmo motivo.
export const maxDuration = 60;

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
  //
  // ⚠️ O ENVELOPE ENTROU NA MESMA LEVA, E NÃO É INFORMAÇÃO DE ENFEITE: é ele que decide a frase da
  // confirmação de "voltar para análise" — ver `envelopeVivoDaProposta`.
  const [analise, contratos, envelopeVivo] = card.proposta_id
    ? await Promise.all([
        analiseDoTrabalho(sb, String(card.proposta_id)).catch((e: unknown) => {
          console.error("[temis][trabalho] falha ao montar a analise", e);
          return null;
        }),
        contratosDaProposta(sb, String(card.proposta_id)).catch((e: unknown) => {
          console.error("[temis][trabalho] falha ao ler os contratos", e);
          return [];
        }),
        // ⚠️ O PORTÃO POR TIPO É O MESMO DA VOLTA, LADO A LADO — `conferirEMatarOEnvelope` abre com
        // `if (card.tipo.trim() !== "contrato") return`. Ele existe porque `temis_envelopes` casa
        // por `proposta_id` e NÃO tem `trabalho_id`: o pedido de cancelamento nasce com a MESMA
        // proposta da venda, e uma proposta tem DOIS cards (medido em 10/09/2026 na proposta do
        // Henrique, Q01 L05). Sem o portão, o card de cancelamento leria o envelope DA VENDA — e a
        // tela avisaria de um cancelamento que a volta dele não faz. Perguntar aqui o que o servidor
        // não pergunta é a mesma divergência de antes, virada do avesso.
        String(card.tipo).trim() === "contrato"
          ? envelopeVivoDaProposta(sb, String(card.proposta_id))
          : Promise.resolve(null),
      ])
    : [null, [], null];

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
    { data: { analise, card: { ...card, contratos }, envelopeVivo, podeEmitir } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * O ENVELOPE VIVO DESTA VENDA, como a tela precisa dele.
 *
 * ⚠️ ELE EXISTE PARA A TELA PARAR DE ADIVINHAR PELO NOME DA ETAPA. Até 12/09/2026 a confirmação de
 * "voltar para análise" escolhia a frase por `estagio !== "contrato"`, e o servidor cancelava o
 * envelope SEM olhar estágio nenhum (`lib/temis/retorno-para-correcao.ts`). O caso que a diferença
 * produz está escrito no próprio módulo: quando o envio falha no passo `notificar`, a linha fica com
 * `envelope_id` e estado `aguardando` e o card NÃO é movido — ele fica em "Contrato" com um envelope
 * ATIVO na conta de PRODUÇÃO. Ali a pessoa lia "o card volta para Análise e o prazo recomeça",
 * confirmava, e só descobria o cancelamento pelo recado verde DEPOIS. É exatamente a surpresa depois
 * do clique que a frase âmbar existe para impedir.
 *
 * ⚠️ A RÉGUA É `envelopeQueSegura`, A MESMA DO SERVIDOR — e é o ponto inteiro. A pergunta ("existe
 * envelope vivo deste contrato?") já tem uma resposta única e testada; uma segunda escrita aqui
 * voltaria a divergir no dia em que um estado mudasse de lado.
 *
 * ⚠️ QUEM DECIDE SE ESTA FUNÇÃO É CHAMADA É O TIPO DO CARD, no GET, e o porquê está lá em cima, ao
 * lado da chamada: é o mesmo portão que abre `conferirEMatarOEnvelope`. Aqui dentro não há portão
 * nenhum — esta função responde só "qual é o envelope vivo desta proposta?".
 *
 * ⚠️ LEITURA QUE FALHA VIRA `null`, E ISSO NÃO SOLTA NADA. O aviso da tela fica no texto neutro, mas
 * quem decide continua sendo a volta, que FALHA FECHADO: sem conseguir ler os envelopes ela devolve
 * 503 e o card não se move. O preço do `null` aqui é um aviso pálido, nunca um envelope cancelado de
 * surpresa.
 */
async function envelopeVivoDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<EnvelopeVivoDoCard | null> {
  const { data, error } = await sb
    .from("temis_envelopes")
    // As mesmas colunas que a guarda do envio e a volta leem — é a mesma régua.
    .select("criado_em, envelope_id, estado, falha, id, provedor")
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) {
    // ⚠️ FALHA DE LEITURA NÃO PODE VIRAR `null`, E ESTE ERA O DEFEITO: `null` quer dizer "não há
    // envelope vivo", e a tela escreve com isso a frase NEUTRA — a que não avisa de cancelamento
    // nenhum. Com um envelope vivo do outro lado, o operador confirmaria uma volta que MATA um
    // envelope da conta de produção sem nunca ter lido o aviso. O `conferido: false` diz a única
    // coisa verdadeira aqui ("não consegui perguntar") e faz a tela avisar pelo pior caso.
    console.error("[temis][trabalho] falha ao ler o envelope da proposta", error);
    return { conferido: false, estado: "desconhecido", id: null, rotulo: "Não deu para conferir" };
  }

  const vivo = envelopeQueSegura((data ?? []) as EnvelopeDaProposta[]);
  if (!vivo) return null;

  return {
    conferido: true,
    estado: vivo.estado,
    id: vivo.envelope_id,
    rotulo: comoSeEscreveOEstado(vivo.estado),
  };
}

/** O envelope vivo da venda, do jeito que a tela de trabalho o consome. */
type EnvelopeVivoDoCard = {
  /**
   * A leitura de `temis_envelopes` deu certo?
   *
   * ⚠️ `false` NÃO É "NÃO TEM ENVELOPE", é "não deu para perguntar" — e a diferença é o aviso que
   * antecede o cancelamento de um envelope pago. Ver o `catch` de `envelopeVivoDaProposta`.
   */
  conferido: boolean;
  /** O estado CRU de `temis_envelopes` — é por ele que a tela decide qual frase mostrar. */
  estado: string;
  /**
   * O id do envelope na Clicksign.
   *
   * ⚠️ `null` É UM CASO REAL, e não descuido: a linha viva sem `envelope_id` quer dizer que um envio
   * começou e o Panteon nunca soube como terminou. Ela SEGURA a volta (409 com instrução), e é por
   * isso que a tela avisa pelo pior caso mesmo aqui — pode haver envelope pago do lado de lá.
   */
  id: null | string;
  /** O mesmo estado em palavra da casa, pronto para a tela ESCREVER. */
  rotulo: string;
};

/**
 * Os oito estados, escritos como `Record` total DE PROPÓSITO: estado novo em `EstadoDaAssinatura`
 * sem linha aqui NÃO COMPILA.
 *
 * ⚠️ AS CHAVES SE REPETEM, OS RÓTULOS NÃO — e é essa a divisão que importa. O texto continua saindo
 * de `rotuloDoEstado`, que é a fonte única da palavra; este `Record` só serve para estreitar a
 * `string` gravada no banco sem `as`. O gêmeo dele, `ESTADOS_DO_ENVELOPE`, é privado de
 * `lib/assinatura/envio-db.ts` — exportá-lo arrastaria o cliente da Clicksign para quem só quer
 * traduzir uma palavra.
 */
const ESTADOS_DO_ENVELOPE: Record<EstadoDaAssinatura, true> = {
  aguardando: true,
  assinado: true,
  cancelado: true,
  desconhecido: true,
  expirado: true,
  parcial: true,
  rascunho: true,
  recusado: true,
};

function ehEstadoDoEnvelope(gravado: string): gravado is EstadoDaAssinatura {
  return Object.prototype.hasOwnProperty.call(ESTADOS_DO_ENVELOPE, gravado);
}

/** O rótulo da casa para o estado gravado; valor que o código não conhece sai como ele mesmo. */
function comoSeEscreveOEstado(gravado: string): string {
  return ehEstadoDoEnvelope(gravado) ? rotuloDoEstado(gravado) : gravado;
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
 * `voltar_para_analise` — o contrato volta para a Análise para ser corrigido. Lucas (11/09/2026),
 * sobre a etapa de organizar as assinaturas: *"caso queira fazer algum ajuste no contrato, podemos
 * ter um botão para voltar o contrato a etapa anterior, corrigir e mandar para assinatura"*; e, no
 * mesmo dia, sobre a etapa seguinte: *"aproveita e coloca uma forma de voltar para analise ... mesmo
 * estando na sessao de assinatura, pois e nesse momento que todos vao receber o contrato para
 * assinatura, ae com certeza pode ter algo para ser alterado"*.
 *
 * ⚠️ ELA MEXE FORA DA CASA: confere o envelope na Clicksign e o cancela antes de mover o card. A
 * regra inteira (de onde volta, o que barra, em que ordem) está em
 * `lib/temis/retorno-para-correcao.ts` — esta rota só abre a porta e traduz o desfecho.
 *
 * ⚠️ E O QUE DECIDE É O ENVELOPE, NÃO A ETAPA. Lucas (12/09/2026), fechando a regra: *"prefaturamento
 * pode desde que nao esteja todo assinado"* e *"se ele estiver todo assinado tem que fazer distrato"*.
 * Por isso esta rota não olha o estágio para escolher caminho: ela entrega o card à regra, que lê o
 * envelope.
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

  const quemNome = await nomeDeQuemClicou(sb, auth.userId);

  // ⚠️ A VOLTA NÃO É MAIS UM `update` DESTA ROTA, e é por isso que ela não lê o card aqui. Ela
  // confere o ENVELOPE — em QUALQUER um dos três estágios que voltam — e o cancela na Clicksign
  // antes de mover, e essa sequência — ler, conferir, cancelar, mover, registrar — é uma regra
  // inteira, com leituras próprias: ver `lib/temis/retorno-para-correcao.ts`. A porta continua sendo
  // a mesma (coordenação).
  if (acao === "voltar_para_analise") {
    return voltarParaAnalise(sb, {
      observacao: String(corpo.observacao ?? "").trim() || null,
      trabalhoId: id,
      usuarioId: auth.userId,
      usuarioNome: quemNome,
    });
  }

  // ⚠️ LER ANTES DE ESCREVER. O estágio de ONDE o card sai é o que o histórico grava — e ele deixa
  // de existir no banco no instante do `update`, porque `temis_trabalhos.estagio` guarda só o
  // presente. Sem esta leitura a passagem nasceria sem origem, e `de` nulo significa "card
  // recém-aberto" (migration 0153), que seria mentira.
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
 * ⚠️ A REGRA MORA EM `lib/temis/retorno-para-correcao.ts`, E NÃO AQUI. Ela deixou de ser um
 * `update` com um `if` na frente no dia em que passou a valer também para a etapa de assinatura:
 * dali a volta CANCELA o envelope na Clicksign antes de mover o card, e falha fechado se o
 * cancelamento não der certo — senão alguém assinaria a versão velha enquanto a nova é corrigida.
 * Lucas (11/09/2026): *"pode cancelar o envelope"*.
 *
 * ⚠️ E A RECUSA DO CONTRATO ASSINADO APONTA PARA O DISTRATO, com nome próprio — quem classifica é
 * `classificarCancelamento` (`lib/temis/cancelamento.ts`), e não esta rota. Repassar a frase inteira
 * do servidor, como o bloco abaixo faz, é o que preserva essa instrução na tela.
 *
 * ⚠️ E A RESPOSTA DIZ O QUE ACONTECEU, não só que deu certo. `envelopeCancelado` é o que permite à
 * tela contar que o contrato saiu da mão de quem ia assinar — um "pronto" mudo faria o operador
 * ficar sem saber se ainda há convite vivo na Clicksign.
 */
async function voltarParaAnalise(
  sb: SupabaseClient,
  decisao: {
    observacao: null | string;
    trabalhoId: string;
    usuarioId: string;
    usuarioNome: null | string;
  },
): Promise<NextResponse> {
  const feito = await retornarParaAnalise(sb, decisao);

  if (!feito.ok) {
    return NextResponse.json({ error: feito.erro }, { status: feito.status });
  }

  return NextResponse.json(
    { de: feito.de, envelopeCancelado: feito.envelopeCancelado, ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
