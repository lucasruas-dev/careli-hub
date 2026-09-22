import { NextResponse } from "next/server";

import { cpfValido, formatarDocumento, soDigitos } from "@/lib/apolo/documento";
import { APOLO_DOCS_BUCKET, MENSAGEM_DOCUMENTO_GRANDE } from "@/lib/apolo/documentos";
import { foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { descreverRegra, gruposDaRegra } from "@/lib/assinatura/ordem";
import { rotuloDoPapel } from "@/lib/assinatura/tipos";
import {
  COLUNAS_DO_APARTAMENTO,
  ehUnidadeVertical,
  lerComColunasDoApartamento,
} from "@/lib/hercules/nome-da-unidade";
import { chaveDaUnidade, ehColunaDaUnidadeVerticalAusente } from "@/lib/hercules/unidade-nova";
import {
  chaveDoTerreno,
  type LinhaParaVincular,
  planoDeVinculo,
} from "@/lib/hercules/vinculo-da-unidade";
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
import { conferirFaixa, type EntradaDeFaixa } from "@/lib/temis/faixas";
import {
  lerOrdemDoCorpo,
  type NivelDeOrdem,
  regraDoNivel,
  resolverOrdemDeAssinatura,
  temOrdemPropria,
} from "@/lib/temis/ordem-da-categoria";

import {
  type Alcance,
  alcanceDaMinuta,
  alcanceDoAlvo,
  alcanceDoAnexo,
  alcanceDoAssinante,
  alcanceDoEmpreendimento,
  alcanceParaEscrever,
  paiNoAlcance,
  respostaDoAlcance,
  somenteLeituraNoPortal,
} from "./alcance-da-estrutura";
import { type AtorDaTemis, enterpriseNoAlcance, idDoAutor } from "./ator";
import { PREFIXO_DO_CONSOLIDADO } from "./cadeia-do-contrato";
import {
  COLUNAS_DA_0173,
  gravarComAutoria,
  nomeComOrigem,
  registrarAtoDoPortal,
} from "./autoria-dos-modelos";

// A ESTRUTURA DO CONTRATO NA TÊMIS — anexos, quadro de assinatura, faixas de prazo e categorias.
//
// Decisões do Lucas (16/09/2026): a equipe da Cecílio gera o contrato, manda assinar e edita os
// modelos dos produtos dela. A rota do hub (`/api/temis/<rota>`, Bearer) e a do portal
// (`/api/incorporador/temis/<rota>`, cookie `apolo_inc`) chamam AS MESMAS funções daqui, passando o
// ATOR (`ator.ts`). O recorte é aplicado aqui, ANTES de ler ou gravar, inclusive nos ids que vêm da
// URL ou do corpo (anexo, assinante, categoria, unidade, minuta da capa).
//
// O QUE O PORTAL FAZ EM CADA PEÇA:
//   • ANEXOS e QUADRO DE ASSINATURA: CRUD completo, só no alcance. São a capa, as páginas anexas e
//     as pessoas que assinam o contrato que ela mesma confecciona. ⚠️ ESCREVER (subir, registrar,
//     trocar a capa, desativar, incluir e remover assinante) é só no produto que o portal OPERA
//     (decisão do Lucas, 16/09/2026): no VOC, que a Cecílio enxerga e a Careli opera, é 403 só
//     consulta (`alcanceParaEscrever`).
//   • FAIXAS DE PRAZO e CATEGORIAS (e o vínculo de unidades a categoria): SOMENTE LEITURA. Plano,
//     faixa e categoria decidem quanto o comprador paga e continuam com a Careli; a escrita, para o
//     portal, é 404 (`somenteLeituraNoPortal`).
//
// ⚠️ O HUB CONTINUA IGUAL. Para o ator do hub toda conferência responde "dentro" sem consulta
// (`alcance-da-estrutura.ts`), e as respostas saem com o mesmo status e a mesma frase de antes. A
// única diferença é o NOME de quem cria e desativa anexo e assinante: `criado_por_nome` existia e
// nunca era preenchido, e `desativado_por_nome` nasce na 0173 (sem ela, a gravação sai como hoje).
// Pelo portal o nome leva "(portal do incorporador)" junto (`autoria-dos-modelos.ts`).

type Admin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const WORKSPACE = "careli";
const SEM_CACHE = { "Cache-Control": "no-store" } as const;

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Um filtro de alcance por empreendimento, com memória: a mesma lista de linhas repete o mesmo
 * `enterprise_id` centenas de vezes, e o consolidado custa duas consultas.
 *
 * Hub: tudo passa, sem consulta.
 */
function filtroDeAlcance(admin: Admin, ator: AtorDaTemis): (enterpriseId: unknown) => Promise<boolean> {
  if (ator.tipo === "hub") return async () => true;
  const memoria = new Map<string, Promise<boolean>>();
  return (enterpriseId) => {
    const chave = String(enterpriseId ?? "").trim();
    let resposta = memoria.get(chave);
    if (!resposta) {
      resposta = alcanceDoEmpreendimento(admin, ator, chave, "inteiro").then((a) => a === "dentro");
      memoria.set(chave, resposta);
    }
    return resposta;
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ANEXOS E CAPA DO CONTRATO — tabela e coluna na migration 0156
// ════════════════════════════════════════════════════════════════════════════
//
// Lucas (13/09/2026): *"eu não vi onde vamos subir os anexos, a capa dos contratos"* e, na mesma
// tarde, *"tem que fazer o upload hoje / estamos montando os contratos hoje"*.
//
// ⚠️ NÃO RECEBE BYTES, e é o mesmo padrão do upload da mídia do editor e do documento grande do
// CAD: o navegador sobe direto para o Storage por URL assinada, e só o registro passa por aqui. Um
// PDF de 20MB atravessando a função serverless estoura o limite de corpo da Vercel.
//
//   POST { acao: "upload", ...alcance, fileName, contentType, size } → { bucket, path, token }
//   POST { acao: "confirmar", ...alcance, posicao, nome, path }      → { anexo }
//   POST { acao: "capa", minutaId, path, nome }                      → { ok: true }
//   GET  ?enterpriseId=&categoriaId=&unidadeId=                      → { anexos }
//   DELETE ?id=                                                      → desativa (não apaga)
//
// ⚠️ O CAMINHO É ESCOLHIDO AQUI, PELO SERVIDOR. Um corpo forjado não grava em cima de outra pasta,
// e o `confirmar` só aceita caminho dentro do prefixo (e, no portal, dentro da PASTA do alcance).
//
// ⚠️ DESATIVA, NÃO APAGA. O arquivo continua no bucket e a linha continua na tabela com
// `ativo = false`. Um contrato já montado que cite aquele anexo precisa que a peça continue
// existindo; apagar o objeto deixaria o PDF do passado apontando para o vazio.

type LinhaDoAnexo = {
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

const COLUNAS_DO_ANEXO =
  "id,enterprise_id,categoria_id,unidade_id,posicao,nome,storage_path,arquivo_nome,arquivo_bytes";

function anexoParaATela(linha: LinhaDoAnexo): AnexoDoContrato {
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

type CamposDoAlcance = {
  categoria_id: null | string;
  enterprise_id: null | string;
  unidade_id: null | string;
};

/**
 * O alcance vindo do corpo, com a trava do "exatamente um".
 *
 * ⚠️ O BANCO TAMBÉM RECUSA (`temis_anexos_um_alcance`), e a conferência aqui existe para a mensagem:
 * um 400 com "escolha um alcance" é acionável; o erro cru da constraint não é.
 */
function lerAlcance(corpo: Record<string, unknown>): {
  campos?: CamposDoAlcance;
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

/**
 * A pasta de um caminho de anexo ou de capa já validado: `temis-(anexos|capas)/<nível>/<id>/<arquivo>`.
 * `null` quando o caminho não segue esse formato (o que só um corpo forjado produz).
 */
function pastaDoCaminho(path: string): CamposDoAlcance | null {
  const resto = path.startsWith(PREFIXO_ANEXO)
    ? path.slice(PREFIXO_ANEXO.length)
    : path.startsWith(PREFIXO_CAPA)
      ? path.slice(PREFIXO_CAPA.length)
      : null;
  if (resto === null) return null;

  const [nivel, id, ...arquivo] = resto.split("/");
  if (!id || arquivo.length === 0 || !arquivo.every(Boolean)) return null;

  if (nivel === "empreendimento") return { categoria_id: null, enterprise_id: id, unidade_id: null };
  if (nivel === "categoria") return { categoria_id: id, enterprise_id: null, unidade_id: null };
  if (nivel === "unidade") return { categoria_id: null, enterprise_id: null, unidade_id: id };
  return null;
}

/**
 * O alcance de uma pasta de anexo (ou de capa) para GRAVAR.
 *
 * ⚠️ A CAPA SOBE COM O ID DA MINUTA NO LUGAR DO EMPREENDIMENTO. A tela (`anexos-do-contrato.tsx`)
 * manda `enterpriseId: minutaId` no `upload` da capa, porque a rota só usa o alcance para montar a
 * pasta. No portal, então, a pasta da capa é aceita quando é de um empreendimento no alcance OU de
 * uma minuta no alcance — nunca de uma minuta de outro dono.
 *
 * ⚠️ GRAVAR É ESCRITA, e a régua é a de escrever: o produto da pasta (ou, na capa, o da MINUTA)
 * precisa ser operado pelo portal. A capa da minuta do VOC, no portal da Cecílio, é 403 só consulta.
 */
async function alcanceDaPasta(
  admin: Admin,
  ator: AtorDaTemis,
  campos: CamposDoAlcance,
  capa: boolean,
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const doAlvo = await alcanceDoAlvo(
    admin,
    ator,
    {
      categoriaId: campos.categoria_id,
      enterpriseId: campos.enterprise_id,
      unidadeId: campos.unidade_id,
    },
    "inteiro",
    "escrever",
  );
  if (doAlvo === "dentro" || !capa || !campos.enterprise_id) return doAlvo;

  const daMinuta = await alcanceDaMinuta(admin, ator, campos.enterprise_id, "escrever");
  if (daMinuta === "dentro") return "dentro";
  if (doAlvo === "falha" || daMinuta === "falha") return "falha";
  return doAlvo === "so-consulta" || daMinuta === "so-consulta" ? "so-consulta" : "fora";
}

export async function lerAnexos(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
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

  // ⚠️ CADA NÍVEL INFORMADO É CONFERIDO, e é também o que protege o `.or()` abaixo: o valor só entra
  // no filtro depois de casar, inteiro, com um id do alcance. Um `37,categoria_id.not.is.null`
  // forjado não casa com nada e para aqui. A categoria lê pelo filho (ela mora no pai).
  const barrado = respostaDoAlcance(
    await alcanceDoAlvo(admin, ator, { categoriaId, enterpriseId, unidadeId }, "parcial"),
  );
  if (barrado) return barrado;

  // ⚠️ NO PORTAL, A CATEGORIA DO PAI SÓ ABRE SE FOR DELE (revisão da onda 3, 16/09/2026). O pai com
  // um filho no alcance basta para ler a categoria, e isso abria os anexos da categoria criada só
  // para os lotes do Lino (VOL) a quem tem só o VOC. A régua é a mesma da lista de categorias:
  // categoria com lote no alcance, ou sem lote nenhum.
  if (ator.tipo === "portal" && categoriaId) {
    const lidas = await unidadesDasCategorias(admin, [categoriaId]);
    if (!lidas.ok) {
      return NextResponse.json(
        { error: "Não foi possível conferir o acesso agora." },
        { status: 503 },
      );
    }
    const visiveis = await categoriasVisiveisAoPortal(admin, ator, [categoriaId], lidas.unidades);
    if (!visiveis.has(categoriaId)) return foraDoEscopo();
  }

  // ⚠️ OS TRÊS NÍVEIS VÊM JUNTOS quando a tela pede os três, porque quem decide o que entra no
  // contrato é quem o MONTA, não o banco.
  //
  // ⚠️ E O QUE ELE DECIDE MUDOU EM 21/09/2026: os níveis SOMAM. Até aqui a nota dizia que a
  // precedência era "unidade > categoria > empreendimento" e que devolver um nível só esconderia
  // do operador que a unidade sobrescreve a categoria. Não sobrescreve mais: o contrato leva as
  // peças dos quatro degraus juntas, na ordem da POSIÇÃO, e a posição passou a ser única na cadeia
  // inteira. Ver `anexos-da-venda.ts`. A lista completa continua vindo pelo mesmo motivo — agora
  // para o operador ver tudo o que vai junto no papel.
  let consulta = admin.from("temis_anexos").select(COLUNAS_DO_ANEXO).eq("ativo", true);
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

  const anexos = ((data ?? []) as LinhaDoAnexo[]).map(anexoParaATela);

  return NextResponse.json(
    {
      // ⚠️ OS ALCANCES POSSÍVEIS VIAJAM JUNTO, e é isso que dá porta ao pedido do Lucas
      // (21/09/2026): *"preciso garantir que consigamos vincular os anexos por filho, categoria"*.
      // A tela de anexos recebia só um `enterpriseId` e mandava só ele: `temis_anexos` aceita os
      // três alcances desde a 0156 e o banco EXIGE exatamente um, mas não havia como criar linha de
      // categoria — medido em 21/09/2026, `temis_anexos` tinha ZERO linhas e continuaria sem
      // nenhuma de categoria, porque não havia porta.
      //
      // ⚠️ QUEM RESOLVE É O SERVIDOR, e não a tela. A ficha consolidada manda `group:Lagoa Bonita`,
      // as categorias moram no PAI e as divisões são do cadastro: se a tela montasse essa lista, ela
      // e o motor discordariam sobre onde a peça mora.
      alcances: await alcancesDoAnexo(admin, ator, request, enterpriseId),
      // ⚠️ O CAMINHO DO ARQUIVO NÃO SAI PARA O PORTAL. A tela não o usa (abre pelo id), o portal não
      // abre o bucket por caminho, e a chave do Storage só serve para mapear o que existe na casa.
      anexos:
        ator.tipo === "portal" ? anexos.map(({ storagePath: _caminho, ...semCaminho }) => semCaminho) : anexos,
    },
    { headers: SEM_CACHE },
  );
}

/** Um lugar onde um anexo pode ser pendurado, com o nome que o operador conhece. */
type AlcancePossivel = { id: string; nome: string; tipo: "categoria" | "empreendimento" };

/**
 * Onde este anexo pode ser pendurado: o pai, cada divisão e cada categoria da família.
 *
 * ⚠️ BEST-EFFORT: falha aqui devolve lista vazia, e a tela cai no alcance único de sempre. É uma
 * lista de ESCOLHA, não um recorte de segurança — quem confere se o alcance escolhido é do ator
 * continua sendo `alcanceDaPasta`, na gravação.
 */
async function alcancesDoAnexo(
  admin: Admin,
  ator: AtorDaTemis,
  request: Request,
  enterpriseId: string,
): Promise<AlcancePossivel[]> {
  if (!enterpriseId) return [];
  try {
    const codigo = new URL(request.url).searchParams.get("codigo");
    const dono = (await empreendimentoDasCategorias(admin, ator, enterpriseId, codigo)) ?? enterpriseId;
    if (dono.startsWith(PREFIXO_DO_CONSOLIDADO)) return [];

    const { data: produtos } = await admin
      .from("hercules_empreendimentos")
      .select("c2x_enterprise_id,id,nome,pai_id")
      .eq("workspace_id", WORKSPACE)
      .eq("c2x_enterprise_id", dono)
      .maybeSingle();
    const raiz = produtos as null | { id: string; nome: null | string };
    if (!raiz) return [];

    const { data: irmas } = await admin
      .from("hercules_empreendimentos")
      .select("c2x_enterprise_id,id,nome")
      .eq("workspace_id", WORKSPACE)
      .eq("pai_id", raiz.id)
      .order("nome", { ascending: true });

    const lista: AlcancePossivel[] = [
      { id: dono, nome: raiz.nome ?? dono, tipo: "empreendimento" },
    ];
    for (const d of (irmas ?? []) as Array<{ c2x_enterprise_id: null | string; nome: null | string }>) {
      const id = texto(d.c2x_enterprise_id);
      // ⚠️ DIVISÃO SEM `c2x_enterprise_id` NÃO ENTRA: a unidade guarda esse id, e sem ele a cadeia
      // do contrato nunca chegaria à peça. Oferecer seria prometer o que o motor não cumpre.
      if (!id || id === dono) continue;
      lista.push({ id, nome: d.nome ?? id, tipo: "empreendimento" });
    }

    const { data: categorias } = await admin
      .from("temis_categorias")
      .select("id,nome,ativa")
      .eq("workspace_id", WORKSPACE)
      .eq("enterprise_id", dono)
      .order("nome", { ascending: true });
    for (const c of (categorias ?? []) as Array<{ ativa: boolean | null; id: string; nome: null | string }>) {
      if (c.ativa === false) continue;
      lista.push({ id: c.id, nome: c.nome ?? "categoria sem nome", tipo: "categoria" });
    }

    return lista;
  } catch (erro) {
    console.error("[temis/anexos] não consegui montar os alcances possíveis", erro);
    return [];
  }
}

export async function gravarAnexo(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
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

    // ⚠️ A MINUTA E O ARQUIVO, OS DOIS. Só a minuta no alcance deixaria o portal pendurar na capa
    // do contrato dele o PDF que outro dono subiu (bastava conhecer o caminho). Trocar a capa é
    // escrita na minuta: só na de produto que o portal opera.
    const barradoMinuta = respostaDoAlcance(
      await alcanceDaMinuta(admin, ator, minutaId, "escrever"),
    );
    if (barradoMinuta) return barradoMinuta;
    if (path && ator.tipo === "portal") {
      const pasta = pastaDoCaminho(path);
      const barradoPasta = respostaDoAlcance(
        pasta ? await alcanceDaPasta(admin, ator, pasta, true) : "fora",
      );
      if (barradoPasta) return barradoPasta;
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
    registrarAtoDoPortal(ator, path ? "capa trocada" : "capa retirada", { minutaId, path });
    return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
  }

  // ⚠️ O CONSOLIDADO NÃO VIRA ALCANCE CRU. A ficha agrupada do Apolo manda `group:Lagoa Bonita`,
  // que é RÓTULO do catálogo e não chave: não existe `enterprise_id` igual a isso em tabela nenhuma.
  // Até 21/09/2026 este alcance era gravado como veio, a tela LISTAVA o anexo (ela filtra pelo mesmo
  // id cru) e o contrato saa sem a peça, sem erro e sem aviso. Resolver aqui, na GRAVAÇÃO, é a
  // mesma coisa que `criarCategoria` e `editarCategoria` já faziam — a assimetria era só do anexo.
  //
  // ⚠️ E QUANDO NÃO RESOLVE, RECUSA. Três famílias têm a raiz sem `c2x_enterprise_id` (LOX, PDX,
  // RDX, medido na mesma data): para elas não existe id de empreendimento nenhum, e a cadeia do
  // contrato nunca alcançaria a peça. Recusar nomeando a saída é melhor do que aceitar um arquivo
  // que ninguém vai ver no papel.
  const cruDoCorpo = texto(corpo.enterpriseId);
  if (cruDoCorpo.startsWith(PREFIXO_DO_CONSOLIDADO)) {
    const resolvido = await empreendimentoDasCategorias(
      admin,
      ator,
      cruDoCorpo,
      typeof corpo.codigo === "string" ? corpo.codigo : null,
    );
    if (!resolvido || resolvido.startsWith(PREFIXO_DO_CONSOLIDADO)) {
      return NextResponse.json(
        {
          error:
            "Esta ficha é a visão consolidada do produto e não tem id de empreendimento. Escolha a divisão (ou a categoria) a que este anexo pertence.",
        },
        { status: 400 },
      );
    }
    corpo.enterpriseId = resolvido;
  }

  const alcance = lerAlcance(corpo);
  if (alcance.erro || !alcance.campos || !alcance.pasta) {
    return NextResponse.json({ error: alcance.erro ?? "Alcance invalido." }, { status: 400 });
  }

  // ⚠️ O ALCANCE DO CORPO É CONFERIDO ANTES DE ASSINAR OU GRAVAR QUALQUER COISA. Gravar é escrita:
  // a categoria do consolidado só entra se o pai inteiro for do ator.
  const barrado = respostaDoAlcance(
    await alcanceDaPasta(admin, ator, alcance.campos, acao === "upload" && corpo.capa === true),
  );
  if (barrado) return barrado;

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
    const assinada = await admin.storage.from(APOLO_DOCS_BUCKET).createSignedUploadUrl(caminho);

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

    // ⚠️ NO PORTAL, O ARQUIVO TEM DE ESTAR NA PASTA DO ALCANCE QUE ELE REGISTRA. O corpo traz as duas
    // coisas separadas; sem isto, o portal registraria no produto dele o PDF que outro dono subiu.
    if (
      ator.tipo === "portal" &&
      !path.startsWith(`${PREFIXO_ANEXO}${alcance.pasta}/`) &&
      !path.startsWith(`${PREFIXO_CAPA}${alcance.pasta}/`)
    ) {
      return foraDoEscopo();
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
        // Hub: `hub_users.id`. Portal: `apolo_incorporador_usuarios.id`; o nome com a origem, ao
        // lado, diz de qual tabela é (a coluna existe desde a 0156 e nunca tinha sido preenchida).
        criado_por: idDoAutor(ator) || null,
        criado_por_nome: nomeComOrigem(ator),
        nome,
        posicao,
        storage_path: path,
      })
      .select(COLUNAS_DO_ANEXO)
      .single<LinhaDoAnexo>();

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

    registrarAtoDoPortal(ator, "anexo registrado", {
      ...alcance.campos,
      anexoId: data.id,
      posicao,
    });
    return NextResponse.json({ anexo: anexoParaATela(data) }, { headers: SEM_CACHE });
  }

  return NextResponse.json({ error: "Acao desconhecida." }, { status: 400 });
}

export async function desativarAnexo(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Informe o anexo." }, { status: 400 });

  const barrado = respostaDoAlcance(await alcanceDoAnexo(admin, ator, id));
  if (barrado) return barrado;

  const { error } = await gravarComAutoria(COLUNAS_DA_0173.temis_anexos, (comAutoria) =>
    admin
      .from("temis_anexos")
      .update({
        ativo: false,
        atualizado_em: new Date().toISOString(),
        ...(comAutoria ? { desativado_por_nome: nomeComOrigem(ator) } : {}),
      })
      .eq("id", id),
  );

  if (error) {
    console.warn("[temis/anexos] desativar falhou:", error.message);
    return NextResponse.json({ error: "Nao foi possivel desativar o anexo." }, { status: 500 });
  }

  registrarAtoDoPortal(ator, "anexo desativado", { anexoId: id });
  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}

// ════════════════════════════════════════════════════════════════════════════
// O QUADRO DE ASSINATURA DO EMPREENDIMENTO — tabela na migration 0158
// ════════════════════════════════════════════════════════════════════════════
//
// Lucas (13/09/2026): *"a vendedora eu posso ter mais de um assinante, então vamos ter que liberar
// para vendedora também a inclusão das assinaturas igual a testemunha (...) Testemunha a mesma
// coisa, e coordenador de vendas a mesma coisa, eu posso ter mais de um como coordenador"*.
//
// ⚠️ TRÊS PAPÉIS DO CONTRATO, E SÓ TRÊS. Comprador e cônjuge saem da PROPOSTA e nunca daqui: digitar
// o comprador abriria a porta para o contrato dizer uma pessoa e o envelope ir para outra, e o
// defeito só apareceria meses depois. O captador não entra — decisão do Lucas no mesmo dia.
//
// ⚠️ A VENDEDORA VEM COM UMA LINHA QUE NÃO ESTÁ NA TABELA. O representante legal cadastrado na PJ
// (`apolo_relationships`) é devolvido junto, marcado `origem: "representante"` e SEM id: ele é
// derivado do cadastro da empresa, não uma linha daqui. Guardá-lo aqui criaria uma segunda verdade
// sobre quem representa a empresa.
//
// ⚠️ E EXISTE UM QUARTO PAPEL, QUE NÃO É DO CONTRATO: `termos_vendedora`. Lucas (20/09/2026):
// *"essa tela determina os assinantes (...) nessa tela vc pode abrir mais um campo para assinatura
// de termos vendedora, ae eu posso apontar quem vai assinar os termos, não precisa necessariamente
// ser os representantes legais, pode ser o juridico, analista, enfim"*. É quem a incorporadora
// apontou para assinar os TERMOS que a Careli emite sobre a carteira dela — hoje o termo de acordo
// do Hades. Ele mora na mesma tabela porque é a mesma forma (uma pessoa, presa ao empreendimento,
// com posição e ordem), e NÃO no papel `vendedora` porque a pergunta é outra: um analista apontado
// para assinar termos não pode virar, no mesmo instante, quem assina a compra e venda. Quem garante
// essa separação é `lib/assinatura/quadro-db.ts`, que só traduz para o contrato os papéis do seu
// mapa. Depende da migration 0180 para ser GRAVADO; a leitura funciona sem ela.

const POSICAO_MAXIMA_NO_QUADRO = 9;
const ORDEM_MAXIMA = 20;

/** A migration que libera o papel `termos_vendedora` no check da tabela. */
export const MIGRATION_DO_ASSINANTE_DE_TERMOS = "0180_assinante_de_termos_da_vendedora";

export const PAPEIS_DO_QUADRO = [
  "vendedora",
  "coordenador",
  "testemunha",
  // ⚠️ ÚLTIMO, E FORA DO CONTRATO. Ver a nota do bloco acima: acrescentar no fim é o que deixa as
  // telas que iteram esta lista mostrarem o papel novo DEPOIS dos três de sempre, sem reordenar o
  // que o operador já conhece.
  "termos_vendedora",
] as const;
export type PapelDoQuadro = (typeof PAPEIS_DO_QUADRO)[number];

/**
 * O papel que SÓ A CARELI aponta, e quem fecha essa porta é o servidor.
 *
 * ⚠️ ESCONDER O CAMPO NA TELA NÃO É FECHAR A PORTA (revisão de 20/09/2026). O cartão do quadro nasce
 * com a caixa dos termos desligada no portal da Cecílio (`comAssinantesDeTermos`), mas as duas
 * portas — `/api/temis/assinantes` (hub) e `/api/incorporador/temis/assinantes` (portal) — chamam as
 * MESMAS `incluirAssinante` e `removerAssinante`, e a única lista conferida era `PAPEIS_DO_QUADRO`.
 * Um POST direto do portal com este papel passava dentro do alcance daquele incorporador, e um
 * DELETE apagava o apontado pela Careli, sem nada na tela dizendo que aconteceu.
 *
 * ⚠️ E O TERMO É INSTRUMENTO DA COBRANÇA DA CARELI, não do produto do incorporador: é a Careli que
 * emite, paga o envelope e responde pelo que ele diz. Quem assina por ela do lado da vendedora é
 * uma escolha da casa, e o portal continua com o CONTRATO inteiro (vendedora, coordenador,
 * testemunha), que é o que aquela equipe confecciona.
 *
 * ⚠️ 404, E NÃO 403 (`foraDoEscopo`): para o portal este papel não existe, é a mesma frase de
 * qualquer id de fora. Dizer "você não pode" confirmaria que há o que apontar ali.
 */
export const PAPEL_SO_DA_CARELI: PapelDoQuadro = "termos_vendedora";

function fechadoParaOPortal(ator: AtorDaTemis, papel: string): NextResponse | null {
  return ator.tipo !== "hub" && papel === PAPEL_SO_DA_CARELI ? foraDoEscopo() : null;
}

const COLUNAS_DO_ASSINANTE =
  "id,enterprise_id,papel,posicao,ordem_assinatura,nome,cpf,email,entity_id,observacao,origem";

type LinhaDoAssinante = {
  cpf: null | string;
  email: null | string;
  enterprise_id: string;
  entity_id: null | string;
  id: string;
  nome: string;
  observacao: null | string;
  ordem_assinatura: null | number;
  origem: null | string;
  papel: string;
  posicao: number;
};

export type AssinanteDoQuadro = {
  cpf: null | string;
  email: null | string;
  /** `null` na linha herdada do cadastro da PJ — ela não se edita nem se apaga aqui. */
  id: null | string;
  nome: string;
  ordemAssinatura: null | number;
  origem: null | string;
  papel: PapelDoQuadro;
  posicao: number;
};

function assinanteParaATela(l: LinhaDoAssinante): AssinanteDoQuadro {
  return {
    cpf: l.cpf,
    email: l.email,
    id: l.id,
    nome: l.nome,
    ordemAssinatura: l.ordem_assinatura,
    origem: l.origem,
    papel: l.papel as PapelDoQuadro,
    posicao: l.posicao,
  };
}

const inteiro = (v: unknown): null | number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Os campos, conferidos.
 *
 * ⚠️ O E-MAIL DECIDE SE A PESSOA CONSEGUE ASSINAR, e por isso é exigido aqui. No provedor o
 * signatário É o e-mail — sem endereço próprio, a conferência do envio recusa a pessoa e o envelope
 * não sai.
 *
 * ⚠️ O CPF É CONFERIDO MAS NÃO EXIGIDO. A Clicksign pede CPF formatado, então sem ele a pessoa
 * também não assina — mas o operador cadastra antes de ter o documento na mão. Quando vier, tem de
 * ser válido: dígito errado vira 400 no meio do envio, com o envelope já criado.
 */
function conferirAssinante(corpo: Record<string, unknown>) {
  const papel = texto(corpo.papel) as PapelDoQuadro;
  const nome = texto(corpo.nome);
  const email = texto(corpo.email).toLowerCase();
  const cpfCru = soDigitos(texto(corpo.cpf));
  const posicao = inteiro(corpo.posicao);
  const ordem =
    corpo.ordemAssinatura == null || texto(corpo.ordemAssinatura) === ""
      ? null
      : inteiro(corpo.ordemAssinatura);

  if (!PAPEIS_DO_QUADRO.includes(papel)) {
    return { erro: "Papel invalido para o quadro de assinatura." };
  }
  if (nome.split(/\s+/).filter(Boolean).length < 2) {
    return { erro: "Informe o nome COMPLETO: e ele que vai impresso no contrato." };
  }
  if (!email || !email.includes("@") || /\s/.test(email)) {
    return { erro: "Informe o e-mail: sem ele a pessoa nao recebe o convite para assinar." };
  }
  if (cpfCru && !cpfValido(cpfCru)) {
    return { erro: "O CPF nao confere. Deixe em branco se ainda nao tiver o documento." };
  }
  if (posicao === null || posicao < 1 || posicao > POSICAO_MAXIMA_NO_QUADRO) {
    return {
      erro: `A posicao vai de 1 a ${POSICAO_MAXIMA_NO_QUADRO}: e ela que numera a linha no contrato.`,
    };
  }
  if (ordem !== null && (ordem < 1 || ordem > ORDEM_MAXIMA)) {
    return {
      erro: `A ordem de assinatura vai de 1 a ${ORDEM_MAXIMA}, ou em branco para seguir o papel.`,
    };
  }

  return {
    valores: {
      cpf: cpfCru ? formatarDocumento(cpfCru) : null,
      email,
      nome,
      observacao: texto(corpo.observacao) || null,
      ordem_assinatura: ordem,
      papel,
      posicao,
    },
  };
}

/**
 * O representante legal da vendedora do empreendimento — a linha que o quadro já mostra preenchida.
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA O QUADRO. Se a leitura do representante falhar, o resto da tela ainda
 * vale: as pessoas digitadas continuam aparecendo.
 */
async function representanteDoCadastro(
  admin: Admin,
  enterpriseId: string,
  papel: PapelDoQuadro,
): Promise<AssinanteDoQuadro | null> {
  try {
    // ⚠️ TRÊS COLUNAS, TRÊS PAPÉIS. `vendedor_entity_id` é a incorporadora;
    // `coordenadora_entity_id` é a Coordenação de Vendas da casa (a Gurgel, a mesma em todos os
    // produtos); `coordenador_entity_id` (0159) é quem o C2X registrou como coordenador daquele
    // empreendimento. Trocar essas três já pôs o captador no lugar do coordenador uma vez.
    //
    // ⚠️ O PAPEL `coordenador` HERDA DA COORDENADORA — Lucas, 22/09/2026: *"a gurgel assina sim"*.
    // Até esta data a TELA herdava de `coordenador_entity_id` e o CONTRATO imprimia
    // `coordenadora_entity_id`: no Vale do Ouro o papel dizia HUBER (que não tem representante legal
    // cadastrado, então o quadro mostrava "Ninguém aqui") enquanto o contrato imprimia a Gurgel. As
    // duas leituras passam a ser a mesma, e `coordenador_entity_id` fica como QUEDA para o produto
    // que ainda não teve a coordenação apontada (o ACP e o LOS, medidos no dia).
    //
    // ⚠️ `termos_vendedora` HERDA DA MESMA EMPRESA QUE `vendedora`, e por isso está do lado de cá do
    // ternário. É a mesma incorporadora: o que muda é o DOCUMENTO que aquela pessoa assina. Deixá-lo
    // cair no `else` (como um terceiro papel faria por descuido) mostraria no campo dos termos o
    // representante da COORDENADORA de vendas — outra empresa, outra pessoa, e ninguém olhando a
    // tela teria como desconfiar.
    const daVendedora = papel === "vendedora" || papel === "termos_vendedora";

    const { data: settings } = await admin
      .from("apolo_enterprise_settings")
      .select("vendedor_entity_id, coordenadora_entity_id, coordenador_entity_id")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle<Record<string, null | string>>();

    const empresa = daVendedora
      ? settings?.vendedor_entity_id
      : (settings?.coordenadora_entity_id ?? settings?.coordenador_entity_id);
    if (!empresa) return null;

    const { data: vinculo } = await admin
      .from("apolo_relationships")
      .select("related_entity_id")
      .eq("entity_id", empresa)
      .eq("relationship_type", "representante_legal")
      .limit(1)
      .maybeSingle<{ related_entity_id: null | string }>();

    const pessoaId = vinculo?.related_entity_id;
    if (!pessoaId) return null;

    const [{ data: pessoa }, { data: contatos }] = await Promise.all([
      admin
        .from("apolo_entities")
        .select("display_name, document_masked")
        .eq("id", pessoaId)
        .maybeSingle<{ display_name: string; document_masked: null | string }>(),
      admin
        .from("apolo_contacts")
        .select("contact_type, value")
        .eq("entity_id", pessoaId)
        .eq("contact_type", "email")
        .limit(1),
    ]);

    if (!pessoa?.display_name) return null;

    return {
      cpf: pessoa.document_masked,
      email: ((contatos ?? []) as Array<{ value: null | string }>)[0]?.value ?? null,
      id: null,
      nome: pessoa.display_name,
      ordemAssinatura: null,
      origem: "representante",
      papel,
      posicao: 1,
    };
  } catch {
    return null;
  }
}

export async function lerQuadroDeAssinatura(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const enterpriseId = (new URL(request.url).searchParams.get("enterpriseId") ?? "").trim();
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  // ⚠️ ANTES DO REPRESENTANTE TAMBÉM: ele traz nome, CPF mascarado e e-mail de uma pessoa.
  const barrado = respostaDoAlcance(await alcanceDoEmpreendimento(admin, ator, enterpriseId));
  if (barrado) return barrado;

  const [{ data, error }, ...herdados] = await Promise.all([
    admin
      .from("temis_assinantes")
      .select(COLUNAS_DO_ASSINANTE)
      .eq("workspace_id", WORKSPACE)
      .eq("enterprise_id", enterpriseId)
      .eq("ativo", true)
      .order("papel", { ascending: true })
      .order("posicao", { ascending: true }),
    representanteDoCadastro(admin, enterpriseId, "vendedora"),
    representanteDoCadastro(admin, enterpriseId, "coordenador"),
    // ⚠️ O REPRESENTANTE VAI TAMBÉM NO PAPEL DOS TERMOS, PORQUE ELE É O ÚLTIMO DEGRAU. O envio do
    // termo cai nele quando ninguém foi apontado E ninguém ocupou o papel `vendedora` (ver
    // `assinanteDeTermosDaVendedora` e `incorporadorDoAcordo`). Ele sai daqui como CANDIDATO, e não
    // como veredito: quem decide qual das linhas a caixa dos termos mostra como "assina os termos"
    // é `filaDosTermos`, no cartão, que tem a lista inteira na mão e espelha a cadeia do envio.
    // Decidir aqui obrigaria esta leitura a conhecer o papel `vendedora` para responder sobre o
    // papel dos termos, e são duas perguntas que o cartão já faz juntas.
    representanteDoCadastro(admin, enterpriseId, "termos_vendedora"),
  ]);

  if (error) {
    console.warn("[temis/assinantes] leitura falhou:", error.message);
    return NextResponse.json({ error: "Nao foi possivel ler o quadro." }, { status: 500 });
  }

  const gravados = ((data ?? []) as LinhaDoAssinante[]).map(assinanteParaATela);

  // ⚠️ O HERDADO SÓ ENTRA SE NINGUÉM OCUPOU A POSIÇÃO 1 DAQUELE PAPEL. Quem digitou uma linha ali
  // decidiu que é aquela pessoa que assina primeiro; empurrar a herdada por cima faria o quadro
  // mostrar duas pessoas na mesma linha do contrato.
  const cabe = (h: AssinanteDoQuadro) =>
    !gravados.some((a) => a.papel === h.papel && a.posicao === 1);

  const assinantes = [
    ...herdados.filter((h): h is AssinanteDoQuadro => Boolean(h)).filter(cabe),
    ...gravados,
  ].map((assinante) => ({ ...assinante, cpf: cpfParaOAtor(ator, assinante.cpf) }));

  return NextResponse.json({ assinantes }, { headers: SEM_CACHE });
}

/**
 * O CPF de um assinante como este ator pode ver.
 *
 * ⚠️ O PORTAL VÊ SÓ OS DOIS ÚLTIMOS DÍGITOS (revisão da onda 3, 16/09/2026). `document_masked` do
 * representante guarda hoje o CPF INTEIRO (ver `formatDocument` em cadastro-persist.ts), e as
 * testemunhas e o coordenador do quadro costumam ser gente da Careli: o GET do portal entregava o
 * documento completo dessas pessoas a quem é de fora. O quadro precisa só saber que o CPF está lá;
 * quem monta o envelope é o servidor, que lê a linha inteira. O hub continua vendo tudo.
 *
 * Um CPF mascarado reenviado pela tela não é gravado: `conferirAssinante` recusa CPF que não fecha
 * os dígitos.
 */
function cpfParaOAtor(ator: AtorDaTemis, cpf: null | string): null | string {
  if (ator.tipo === "hub" || !cpf) return cpf;
  const digitos = soDigitos(cpf);
  return digitos.length >= 2 ? `***.***.***-${digitos.slice(-2)}` : "***";
}

export async function incluirAssinante(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as null | Record<string, unknown>;
  if (!corpo) return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });

  const enterpriseId = texto(corpo.enterpriseId);
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  // ⚠️ ANTES DE TUDO, E SEM IR AO BANCO. Ver `PAPEL_SO_DA_CARELI`: a caixa dos termos é da Careli, e
  // escondê-la na tela não fechava a porta. Recusar aqui, antes do alcance, também é o que impede o
  // portal de descobrir pela resposta se aquele empreendimento é dele.
  const soDaCareli = fechadoParaOPortal(ator, texto(corpo.papel));
  if (soDaCareli) return soDaCareli;

  // Incluir é escrita: no portal, só no quadro do produto que ele opera.
  const barrado = respostaDoAlcance(await alcanceParaEscrever(admin, ator, enterpriseId));
  if (barrado) return barrado;

  const { erro, valores } = conferirAssinante(corpo);
  if (erro || !valores) return NextResponse.json({ error: erro }, { status: 400 });

  const { data, error } = await admin
    .from("temis_assinantes")
    .insert({
      ...valores,
      criado_por: idDoAutor(ator) || null,
      // A coluna existe desde a 0157 e nunca tinha sido preenchida; com o portal gravando no mesmo
      // quadro, é ela que diz se a testemunha entrou pela Careli ou pelo incorporador.
      criado_por_nome: nomeComOrigem(ator),
      enterprise_id: enterpriseId,
    })
    .select(COLUNAS_DO_ASSINANTE)
    .single<LinhaDoAssinante>();

  if (error) {
    // ⚠️ 23505 É A TRAVA DA POSIÇÃO, e ela é POR PAPEL: vendedora 1 e testemunha 1 convivem. Sem
    // dizer isso, o operador lê "posicao ocupada" olhando para um quadro onde aquele número parece
    // livre.
    const ocupada = error.code === "23505";
    // ⚠️ 23514 É O CHECK DO PAPEL, E HOJE ELE SÓ ESTOURA NUM CASO: `termos_vendedora` antes da
    // migration 0180. O código sobe antes dela (a leitura do quadro não precisa de nada novo), e um
    // "Nao foi possivel gravar o assinante" seco mandaria o operador conferir o nome, o CPF e o
    // e-mail que ele digitou certo. A frase nomeia a migration, como a do envio do acordo nomeia a
    // 0179.
    const papelNaoLiberado = error.code === "23514";
    console.warn("[temis/assinantes] insert falhou:", error.message);
    const recado = papelNaoLiberado
      ? `O banco ainda nao aceita o papel "${valores.papel}": falta aplicar a migration ${MIGRATION_DO_ASSINANTE_DE_TERMOS}. Avise quem cuida do banco; os outros papeis do quadro continuam funcionando.`
      : ocupada
        ? await fraseDaLinhaOcupada(admin, enterpriseId, valores)
        : "Nao foi possivel gravar o assinante.";
    return NextResponse.json(
      { error: recado },
      { status: papelNaoLiberado ? 503 : ocupada ? 409 : 500 },
    );
  }

  registrarAtoDoPortal(ator, "assinante incluído", {
    assinanteId: data.id,
    enterpriseId,
    papel: valores.papel,
  });
  return NextResponse.json({ assinante: assinanteParaATela(data) }, { headers: SEM_CACHE });
}

/**
 * A frase da linha já ocupada, dizendo DE QUEM ela é e como sair do impasse.
 *
 * ⚠️ A FRASE ANTIGA FOI LIDA COMO OUTRA COISA. Ela dizia "A posicao 4 ja esta ocupada em
 * testemunha neste empreendimento", com a chave interna do papel, e a Nívea entendeu que o sistema
 * não aceitava uma segunda testemunha: *"Ele nao esta aceitando 02 testemunhas"* (22/09/2026).
 * Cabem NOVE por papel; o que estava ocupado era a LINHA 4, onde já morava a YASMIN.
 *
 * ⚠️ O NOME DO OCUPANTE CUSTA UM SELECT, e ele só roda no caminho do erro. É o que transforma a
 * recusa em instrução: quem lê sabe qual linha escolher sem abrir outra tela.
 */
async function fraseDaLinhaOcupada(
  admin: Admin,
  enterpriseId: string,
  valores: { papel: string; posicao: number },
): Promise<string> {
  const rotulo = ROTULO_DO_PAPEL[valores.papel] ?? valores.papel;
  let dono = "";
  try {
    const { data } = await admin
      .from("temis_assinantes")
      .select("nome")
      .eq("workspace_id", WORKSPACE)
      .eq("enterprise_id", enterpriseId)
      .eq("papel", valores.papel)
      .eq("posicao", valores.posicao)
      .eq("ativo", true)
      .maybeSingle<{ nome: null | string }>();
    dono = String(data?.nome ?? "").trim();
  } catch {
    // Sem o nome a frase continua útil: o que resolve é a instrução do fim.
  }

  return (
    `A linha ${valores.posicao} de ${rotulo} ` +
    (dono ? `ja e de ${dono}. ` : "ja esta ocupada. ") +
    "Cabem varias pessoas neste papel: use outra linha, ou deixe o campo Linha em branco que o quadro numera sozinho."
  );
}

/** O nome do papel como a tela o escreve. A frase de erro fala com gente, nao com o banco. */
const ROTULO_DO_PAPEL: Record<string, string> = {
  coordenador: "Coordenador de Vendas",
  termos_vendedora: "Assinatura de termos (vendedora)",
  testemunha: "Testemunhas",
  vendedora: "Vendedora",
};

/**
 * ⚠️ DESATIVA, NÃO APAGA. Um contrato já enviado carrega o nome no envelope e o diário da
 * assinatura aponta para esta linha; apagar deixaria a trilha do que já aconteceu sem o nome de
 * quem assinou.
 */
export async function removerAssinante(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Informe o assinante." }, { status: 400 });

  // ⚠️ O PAPEL DA LINHA É CONFERIDO ANTES DO ALCANCE, E SÓ PARA O PORTAL. O alcance responde "este
  // empreendimento é seu?", e a linha dos TERMOS está num empreendimento que É do incorporador —
  // então o alcance diz sim, e o DELETE apagava o apontado pela Careli. A pergunta que faltava é
  // outra: quem aponta quem assina os termos da carteira é a Careli (ver `PAPEL_SO_DA_CARELI`). A
  // consulta extra só acontece do lado do portal; para o hub nada disto roda.
  if (ator.tipo !== "hub") {
    const { data: linha } = await admin
      .from("temis_assinantes")
      .select("papel")
      .eq("id", id)
      .maybeSingle<{ papel: null | string }>();
    const soDaCareli = fechadoParaOPortal(ator, String(linha?.papel ?? ""));
    if (soDaCareli) return soDaCareli;
  }

  const barrado = respostaDoAlcance(await alcanceDoAssinante(admin, ator, id));
  if (barrado) return barrado;

  const { error } = await gravarComAutoria(COLUNAS_DA_0173.temis_assinantes, (comAutoria) =>
    admin
      .from("temis_assinantes")
      .update({
        ativo: false,
        atualizado_em: new Date().toISOString(),
        ...(comAutoria ? { desativado_por_nome: nomeComOrigem(ator) } : {}),
      })
      .eq("id", id),
  );

  if (error) {
    console.warn("[temis/assinantes] desativar falhou:", error.message);
    return NextResponse.json({ error: "Nao foi possivel remover o assinante." }, { status: 500 });
  }

  registrarAtoDoPortal(ator, "assinante removido", { assinanteId: id });
  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}

// ════════════════════════════════════════════════════════════════════════════
// FAIXAS DE PRAZO DO EMPREENDIMENTO — no portal, SOMENTE LEITURA
// ════════════════════════════════════════════════════════════════════════════
//
//   GET    → as faixas de um empreendimento, mais os índices cadastrados
//   POST   → cria uma faixa
//   PATCH  → edita uma faixa
//   DELETE → desativa (não apaga)
//
// Lucas (13/09/2026): *"em vez de cadastrar os juros e correção dentro de um plano, ter um cadastro
// de juros e correção separado por parcelas"*, e *"Faixa é por empreendimento"*.
//
// ⚠️ FAIXA DE PRAZO, NUNCA "FAIXA DE PARCELAS": aqui "1 a 12" quer dizer PLANOS DE 1 A 12
// PARCELAS, e não as parcelas 1 a 12 de um contrato.
//
// ⚠️ DESATIVAR, NUNCA APAGAR — a mesma regra do plano e do índice. Uma faixa desativada continua
// explicando o plano que ela gerou; apagá-la deixaria o plano sem origem.
//
// ⚠️ A SOBREPOSIÇÃO É RECUSADA PELO BANCO, não por esta função. A `exclude` da migration 0155 usa
// `int4range` e cobre até a corrida entre duas abas abertas ao mesmo tempo. Aqui só se traduz o erro
// para uma frase que o operador entende.
//
// ⚠️ PLANOS E FAIXAS CONTINUAM COM A CARELI (decisão de 16/09/2026). A faixa decide quanto o
// comprador paga de juros; o portal lê para montar a simulação e o contrato, e não grava.

/** O empreendimento é TEXT porque convive com id numérico e agrupamento. */
function empreendimentoDaUrl(request: Request): null | string {
  const valor = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  return valor || null;
}

/** `23P01` é a violação de `exclude` — a única que precisa virar texto de gente. */
function erroDaFaixa(codigo: string | undefined, mensagem: string): string {
  if (codigo === "23P01") {
    return "Já existe uma faixa ativa cobrindo parte desse intervalo de parcelas.";
  }
  if (codigo === "23503") {
    return "O índice escolhido não está cadastrado.";
  }
  return mensagem;
}

function linhaDaFaixa(entrada: EntradaDeFaixa) {
  return {
    define_entrada: entrada.defineEntrada,
    define_indice: entrada.defineIndice,
    define_juros: entrada.defineJuros,
    entrada_percentual: entrada.defineEntrada ? entrada.entradaPercentual : null,
    indice_correcao: entrada.defineIndice ? entrada.indiceCorrecao : null,
    juros_convencao: entrada.jurosConvencao,
    juros_periodicidade: entrada.jurosPeriodicidade,
    // ⚠️ NULO AQUI É "SEM JUROS", e não "não informado": é a faixa "1 a 12 sem juros" do exemplo do
    // Lucas. Quem diz se a faixa opina sobre juros é `define_juros`.
    juros_taxa: entrada.defineJuros ? entrada.jurosTaxa : null,
    observacao: entrada.observacao,
    parcela_maxima: entrada.parcelaMaxima,
    parcela_minima: entrada.parcelaMinima,
  };
}

export async function lerFaixas(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const barrado = respostaDoAlcance(await alcanceDoEmpreendimento(admin, ator, enterpriseId));
  if (barrado) return barrado;

  const [faixasRes, indicesRes] = await Promise.all([
    admin
      .from("temis_faixas_de_prazo")
      .select(
        "id, parcela_minima, parcela_maxima, define_entrada, entrada_percentual, define_juros, juros_taxa, juros_periodicidade, juros_convencao, define_indice, indice_correcao, ativo, observacao, criado_em",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("enterprise_id", enterpriseId)
      .order("parcela_minima", { ascending: true }),
    // ⚠️ OS ÍNDICES VÊM JUNTO, e da TABELA (migration 0154) — não de uma lista no código. Era assim
    // que nasciam as cinco cópias divergentes que esta casa tinha até 13/09/2026.
    admin
      .from("temis_indices")
      .select("codigo, sigla, nome, aplicacao, fonte, exige_parametro, ordem")
      .eq("workspace_id", WORKSPACE)
      .eq("ativo", true)
      .order("ordem", { ascending: true }),
  ]);

  if (faixasRes.error) {
    return NextResponse.json({ error: faixasRes.error.message }, { status: 500 });
  }
  if (indicesRes.error) {
    return NextResponse.json({ error: indicesRes.error.message }, { status: 500 });
  }

  return NextResponse.json(
    { data: { faixas: faixasRes.data ?? [], indices: indicesRes.data ?? [] } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function criarFaixa(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const somenteLeitura = somenteLeituraNoPortal(ator);
  if (somenteLeitura) return somenteLeitura;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const corpo = (await request.json().catch(() => null)) as null | EntradaDeFaixa;
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const problemas = conferirFaixa(corpo);
  if (problemas.length > 0) {
    return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { data, error } = await admin
    .from("temis_faixas_de_prazo")
    .insert({
      ...linhaDaFaixa(corpo),
      criado_por: idDoAutor(ator),
      enterprise_id: enterpriseId,
      workspace_id: WORKSPACE,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: erroDaFaixa(error.code, error.message) },
      { status: error.code === "23P01" ? 409 : 500 },
    );
  }

  return NextResponse.json({ data: { id: (data as null | { id: string })?.id ?? null } });
}

export async function editarFaixa(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const somenteLeitura = somenteLeituraNoPortal(ator);
  if (somenteLeitura) return somenteLeitura;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Informe a faixa." }, { status: 400 });

  const corpo = (await request.json().catch(() => null)) as null | EntradaDeFaixa;
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const problemas = conferirFaixa(corpo);
  if (problemas.length > 0) {
    return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { error } = await admin
    .from("temis_faixas_de_prazo")
    .update({ ...linhaDaFaixa(corpo), atualizado_em: new Date().toISOString() })
    .eq("workspace_id", WORKSPACE)
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: erroDaFaixa(error.code, error.message) },
      { status: error.code === "23P01" ? 409 : 500 },
    );
  }

  return NextResponse.json({ data: { ok: true } });
}

export async function desativarFaixa(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const somenteLeitura = somenteLeituraNoPortal(ator);
  if (somenteLeitura) return somenteLeitura;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Informe a faixa." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // ⚠️ DESATIVA, NÃO APAGA. E desativar LIBERA o intervalo: a `exclude` da 0155 é parcial
  // (`where (ativo)`), então a faixa antiga não impede a nova de ocupar o mesmo prazo.
  const { error } = await admin
    .from("temis_faixas_de_prazo")
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq("workspace_id", WORKSPACE)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: { ok: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// CATEGORIAS — o agrupamento livre de planos dentro do empreendimento. No portal, SÓ LEITURA
// ════════════════════════════════════════════════════════════════════════════
//
// Pedido do Lucas (01/09/2026): *"empreendimento já vai vir do apolo, ae eu posso criar as
// subcategorias"*. Ela existe para dar nome ao que no legado ficava escondido no arquivo: o JDG tem
// seis planos, três internos e três externos, e a diferença só aparecia em "JDG-EXTERNA-...".
//
// ⚠️ NO PORTAL, A CATEGORIA É LIDA PELO FILHO E RECORTADA. Ela mora no PAI por desenho (o VLO, 35,
// é o pai do VOC da Cecílio e do VOL do Lino), e a da divisão é a mesma do conjunto. O portal lê o
// nome, a ordem e a hierarquia; a contagem de lotes e a ordem de assinatura herdada contam só as
// divisões do alcance, porque o resto é de outro dono.

/**
 * O empreendimento onde as categorias moram.
 *
 * ⚠️ A CATEGORIA VIVE NO PAI, e o filho lê de lá. O Lagoa Bonita é o caso vivo: LBF, LBP e LBR são
 * o jeito que o LEGADO tinha de dividir um empreendimento — criar três produtos para separar o que
 * é um só. A categoria é justamente o que substitui isso (Lucas, 07/09/2026: *"o Condomínio e o
 * Loteamento não interfere nos filhos, é tudo junto"*, e *"isso é porque o legado não tem essa
 * arquitetura que estamos fazendo no Panteon, estamos exatamente resolvendo isso"*).
 *
 * ⚠️ DUPLICAR O CADASTRO NOS TRÊS SERIA CARREGAR A LIMITAÇÃO DO C2X PARA DENTRO DO PANTEON: três
 * "Condomínio" para manter em dia, e o dia em que um deles ficar para trás ninguém percebe.
 *
 * Falha aqui devolve o próprio id: sem cadastro, o empreendimento responde por si — que é o que
 * acontece com os 35 produtos que não têm pai.
 *
 * ⚠️ `null` SÓ NO PORTAL: o `codigo` da URL apontou para uma divisão fora do alcance. Sem esta
 * conferência, o id do grupo (que é do ator) com o código de OUTRO produto leria as categorias dele.
 */
async function empreendimentoDasCategorias(
  admin: Admin,
  ator: AtorDaTemis,
  enterpriseId: string,
  codigo?: null | string,
): Promise<null | string> {
  try {
    // ⚠️ A FICHA CONSOLIDADA NÃO TEM ID DE EMPREENDIMENTO. Quando o produto é agrupado, o Apolo
    // monta a linha com `id: "group:Lagoa Bonita"` — um rótulo, não uma chave: não existe
    // `enterprise_id` igual a isso em tabela nenhuma. Foi assim que as duas categorias do Lagoa
    // Bonita, criadas e carimbadas em 495 lotes, apareceram como "nenhuma categoria" na tela.
    //
    // O caminho de volta é o CÓDIGO de uma das etapas (LBF, LBR, LBP), que a ficha já tem em mãos:
    // dele se acha o empreendimento, e do empreendimento se sobe ao pai.
    const porGrupo = enterpriseId.startsWith("group:");
    const chave = porGrupo ? (codigo ?? "").trim() : enterpriseId;
    if (porGrupo && !chave) return enterpriseId;

    const consulta = admin
      .from("hercules_empreendimentos")
      .select("pai_id,c2x_enterprise_id")
      .eq("workspace_id", WORKSPACE);

    const { data } = await (porGrupo
      ? consulta.eq("codigo", chave)
      : consulta.eq("c2x_enterprise_id", chave)
    ).maybeSingle();

    const achado = data as null | { c2x_enterprise_id?: null | string; pai_id: null | string };
    if (porGrupo && achado && ator.tipo === "portal") {
      if (!enterpriseNoAlcance(ator, achado.c2x_enterprise_id)) return null;
    }

    const paiId = achado?.pai_id;
    if (!paiId) return enterpriseId;

    const { data: pai } = await admin
      .from("hercules_empreendimentos")
      .select("c2x_enterprise_id")
      .eq("id", paiId)
      .maybeSingle();

    return (pai as null | { c2x_enterprise_id: null | string })?.c2x_enterprise_id ?? enterpriseId;
  } catch {
    return enterpriseId;
  }
}

/** A ordem de assinatura que o empreendimento oferece às suas categorias. */
type HerancaDoEmpreendimento = {
  /** Quando as divisões discordam entre si, a frase de cada uma. Nulo = todas dizem o mesmo. */
  divergencia: null | string[];
  /** `false` = a leitura FALHOU. Não é "não tem regra" — ver a nota da função. */
  lido: boolean;
  nivel: NivelDeOrdem;
};

/**
 * A ordem de assinatura cadastrada no empreendimento — o degrau abaixo da categoria.
 *
 * ⚠️ LÊ O PAI E AS DIVISÕES, e não só o pai. A categoria mora no PAI, mas a aba de política grava a
 * configuração nas DIVISÕES — manda LBF (33), LBP (32) e LBR (27), nunca o 31. Olhar só o pai faria a
 * tela dizer "herda o padrão da casa" com a ordem cadastrada nas três divisões logo ali.
 *
 * ⚠️ E QUANDO AS DIVISÕES DISCORDAM, A TELA DIZ ISSO em vez de escolher uma.
 *
 * ⚠️ FALHA DE LEITURA NÃO VIRA "NÃO TEM REGRA". Um timeout do PostgREST viraria uma AFIRMAÇÃO de
 * negócio na tela ("segue o padrão da casa"). `lido: false` faz a tela dizer que não sabe.
 *
 * ⚠️ NO PORTAL, SÓ AS DIVISÕES DO ALCANCE (e o pai, se o conjunto inteiro for do ator). A ordem de
 * assinatura da divisão do Lino não é da Cecílio, nem como aviso de divergência.
 */
async function ordemDoEmpreendimento(
  admin: Admin,
  ator: AtorDaTemis,
  dono: string,
  nomeVisivel: string,
): Promise<HerancaDoEmpreendimento> {
  const semRegra: NivelDeOrdem = {
    ordem: null,
    ordenada: false,
    origem: "empreendimento",
    rotulo: nomeVisivel,
  };

  const { data: pai } = await admin
    .from("hercules_empreendimentos")
    .select("id,nome")
    .eq("workspace_id", WORKSPACE)
    .eq("c2x_enterprise_id", dono)
    .maybeSingle();

  const paiRow = pai as null | { id: string; nome: null | string };
  const rotulo = new Map<string, string>([[dono, paiRow?.nome ?? nomeVisivel]]);
  const ids = [dono];
  const idsDosFilhos: string[] = [];

  if (paiRow) {
    const { data: filhos } = await admin
      .from("hercules_empreendimentos")
      .select("codigo,c2x_enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("pai_id", paiRow.id);

    for (const filho of (filhos ?? []) as Array<{
      c2x_enterprise_id: null | string;
      codigo: null | string;
    }>) {
      const id = (filho.c2x_enterprise_id ?? "").trim();
      idsDosFilhos.push(id);
      if (!id || ids.includes(id)) continue;
      ids.push(id);
      rotulo.set(id, filho.codigo ?? id);
    }
  }

  const visiveis =
    ator.tipo === "hub"
      ? ids
      : ids.filter((id) =>
          id === dono
            ? enterpriseNoAlcance(ator, dono) || paiNoAlcance(ator, idsDosFilhos, "inteiro")
            : enterpriseNoAlcance(ator, id),
        );

  if (visiveis.length === 0) return { divergencia: null, lido: true, nivel: semRegra };

  const { data: settings, error } = await admin
    .from("apolo_enterprise_settings")
    .select("enterprise_id,assinatura_ordenada,assinatura_ordem")
    .in("enterprise_id", visiveis);

  if (error) return { divergencia: null, lido: false, nivel: semRegra };

  const linhas = ((settings ?? []) as Array<{
    assinatura_ordem: unknown;
    assinatura_ordenada: boolean | null;
    enterprise_id: string;
  }>).filter((linha) =>
    temOrdemPropria({ ordem: linha.assinatura_ordem, ordenada: linha.assinatura_ordenada === true }),
  );

  if (linhas.length === 0) return { divergencia: null, lido: true, nivel: semRegra };

  const niveis = linhas.map((linha) => ({
    id: String(linha.enterprise_id),
    nivel: {
      ordem: linha.assinatura_ordem,
      ordenada: linha.assinatura_ordenada === true,
      origem: "empreendimento" as const,
      rotulo: rotulo.get(String(linha.enterprise_id)) ?? nomeVisivel,
    },
  }));

  // O pai manda quando ele mesmo tem regra; senão vale a primeira divisão que tiver.
  const escolhido = niveis.find((n) => n.id === dono) ?? niveis[0];

  const distintas = new Set(
    niveis.map((n) =>
      JSON.stringify([n.nivel.ordenada, gruposDaRegra(regraDoNivel(n.nivel)).flat()]),
    ),
  );

  return {
    divergencia:
      distintas.size > 1
        ? niveis.map(
            (n) => `${n.nivel.rotulo}: ${descreverRegra(regraDoNivel(n.nivel), rotuloDoPapel)}`,
          )
        : null,
    lido: true,
    nivel: { ...(escolhido?.nivel ?? semRegra), rotulo: paiRow?.nome ?? nomeVisivel },
  };
}

type UnidadeDaCategoria = {
  /** 0171. Ausente quando a leitura caiu sem as colunas do apartamento. */
  apartamento?: null | string;
  categoria_id: null | string;
  enterprise_id: null | string;
  lote: null | string;
  quadra: null | string;
  torre?: null | string;
};

/**
 * Os lotes carimbados nestas categorias, de mil em mil.
 *
 * ⚠️ PAGINA: o PostgREST corta em 1.000 linhas SEM ERRO, e o Lagoa Bonita já tem 907 lotes
 * carimbados. Sem paginar, a contagem pararia de crescer calada no milésimo registro.
 *
 * `ok: false` = alguma página falhou; `unidades` traz o que foi lido até ali (o hub conta com isso,
 * como sempre contou; o portal recusa, porque sem os lotes não prova de quem é a categoria).
 */
async function unidadesDasCategorias(
  admin: Admin,
  categoriaIds: readonly string[],
): Promise<{ ok: boolean; unidades: UnidadeDaCategoria[] }> {
  const unidades: UnidadeDaCategoria[] = [];
  let extras = COLUNAS_DO_APARTAMENTO;
  for (let de = 0; ; de += 1000) {
    const { data: pagina, error } = await admin
      .from("hercules_unidades")
      .select(`categoria_id,quadra,lote,enterprise_id${extras}`)
      .eq("workspace_id", WORKSPACE)
      .in("categoria_id", [...categoriaIds])
      .order("id", { ascending: true })
      .range(de, de + 999);
    // Sem a 0171 não há apartamento: a mesma página é lida de novo sem as colunas.
    if (error && extras && ehColunaDaUnidadeVerticalAusente(error)) {
      extras = "";
      de -= 1000;
      continue;
    }
    if (error) return { ok: false, unidades };
    const linhasDaPagina = (pagina ?? []) as unknown as UnidadeDaCategoria[];
    unidades.push(...linhasDaPagina);
    if (linhasDaPagina.length < 1000) return { ok: true, unidades };
  }
}

/**
 * As categorias que ESTE ATOR vê. Hub: todas, sem consulta.
 *
 * Portal (revisão da onda 3, 16/09/2026): a categoria mora no PAI, e o pai com um filho no alcance
 * abre a leitura. Sem recorte, quem tem só o VOC via o nome (e os anexos) da categoria criada só para
 * os lotes do Lino. A régua: a categoria com PELO MENOS UM lote no alcance "inteiro", ou a que não
 * tem lote nenhum (a recém-criada, que ainda não é de ninguém). A de lotes só de outro dono some.
 */
async function categoriasVisiveisAoPortal(
  admin: Admin,
  ator: AtorDaTemis,
  categoriaIds: readonly string[],
  unidades: readonly UnidadeDaCategoria[],
): Promise<Set<string>> {
  if (ator.tipo === "hub") return new Set(categoriaIds);

  const noAlcance = filtroDeAlcance(admin, ator);
  const comLote = new Set<string>();
  const comLoteNoAlcance = new Set<string>();
  for (const unidade of unidades) {
    if (!unidade.categoria_id) continue;
    comLote.add(unidade.categoria_id);
    if (comLoteNoAlcance.has(unidade.categoria_id)) continue;
    if (await noAlcance(unidade.enterprise_id)) comLoteNoAlcance.add(unidade.categoria_id);
  }

  return new Set(categoriaIds.filter((id) => comLoteNoAlcance.has(id) || !comLote.has(id)));
}

/**
 * As categorias do empreendimento, com quantos lotes cada uma tem.
 *
 * ⚠️ A CONTAGEM DE LOTES É O QUE TORNA A EXCLUSÃO HONESTA. Apagar uma categoria devolve os lotes
 * dela à regra geral do produto — e quem clica precisa saber que são doze, e não zero, ANTES de
 * confirmar.
 */
export async function lerCategorias(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // Leitura: o pai com um filho no alcance basta. Ver o topo do bloco.
  const barrado = respostaDoAlcance(
    await alcanceDoEmpreendimento(admin, ator, enterpriseId, "parcial"),
  );
  if (barrado) return barrado;

  const dono = await empreendimentoDasCategorias(
    admin,
    ator,
    enterpriseId,
    new URL(request.url).searchParams.get("codigo"),
  );
  if (!dono) return foraDoEscopo();

  const { data, error } = await admin
    .from("temis_categorias")
    .select("id,nome,categoria_pai_id,ordem,assinatura_ordenada,assinatura_ordem,minuta_id")
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", dono)
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Não consegui ler as categorias." }, { status: 502 });
  }

  const linhas = (data ?? []) as Array<{
    assinatura_ordem: unknown;
    assinatura_ordenada: boolean | null;
    categoria_pai_id: null | string;
    id: string;
    minuta_id?: null | string;
    nome: string;
  }>;

  const porCategoria = new Map<string, number>();
  let visiveis = new Set(linhas.map((c) => c.id));
  if (linhas.length > 0) {
    const noAlcance = filtroDeAlcance(admin, ator);
    const lidas = await unidadesDasCategorias(
      admin,
      linhas.map((c) => c.id),
    );
    // ⚠️ NO PORTAL, SEM LER OS LOTES NÃO SE SABE QUAL CATEGORIA É DELE, e a resposta é o erro de
    // leitura de sempre (502), nunca a lista inteira. O hub segue contando o que leu, como fazia.
    if (!lidas.ok && ator.tipo === "portal") {
      return NextResponse.json({ error: "Não consegui ler as categorias." }, { status: 502 });
    }
    const { unidades } = lidas;
    visiveis = await categoriasVisiveisAoPortal(
      admin,
      ator,
      linhas.map((c) => c.id),
      unidades,
    );

    // ⚠️ CONTA LOTE, E NÃO REGISTRO. No Lagoa Bonita o mesmo lote existe duas vezes — uma no pai e
    // outra na etapa —, e somar as linhas diria "750 lotes de condomínio" onde há 400. A chave é
    // quadra + lote, que é o que identifica o terreno independentemente de por qual nível se olha.
    const vistos = new Set<string>();
    for (const linha of unidades) {
      if (!linha.categoria_id) continue;
      // No portal, só os lotes das divisões do alcance: a carteira do outro dono não se conta aqui.
      if (!(await noAlcance(linha.enterprise_id))) continue;
      // O apartamento conta pela chave dele: quadra e lote nulos juntariam o prédio inteiro num só.
      const chave = ehUnidadeVertical(linha)
        ? `${linha.categoria_id}:apartamento:${chaveDaUnidade("vertical", linha)}`
        : `${linha.categoria_id}:${linha.quadra ?? ""}:${linha.lote ?? ""}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      porCategoria.set(linha.categoria_id, (porCategoria.get(linha.categoria_id) ?? 0) + 1);
    }
  }

  const heranca = await ordemDoEmpreendimento(
    admin,
    ator,
    dono,
    new URL(request.url).searchParams.get("nome")?.trim() || "o empreendimento",
  );

  // ⚠️ AS MINUTAS QUE A CATEGORIA PODE APONTAR SÃO AS DO DONO DELA, e só. Lucas (21/09/2026):
  // *"vincular os anexos por filho, categoria. também as minutas"*. A cadeia do contrato lê
  // `temis_categorias.minuta_id` como PRIMEIRO degrau (`cadeia-do-contrato.ts`) e a escolha passa
  // pela régua de família (`minuta-da-cadeia.ts`): a minuta tem de ser de um produto que esteja na
  // cadeia da venda. O dono da categoria é o PAI da família, e o pai está na cadeia de todo lote
  // dela — oferecer a minuta de uma divisão irmã deixaria a tela propor algo que o motor recusaria
  // na hora de imprimir.
  const { data: publicadas } = await admin
    .from("temis_minutas")
    .select("id,nome,versao")
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", dono)
    .eq("situacao", "publicada")
    .eq("tipo", "contrato")
    .order("nome", { ascending: true });

  const minutas = ((publicadas ?? []) as Array<{ id: string; nome: null | string; versao: null | number }>)
    .map((m) => ({ id: m.id, nome: m.nome ?? "minuta sem nome", versao: m.versao ?? null }));
  const porMinuta = new Map(minutas.map((m) => [m.id, m]));

  // ⚠️ A SUBCATEGORIA NÃO HERDA DA MÃE, E A TELA NÃO PODE PROMETER QUE HERDA. Quem manda o contrato é
  // `regraDeOrdemDaVenda` (`lib/assinatura/ordem-db.ts`) e ele vai da categoria DIRETO ao
  // empreendimento. Se esta tela mostrasse "Fase 1 herda de Loteamento", o envio ignoraria a mãe e o
  // contrato sairia na ordem do empreendimento: a tela dizendo uma coisa e o contrato fazendo outra.
  const herdada = resolverOrdemDeAssinatura([heranca.nivel]);

  return NextResponse.json({
    data: {
      // ⚠️ NO PORTAL, SÓ A CATEGORIA QUE É DELE (revisão da onda 3, 16/09/2026): com lote no alcance,
      // ou sem lote nenhum. A categoria criada só para os lotes do Lino (VOL) não aparece para quem
      // tem só o VOC, nem o nome. A mãe que ficou de fora não é citada pela filha visível.
      categorias: linhas.filter((c) => visiveis.has(c.id)).map((c) => {
        // O que ESTA categoria decide por si. Herda = o par intacto (booleano falso, lista nula).
        const nivelDaCategoria: NivelDeOrdem = {
          ordem: c.assinatura_ordem,
          ordenada: c.assinatura_ordenada === true,
          origem: "categoria",
          rotulo: c.nome,
        };
        const propria = temOrdemPropria(nivelDaCategoria) ? regraDoNivel(nivelDaCategoria) : null;

        const minutaId = c.minuta_id ?? null;
        return {
          categoriaPaiId:
            ator.tipo === "hub" || (c.categoria_pai_id && visiveis.has(c.categoria_pai_id))
              ? c.categoria_pai_id
              : null,
          id: c.id,
          // ⚠️ O NOME VEM JUNTO DO ID. Uma tela de herança que mostra só um uuid faz o operador
          // abrir outra aba para saber o que está vinculado — e é assim que ele deixa como está.
          minuta: minutaId
            ? (porMinuta.get(minutaId) ?? { id: minutaId, nome: "minuta que não está publicada aqui", versao: null })
            : null,
          nome: c.nome,
          ordemHerdada:
            // ⚠️ SÓ AFIRMA "PADRÃO DA CASA" SE A LEITURA DO EMPREENDIMENTO DEU CERTO. Com a leitura
            // falha, cair no padrão é conclusão de uma consulta que não aconteceu.
            herdada.origem === "padrao" && !heranca.lido
              ? null
              : {
                  ordenada: herdada.regra.ordenada,
                  origem: herdada.origem,
                  papeis: gruposDaRegra(herdada.regra).flat(),
                  rotulo: herdada.rotulo,
                },
          ordemPropria: propria
            ? { ordenada: propria.ordenada, papeis: gruposDaRegra(propria).flat() }
            : null,
          unidades: porCategoria.get(c.id) ?? 0,
        };
      }),
      // A divergência é do EMPREENDIMENTO, e não de uma categoria: vale para todas de uma vez.
      divergenciaDoEmpreendimento: heranca.divergencia,
      /** As minutas publicadas que a categoria pode apontar. Vazio = não há o que escolher. */
      minutasDisponiveis: minutas,
    },
  });
}

export async function criarCategoria(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const somenteLeitura = somenteLeituraNoPortal(ator);
  if (somenteLeitura) return somenteLeitura;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });

  const corpo = (await request.json().catch(() => null)) as null | {
    categoriaPaiId?: null | string;
    nome?: string;
    ordem?: number;
  };
  const nome = corpo?.nome?.trim();
  if (!nome) return NextResponse.json({ error: "A categoria precisa de um nome." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const dono = await empreendimentoDasCategorias(
    admin,
    ator,
    enterpriseId,
    new URL(request.url).searchParams.get("codigo"),
  );

  const { data, error } = await admin
    .from("temis_categorias")
    .insert({
      // ⚠️ A SUBCATEGORIA É A MESMA TABELA, apontando para a mãe. *"eu posso criar uma subcategoria
      // da categoria"* — e a profundidade é do negócio: condomínio dentro de loteamento, fase dentro
      // de condomínio. Uma tabela separada para o segundo nível impediria o terceiro.
      categoria_pai_id: corpo?.categoriaPaiId ?? null,
      // A categoria nasce no PAI, para o filho não ter cadastro próprio do mesmo recorte.
      enterprise_id: dono ?? enterpriseId,
      nome,
      // ⚠️ A CATEGORIA NASCE HERDANDO, e a ordem de assinatura não entra no formulário de criação:
      // `assinatura_ordem` fica nula (o default da 0142) e a categoria segue o empreendimento até
      // alguém decidir o contrário, olhando a ordem herdada que a tela mostra.
      ordem: corpo?.ordem ?? 0,
      workspace_id: WORKSPACE,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "Já existe uma categoria com esse nome neste empreendimento."
            : "Não consegui criar a categoria.",
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ data: { id: (data as { id: string }).id } });
}

export async function editarCategoria(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const somenteLeitura = somenteLeituraNoPortal(ator);
  if (somenteLeitura) return somenteLeitura;

  const enterpriseId = empreendimentoDaUrl(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!enterpriseId || !id) {
    return NextResponse.json({ error: "Informe o empreendimento e a categoria." }, { status: 400 });
  }

  const corpo = (await request.json().catch(() => null)) as null | {
    ativa?: boolean;
    // ⚠️ AUSENTE ≠ NULO, a mesma disciplina da rota de política comercial: ausente = não mexeu na
    // ordem; `assinaturaOrdem: null` = limpou, e a categoria volta a herdar do empreendimento.
    assinaturaOrdem?: null | unknown;
    assinaturaOrdenada?: unknown;
    // Ausente = não mexeu na minuta; `null` = limpou, e a categoria volta a HERDAR o modelo de cima.
    minutaId?: null | string;
    nome?: string;
    ordem?: number;
  };
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const mudancas: Record<string, boolean | null | number | string | string[]> = {
    atualizado_em: new Date().toISOString(),
  };
  if (corpo.nome !== undefined) {
    const nome = corpo.nome.trim();
    if (!nome) return NextResponse.json({ error: "A categoria precisa de um nome." }, { status: 400 });
    mudancas.nome = nome;
  }
  if (corpo.ordem !== undefined) mudancas.ordem = corpo.ordem;
  if (corpo.ativa !== undefined) mudancas.ativa = corpo.ativa;

  // ⚠️ A LISTA É VALIDADA AQUI, NA PORTA. Papel inexistente, papel repetido e lista vazia não
  // derrubam nada na gravação: derrubam semanas depois, no envio do contrato, longe desta tela e
  // sem ninguém para ligar uma coisa à outra.
  const daOrdem = lerOrdemDoCorpo(corpo);
  if (!daOrdem.ok) return NextResponse.json({ error: daOrdem.erro }, { status: 400 });
  if (daOrdem.mudancas) {
    mudancas.assinatura_ordem = daOrdem.mudancas.assinatura_ordem;
    mudancas.assinatura_ordenada = daOrdem.mudancas.assinatura_ordenada;
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // ⚠️ FILTRA PELO DONO, E NÃO PELO ID DA URL. A ficha consolidada manda `group:Lagoa Bonita` e a
  // ficha de uma etapa manda 33 (LBF), mas as categorias moram no PAI (31) — o `.eq` no id cru
  // casava com zero linhas e o `update` voltava SEM ERRO. A tela dizia "salvo" e nada tinha sido
  // gravado.
  const dono =
    (await empreendimentoDasCategorias(
      admin,
      ator,
      enterpriseId,
      new URL(request.url).searchParams.get("codigo"),
    )) ?? enterpriseId;

  // ⚠️ A MINUTA DA CATEGORIA É CONFERIDA NA PORTA, e não só na hora de imprimir. Lucas
  // (21/09/2026): *"vincular os anexos por filho, categoria. também as minutas"*. Este campo é o
  // PRIMEIRO degrau da cadeia do contrato: ele vence a divisão e o empreendimento. Deixar entrar um
  // id qualquer aqui faria a venda descobrir o problema no 409 da geração, semanas depois e longe
  // desta tela — e um id de OUTRO produto imprimiria o contrato do loteamento errado, que é
  // exatamente o que `empreendimentosQueServem` passou a impedir em 16/09/2026 no caminho irmão.
  if (corpo.minutaId !== undefined) {
    const pedida = String(corpo.minutaId ?? "").trim();
    if (!pedida) {
      mudancas.minuta_id = null;
    } else {
      const { data: minuta, error: erroDaMinuta } = await admin
        .from("temis_minutas")
        .select("id,nome,situacao,tipo,enterprise_id")
        .eq("workspace_id", WORKSPACE)
        .eq("id", pedida)
        .maybeSingle();

      if (erroDaMinuta) {
        return NextResponse.json({ error: "Não consegui ler a minuta escolhida." }, { status: 502 });
      }
      const linha = minuta as null | {
        enterprise_id: null | string;
        nome: null | string;
        situacao: null | string;
        tipo: null | string;
      };
      if (!linha) {
        return NextResponse.json({ error: "Minuta não encontrada." }, { status: 404 });
      }
      if (String(linha.enterprise_id ?? "") !== dono) {
        return NextResponse.json(
          {
            error: `A minuta "${linha.nome ?? pedida}" é de outro empreendimento e não serve para esta categoria.`,
          },
          { status: 409 },
        );
      }
      if (linha.situacao !== "publicada" || linha.tipo !== "contrato") {
        return NextResponse.json(
          {
            error: `A minuta "${linha.nome ?? pedida}" está ${linha.situacao ?? "sem situação"} e não pode virar contrato. Publique-a antes de vincular.`,
          },
          { status: 409 },
        );
      }
      mudancas.minuta_id = pedida;
    }
  }

  const { data: salvas, error } = await admin
    .from("temis_categorias")
    .update(mudancas)
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", dono)
    .eq("id", id)
    .select("id");

  // ⚠️ ZERO LINHAS É ERRO, e não sucesso silencioso: a categoria não é deste empreendimento (ou não
  // existe mais) e quem clicou precisa saber disso agora, não quando o contrato sair na ordem errada.
  if (!error && (salvas ?? []).length === 0) {
    return NextResponse.json(
      { error: "Não achei esta categoria neste empreendimento. Recarregue a tela." },
      { status: 404 },
    );
  }

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "Já existe uma categoria com esse nome neste empreendimento."
            : "Não consegui salvar a categoria.",
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ data: { id } });
}

export async function apagarCategoria(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const somenteLeitura = somenteLeituraNoPortal(ator);
  if (somenteLeitura) return somenteLeitura;

  const enterpriseId = empreendimentoDaUrl(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!enterpriseId || !id) {
    return NextResponse.json({ error: "Informe o empreendimento e a categoria." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // ⚠️ SUBCATEGORIA PRIMEIRO. A 0139 poe `on delete restrict` na autorreferencia, entao o banco
  // recusaria — mas com o erro cru do Postgres, que nao diz a ninguem o que fazer. Conferir aqui
  // devolve a frase com o NOME das filhas.
  const { data: filhas, error: erroFilhas } = await admin
    .from("temis_categorias")
    .select("nome")
    .eq("workspace_id", "careli")
    .eq("categoria_pai_id", id);

  if (erroFilhas) {
    return NextResponse.json({ error: "Não consegui conferir as subcategorias." }, { status: 503 });
  }

  const dentro = (filhas ?? []) as Array<{ nome: string }>;
  if (dentro.length > 0) {
    return NextResponse.json(
      {
        error: `Esta categoria tem ${dentro.length === 1 ? "a subcategoria" : "as subcategorias"} ${dentro
          .map((c) => `"${c.nome}"`)
          .join(", ")}. Exclua ${dentro.length === 1 ? "ela" : "elas"} antes.`,
      },
      { status: 409 },
    );
  }

  // ⚠️ CONTA OS PLANOS ANTES. O banco tem `on delete set null`, então apagar a categoria NÃO daria
  // erro: os planos apenas perderiam a organização em silêncio, e no JDG isso significa seis planos
  // virando uma lista plana onde ninguém mais distingue interno de externo.
  const { count, error: erroConta } = await admin
    .from("temis_planos")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", "careli")
    .eq("categoria_id", id);

  if (erroConta) {
    return NextResponse.json({ error: "Não consegui conferir os planos da categoria." }, { status: 503 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Esta categoria tem ${count} plano(s). Mova-os para outra categoria antes de apagar.`,
      },
      { status: 409 },
    );
  }

  // Mesmo motivo da edição: a categoria mora no PAI, e o id da URL pode ser o `group:` ou o da
  // etapa. Com o `.eq` no id cru, o `delete` casava zero linhas e voltava sem erro.
  const dono =
    (await empreendimentoDasCategorias(
      admin,
      ator,
      enterpriseId,
      new URL(request.url).searchParams.get("codigo"),
    )) ?? enterpriseId;

  const { data: apagadas, error } = await admin
    .from("temis_categorias")
    .delete()
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", dono)
    .eq("id", id)
    .select("id");

  if (error) return NextResponse.json({ error: "Não consegui apagar a categoria." }, { status: 400 });
  if ((apagadas ?? []).length === 0) {
    return NextResponse.json(
      { error: "Não achei esta categoria neste empreendimento. Recarregue a tela." },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { id } });
}

// ════════════════════════════════════════════════════════════════════════════
// VINCULAR UNIDADES A UMA CATEGORIA — no portal, SÓ LEITURA
// ════════════════════════════════════════════════════════════════════════════
//
// Lucas (15/09/2026): *"eu criei umas categorias mas não tem como eu vincular a unidade aquela
// categoria, não temos a tela de cadastro da unidade a qual eu posso vincular aquela unidade ao
// filho, categoria"*.
//
// ⚠️ ESTA É A PRIMEIRA ESCRITA DE `categoria_id` DO APLICATIVO. Até 15/09/2026 as 907 unidades
// carimbadas do Lagoa Bonita foram preenchidas por UPDATE cru no banco. Daqui em diante existe
// caminho, e ele deixa rastro.
//
// ⚠️ O ALCANCE É POR TERRENO, NÃO POR LINHA. Ver `lib/hercules/vinculo-da-unidade.ts`: o mesmo lote
// tem duas linhas nos produtos divididos, e carimbar só a que o operador clicou faria o mapa do pai
// e a Mesa de Venda discordarem sobre a categoria do mesmo terreno.
//
// ⚠️ E NÃO HÁ TRAVA POR VENDA EM ANDAMENTO, por decisão dele: *"não muda nada o que já está venda
// andando"*. A proposta congela as condições quando nasce.

/** Teto por chamada. Acima disto a tela pagina — ver o aviso do PostgREST abaixo. */
const TETO_DE_UNIDADES = 500;

/** A linha de `hercules_unidades` que o vínculo lê: o terreno, e o apartamento quando é prédio. */
type LinhaDoVinculo = LinhaParaVincular & {
  /** 0171. Ausente quando a leitura caiu sem as colunas do apartamento. */
  apartamento?: null | string;
  torre?: null | string;
};

/** A linha é um apartamento (prédio), e não um lote? A régua é a de `nome-da-unidade.ts`. */
function ehApartamento(linha: LinhaDoVinculo): boolean {
  return ehUnidadeVertical({ apartamento: linha.apartamento, lote: linha.lote, quadra: linha.quadra });
}

/**
 * A linha como a régua do vínculo (`planoDeVinculo`, `chaveDoTerreno`) a enxerga.
 *
 * ⚠️ O APARTAMENTO NÃO TEM QUADRA NEM LOTE (revisão da onda 2, achado 28). Na chave de terreno todos
 * eles caíam em "|": o vínculo recusava o prédio inteiro com "unidade sem quadra e sem lote", e a
 * lista de unidades juntava todos os apartamentos numa linha só. Aqui o apartamento ganha a chave
 * dele (torre + número, `chaveDaUnidade("vertical")`) no lugar do lote, com uma "quadra" que nenhum
 * loteamento usa. O lote passa intacto.
 */
function linhaParaOPlano<T extends LinhaDoVinculo>(linha: T): T {
  if (!ehApartamento(linha)) return linha;
  return { ...linha, lote: chaveDaUnidade("vertical", linha), quadra: "APARTAMENTO" };
}

type CorpoDoVinculo = {
  /** `null` desvincula: a unidade volta a não ter categoria. */
  categoriaId?: null | string;
  /** Os ids de `hercules_unidades` que o operador escolheu. */
  unidadeIds?: string[];
};

export async function vincularUnidadesACategoria(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const somenteLeitura = somenteLeituraNoPortal(ator);
  if (somenteLeitura) return somenteLeitura;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as CorpoDoVinculo | null;
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const escolhidos = [
    ...new Set((corpo.unidadeIds ?? []).map((i) => String(i ?? "").trim()).filter(Boolean)),
  ];
  if (escolhidos.length === 0) {
    return NextResponse.json({ error: "Escolha ao menos uma unidade." }, { status: 422 });
  }
  if (escolhidos.length > TETO_DE_UNIDADES) {
    return NextResponse.json(
      { error: `São no máximo ${TETO_DE_UNIDADES} unidades por vez.` },
      { status: 422 },
    );
  }

  const categoriaId = String(corpo.categoriaId ?? "").trim() || null;

  try {
    // 1) As linhas escolhidas, para saber de quais TERRENOS (ou apartamentos) estamos falando. Torre
    // e apartamento vêm junto, e sem eles se a 0171 ainda não foi aplicada (aí não há prédio).
    const { data: base, error: erroBase } = await lerComColunasDoApartamento((extras) =>
      admin
        .from("hercules_unidades")
        .select(`id,quadra,lote,enterprise_id${extras}`)
        .eq("workspace_id", WORKSPACE)
        .in("id", escolhidos),
    );

    if (erroBase) throw new Error((erroBase as { message?: string }).message ?? "leitura falhou");
    const escolhidas = (base ?? []) as unknown as LinhaDoVinculo[];
    if (escolhidas.length === 0) {
      return NextResponse.json({ error: "Unidades não encontradas." }, { status: 404 });
    }

    // 2) A categoria precisa existir — e a mensagem tem de dizer isso, não "não deu".
    if (categoriaId) {
      const { data: cat } = await admin
        .from("temis_categorias")
        .select("id,nome")
        .eq("workspace_id", WORKSPACE)
        .eq("id", categoriaId)
        .maybeSingle();
      if (!cat) {
        return NextResponse.json({ error: "Categoria não encontrada." }, { status: 404 });
      }
    }

    // 3) A FAMÍLIA INTEIRA do empreendimento, para achar os gêmeos.
    //
    // ⚠️ SEM ISTO O GÊMEO FICA DE FORA. A tela lista as unidades de UM nível; o terreno vive em
    // dois. Buscar a família é o que permite carimbar os dois lados numa gravação só.
    const enterprisesEscolhidos = [
      ...new Set(escolhidas.map((l) => String(l.enterprise_id ?? "")).filter(Boolean)),
    ];
    const familia = await idsDaFamilia(admin, enterprisesEscolhidos);

    const universo: LinhaDoVinculo[] = [];
    // ⚠️ PAGINA: o PostgREST corta em 1.000 linhas SEM ERRO, e o Lagoa Bonita tem 907 unidades só
    // na família dele. Sem paginar, o gêmeo do lote 908 em diante simplesmente não apareceria.
    let extras = COLUNAS_DO_APARTAMENTO;
    for (let de = 0; ; de += 1000) {
      const { data, error } = await admin
        .from("hercules_unidades")
        .select(`id,quadra,lote,enterprise_id${extras}`)
        .eq("workspace_id", WORKSPACE)
        .in("enterprise_id", familia)
        .range(de, de + 999);
      // Sem a 0171 não há apartamento: a mesma página é lida de novo sem as colunas.
      if (error && extras && ehColunaDaUnidadeVerticalAusente(error)) {
        extras = "";
        de -= 1000;
        continue;
      }
      if (error) throw new Error(error.message);
      const pagina = (data ?? []) as unknown as LinhaDoVinculo[];
      universo.push(...pagina);
      if (pagina.length < 1000) break;
    }

    // ⚠️ O PRÉDIO ENTRA NO PLANO PELA CHAVE DO APARTAMENTO (revisão da onda 2, achado 28). A régua
    // pura só conhece quadra + lote, e todo apartamento tem os dois nulos: sem a projeção, escolher um
    // apartamento carimbaria o prédio inteiro.
    const plano = planoDeVinculo(escolhidos, universo.map(linhaParaOPlano));
    if (plano.ids.length === 0) {
      return NextResponse.json({ error: "Nada a vincular." }, { status: 422 });
    }

    // ⚠️ LOTE SEM QUADRA E SEM LOTE NÃO TEM CHAVE DE TERRENO, e todos eles compartilham a mesma
    // chave vazia — um arrastaria os outros. Recusar é melhor do que carimbar o lote errado. A trava
    // vale só para o LOTEAMENTO: o apartamento (torre + número) tem chave própria.
    const semChave = escolhidas.filter((l) => !ehApartamento(l) && chaveDoTerreno(l) === "|");
    if (semChave.length > 0) {
      return NextResponse.json(
        {
          error:
            "Há unidade sem quadra e sem lote na seleção. Corrija o cadastro dela antes de vincular.",
        },
        { status: 409 },
      );
    }

    const agora = new Date().toISOString();
    let gravadas = 0;
    // Em lotes, pela mesma razão do `.in()` acima: a lista vai na URL.
    for (let de = 0; de < plano.ids.length; de += 200) {
      const { data, error } = await admin
        .from("hercules_unidades")
        .update({ atualizado_em: agora, categoria_id: categoriaId })
        .eq("workspace_id", WORKSPACE)
        .in("id", plano.ids.slice(de, de + 200))
        .select("id");
      if (error) throw new Error(error.message);
      gravadas += (data ?? []).length;
    }

    return NextResponse.json({
      data: {
        gravadas,
        // A tela diz "12 lotes" e não "24 linhas": é o que o operador escolheu.
        porParentesco: plano.porParentesco,
        terrenos: plano.terrenos,
      },
    });
  } catch (erro) {
    console.error("[temis][categorias][unidades]", erro);
    return NextResponse.json({ error: "Não foi possível vincular as unidades." }, { status: 500 });
  }
}

/**
 * As unidades da família, para a tela de vínculo escolher.
 *
 * ⚠️ VEM DO PANTEON, E NÃO DO C2X. A aba "Unidades" do Apolo lista o legado (MySQL) e por isso não
 * conhece `categoria_id` nem o id de `hercules_unidades` — não há como vincular a partir dela.
 *
 * ⚠️ E DEVOLVE UM TERRENO POR LINHA, não uma linha por registro. O mesmo lote existe no pai e na
 * gleba; mostrar os dois faria o operador escolher duas vezes o mesmo terreno. A linha VIVA (sem
 * `espelho_de`) é a que representa o terreno — é ela que a Mesa de Venda usa para vender.
 *
 * ⚠️ NO PORTAL, SÓ A FAMÍLIA DO ALCANCE. A família sobe ao pai e desce a TODOS os filhos, e sem o
 * recorte a Cecílio (VOC) receberia a lista de lotes do Lino (VOL). A linha do pai só entra para
 * quem tem o conjunto inteiro; o lote que só existe no pai fica fora para quem tem uma divisão.
 */
export async function lerUnidadesParaCategoria(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const url = new URL(request.url);
  const enterpriseId = String(url.searchParams.get("enterpriseId") ?? "").trim();
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const barrado = respostaDoAlcance(
    await alcanceDoEmpreendimento(admin, ator, enterpriseId, "parcial"),
  );
  if (barrado) return barrado;

  try {
    const familiaInteira = await idsDaFamilia(admin, [enterpriseId]);
    const noAlcance = filtroDeAlcance(admin, ator);
    const familia: string[] = [];
    for (const id of familiaInteira) {
      if (await noAlcance(id)) familia.push(id);
    }

    const linhas: Array<
      LinhaDoVinculo & {
        categoria_id: null | string;
        codigo: null | string;
        enterprise_id: null | string;
        espelho_de: null | string;
        situacao: null | string;
      }
    > = [];

    // Torre e apartamento vêm junto (o prédio), e a página é relida sem eles se a 0171 não entrou.
    let extras = COLUNAS_DO_APARTAMENTO;
    for (let de = 0; familia.length > 0; de += 1000) {
      const { data, error } = await admin
        .from("hercules_unidades")
        .select(`id,codigo,quadra,lote,situacao,categoria_id,enterprise_id,espelho_de${extras}`)
        .eq("workspace_id", WORKSPACE)
        .in("enterprise_id", familia)
        .order("quadra", { ascending: true })
        .order("lote", { ascending: true })
        .range(de, de + 999);
      if (error && extras && ehColunaDaUnidadeVerticalAusente(error)) {
        extras = "";
        de -= 1000;
        continue;
      }
      if (error) throw new Error(error.message);
      const pagina = (data ?? []) as unknown as typeof linhas;
      linhas.push(...pagina);
      if (pagina.length < 1000) break;
    }

    // ⚠️ UM TERRENO, UMA LINHA — e a escolhida é a VIVA. Entre o registro do pai e o da gleba, quem
    // responde pela venda é a gleba (é o que a coluna `espelho_de` marca, na migration 0161).
    // Quando só existe a linha do pai (83 lotes do Lagoa Bonita não têm gleba), ela mesma vale.
    const porTerreno = new Map<string, (typeof linhas)[number]>();
    for (const l of linhas) {
      // O apartamento responde pela chave dele (torre + número), e não pelo "|" de quadra e lote nulos.
      const chave = chaveDoTerreno(linhaParaOPlano(l));
      const atual = porTerreno.get(chave);
      if (!atual || (atual.espelho_de && !l.espelho_de)) porTerreno.set(chave, l);
    }

    const unidades = [...porTerreno.values()].map((l) => ({
      // Só o prédio traz os dois (a 0171); no loteamento seguem vazios, e a tela mostra quadra e lote.
      apartamento: l.apartamento ?? "",
      categoriaId: l.categoria_id,
      codigo: l.codigo ?? "",
      enterpriseId: String(l.enterprise_id ?? ""),
      id: l.id,
      lote: l.lote ?? "",
      quadra: l.quadra ?? "",
      situacao: l.situacao ?? "",
      torre: l.torre ?? "",
    }));

    return NextResponse.json({ data: { unidades } }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    console.error("[temis][categorias][unidades][GET]", erro);
    return NextResponse.json({ error: "Não foi possível carregar as unidades." }, { status: 500 });
  }
}

/**
 * Os `enterprise_id` da família (o pai e todos os filhos) a partir dos empreendimentos escolhidos.
 *
 * ⚠️ SOBE E DESCE. Se a tela está no filho, o pai entra; se está no pai, os filhos entram. É o que
 * garante que o gêmeo do terreno esteja no universo — e é a mesma ideia de
 * `familiaDoEmpreendimento`, escrita aqui contra o cadastro do Panteon porque aqui a chave é o
 * `c2x_enterprise_id` e não o código.
 *
 * Falha devolve os próprios ids: sem cadastro, cada empreendimento responde por si — que é o caso
 * dos 35 produtos sem pai.
 */
async function idsDaFamilia(admin: Admin, enterpriseIds: readonly string[]): Promise<string[]> {
  try {
    const { data } = await admin
      .from("hercules_empreendimentos")
      .select("id,pai_id,c2x_enterprise_id")
      .eq("workspace_id", WORKSPACE);

    const cadastro = (data ?? []) as Array<{
      c2x_enterprise_id: null | string;
      id: string;
      pai_id: null | string;
    }>;
    if (cadastro.length === 0) return [...enterpriseIds];

    const porC2x = new Map(
      cadastro.filter((e) => e.c2x_enterprise_id).map((e) => [String(e.c2x_enterprise_id), e]),
    );

    const raizes = new Set<string>();
    for (const id of enterpriseIds) {
      const linha = porC2x.get(String(id));
      if (!linha) continue;
      raizes.add(linha.pai_id ?? linha.id);
    }

    const saida = new Set<string>(enterpriseIds);
    for (const e of cadastro) {
      if (!e.c2x_enterprise_id) continue;
      if (raizes.has(e.id) || (e.pai_id && raizes.has(e.pai_id))) {
        saida.add(String(e.c2x_enterprise_id));
      }
    }
    return [...saida];
  } catch {
    return [...enterpriseIds];
  }
}
