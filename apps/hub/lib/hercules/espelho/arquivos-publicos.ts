import type { SupabaseClient } from "@supabase/supabase-js";

import { ordenarArquivos, type TipoDeArquivo, uuidValido } from "@/lib/apolo/arquivos-do-produto";

// OS ARQUIVOS DO EMPREENDIMENTO NO ESPELHO PÚBLICO — a aba que o corretor abre na frente do cliente.
//
// Lucas (22/09/2026): a aba **Arquivos** que já existe no portal do incorporador
// (`/incorporador/cecilio-rocha`) *"tem que aparecer também no espelho público"*, e apontou o link
// exato: `c2x.app.br/e/garden-ksewinpw`.
//
// ⚠️ DO OUTRO LADO DESTE LINK NÃO HÁ LOGIN. A mesma tabela alimenta o portal, e lá a lista carrega
// tamanho em bytes, mime, largura, duração, legenda, quem enviou e o caminho no bucket
// (`lib/apolo/arquivos-do-produto-servidor.ts`). NADA DISSO SAI AQUI: o espelho entrega id, nome,
// ordem e tipo, e é só com isso que a tela desenha a grade. A lista NEM SELECIONA `storage_path` —
// o que não é lido não vaza por descuido de um `...linha` num refactor futuro.
//
// ⚠️ E O CAMINHO NO BUCKET NUNCA VEM DO CLIENTE. `acharArquivoDoEspelho` recebe o ID e os
// `enterprise_id` DAQUELE link, e é o banco que devolve o caminho. Aceitar caminho no parâmetro
// transformaria a porta pública numa leitura livre do bucket `produto-arquivos` — a mesma armadilha
// que `lerCaminhoDoArquivo` fecha no registro do upload.

export const TABELA_DOS_ARQUIVOS = "apolo_empreendimento_arquivos";

/** O único workspace da casa hoje; o mesmo filtro do portal. */
const WORKSPACE = "careli";

// ⚠️ PAGINADO MESMO COM 47 LINHAS: o PostgREST corta em 1.000 SEM ERRO
// ([[reference_postgrest_teto_de_1000_linhas]]). Um Book Garden com 300 cenas cortaria em silêncio.
const PAGINA = 1000;

/** ⚠️ O QUE SAI PARA A RUA. Quatro campos, e o teste do payload prova que não há um quinto. */
export type ArquivoPublicoDoEspelho = {
  id: string;
  nome: string;
  ordem: null | number;
  tipo: TipoDeArquivo;
};

/** O que só o SERVIDOR vê: o caminho no bucket privado. Nunca vai para a tela. */
export type ArquivoResolvidoDoEspelho = {
  id: string;
  mime: null | string;
  miniaturaPath: null | string;
  nome: string;
  storagePath: string;
  tipo: TipoDeArquivo;
};

type LinhaDaLista = {
  criado_em: string;
  id: string;
  nome: string;
  ordem: null | number;
  tipo: TipoDeArquivo;
};

type LinhaDoArquivo = {
  id: string;
  mime: null | string;
  miniatura_path: null | string;
  nome: string;
  storage_path: string;
  tipo: TipoDeArquivo;
};

const COLUNAS_DA_LISTA = "id,nome,tipo,ordem,criado_em";
const COLUNAS_DO_ARQUIVO = "id,nome,tipo,mime,storage_path,miniatura_path";

/**
 * A lista da aba Arquivos de um espelho.
 *
 * ⚠️ NUNCA LANÇA, E ISSO É DECISÃO. As páginas do espelho montam a primeira carga num `try` só: uma
 * exceção daqui cairia no `catch` e o visitante veria "Não foi possível carregar o mapa agora" por
 * causa da GALERIA. O mapa é o produto; a galeria é um extra. Falhou, volta vazia e a aba não nasce.
 */
export async function arquivosPublicosDoEspelho(
  client: SupabaseClient,
  enterpriseIds: readonly string[],
): Promise<ArquivoPublicoDoEspelho[]> {
  const alvo = [...new Set(enterpriseIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (alvo.length === 0) return [];

  try {
    const linhas: LinhaDaLista[] = [];

    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await client
        .from(TABELA_DOS_ARQUIVOS)
        .select(COLUNAS_DA_LISTA)
        .eq("workspace_id", WORKSPACE)
        .in("enterprise_id", alvo)
        .is("removido_em", null)
        .order("criado_em", { ascending: false })
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);

      if (error) throw new Error(error.message);
      const pagina = (data ?? []) as unknown as LinhaDaLista[];
      linhas.push(...pagina);
      if (pagina.length < PAGINA) break;
    }

    // ⚠️ A ORDEM É A MESMA DO PORTAL, pela MESMA função: `ordem` manual primeiro, depois o mais
    // novo. No Garden isso dá 1 a 47 — `Video 1.mp4`, `Book Garden.pdf`, `Cena 1` a `Cena 45`. Uma
    // segunda regra de ordenação aqui faria a apresentação do corretor sair fora da ordem que a
    // equipe montou na outra tela.
    const ordenados = ordenarArquivos(
      linhas.map((l) => ({ criadoEm: l.criado_em, id: l.id, ordem: l.ordem, tipo: l.tipo, nome: l.nome })),
    );

    // O recorte campo a campo, à mão. Espalhar a linha aqui seria o vazamento.
    return ordenados.map((l) => ({ id: l.id, nome: l.nome, ordem: l.ordem, tipo: l.tipo }));
  } catch (erro) {
    console.error("[publico][espelho] falha ao listar os arquivos", erro);
    return [];
  }
}

/**
 * O caminho no bucket de UM arquivo, se ele for deste espelho.
 *
 * ⚠️ O PARÂMETRO É O ID, E SÓ UM UUID CHEGA AO BANCO. `39/<uuid>.pdf` ou `../outro/segredo.pdf`
 * param aqui, antes da consulta. E o `.in("enterprise_id", ...)` é o que garante que o link do
 * Garden não abre o arquivo do Villa Paris.
 */
export async function acharArquivoDoEspelho(
  client: SupabaseClient,
  enterpriseIds: readonly string[],
  id: null | string | undefined,
): Promise<ArquivoResolvidoDoEspelho | null> {
  const alvo = [...new Set(enterpriseIds.map((e) => String(e ?? "").trim()).filter(Boolean))];
  if (alvo.length === 0 || !uuidValido(id)) return null;

  try {
    const { data, error } = await client
      .from(TABELA_DOS_ARQUIVOS)
      .select(COLUNAS_DO_ARQUIVO)
      .eq("workspace_id", WORKSPACE)
      .eq("id", String(id))
      .in("enterprise_id", alvo)
      .is("removido_em", null)
      .maybeSingle();

    if (error) throw new Error(error.message);
    const linha = data as unknown as LinhaDoArquivo | null;
    if (!linha?.storage_path) return null;

    return {
      id: linha.id,
      mime: linha.mime,
      miniaturaPath: linha.miniatura_path,
      nome: linha.nome,
      storagePath: linha.storage_path,
      tipo: linha.tipo,
    };
  } catch (erro) {
    console.error("[publico][espelho] falha ao achar o arquivo", erro);
    return null;
  }
}
