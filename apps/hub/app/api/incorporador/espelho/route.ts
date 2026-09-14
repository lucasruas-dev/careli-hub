import { NextResponse } from "next/server";

import { autorizar, codigosDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  BUCKET_DO_ESPELHO,
  CACHE_IMUTAVEL,
  caminhoDaArte,
  caminhoDaGeometria,
} from "@/lib/hercules/espelho/pecas-do-espelho";
import { topoDaArvore } from "@/lib/hercules/masterplan-do-empreendimento";

// A ARTE E A GEOMETRIA PARA A MESA DE VENDA — as mesmas peças do espelho público, por dentro.
//
// Lucas (10/09/2026), vendo que o Veredas do Ouro não tinha espelho na Mesa: *"pq não tem o
// espelho no veredas aqui"* — e escolheu migrar a Mesa para esta base.
//
// ⚠️ POR QUE UMA ROTA NOVA, E NÃO A PÚBLICA. As três rotas públicas autorizam pelo TOKEN do link
// do espelho; a Mesa de Venda autoriza pela SESSÃO do portal. Fazer a tela interna emitir um token
// público para ler o próprio mapa seria dar a ela uma credencial que circula fora do hub, e
// misturar as duas portas faria uma mudança no gate de uma alcançar a outra sem querer.
//
// ⚠️ E O ESCOPO É CONFERIDO AQUI. O `code` só REDUZ o que a sessão já autorizou: um coordenador que
// só vende o Garden não lê o mapa do Vale do Ouro por esta porta. É a mesma regra das rotas irmãs
// de produto, e vale igual para uma imagem — o desenho do loteamento inteiro é informação de
// negócio.
/**
 * Empreendimentos que TÊM masterplan publicado mas NÃO oferecem espelho na Mesa de Venda.
 *
 * ⚠️ O JARDIM DAS GERAIS ESTÁ AQUI POR DECISÃO DO LUCAS (10/09/2026): *"jardim da gerais não tem
 * espelho, somente será grade"*. O masterplan dele existe em `hercules_masterplans` — é o que o
 * TELÃO DO PROMETEU projeta no salão do lançamento —, e por isso ele apareceria sozinho quando a
 * Mesa passou a ler o cadastro em vez da lista de arquivos HTML. Ter mapa publicado e ter espelho
 * na Mesa são duas perguntas diferentes, e esta lista é onde a segunda é respondida.
 *
 * Para religar, basta tirar o código daqui: a arte e a geometria já estão preparadas.
 */
const SEM_ESPELHO_NA_MESA = new Set(["JDG"]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") ?? "").trim().toUpperCase();
  const pedido = url.searchParams.get("parte");
  const parte = pedido === "geometria" ? "geometria" : pedido === "disponiveis" ? "disponiveis" : "arte";

  // ⚠️ QUEM TEM MAPA, ANTES DE PEDIR O MAPA. A Mesa de Venda precisa saber se OFERECE o botão
  // "Espelho" — e até aqui ela decidia por uma lista cravada no código (`MASTERPLANS_INTERNOS`,
  // cinco arquivos HTML). Esta parte responde a mesma pergunta pelo cadastro: os empreendimentos
  // com masterplan publicado, que hoje são oito e crescem sozinhos a cada importação.
  if (parte === "disponiveis") {
    return await codigosComMapa(auth);
  }

  if (!code) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const autorizados = await codigosDaSessao(auth.sessao);
  if (autorizados.length === 0) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Mapa indisponível." }, { status: 503 });
  }

  const topo = await topoDaArvore(client, code);
  if (!topo) return NextResponse.json({ error: "Mapa não encontrado." }, { status: 404 });

  // ⚠️ CONFERE O TOPO **E** O PEDIDO. O mapa é do pai, mas quem pede é a sessão: um coordenador do
  // VOC alcança o mapa do VLO porque o VOC é dele — e alguém sem nenhum dos dois não alcança
  // nenhum. Fora do escopo responde 404, o mesmo de um mapa inexistente: a resposta não pode
  // diferenciar "não é seu" de "não existe".
  const permitidos = new Set(autorizados.map((c) => c.trim().toUpperCase()));
  if (!permitidos.has(code) && !permitidos.has(topo.codigo)) {
    return NextResponse.json({ error: "Mapa não encontrado." }, { status: 404 });
  }

  // A mesma recusa da listagem, aqui também: esconder o botão sem fechar a porta deixaria o mapa
  // acessível por URL direta a quem soubesse o formato.
  if (SEM_ESPELHO_NA_MESA.has(code) || SEM_ESPELHO_NA_MESA.has(topo.codigo)) {
    return NextResponse.json({ error: "Mapa não encontrado." }, { status: 404 });
  }

  const { data: publicado } = await client
    .from("hercules_masterplans")
    .select("versao")
    .eq("empreendimento_id", topo.id)
    .not("publicado_em", "is", null)
    .maybeSingle<{ versao: number }>();

  if (!publicado) {
    return NextResponse.json(
      { error: "Este empreendimento não tem masterplan publicado." },
      { status: 404 },
    );
  }

  const caminho =
    parte === "geometria"
      ? caminhoDaGeometria(topo.codigo, publicado.versao)
      : caminhoDaArte(topo.codigo, publicado.versao);

  const { data, error } = await client.storage.from(BUCKET_DO_ESPELHO).download(caminho);

  if (error || !data) {
    // ⚠️ ACONTECE QUANDO O MASTERPLAN FOI PUBLICADO MAS O ESPELHO NÃO FOI PREPARADO. O conserto é
    // `scripts/hercules/preparar-espelho.mts --pai <cod> --gravar`, e o log tem de dizer isso.
    console.error(
      `[incorporador][espelho] ${parte} ausente para ${topo.codigo} v${publicado.versao}.`,
      "Rode scripts/hercules/preparar-espelho.mts --pai",
      topo.codigo,
      "--gravar",
    );
    return NextResponse.json({ error: "Mapa em preparação." }, { status: 503 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      // Imutável: a versão está no caminho, então nunca serve mapa velho.
      "Cache-Control": CACHE_IMUTAVEL,
      "Content-Type": parte === "geometria" ? "application/json" : "image/webp",
    },
  });
}

