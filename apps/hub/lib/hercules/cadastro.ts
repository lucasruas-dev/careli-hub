// O CADASTRO DE EMPREENDIMENTOS DO PANTEON (hercules_empreendimentos), lido do banco.
//
// Lucas (02/09/2026): *"a partir de hoje vamos cadastrar os empreendimentos dentro do panteon (...)
// ter o empreendimento pai, e os filhos"*. A migration 0123 criou a tabela; este é o PRIMEIRO
// leitor dela no app. A regra de negócio (quem é pai, quem é visão, como somar) mora em
// `./empreendimentos` e é pura — aqui é só a ida ao banco, num lugar só, para o painel de
// Produtos e a rota de Vendas lerem o MESMO cadastro.
//
// ⚠️ PAGINA POR `.range` MESMO SENDO 37 LINHAS HOJE. O PostgREST corta em 1.000 linhas SEM ERRO
// (ver reference_postgrest_teto_de_1000_linhas): um cadastro que crescesse além disso perderia
// o final da lista em silêncio — e o final da lista é exatamente o empreendimento mais novo, o
// que está vendendo. A paginação tem ORDER fixo (ordem, codigo) porque `.range` sem ordem estável
// pode repetir ou pular linha entre páginas.
import { createApoloAdminClient } from "@/lib/apolo/server";

import type { LinhaDeEmpreendimento } from "./empreendimentos";
import { ehColunaDoProdutoAusente, tipoProdutoDe, type TipoProduto } from "./produto-novo";

/**
 * Uma linha do cadastro. É o MESMO tipo que a árvore de unidades (`./empreendimentos`) recebe —
 * de propósito: o painel de Produtos e o importador de masterplan leem a mesma linha.
 *
 *   • `paiId === null` → PAI (o espelho: VLO 35, LAB 31; ou pai só do Panteon, como o LOX da
 *     Lavra do Ouro, que fica sem `c2xEnterpriseId`);
 *   • `paiId` preenchido → FILHO/visão segmentada, sempre com o id do C2X que responde pela
 *     burocracia dele (VOC 37, VOL 36, LBF 33).
 *
 * `operadoPor` e `tipoProduto` vêm da migration 0170 e SEMPRE saem preenchidos de
 * `carregarCadastroDeEmpreendimentos` / `mapearLinhaDoCadastro` (nulo = a Careli opera; loteamento
 * quando a coluna ainda não existe). ⚠️ São opcionais NO TIPO só para não quebrar as fábricas de
 * linha dos testes que montam `LinhaDoCadastro` à mão: quem lê trata ausente como `null` e
 * `"loteamento"` (use `tipoProdutoDe`).
 */
export type LinhaDoCadastro = LinhaDeEmpreendimento & {
  /** `apolo_incorporadores.id` de quem opera o produto. Nulo = a Careli. */
  operadoPor?: null | string;
  tipoProduto?: TipoProduto;
};

// Mesmo workspace fixo das outras leituras do portal (ver /api/incorporador/boletos).
const WORKSPACE = "careli";
const PAGINA = 1000;

const COLUNAS_SEM_0170 = "id,codigo,nome,cidade,uf,c2x_enterprise_id,pai_id,vendendo,ordem";
const COLUNAS_COM_0170 = `${COLUNAS_SEM_0170},operado_por,tipo_produto`;

type LinhaCrua = {
  c2x_enterprise_id: null | string;
  cidade: null | string;
  codigo: null | string;
  id: string;
  nome: null | string;
  // Ausentes quando a migration 0170 ainda não foi aplicada (select sem elas).
  operado_por?: null | string;
  ordem: null | number;
  pai_id: null | string;
  tipo_produto?: null | string;
  uf: null | string;
  vendendo: boolean | null;
};

function texto(valor: null | string | undefined): null | string {
  const limpo = String(valor ?? "").trim();
  return limpo ? limpo : null;
}

/** Exportada para o teste: é aqui que o texto do banco vira a linha que o resto do app entende. */
export function mapearLinhaDoCadastro(crua: LinhaCrua): LinhaDoCadastro {
  return {
    // O id do C2X é `text` no banco; a sessão do portal compara como string ("35"). Trim para
    // um espaço digitado no cadastro não fazer o Vale do Ouro sumir do escopo.
    c2xEnterpriseId: texto(crua.c2x_enterprise_id),
    cidade: texto(crua.cidade),
    codigo: (texto(crua.codigo) ?? "").toUpperCase(),
    id: String(crua.id),
    nome: texto(crua.nome) ?? texto(crua.codigo) ?? "Empreendimento",
    operadoPor: texto(crua.operado_por),
    ordem: Number.isFinite(Number(crua.ordem)) ? Number(crua.ordem) : 0,
    paiId: texto(crua.pai_id),
    tipoProduto: tipoProdutoDe(crua.tipo_produto),
    uf: texto(crua.uf)?.toUpperCase() ?? null,
    vendendo: crua.vendendo === true,
  };
}

// ⚠️ MEMÓRIA CURTA DA MIGRATION 0170 PENDENTE. Sem ela, cada leitura fazia DUAS requisições (a que
// pede as colunas novas falha com 42703/PGRST204, a segunda repete sem elas), e `codigosDaSessao` lê o
// cadastro a cada rota do portal: o log do Supabase enchia de "column operado_por does not exist" e a
// latência dobrava. Depois de uma falha, as leituras dos próximos 60 segundos já vão sem as colunas;
// passado isso, a primeira tenta de novo, e é assim que a aplicação da 0170 volta a valer sozinha.
const MEMORIA_DA_0170_MS = 60 * 1000;
let sem0170Ate = 0;

