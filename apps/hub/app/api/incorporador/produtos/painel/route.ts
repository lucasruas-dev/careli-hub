import { NextResponse } from "next/server";

import { type ApoloEnterpriseRow, loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import {
  type Cenario,
  cenarioVazio,
  decidirPainelDeProdutos,
  montarPainelDeProdutos,
  type PainelDeProdutos,
  somarCenarios,
} from "@/lib/apolo/incorporador/painel-de-produtos";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import { lerCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { lerEstoquePelaRegua } from "@/lib/hercules/estoque-da-situacao";

// O PAINEL DE PRODUTOS DO HÉRCULES: os seis cards e a tabela pai/filhos da aba Produtos.
//
// Lucas (02/09/2026): *"queria trazer aquela tela que temos no empreendimento (...) vendas tem que
// morar dentro da tela de produtos"*. Mesma tela de Empreendimentos do Apolo, mas agrupada pelo
// CADASTRO DO PANTEON (hercules_empreendimentos) e recortada pela sessão do portal.
//
// O recorte NÃO vem da query string: sai do cookie assinado (mesma regra de ../route.ts). O
// cadastro diz quem é pai de quem, e a montagem é pura (`montarPainelDeProdutos`), coberta por
// teste.
//
// ⚠️ OS NÚMEROS VÊM DO PANTEON DESDE 04/09/2026, e não mais do C2X. Lucas, vendo o empreendimento
// de teste com 12 unidades na tela Venda e ZERO aqui: *"a informação de unidades tem que ser
// alimentada de um local somente"* e *"o panteon tem que ler do panteon"*. As duas telas
// respondiam a mesma pergunta por fontes diferentes — a Venda contava `hercules_unidades`, esta
// contava `enterprise_unities` do legado.
//
// ⚠️ E A SITUAÇÃO DE CADA UNIDADE VEM DA RÉGUA ÚNICA DESDE 18/09/2026 (lib/hercules/situacao-da-
// unidade.ts). Lucas: *"esses status tem que morar em um so lugar"* · *"no c2x não precisa olhar"*.
// Até aqui este painel tinha a conta dele (`estoquePorEmpreendimento`: a proposta viva da própria
// linha, senão o cadastro cru), que não via a reserva do Hércules nem a do evento, nem a proposta
// que mora na linha antiga do terreno. Agora a quantidade e o preço continuam saindo de
// `hercules_unidades`, linha a linha, e o BALDE de cada linha sai da situação do terreno dela.
//
// O C2X continua entrando para a MOLDURA (quais linhas existem, nome e cidade de quem não está no
// cadastro do Panteon) — não para contar unidade. Nem na linha que só o C2X conhece: o `scenario`
// que o legado manda (de `sale_status_id`) é trocado pelo do Panteon antes da montagem.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type PainelDeProdutosDoIncorporador = PainelDeProdutos;

// Texto para o coordenador (externo): diz o efeito, sem nomear sistema.
const AVISO_DE_ESTOQUE =
  "Os números de estoque não carregaram agora e aparecem zerados. Tente de novo em instantes.";

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);

  if (!sessao) {
    return NextResponse.json({ error: "Sessão ausente." }, { status: 401 });
  }

  // C2X (moldura), sessão expandida (escopo) e cadastro (agrupamento) correm juntas. O estoque
  // espera só o escopo: é ele que diz quais empreendimentos contar.
  //
  // ⚠️ O CADASTRO É ENRIQUECIMENTO, O ESCOPO NÃO. Cadastro fora do ar degrada: todo
  // empreendimento vira linha simples com o nome do C2X (é a tela antiga, sem pai/filho) — melhor
  // que um 503 no painel inteiro.
  //
  // ⚠️ E O C2X VIROU MOLDURA (16/09/2026): sem ele o painel sai pelo cadastro do Panteon, com
  // aviso, em vez de 503 — senão o produto que só existe no Panteon sumia junto com o legado. A
  // regra inteira está em `decidirPainelDeProdutos`. `loadApoloEnterprises` lança quando o MySQL
  // recusa a consulta (ele só devolve `ok: false` sem configuração): o `.catch` põe as duas
  // quedas no mesmo caminho.
  const doEscopo = idsDaSessao(sessao);
  const [c2x, permitidos, cadastro, estoque] = await Promise.all([
    loadApoloEnterprises().catch((erro: unknown) => {
      console.error("[incorporador/produtos/painel] C2X indisponível", erro);
      return { error: "C2X indisponível.", ok: false as const };
    }),
    doEscopo,
    // `lerCadastro...` (e não `carregar...`) porque o painel precisa saber se a 0170 veio: sem a
    // coluna `operado_por`, nenhuma linha acende escrita no portal que confecciona (fail-closed).
    lerCadastroDeEmpreendimentos().catch(() => null),
    // ⚠️ UMA LEITURA DA SITUAÇÃO PARA A SESSÃO INTEIRA, e não uma por produto: o comercial vê
    // todos os empreendimentos de uma vez, e N idas à régua seriam N vezes as propostas vivas e as
    // reservas do banco inteiro.
    doEscopo.then(lerEstoqueDoPanteon),
  ]);

  // ⚠️ `podeEscrever` DE CADA LINHA (decisão do Lucas, 16/09/2026): no portal que confecciona, só no
  // produto que ele opera. É dica para a tela esconder botão; cada rota de escrita confere de novo,
  // com a sessão revalidada (`autorizarEscritaNoProduto`). O cookie aqui só diz QUEM pergunta.
  const decidido = decidirPainelDeProdutos({
    cadastroRespondeu: cadastro !== null,
    c2xRespondeu: c2x.ok,
    painel: montarPainelDeProdutos({
      cadastro: cadastro?.linhas ?? [],
      com0170: cadastro?.com0170 === true,
      estoque: estoque ?? new Map(),
      linhasDoC2x: c2x.ok ? comOEstoqueDoPanteon(c2x.data.rows, estoque) : [],
      permitidos: new Set(permitidos),
      portal: { incorporadorId: sessao.incorporadorId, slug: sessao.slug, tipo: sessao.tipo },
    }),
  });

  if (!decidido.ok) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  // ⚠️ ESTOQUE QUE NÃO CARREGOU SAI ZERADO E AVISADO, NUNCA LIVRE. Zero não afirma que há lote para
  // vender; e o aviso impede que a pessoa leia "0" como "vendeu tudo".
  const painel =
    estoque === null
      ? {
          ...decidido.painel,
          avisoDaFonte: [decidido.painel.avisoDaFonte, AVISO_DE_ESTOQUE].filter(Boolean).join(" "),
        }
      : decidido.painel;

  return NextResponse.json(
    { data: painel },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * A linha do C2X com o número do PANTEON no lugar do dela.
 *
 * ⚠️ A LINHA QUE SÓ O C2X CONHECE (id da sessão fora do cadastro, ou o cadastro inteiro fora do ar)
 * era montada com o `scenario` do legado, que classifica por `sale_status_id` / `sale_blocked` e não
 * vê nada feito no Panteon. É a mesma unidade com dois status, na mesma tela. Aqui a moldura fica
 * (nome, cidade, espelho) e o número passa a ser o de `hercules_unidades`; empreendimento sem
 * unidade no Panteon entra zerado, a mesma regra das outras linhas.
 */
function comOEstoqueDoPanteon(
  linhas: ApoloEnterpriseRow[],
  estoque: Map<string, Cenario> | null,
): ApoloEnterpriseRow[] {
  const doPanteon = (id: string): Cenario => estoque?.get(String(id).trim()) ?? cenarioVazio();

  return linhas.map((linha) => {
    const etapas = (linha.stages ?? []).map((etapa) => ({ ...etapa, scenario: doPanteon(etapa.id) }));
    return {
      ...linha,
      scenario:
        etapas.length > 0 ? somarCenarios(etapas.map((etapa) => etapa.scenario)) : doPanteon(linha.id),
      stages: etapas,
    };
  });
}

/**
 * O estoque de cada empreendimento da sessão, contado no Panteon pela régua única.
 *
 * ⚠️ A CONTA NÃO MORA AQUI (18/09/2026). Até esta data esta rota tinha a sua cópia de
 * `contarEstoque`, `baldeDoEstoque` e `SITUACAO_FORA_DO_MAPA`, e a lista de produtos (../route.ts)
 * tinha outra. Agora as duas, e o funil do Resumo, contam por lib/hercules/estoque-da-situacao.ts:
 * quantidade e preço da linha, situação do terreno, os cinco baldes de `baldeDaSituacao`, e a
 * unidade fora do mapa ocupada. Uma chamada à régua para a sessão inteira.
 *
 * ⚠️ FALHA DEVOLVE `null`, e não um mapa vazio: quem chama precisa saber que não leu, para avisar.
 * Mesmo assim a tela não cai: nomes, agrupamento e quem é pai de quem continuam de pé.
 */
async function lerEstoqueDoPanteon(ids: readonly string[]): Promise<Map<string, Cenario> | null> {
  const supabase = createApoloAdminClient();
  if (!supabase) {
    console.error("[incorporador/produtos/painel] Supabase ausente: sem o estoque do Panteon.");
    return null;
  }

  try {
    return await lerEstoquePelaRegua(supabase, ids);
  } catch (erro) {
    console.error("[incorporador/produtos/painel] estoque do Panteon", erro);
    return null;
  }
}
