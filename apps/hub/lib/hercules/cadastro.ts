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

/**
 * Uma linha do cadastro. É o MESMO tipo que a árvore de unidades (`./empreendimentos`) recebe —
 * de propósito: o painel de Produtos e o importador de masterplan leem a mesma linha.
 *
 *   • `paiId === null` → PAI (o espelho: VLO 35, LAB 31; ou pai só do Panteon, como o LOX da
 *     Lavra do Ouro, que fica sem `c2xEnterpriseId`);
 *   • `paiId` preenchido → FILHO/visão segmentada, sempre com o id do C2X que responde pela
 *     burocracia dele (VOC 37, VOL 36, LBF 33).
 */
export type LinhaDoCadastro = LinhaDeEmpreendimento;

// Mesmo workspace fixo das outras leituras do portal (ver /api/incorporador/boletos).
const WORKSPACE = "careli";
const PAGINA = 1000;

type LinhaCrua = {
  c2x_enterprise_id: null | string;
  cidade: null | string;
  codigo: null | string;
  id: string;
  nome: null | string;
  ordem: null | number;
  pai_id: null | string;
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
    ordem: Number.isFinite(Number(crua.ordem)) ? Number(crua.ordem) : 0,
    paiId: texto(crua.pai_id),
    uf: texto(crua.uf)?.toUpperCase() ?? null,
    vendendo: crua.vendendo === true,
  };
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
  const admin = createApoloAdminClient();

  if (!admin) {
    throw new Error("Cadastro de empreendimentos indisponível: Supabase sem configuração.");
  }

  const saida: LinhaDoCadastro[] = [];

  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("hercules_empreendimentos")
      .select("id,codigo,nome,cidade,uf,c2x_enterprise_id,pai_id,vendendo,ordem")
      .eq("workspace_id", WORKSPACE)
      .order("ordem", { ascending: true })
      .order("codigo", { ascending: true })
      .range(de, de + PAGINA - 1)
      .returns<LinhaCrua[]>();

    if (error) {
      throw new Error(`Não foi possível ler o cadastro de empreendimentos: ${error.message}`);
    }

    const pagina = data ?? [];
    saida.push(...pagina.map(mapearLinhaDoCadastro));

    if (pagina.length < PAGINA) break;
  }

  return saida;
}
