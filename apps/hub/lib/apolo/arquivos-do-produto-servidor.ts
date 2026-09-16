import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { pedidoPrecisaDeExpansao } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { comIdsDoGrupo } from "@/lib/apolo/incorporador/resumo-do-produto";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import {
  lerCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import { ehIdDoPai, expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";

import {
  BUCKET_DO_PRODUTO,
  caminhoDaMiniatura,
  caminhoDoArquivo,
  conferirArquivoDoProduto,
  idDeDestinoValido,
  legendaSegura,
  lerCaminhoDoArquivo,
  metadadosSeguros,
  miniaturaCombina,
  nomeSeguro,
  ordenarArquivos,
  rotulosDosDestinos,
  TAMANHO_MAXIMO_DA_MINIATURA,
  type TipoDeArquivo,
  tipoDoArquivo,
  uuidValido,
} from "./arquivos-do-produto";

// AS FOTOS E OS VÍDEOS DO PRODUTO — a ida ao banco e ao Storage, num lugar só para as DUAS portas.
//
// ⚠️ DUAS ROTAS, UMA REGRA. O portal (/api/incorporador/produto/arquivos, cookie do portal) e o
// Apolo (/api/apolo/empreendimentos/arquivos, Bearer do hub) listam, assinam, registram e removem
// do MESMO jeito. O que muda entre elas é só QUEM passa pela porta e QUAIS ids ela alcança; por
// isso as rotas decidem o portão e o `permitidos`, e tudo o que vem depois mora aqui. Regra escrita
// numa rota só vira bug na outra: foi o que aconteceu com a tradução do `emp` em vendas/assinaturas.
//
// ⚠️ O ARQUIVO NUNCA PASSA POR AQUI (ATENCAO 2 da 0169). `preparar` devolve a permissão assinada, o
// navegador grava direto no bucket, `registrar` confere o objeto com `.info()` antes da linha.

type Admin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type ResultadoDoArquivo<T> =
  | { data: T; ok: true }
  | { error: string; ok: false; status: number };

const TABELA = "apolo_empreendimento_arquivos";
const WORKSPACE = "careli";
const PAGINA = 1000;
/** Lote de ids num `.in()`: a URL estoura perto de 700 ids (medido em 24/07/2026). */
const LOTE_DE_IDS = 100;

/**
 * Quanto vale o link de leitura, em segundos.
 *
 * ⚠️ UMA HORA, E NÃO OS 10 MINUTOS DOS DOCUMENTOS DA VENDA. O vídeo não baixa de uma vez: o player
 * pede pedaços (`Range`) enquanto toca e a cada vez que alguém arrasta a barra, e CADA pedaço
 * confere o token. Com 10 minutos, o vídeo de apresentação parado na metade durante a conversa com o
 * cliente travaria no primeiro avanço. O link continua não sendo guardado em lugar nenhum: nasce na
 * leitura, e a tela recarrega a lista quando ela passa de 45 minutos.
 */
export const VALIDADE_DO_LINK = 60 * 60;

/** O 404 do produto que não existe ou não é da sessão, na frase das outras abas da ficha. */
export const PRODUTO_FORA_DO_RECORTE = "Este produto não está mais no seu recorte.";

const falha = (status: number, error: string): { error: string; ok: false; status: number } => ({
  error,
  ok: false,
  status,
});

const INDISPONIVEL = "Não foi possível carregar as fotos e vídeos agora.";

// ── O ESCOPO DO PRODUTO ─────────────────────────────────────────────────────

/**
 * Os ids REAIS (e o grupo, quando coberto inteiro) que o produto pedido alcança, dentro de
 * `permitidos`.
 *
 * ⚠️ POR ID, E NÃO POR CÓDIGO, e é por isso que o empreendimento que só existe no Panteon funciona
 * aqui sem o `soDoPanteon`. As rotas de venda traduzem o escopo em CÓDIGOS pelo catálogo do C2X, e o
 * empreendimento de fora do legado some nessa tradução; esta tabela guarda o id, e a sessão já traz
 * o id dele. A régua é a MESMA de produto/resumo:
 *   • "pai:<uuid>" e id numérico → `expandirIdDoPainel` (filhos autorizados, ou o próprio pai sem
 *     filho, como o Garden) completado pelo grupo que eles cobrem por inteiro (`comIdsDoGrupo`);
 *   • id do catálogo ("group:Lagoa Bonita") → só se a sessão tiver o GRUPO; aí ele e as divisões.
 *
 * ⚠️ FAIL-CLOSED: pedido vazio, id fora de `permitidos` ou pai inventado devolvem lista VAZIA, e a
 * rota responde 404. Nunca cai na visão de "todos os produtos".
 */
export function idsDoProdutoNoEscopo(entrada: {
  cadastro: LinhaDoCadastro[];
  catalogo: ReadonlyArray<{ id: string; stageIds: string[] }>;
  pedido: null | string | undefined;
  permitidos: Set<string>;
}): string[] {
  const { cadastro, catalogo, permitidos } = entrada;
  const pedido = String(entrada.pedido ?? "").trim();
  if (!pedido) return [];

  if (pedidoPrecisaDeExpansao(pedido)) {
    const reais = expandirIdDoPainel(pedido, cadastro, permitidos);
    return reais.length > 0 ? comIdsDoGrupo(reais, [...catalogo], permitidos) : [];
  }

  if (!permitidos.has(pedido)) return [];

  const doCatalogo = catalogo.find((emp) => emp.id === pedido);
  if (!doCatalogo) return [pedido];

  return [
    ...new Set([
      pedido,
      ...doCatalogo.stageIds.map((id) => String(id).trim()).filter((id) => permitidos.has(id)),
    ]),
  ];
}

/**
 * Todo id de empreendimento que a CASA conhece: o `permitidos` do Apolo, onde o time da Careli
 * alcança qualquer produto por desenho (o portão de lá é o papel no hub, não um recorte).
 *
 * ⚠️ AINDA ASSIM É UMA LISTA, E NÃO "QUALQUER COISA". Sem ela, um id digitado na URL criaria pasta
 * e linha para um empreendimento que não existe, e ninguém acharia essas fotos depois.
 */
export function todosOsIdsConhecidos(
  cadastro: ReadonlyArray<{ c2xEnterpriseId: null | string }>,
  catalogo: ReadonlyArray<{ id: string; stageIds: string[] }>,
): Set<string> {
  const ids = new Set<string>();
  for (const emp of catalogo) {
    ids.add(String(emp.id).trim());
    for (const stageId of emp.stageIds) ids.add(String(stageId).trim());
  }
  for (const linha of cadastro) {
    if (linha.c2xEnterpriseId) ids.add(linha.c2xEnterpriseId.trim());
  }
  ids.delete("");
  return ids;
}

export type ProdutoDoPedido = {
  /** Onde um envio novo pode ser gravado, com o rótulo do seletor. */
  destinos: Array<{ id: string; rotulo: string }>;
  /** Todos os ids que a leitura cobre. */
  ids: string[];
};

/** O que `resolverProdutoDoPedido` já leu, entregue a quem decide o `permitidos`. */
export type BasesDoPedido = {
  cadastro: LinhaDoCadastro[];
  catalogo: Awaited<ReturnType<typeof catalogoDeEmpreendimentos>>;
  /**
   * O cadastro veio com as colunas da 0170 (`operado_por`)? Falso também quando a leitura falhou.
   * É o que a régua de quem opera o produto (`podeEscreverNosEnterprises`) precisa para liberar o
   * botão de envio no portal sem ler o cadastro uma segunda vez.
   */
  com0170: boolean;
};

/**
 * Carrega cadastro e catálogo e resolve o `emp` pedido. As duas rotas chamam; cada uma diz o seu
 * `permitidos` (sessão do portal ou tudo o que a casa conhece).
 *
 * ⚠️ CADASTRO FORA DO AR SÓ DERRUBA O PEDIDO DE PAI (503): sem cadastro não há como provar que o pai
 * é dele, e "não encontrado" para um produto que É dele vira ligação. O id numérico segue sem o
 * cadastro, como em `codigosDoPedido`.
 */
export async function resolverProdutoDoPedido(
  pedido: null | string | undefined,
  permitidosDe: (bases: BasesDoPedido) => Promise<Set<string>> | Set<string>,
): Promise<ResultadoDoArquivo<ProdutoDoPedido>> {
  const limpo = String(pedido ?? "").trim();
  if (!limpo) return falha(400, "Produto não informado.");

  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  let cadastro: LinhaDoCadastro[] = [];
  let com0170 = false;
  try {
    const lido = await lerCadastroDeEmpreendimentos();
    cadastro = lido.linhas;
    com0170 = lido.com0170;
  } catch {
    if (ehIdDoPai(limpo)) return falha(503, "Não foi possível carregar os empreendimentos agora.");
  }

  const permitidos = await permitidosDe({ cadastro, catalogo, com0170 });
  const ids = idsDoProdutoNoEscopo({ cadastro, catalogo, pedido: limpo, permitidos });

  // Para quem não tem o produto, ele não existe: 404, nunca 403 (`foraDoEscopo`).
  // (16/09/2026, revisão) A frase com acento e com sentido: a aba mostra o `error` cru, e
  // "Nao encontrado." numa faixa vermelha não dizia nada. O mesmo texto serve a produto inexistente
  // e a produto de outro portal, então não vira oráculo.
  if (ids.length === 0) return falha(404, PRODUTO_FORA_DO_RECORTE);

  return { data: { destinos: rotulosDosDestinos(ids, cadastro, catalogo), ids }, ok: true };
}

// ── LISTAR ──────────────────────────────────────────────────────────────────

type LinhaDoBanco = {
  altura: null | number;
  criado_em: string;
  duracao_segundos: null | number | string;
  enterprise_id: string;
  enviado_origem: string;
  enviado_por_nome: null | string;
  id: string;
  largura: null | number;
  legenda: null | string;
  mime: null | string;
  miniatura_path: null | string;
  nome: string;
  ordem: null | number;
  storage_path: string;
  tamanho_bytes: null | number | string;
  tipo: TipoDeArquivo;
};

const COLUNAS =
  "id,enterprise_id,tipo,nome,mime,tamanho_bytes,storage_path,miniatura_path,largura,altura,duracao_segundos,legenda,ordem,enviado_por_nome,enviado_origem,criado_em";

/** O que a tela recebe. Os links nascem nesta leitura e não são guardados em lugar nenhum. */
export type ArquivoDoProduto = {
  altura: null | number;
  criadoEm: string;
  duracaoSegundos: null | number;
  /**
   * Quem enviou. Só o Apolo recebe o nome; o portal recebe "Careli" ou `null`.
   *
   * ⚠️ O NOME DO ANALISTA DA CARELI NÃO SAI PARA O PORTAL. É o mesmo cuidado que falta hoje na fila
   * do board (que devolve nome e e-mail de todo hub_user): o incorporador não precisa saber quem da
   * casa subiu a foto, só que foi a casa.
   */
  enviadoPor: null | string;
  id: string;
  largura: null | number;
  legenda: null | string;
  mime: null | string;
  miniaturaUrl: null | string;
  nome: string;
  ordem: null | number;
  tamanhoBytes: null | number;
  tipo: TipoDeArquivo;
  url: null | string;
};

function numeroOuNulo(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

async function linksAssinados(admin: Admin, caminhos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const unicos = [...new Set(caminhos.filter(Boolean))];

  // Em lotes: 300 fotos são 600 caminhos, e um corpo gigante num pedido só é o tipo de coisa que
  // falha inteira por causa de um item.
  for (let i = 0; i < unicos.length; i += 200) {
    const lote = unicos.slice(i, i + 200);
    const { data, error } = await admin.storage
      .from(BUCKET_DO_PRODUTO)
      .createSignedUrls(lote, VALIDADE_DO_LINK);
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      if (!item.error && item.path && item.signedUrl) mapa.set(item.path, item.signedUrl);
    }
  }

  return mapa;
}

export async function listarArquivosDoProduto(
  admin: Admin,
  ids: string[],
  opcoes: { comAutor: boolean },
): Promise<ResultadoDoArquivo<ArquivoDoProduto[]>> {
  const alvo = [...new Set(ids.filter(Boolean))];
  if (alvo.length === 0) return { data: [], ok: true };

  try {
    const linhas: LinhaDoBanco[] = [];

    for (let i = 0; i < alvo.length; i += LOTE_DE_IDS) {
      const lote = alvo.slice(i, i + LOTE_DE_IDS);

      // ⚠️ PAGINADO MESMO SENDO POUCAS FOTOS HOJE: o PostgREST corta em 1.000 linhas SEM ERRO, e a
      // galeria cortada em silêncio é a que "perdeu" justamente as fotos mais antigas.
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await admin
          .from(TABELA)
          .select(COLUNAS)
          .eq("workspace_id", WORKSPACE)
          .in("enterprise_id", lote)
          .is("removido_em", null)
          .order("criado_em", { ascending: false })
          .order("id", { ascending: true })
          .range(de, de + PAGINA - 1);

        if (error) throw new Error(error.message);
        const pagina = (data ?? []) as unknown as LinhaDoBanco[];
        linhas.push(...pagina);
        if (pagina.length < PAGINA) break;
      }
    }

    const links = await linksAssinados(
      admin,
      linhas.flatMap((l) => [l.storage_path, l.miniatura_path ?? ""]),
    );

    const arquivos: ArquivoDoProduto[] = linhas.map((l) => ({
      altura: numeroOuNulo(l.altura),
      criadoEm: l.criado_em,
      duracaoSegundos: numeroOuNulo(l.duracao_segundos),
      enviadoPor: opcoes.comAutor
        ? (l.enviado_por_nome ?? null)
        : l.enviado_origem === "hub"
          ? "Careli"
          : null,
      id: l.id,
      largura: numeroOuNulo(l.largura),
      legenda: l.legenda,
      mime: l.mime,
      miniaturaUrl: l.miniatura_path ? (links.get(l.miniatura_path) ?? null) : null,
      nome: l.nome,
      ordem: numeroOuNulo(l.ordem),
      tamanhoBytes: numeroOuNulo(l.tamanho_bytes),
      tipo: l.tipo,
      url: links.get(l.storage_path) ?? null,
    }));

    return { data: ordenarArquivos(arquivos), ok: true };
  } catch (erro) {
    console.error("[produto][arquivos] falha ao listar", erro);
    return falha(503, INDISPONIVEL);
  }
}

// ── PREPARAR (assinar a gravação) ───────────────────────────────────────────

export type PreparoDoEnvio = {
  bucket: string;
  /** O uuid do arquivo: é também o id da linha que o `registrar` vai criar. */
  id: string;
  mime: string;
  miniatura: null | { caminho: string; signedUrl: string; token: string };
  original: { caminho: string; signedUrl: string; token: string };
};

export async function prepararEnvioDoArquivo(
  admin: Admin,
  entrada: {
    comMiniatura: boolean;
    destino: string;
    mime: unknown;
    nome: unknown;
    tamanho: unknown;
  },
): Promise<ResultadoDoArquivo<PreparoDoEnvio>> {
  if (!idDeDestinoValido(entrada.destino)) return falha(422, "Empreendimento inválido.");

  // ⚠️ O TAMANHO É CONFERIDO ANTES DE ASSINAR, com o número do navegador. Resolve o caso honesto (o
  // vídeo de 2 GB recusado antes de subir, e não depois de meia hora); o `registrar` confere de novo
  // com o tamanho MEDIDO, porque o número do cliente pode mentir.
  const conferido = conferirArquivoDoProduto({
    mime: typeof entrada.mime === "string" ? entrada.mime : null,
    nome: typeof entrada.nome === "string" ? entrada.nome : null,
    tamanho: Number(entrada.tamanho),
  });
  if (!conferido.ok) return falha(422, conferido.motivo);

  try {
    const id = crypto.randomUUID();
    const bucket = admin.storage.from(BUCKET_DO_PRODUTO);

    const original = await bucket.createSignedUploadUrl(
      caminhoDoArquivo(entrada.destino, id, conferido.extensao),
    );
    if (original.error || !original.data) {
      throw new Error(original.error?.message ?? "não foi possível assinar o envio");
    }

    // A miniatura é acessório: falhar em assinar ELA não impede a foto de subir. A grade mostra o
    // ícone no lugar.
    let miniatura: PreparoDoEnvio["miniatura"] = null;
    if (entrada.comMiniatura) {
      const assinada = await bucket.createSignedUploadUrl(caminhoDaMiniatura(entrada.destino, id));
      if (!assinada.error && assinada.data) {
        miniatura = {
          caminho: assinada.data.path,
          signedUrl: assinada.data.signedUrl,
          token: assinada.data.token,
        };
      }
    }

    return {
      data: {
        bucket: BUCKET_DO_PRODUTO,
        id,
        mime: conferido.mime,
        miniatura,
        original: {
          caminho: original.data.path,
          signedUrl: original.data.signedUrl,
          token: original.data.token,
        },
      },
      ok: true,
    };
  } catch (erro) {
    console.error("[produto][arquivos] falha ao preparar", erro);
    return falha(503, "Não foi possível preparar o envio agora.");
  }
}

// ── REGISTRAR (conferir o objeto e criar a linha) ───────────────────────────

export type AutorDoEnvio = {
  id: null | string;
  nome: null | string;
  origem: "hub" | "portal";
};

export async function registrarArquivoDoProduto(
  admin: Admin,
  entrada: {
    altura?: unknown;
    autor: AutorDoEnvio;
    caminho: unknown;
    destino: string;
    duracao?: unknown;
    largura?: unknown;
    legenda?: unknown;
    miniatura?: unknown;
    nome: unknown;
  },
): Promise<ResultadoDoArquivo<{ id: string }>> {
  const caminho = String(entrada.caminho ?? "").trim();

  // ⚠️ O CAMINHO VOLTOU DO NAVEGADOR. O que ele precisa provar: ser da pasta do destino (que a rota
  // já conferiu contra o escopo) e ter o formato exato que o `preparar` produz.
  const lido = lerCaminhoDoArquivo(caminho, entrada.destino);
  if (!lido) return falha(422, "Caminho do arquivo inválido.");

  const bucket = admin.storage.from(BUCKET_DO_PRODUTO);
  const miniaturaPedida = String(entrada.miniatura ?? "").trim();
  const miniaturaDoArquivo = miniaturaCombina(miniaturaPedida, entrada.destino, lido.uuid)
    ? miniaturaPedida
    : null;

  try {
    // ⚠️ IDEMPOTENTE: duplo clique ou retry de rede chegam aqui com o mesmo caminho. Sem esta
    // leitura, o segundo insert bateria no índice único e o tratamento de erro abaixo APAGARIA os
    // bytes de uma foto que já está registrada e aparecendo na grade.
    const { data: existente, error: erroExistente } = await admin
      .from(TABELA)
      .select("id")
      .eq("storage_path", caminho)
      .maybeSingle();
    if (erroExistente) throw new Error(erroExistente.message);
    if (existente) return { data: { id: (existente as { id: string }).id }, ok: true };

    // ⚠️ O `.info()` É A PROVA DE QUE O ARQUIVO EXISTE, e não só a medida. Sem `size` numérico não há
    // registro: um POST direto com um caminho inventado criaria na grade uma foto que não abre.
    const info = await bucket.info(caminho);
    const tamanho = !info.error && typeof info.data?.size === "number" ? info.data.size : -1;
    if (tamanho < 0) {
      return falha(422, "O arquivo não foi encontrado no armazenamento. Tente enviar de novo.");
    }

    const apagarTudo = async () => {
      await bucket.remove([caminho, ...(miniaturaDoArquivo ? [miniaturaDoArquivo] : [])]);
    };

    // ⚠️ O TIPO VEM DO CAMINHO, E O TETO É O DELE. Quem assinou um .jpg (teto de 25 MB) e gravou um
    // vídeo de 400 MB no lugar passaria pelo teto do vídeo se o tipo viesse do `contentType`. E o
    // `contentType` gravado tem de concordar com o caminho: foto com cara de vídeo sai inteira.
    const tipoGravado = info.data?.contentType ? tipoDoArquivo(null, info.data.contentType) : null;
    if (info.data?.contentType && tipoGravado !== lido.tipo) {
      await apagarTudo();
      return falha(422, "O arquivo enviado não corresponde ao formato informado.");
    }

    const conferido = conferirArquivoDoProduto({
      mime: lido.mime,
      nome: `arquivo.${lido.extensao}`,
      tamanho,
    });
    if (!conferido.ok) {
      await apagarTudo();
      return falha(422, conferido.motivo);
    }

    // A miniatura só entra conferida: existe, é pequena e é imagem. Senão sai do bucket e a linha
    // nasce sem ela (a grade mostra o ícone).
    let miniaturaPath: null | string = null;
    if (miniaturaDoArquivo) {
      const dela = await bucket.info(miniaturaDoArquivo);
      const tamanhoDela = !dela.error && typeof dela.data?.size === "number" ? dela.data.size : -1;
      const ehImagem =
        !dela.data?.contentType || tipoDoArquivo(null, dela.data.contentType) === "imagem";
      if (tamanhoDela > 0 && tamanhoDela <= TAMANHO_MAXIMO_DA_MINIATURA && ehImagem) {
        miniaturaPath = miniaturaDoArquivo;
      } else if (tamanhoDela >= 0) {
        await bucket.remove([miniaturaDoArquivo]);
      }
    }

    const metadados = metadadosSeguros({
      altura: entrada.altura,
      duracao: entrada.duracao,
      largura: entrada.largura,
      tipo: lido.tipo,
    });

    const { error } = await admin.from(TABELA).insert({
      altura: metadados.altura,
      duracao_segundos: metadados.duracaoSegundos,
      enterprise_id: entrada.destino,
      enviado_origem: entrada.autor.origem,
      enviado_por: entrada.autor.id,
      enviado_por_nome: entrada.autor.nome,
      id: lido.uuid,
      largura: metadados.largura,
      legenda: legendaSegura(entrada.legenda),
      mime: lido.mime,
      miniatura_path: miniaturaPath,
      nome: nomeSeguro(typeof entrada.nome === "string" ? entrada.nome : null),
      ordem: null,
      storage_path: caminho,
      tamanho_bytes: tamanho,
      tipo: lido.tipo,
      workspace_id: WORKSPACE,
    });

    if (error) {
      // Corrida entre dois `registrar` do mesmo arquivo: o outro já criou a linha, e os bytes são
      // dela. Não apagar.
      if (error.code === "23505") return { data: { id: lido.uuid }, ok: true };

      // ⚠️ O ARQUIVO SAI JUNTO QUANDO A LINHA NÃO ENTRA: objeto sem linha é foto que ninguém acha e
      // ninguém apaga, paga para sempre.
      await apagarTudo();
      throw new Error(error.message);
    }

    return { data: { id: lido.uuid }, ok: true };
  } catch (erro) {
    console.error("[produto][arquivos] falha ao registrar", erro);
    return falha(503, "Não foi possível guardar o arquivo agora.");
  }
}

// ── REMOVER (lógico) ────────────────────────────────────────────────────────

/**
 * Tira o arquivo da grade para todos. Linha e bytes ficam (ATENCAO 4 da 0169).
 *
 * ⚠️ O ID VEM COM O PRODUTO, e a remoção exige os dois: sem conferir que a linha é de um id do
 * escopo, quem tem o Garden removeria a foto do VOC adivinhando um uuid.
 */
export async function removerArquivoDoProduto(
  admin: Admin,
  entrada: { autorId: null | string; id: unknown; ids: string[] },
): Promise<ResultadoDoArquivo<{ id: string }>> {
  const id = String(entrada.id ?? "").trim();
  if (!uuidValido(id)) return falha(404, "Arquivo não encontrado.");

  try {
    const { data, error } = await admin
      .from(TABELA)
      .select("id,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", id)
      .is("removido_em", null)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const linha = data as null | { enterprise_id: string; id: string };
    if (!linha || !entrada.ids.includes(linha.enterprise_id)) {
      return falha(404, "Arquivo não encontrado.");
    }

    const { error: erroUpdate } = await admin
      .from(TABELA)
      .update({ removido_em: new Date().toISOString(), removido_por: entrada.autorId })
      .eq("workspace_id", WORKSPACE)
      .eq("id", id)
      .is("removido_em", null);
    if (erroUpdate) throw new Error(erroUpdate.message);

    return { data: { id }, ok: true };
  } catch (erro) {
    console.error("[produto][arquivos] falha ao remover", erro);
    return falha(503, "Não foi possível remover o arquivo agora.");
  }
}
