import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { codigosParaOC2x } from "@/lib/apolo/incorporador/cadastro-do-produto";
import {
  pedidoPrecisaDeExpansao,
  resolverCodigosDoPedido,
} from "@/lib/apolo/incorporador/codigos-do-pedido";
import { lerEsteiraDoEscopo, lerImobiliariasVinculadas } from "@/lib/apolo/incorporador/crm";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import {
  autorizar,
  codigosDaSessao,
  foraDoEscopo,
  idsDaSessao,
} from "@/lib/apolo/incorporador/escopo";
import {
  contarVendasDoPanteonPorImobiliaria,
  contarVendasPorImobiliaria,
  lerNomesDasEntidades,
  lerPropostasVivasDoPanteon,
  montarImobiliariasDoProduto,
  somarVendasPorImobiliaria,
} from "@/lib/apolo/incorporador/imobiliarias-do-produto";
import {
  empreendimentosIndisponiveis,
  idsDosProprios,
  lidosDoPanteon,
  propriosDoPortal,
} from "@/lib/apolo/incorporador/proprios-do-portal";
import { comIdsDoGrupo } from "@/lib/apolo/incorporador/resumo-do-produto";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { loadApoloEnterpriseVendas } from "@/lib/apolo/vendas";
import { ehIdDoPai, expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";

// AS IMOBILIÁRIAS DE UM PRODUTO, PELO PROCESSO — a aba Imobiliárias da ficha do Hércules.
//
// Lucas (02/09/2026): *"deixa imobiliárias separado para a gente visualizar as imobiliárias
// habilitadas, com os corretores com os clientes (cads credenciadas, enviadas, erradas, ou seja
// uma visão processual das cads)"*. A regra da árvore e das contagens está em
// `imobiliarias-do-produto.ts`; esta rota só resolve o escopo, lê as três fontes e devolve.
//
// ⚠️ O ESCOPO VEM DO TOKEN, NUNCA DA URL. O `emp` só REDUZ o que a sessão já autorizou, pela MESMA
// regra da rota de Vendas (/api/incorporador/vendas) — a de `codigos-do-pedido.ts`, e não uma
// cópia: "pai:<uuid>" expande pelo cadastro do Panteon cruzado com `idsDaSessao`; id NUMÉRICO de
// um filho ("33", o LBF aberto pelo chevron do Lagoa Bonita) vale por ele, se autorizado; id do
// catálogo passa por `codesDoRecorte`. A primeira versão copiou a resolução ANTIGA (só
// `codesDoRecorte`) e o filho respondia 404 para um produto que É do coordenador. Fora do escopo →
// 404, o mesmo de um produto inexistente.
//
// ⚠️ DUAS LÍNGUAS DE ID. O C2X (vendas) fala CÓDIGO (VOC); as tabelas do Apolo (esteira, vínculos)
// falam ID, em dois formatos ao mesmo tempo (divisão "37" e grupo "group:…"). Por isso o recorte
// sai daqui em dois: `codes` para as vendas e `enterpriseIds` para o Apolo. O GRUPO entra pela
// MESMA régua das rotas irmãs (produto/resumo, contratos) e do Board (`comIdsDoGrupo`: só quando
// os ids cobrem o grupo INTEIRO e a sessão o tem) — antes esta aba usava "qualquer divisão", e
// uma CAD gravada como "group:…" contava aqui e sumia do Resumo e do Cadastro da mesma ficha.
//
// ⚠️ O PRODUTO QUE SÓ EXISTE NO PANTEON NÃO VAI AO C2X (achado 20 da onda 1, 16/09/2026). O código
// dele não tem venda no legado: a ida ao MySQL voltava vazia (a coluna Vendas dizia "ninguém vendeu")
// ou, com o C2X fora, derrubava a aba de um produto que nem depende dele. A venda desses códigos é a
// proposta viva de `hercules_propostas`, contada pela mesma régua (unidade com venda ativa); os
// códigos do legado continuam no C2X, e as duas contagens se somam.
//
// ⚠️ CUSTO. `loadApoloEnterpriseVendas` faz quatro consultas no C2X. Roda quando o coordenador
// ABRE a aba, não em polling. Nada aqui pode virar chamada repetida sem antes ganhar cache.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// ⚠️ FUNÇÃO, E NÃO CONSTANTE. Uma `NextResponse` criada no carregamento do módulo tem UM corpo só:
// a primeira requisição que caísse aqui consumia o stream, e a segunda devolveria uma resposta de
// corpo já lido. Cada chamada monta a sua.
const indisponivel = () =>
  NextResponse.json(
    { error: "Não foi possível carregar as imobiliárias agora." },
    { status: 503 },
  );

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  // Os códigos que esta sessão enxerga. Sem filtro nenhum aqui de propósito: o recorte por
  // produto é feito depois, sobre esta lista.
  const codesAutorizados = await codigosDaSessao(auth.sessao);
  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  // ⚠️ O EMPREENDIMENTO QUE SÓ EXISTE NO PANTEON — a mesma expansão da rota /venda, pela peça
  // comum (`propriosDoPortal`; o porquê e a guarda do cadastro estão lá).
  const doPanteon = await propriosDoPortal({
    catalogo,
    codesAutorizados,
    sessao: auth.sessao,
  });

  // ⚠️ AQUI NÃO É "ELE NÃO TEM NADA". A sessão só existe com empreendimento, então zero código
  // (nem do C2X, nem do Panteon) significa fonte fora do ar, e não falta de permissão.
  if (doPanteon.codesComProprios.length === 0) return empreendimentosIndisponiveis();

  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  const pedido = new URL(request.url).searchParams.get("emp");

  // O escopo expandido (grupo + divisões) — o teto de tudo o que sai daqui.
  const permitidos = new Set(doPanteon.idsDaSessao);

  // O `emp` chega em TRÊS formatos, e os três só REDUZEM o que a sessão já autorizou:
  //   • "pai:<uuid>", o PAI do cadastro do Panteon (o que a ficha do Hércules manda) — expande
  //     para os c2x ids dos filhos autorizados pela MESMA regra do painel (`alcanceDoPai`);
  //   • o id NUMÉRICO do C2X de um filho ("33") — ele mesmo, se autorizado;
  //   • o id do catálogo do C2X ("group:Lagoa Bonita" ou "37") — `codesDoRecorte`, como sempre.
  //
  // ⚠️ FAIL-CLOSED EM DUAS CAMADAS no caminho expandido: a expansão cruza com `idsDaSessao` e o
  // código resultante ainda é cruzado com `codesAutorizados`. Cadastro fora do ar responde 503,
  // e não 404: sem cadastro não dá para provar que o pai é dele. O id numérico não carrega o
  // cadastro (não precisa dele).
  if (ehIdDoPai(pedido) && doPanteon.cadastro === null) return empreendimentosIndisponiveis();
  const cadastro = doPanteon.cadastro ?? [];

  const codes = resolverCodigosDoPedido({
    cadastro,
    catalogo,
    codesAutorizados: doPanteon.codesComProprios,
    empreendimentos,
    pedido,
    permitidos,
    proprios: doPanteon.proprios,
  });

  // Os ids do Apolo. Caminho expandido: os ids reais mais o grupo que eles cobrem por inteiro.
  // Id do catálogo: `idsDaSessao(sessao, pedido)` já devolve o grupo E cada divisão, dentro do
  // que é dele (a sessão com uma gleba só não abre o grupo inteiro). Sem `emp`: tudo o que a
  // sessão alcança. O produto do Panteon pedido pelo CÓDIGO entra pelo id que o cadastro guarda.
  const enterpriseIds = pedidoPrecisaDeExpansao(pedido)
    ? comIdsDoGrupo(expandirIdDoPainel(pedido, cadastro, permitidos), catalogo, permitidos)
    : [
        ...new Set([
          ...(await idsDaSessao(auth.sessao, pedido)),
          ...idsDosProprios(doPanteon.proprios, codes),
        ]),
      ];

  // Pedido que não sobra nada = produto que não é dele (ou que saiu do catálogo). Nunca cai na
  // visão consolidada. Com o cadastro fora do ar pode ser um produto do Panteon que só não deu
  // para traduzir: 503.
  if (codes.length === 0 || enterpriseIds.length === 0) {
    return doPanteon.cadastro === null ? empreendimentosIndisponiveis() : foraDoEscopo();
  }

  const admin = createApoloAdminClient();
  // Sem o Apolo não há vínculo nem CAD: a aba inteira é dele. Aba pela metade afirmaria
  // "nenhuma imobiliária habilitada", e isso é uma afirmação, não uma falha.
  if (!admin) return indisponivel();

  // Os códigos que valem uma ida ao C2X, e os que têm venda nativa no Panteon.
  //
  // (16/09/2026, revisão do conjunto) ⚠️ O PRODUTO COM DONO (o Garden, D2) CONTA NAS DUAS FONTES: as
  // vendas antigas no C2X e as que a Cecílio faz agora no Panteon (que não são escritas no C2X). A
  // lista é a de Unidades e Resumo (`lidosDoPanteon`); a leitura do Panteon só traz proposta nativa.
  const codesDoC2x = codigosParaOC2x(codes, doPanteon.proprios);
  const codesDoPanteon = lidosDoPanteon({
    cadastro: doPanteon.cadastro,
    codes,
    idsDaSessao: doPanteon.idsDaSessao,
    proprios: doPanteon.proprios,
  }).map((produto) => produto.codigo);

  // As fontes correm juntas: mesmo escopo, um fetch só na tela.
  const [vendas, propostasDoPanteon, esteira, vinculadas] = await Promise.all([
    codesDoC2x.length > 0 ? loadApoloEnterpriseVendas(codesDoC2x) : Promise.resolve(null),
    codesDoPanteon.length > 0
      ? lerPropostasVivasDoPanteon(admin, codesDoPanteon)
      : Promise.resolve({ ok: true as const, propostas: [] }),
    lerEsteiraDoEscopo(admin, enterpriseIds),
    lerImobiliariasVinculadas(admin, enterpriseIds),
  ]);

  // Tudo ou nada, como a aba Imobiliárias do CRM do portal: a coluna Vendas zerada por falha do
  // C2X (ou do Panteon) diria "ninguém vendeu", e o coordenador cobraria a imobiliária por isso.
  if ((vendas && !vendas.ok) || !propostasDoPanteon.ok || !esteira.ok || !vinculadas.ok) {
    return indisponivel();
  }

  // Os nomes das pessoas das CADs. Best-effort: sem leitura, "Sem nome" — nunca aba travada.
  const nomes = await lerNomesDasEntidades(
    admin,
    esteira.linhas.map((linha) => linha.entity_id),
  );

  const data = montarImobiliariasDoProduto({
    credenciadas: vinculadas.credenciadas,
    esteira: esteira.linhas,
    nomes,
    vendasPorImobiliaria: somarVendasPorImobiliaria(
      contarVendasPorImobiliaria(vendas?.ok ? vendas.data.units : []),
      contarVendasDoPanteonPorImobiliaria(propostasDoPanteon.propostas),
    ),
  });

  return NextResponse.json(
    { data: { ...data, filtro: pedido?.trim() ? pedido.trim() : null } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