/**
 * Os códigos que a sessão alcança E têm masterplan publicado.
 *
 * Devolve os códigos do PEDIDO (VOC, VOL…), e não os do topo: é assim que a Mesa compara com o
 * produto aberto na tela, que fala a língua do C2X.
 */
async function codigosComMapa(
  auth: Extract<ReturnType<typeof autorizar>, { ok: true }>,
): Promise<NextResponse> {
  const autorizados = await codigosDaSessao(auth.sessao);
  const client = createApoloAdminClient();
  if (!client || autorizados.length === 0) {
    return NextResponse.json({ data: { codigos: [] } }, { headers: { "Cache-Control": "no-store" } });
  }

  const comMapa: string[] = [];
  // ⚠️ OS IDS DO C2X VAO JUNTO, E SEM ELES A MESA NAO ACHAVA O PRODUTO. A tela guarda o produto
  // aberto como um CARD, e o card consolidado não tem código nenhum: o `code` dele é o rótulo
  // `"LBF + LBR + LBP"` e o resto são `enterpriseIds`, que são IDS DO C2X ("33", "32", "27"). Uma
  // lista só de códigos nunca casa com nenhum dos dois — e por isso TODO produto consolidado caía
  // na grade, com o masterplan publicado e as três peças prontas no storage. Era o caso do Lagoa
  // Bonita e do Vale do Ouro.
  //
  // ⚠️ E O PAR VIAJA JUNTO PORQUE A ROTA PEDE CÓDIGO. Devolver só os ids resolveria o casamento e
  // quebraria a chamada seguinte (`?code=`), que é por código. Cada entrada leva o código E os ids
  // que levam até ele, e a tela usa o id para ACHAR e o código para PEDIR.
  const produtos: { codigo: string; enterpriseIds: string[] }[] = [];

  for (const code of autorizados) {
    const limpo = code.trim().toUpperCase();
    const topo = await topoDaArvore(client, limpo);
    if (!topo?.temMapa) continue;
    // A exclusão vale pelo código pedido E pelo topo: o filho não herda um espelho que o pai não
    // oferece.
    if (SEM_ESPELHO_NA_MESA.has(limpo) || SEM_ESPELHO_NA_MESA.has(topo.codigo)) continue;
    comMapa.push(limpo);

    // O id do próprio empreendimento e os dos filhos: num consolidado, o card carrega os dos
    // FILHOS, e é por eles que o casamento acontece.
    const ids = new Set<string>();
    const { data: linha } = await client
      .from("hercules_empreendimentos")
      .select("c2x_enterprise_id")
      .eq("codigo", limpo)
      .maybeSingle<{ c2x_enterprise_id: null | string }>();
    if (linha?.c2x_enterprise_id) ids.add(String(linha.c2x_enterprise_id));
    if (topo.c2xEnterpriseId) ids.add(String(topo.c2xEnterpriseId));
    for (const filho of topo.filhosC2xIds) ids.add(String(filho));

    produtos.push({ codigo: limpo, enterpriseIds: [...ids] });
  }

  return NextResponse.json(
    // `codigos` continua saindo para não quebrar quem já lia a resposta antiga.
    { data: { codigos: comMapa, produtos } },
    // Curto e privado: a lista muda quando um masterplan é publicado, o que é raro, mas ela é
    // por SESSÃO — não pode ficar em cache compartilhado.
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