/** Esquece a memória da 0170 pendente (para o teste; e para quem acabou de aplicar a migration). */
export function limparMemoriaDaMigration0170(): void {
  sem0170Ate = 0;
}

/**
 * Lê o cadastro inteiro (pais e filhos), na ordem do cadastro.
 *
 * Lança em falha de leitura em vez de devolver lista vazia: cadastro vazio e banco fora do ar
 * NÃO são a mesma coisa para quem chama. O painel de Produtos degrada (todo empreendimento vira
 * linha simples); a rota de Vendas responde 503, porque com "pai:<uuid>" sem cadastro ela não tem
 * como provar o escopo — e responder 404 diria "não é seu" para um empreendimento que é.
 */
export async function carregarCadastroDeEmpreendimentos(): Promise<LinhaDoCadastro[]> {
  return (await lerCadastroDeEmpreendimentos()).linhas;
}

/**
 * A mesma leitura, dizendo se as colunas da 0170 (`operado_por`, `tipo_produto`) vieram.
 *
 * ⚠️ QUEM ESCREVE PRECISA SABER. Sem as colunas, toda linha sai "a Careli opera, loteamento", que é o
 * certo para quem só LÊ o painel, e o errado para quem grava: o cadastro de unidades gravaria lote
 * num prédio, e a guarda do portal não teria como saber quem opera o produto.
 */
export async function lerCadastroDeEmpreendimentos(): Promise<{ com0170: boolean; linhas: LinhaDoCadastro[] }> {
  const admin = createApoloAdminClient();

  if (!admin) {
    throw new Error("Cadastro de empreendimentos indisponível: Supabase sem configuração.");
  }

  const saida: LinhaDoCadastro[] = [];
  let colunas = Date.now() < sem0170Ate ? COLUNAS_SEM_0170 : COLUNAS_COM_0170;

  for (let de = 0; ; de += PAGINA) {
    const ler = (selecao: string) =>
      admin
        .from("hercules_empreendimentos")
        .select(selecao)
        .eq("workspace_id", WORKSPACE)
        .order("ordem", { ascending: true })
        .order("codigo", { ascending: true })
        .range(de, de + PAGINA - 1)
        .returns<LinhaCrua[]>();

    let { data, error } = await ler(colunas);

    // ⚠️ MIGRATION 0170 PENDENTE NÃO DERRUBA O CADASTRO. Painel, Venda e portal inteiro leem esta
    // função; sem as colunas novas, a linha sai "Careli opera, loteamento", que é o que o sistema
    // inteiro assume hoje. Só o erro de coluna DA 0170 cai aqui: qualquer outro continua lançando.
    if (error && colunas === COLUNAS_COM_0170 && ehColunaDoProdutoAusente(error)) {
      colunas = COLUNAS_SEM_0170;
      sem0170Ate = Date.now() + MEMORIA_DA_0170_MS;
      ({ data, error } = await ler(colunas));
    }

    if (error) {
      throw new Error(`Não foi possível ler o cadastro de empreendimentos: ${error.message}`);
    }

    const pagina = data ?? [];
    saida.push(...pagina.map(mapearLinhaDoCadastro));

    if (pagina.length < PAGINA) break;
  }

  return { com0170: colunas === COLUNAS_COM_0170, linhas: saida };
}

/**
 * Os empreendimentos que existem SÓ no Panteon, dentro de um escopo de sessão.
 *
 * ⚠️ SEM ISSO ELES NÃO APARECEM EM LUGAR NENHUM. O escopo do portal é traduzido em CÓDIGOS pelo
 * catálogo do C2X (`codigosDaSessao` → `catalogoDeEmpreendimentos`, que é um select em `enterprises`
 * do legado). Empreendimento cujo `c2x_enterprise_id` não existe lá — o de TESTE, e qualquer produto
 * cadastrado aqui antes de subir para o legado — não vira código, e sem código a tela Venda não
 * carrega as unidades dele: o mapa fica sem o lote e o botão Reservar nunca chega a existir.
 *
 * ⚠️ NÃO AMPLIA PERMISSÃO. Só devolve o que JÁ está no escopo recebido: a função filtra pelos ids
 * da sessão, nunca acrescenta um empreendimento que o usuário não teria direito de ver. É tradução,
 * como `codesDosIds` — e do mesmo jeito que lá, o que a sessão não traz não sai daqui.
 */
export function soDoPanteon(
  cadastro: LinhaDoCadastro[],
  idsDaSessao: string[],
  idsDoCatalogoC2x: Set<string>,
): { codigo: string; enterpriseId: string }[] {
  const permitidos = new Set(idsDaSessao.map((id) => String(id).trim()).filter(Boolean));
  if (permitidos.size === 0) return [];

  return cadastro
    .filter((l) => l.c2xEnterpriseId && permitidos.has(l.c2xEnterpriseId))
    .filter((l) => !idsDoCatalogoC2x.has(l.c2xEnterpriseId as string))
    .map((l) => ({ codigo: l.codigo, enterpriseId: l.c2xEnterpriseId as string }));
}
