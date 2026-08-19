// A CARTEIRA DO LSOFT — Garden e Vale do Sol.
//
// Pedido do Lucas (19/08/2026): "preciso ver esses dados cadastrais, preciso ver as parcelas, se
// foi pago se não... montar um POC para trabalhar nessa integração com Apolo e C2X".
//
// ⚠️ ISTO É UM ESPELHO, NÃO O LSOFT AO VIVO. O sistema da Cecílio Rocha é um Access antigo dentro
// da rede local deles (`\\SERVIDOR\Sistema\sgc\dados.mdb`), inalcançável pela Vercel. A carga roda
// da máquina que enxerga aquele caminho (scripts/lsoft/) e escreve nas tabelas `lsoft_*`. Por isso
// toda leitura devolve junto o `sincronizadoEm`: a tela precisa dizer de quando é o dado, senão o
// usuário decide em cima de uma foto achando que é filmagem.
import { createApoloAdminClient } from "@/lib/apolo/server";

export type ClienteDaCarteira = {
  celular: null | string;
  cidade: null | string;
  codigo: string;
  cpf: null | string;
  cpfFormatado: null | string;
  email: null | string;
  empreendimentos: string[];
  nome: string;
  parcelas: number;
  parcelasAbertas: number;
  parcelasPagas: number;
  parcelasVencidas: number;
  proximoVencimento: null | string;
  saldoAberto: number;
  saldoVencido: number;
  telefone: null | string;
  totalRecebido: number;
  /** "Q08 L109" — vem do parse das observações, então pode estar vazio. */
  unidades: string[];
};

export type ParcelaDaCarteira = {
  dataRecebido: null | string;
  empreendimento: string;
  id: string;
  lote: null | string;
  /** O texto original do LSoft. É a fonte quando o lote/quadra não sai do parse. */
  observacoes: null | string;
  paga: boolean;
  parcela: null | string;
  parcelaNumero: null | number;
  parcelaTotal: null | number;
  quadra: null | string;
  valor: number;
  valorRecebido: number;
  vencimento: null | string;
};

export type CadastroDoCliente = {
  bairro: null | string;
  bloqueado: boolean;
  celular: null | string;
  cep: null | string;
  cidade: null | string;
  codigo: string;
  conjuge: null | string;
  cpfFormatado: null | string;
  dataCadastro: null | string;
  email: null | string;
  empreendimentos: string[];
  endereco: null | string;
  estado: null | string;
  mae: null | string;
  nascimento: null | string;
  nome: string;
  pai: null | string;
  rg: null | string;
  telefone: null | string;
  vendedor: null | string;
};

export type ResumoDaCarteira = {
  clientes: number;
  parcelasAbertas: number;
  parcelasVencidas: number;
  saldoAberto: number;
  saldoVencido: number;
  /** Quando a carga rodou. Nulo enquanto ninguém importou. */
  sincronizadoEm: null | string;
  totalRecebido: number;
};

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const texto = (valor: unknown): null | string => {
  const t = String(valor ?? "").trim();
  return t === "" ? null : t;
};

/** Os empreendimentos que a POC cobre. Filtro fora desta lista é ignorado, não vira busca vazia. */
export const EMPREENDIMENTOS_DO_LSOFT = ["Garden", "Vale do Sol"] as const;

export type FiltroDaCarteira = {
  /** Nome, CPF ou unidade ("109", "Q08"). */
  busca?: null | string;
  empreendimento?: null | string;
};

type LinhaDaView = Record<string, unknown>;

function clienteDaLinha(linha: LinhaDaView): ClienteDaCarteira {
  return {
    celular: texto(linha.celular),
    cidade: texto(linha.cidade),
    codigo: String(linha.codigo ?? ""),
    cpf: texto(linha.cpf),
    cpfFormatado: texto(linha.cpf_formatado),
    email: texto(linha.email),
    empreendimentos: Array.isArray(linha.empreendimentos) ? (linha.empreendimentos as string[]) : [],
    nome: String(linha.nome ?? ""),
    parcelas: numero(linha.parcelas),
    parcelasAbertas: numero(linha.parcelas_abertas),
    parcelasPagas: numero(linha.parcelas_pagas),
    parcelasVencidas: numero(linha.parcelas_vencidas),
    proximoVencimento: texto(linha.proximo_vencimento),
    saldoAberto: numero(linha.saldo_aberto),
    saldoVencido: numero(linha.saldo_vencido),
    telefone: texto(linha.telefone),
    totalRecebido: numero(linha.total_recebido),
    unidades: Array.isArray(linha.unidades) ? (linha.unidades as string[]) : [],
  };
}

/**
 * A lista de clientes da carteira, já com o resumo financeiro de cada um.
 *
 * ⚠️ O RESUMO VEM DA VIEW, não de soma no servidor: são ~20 mil parcelas para fechar 237 linhas, e
 * essa conta pertence ao banco. Ver `lsoft_carteira_por_cliente` na migration 0096.
 */
export async function lerCarteiraDoLsoft(filtro: FiltroDaCarteira = {}): Promise<
  { clientes: ClienteDaCarteira[]; ok: true; resumo: ResumoDaCarteira } | { erro: string; ok: false }
> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  let consulta = admin.from("lsoft_carteira_por_cliente").select("*").order("nome");

  const empreendimento = texto(filtro.empreendimento);
  if (empreendimento && EMPREENDIMENTOS_DO_LSOFT.includes(empreendimento as never)) {
    consulta = consulta.contains("empreendimentos", [empreendimento]);
  }

  const busca = texto(filtro.busca);
  if (busca) {
    // ⚠️ O CPF é buscado SÓ POR DÍGITOS. Quem digita "985.227" não encontraria nada contra a
    // coluna crua, e quem digita "98522744653" não encontraria contra a formatada — por isso a
    // coluna `cpf` guarda só dígitos e a busca normaliza o que veio.
    const soDigitos = busca.replace(/\D/g, "");
    const termos = [`nome.ilike.%${busca}%`];
    if (soDigitos.length >= 3) termos.push(`cpf.ilike.%${soDigitos}%`);
    consulta = consulta.or(termos.join(","));
  }

  const { data, error } = await consulta;
  if (error) return { erro: error.message, ok: false };

  const linhas = (data ?? []) as LinhaDaView[];
  let clientes = linhas.map(clienteDaLinha);

  // A unidade não é coluna: ela sai do parse das observações e vive no array `unidades`. Filtrar
  // por ela no PostgREST exigiria uma função; com 237 linhas, aqui é mais simples e honesto.
  if (busca && /^[a-z]?\d+$/i.test(busca.trim())) {
    const alvo = busca.trim().toUpperCase();
    const porUnidade = clientes.filter((c) =>
      c.unidades.some((u) => u.toUpperCase().split(/\s+/).includes(alvo) || u.toUpperCase().includes(alvo)),
    );
    if (porUnidade.length > 0) clientes = porUnidade;
  }

  const { data: ultima } = await admin
    .from("lsoft_sincronizacoes")
    .select("concluido_em")
    .eq("ok", true)
    .order("concluido_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const resumo: ResumoDaCarteira = {
    clientes: clientes.length,
    parcelasAbertas: clientes.reduce((s, c) => s + c.parcelasAbertas, 0),
    parcelasVencidas: clientes.reduce((s, c) => s + c.parcelasVencidas, 0),
    saldoAberto: clientes.reduce((s, c) => s + c.saldoAberto, 0),
    saldoVencido: clientes.reduce((s, c) => s + c.saldoVencido, 0),
    sincronizadoEm: texto((ultima as { concluido_em?: string } | null)?.concluido_em),
    totalRecebido: clientes.reduce((s, c) => s + c.totalRecebido, 0),
  };

  return { clientes, ok: true, resumo };
}

/** A ficha: cadastro completo + todas as parcelas, das mais antigas para as mais novas. */
export async function lerFichaDoLsoft(codigo: string): Promise<
  { cadastro: CadastroDoCliente; ok: true; parcelas: ParcelaDaCarteira[] } | { erro: string; ok: false }
> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  const { data: cliente, error: erroCliente } = await admin
    .from("lsoft_clientes")
    .select("*")
    .eq("codigo", codigo)
    .maybeSingle();

  if (erroCliente) return { erro: erroCliente.message, ok: false };
  if (!cliente) return { erro: "Cliente não encontrado.", ok: false };

  const { data: parcelas, error: erroParcelas } = await admin
    .from("lsoft_parcelas")
    .select("*")
    .eq("cliente_codigo", codigo)
    .order("vencimento", { ascending: true });

  if (erroParcelas) return { erro: erroParcelas.message, ok: false };

  const linha = cliente as LinhaDaView;

  return {
    cadastro: {
      bairro: texto(linha.bairro),
      bloqueado: Boolean(linha.bloqueado),
      celular: texto(linha.celular),
      cep: texto(linha.cep),
      cidade: texto(linha.cidade),
      codigo: String(linha.codigo ?? ""),
      conjuge: texto(linha.conjuge),
      cpfFormatado: texto(linha.cpf_formatado),
      dataCadastro: texto(linha.data_cadastro),
      email: texto(linha.email),
      empreendimentos: Array.isArray(linha.empreendimentos) ? (linha.empreendimentos as string[]) : [],
      endereco: texto(linha.endereco),
      estado: texto(linha.estado),
      mae: texto(linha.mae),
      nascimento: texto(linha.nascimento),
      nome: String(linha.nome ?? ""),
      pai: texto(linha.pai),
      rg: texto(linha.rg),
      telefone: texto(linha.telefone),
      vendedor: texto(linha.vendedor),
    },
    ok: true,
    parcelas: ((parcelas ?? []) as LinhaDaView[]).map((p) => ({
      dataRecebido: texto(p.data_recebido),
      empreendimento: String(p.empreendimento ?? ""),
      id: String(p.id ?? ""),
      lote: texto(p.lote),
      observacoes: texto(p.observacoes),
      paga: Boolean(p.paga),
      parcela: texto(p.parcela),
      parcelaNumero: p.parcela_numero === null ? null : numero(p.parcela_numero),
      parcelaTotal: p.parcela_total === null ? null : numero(p.parcela_total),
      quadra: texto(p.quadra),
      valor: numero(p.valor),
      valorRecebido: numero(p.valor_recebido),
      vencimento: texto(p.vencimento),
    })),
  };
}
