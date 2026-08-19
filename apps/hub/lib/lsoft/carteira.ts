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
  /** Quantos dos 9 campos que o C2X exige já estão preenchidos. */
  camposC2xPreenchidos: number;
  camposC2xTotal: number;
  celular: null | string;
  cidade: null | string;
  codigo: string;
  cpf: null | string;
  cpfFormatado: null | string;
  email: null | string;
  empreendimentos: string[];
  enriquecidoEm: null | string;
  nome: string;
  parcelas: number;
  parcelasAbertas: number;
  parcelasPagas: number;
  parcelasVencidas: number;
  proximoVencimento: null | string;
  saldoAberto: number;
  saldoVencido: number;
  statusValidacao: StatusDaValidacao;
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
  complemento: null | string;
  conjuge: null | string;
  cpfFormatado: null | string;
  dataCadastro: null | string;
  email: null | string;
  empreendimentos: string[];
  endereco: null | string;
  enriquecidoEm: null | string;
  escolaridade: null | string;
  estado: null | string;
  estadoCivil: null | string;
  faixaRenda: null | string;
  imobiliariaDocumento: null | string;
  mae: null | string;
  nacionalidade: null | string;
  nascimento: null | string;
  naturalidade: null | string;
  nome: string;
  nomePai: null | string;
  numero: null | string;
  observacaoValidacao: null | string;
  pai: null | string;
  profissao: null | string;
  regimeBens: null | string;
  rg: null | string;
  sexo: null | string;
  statusValidacao: StatusDaValidacao;
  telefone: null | string;
  validadoEm: null | string;
  validadoPor: null | string;
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

/**
 * O caminho do cliente até estar pronto para o C2X.
 *
 * `pendente` ninguém olhou · `em_analise` alguém mexeu e ainda falta campo · `validado` completo e
 * conferido · `dispensado` não vai para o C2X (com o motivo em `observacaoValidacao`).
 */
export type StatusDaValidacao = "dispensado" | "em_analise" | "pendente" | "validado";

/**
 * Tudo o que a validação pode corrigir — inclusive o que veio do LSoft.
 *
 * Decisão do Lucas (19/08/2026): *"pode deixar tudo editável"*. O cadastro do LSoft tem buraco
 * (nascimento, mãe e telefone em branco em boa parte das fichas) e erro de digitação de anos; quem
 * está conferindo com o cliente na linha precisa poder arrumar na hora.
 *
 * ⚠️ A CARGA DO LSOFT FOI ÚNICA (decisão do Lucas, 19/08/2026: *"não terá nova carga da LSoft, vai
 * ser somente essa"*). Ou seja: daqui para a frente **este banco é a verdade**, não mais o Access
 * da Cecílio. Nada sobrescreve o que for editado aqui — e é por isso que abrir tudo para edição
 * deixou de ser arriscado. Se um dia alguém recarregar, terá de resolver antes o que fazer com o
 * que a validação corrigiu.
 *
 * ⚠️ O QUE SEGUE FORA, de propósito: `codigo` (é a chave que amarra as parcelas) e os valores das
 * parcelas (dinheiro é do LSoft; corrigir aqui criaria uma segunda verdade financeira).
 */
export const CAMPOS_EDITAVEIS = [
  "bairro",
  "celular",
  "cep",
  "cidade",
  "complemento",
  "conjuge",
  "cpf_formatado",
  "email",
  "endereco",
  "escolaridade",
  "estado",
  "estado_civil",
  "faixa_renda",
  "imobiliaria_documento",
  "mae",
  "nacionalidade",
  "nascimento",
  "naturalidade",
  "nome",
  "nome_pai",
  "numero",
  "observacao_validacao",
  "profissao",
  "regime_bens",
  "rg",
  "sexo",
  "telefone",
] as const;

/**
 * Campos de data: chegam "dd/mm/aaaa" da tela e o Postgres precisa de ISO.
 *
 * ⚠️ String vazia em coluna `date` é erro no Postgres, não nulo — por isso o vazio vira `null`
 * explicitamente antes de gravar.
 */
const CAMPOS_DE_DATA = new Set(["nascimento"]);

function valorParaBanco(campo: string, valor: null | string): null | string {
  if (valor === null || valor.trim() === "") return null;
  if (!CAMPOS_DE_DATA.has(campo)) return valor;

  const br = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

export type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

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
    camposC2xPreenchidos: numero(linha.campos_c2x_preenchidos),
    camposC2xTotal: numero(linha.campos_c2x_total) || 9,
    celular: texto(linha.celular),
    cidade: texto(linha.cidade),
    codigo: String(linha.codigo ?? ""),
    cpf: texto(linha.cpf),
    cpfFormatado: texto(linha.cpf_formatado),
    email: texto(linha.email),
    empreendimentos: Array.isArray(linha.empreendimentos) ? (linha.empreendimentos as string[]) : [],
    enriquecidoEm: texto(linha.enriquecido_em),
    nome: String(linha.nome ?? ""),
    parcelas: numero(linha.parcelas),
    parcelasAbertas: numero(linha.parcelas_abertas),
    parcelasPagas: numero(linha.parcelas_pagas),
    parcelasVencidas: numero(linha.parcelas_vencidas),
    proximoVencimento: texto(linha.proximo_vencimento),
    saldoAberto: numero(linha.saldo_aberto),
    saldoVencido: numero(linha.saldo_vencido),
    statusValidacao: (texto(linha.status_validacao) ?? "pendente") as StatusDaValidacao,
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
      complemento: texto(linha.complemento),
      enriquecidoEm: texto(linha.enriquecido_em),
      escolaridade: texto(linha.escolaridade),
      estadoCivil: texto(linha.estado_civil),
      faixaRenda: texto(linha.faixa_renda),
      imobiliariaDocumento: texto(linha.imobiliaria_documento),
      mae: texto(linha.mae),
      nacionalidade: texto(linha.nacionalidade),
      nascimento: texto(linha.nascimento),
      naturalidade: texto(linha.naturalidade),
      nome: String(linha.nome ?? ""),
      nomePai: texto(linha.nome_pai),
      numero: texto(linha.numero),
      observacaoValidacao: texto(linha.observacao_validacao),
      pai: texto(linha.pai),
      profissao: texto(linha.profissao),
      regimeBens: texto(linha.regime_bens),
      rg: texto(linha.rg),
      sexo: texto(linha.sexo),
      statusValidacao: (texto(linha.status_validacao) ?? "pendente") as StatusDaValidacao,
      telefone: texto(linha.telefone),
      validadoEm: texto(linha.validado_em),
      validadoPor: texto(linha.validado_por),
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

/**
 * Grava o que a validação preencheu, campo a campo, com trilha.
 *
 * ⚠️ SÓ OS CAMPOS DA LISTA BRANCA passam. Qualquer outro é ignorado em silêncio — o que vem do
 * LSoft é espelho e seria sobrescrito na próxima carga, então aceitar edição ali seria prometer
 * uma correção que some sozinha.
 *
 * ⚠️ A TRILHA GUARDA O ANTES E O DEPOIS. Só grava linha quando o valor MUDOU de verdade: salvar a
 * ficha sem mexer em nada não pode encher o histórico de ruído, senão ninguém acha a alteração que
 * importa quando precisar.
 */
export async function salvarValidacaoDoLsoft(args: {
  autor: string;
  autorOrigem?: "careli" | "incorporador";
  campos: Partial<Record<CampoEditavel, null | string>>;
  codigo: string;
  status?: StatusDaValidacao;
}): Promise<{ alterados: number; ok: true } | { erro: string; ok: false }> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  const { data: atual, error: erroLeitura } = await admin
    .from("lsoft_clientes")
    .select("*")
    .eq("codigo", args.codigo)
    .maybeSingle();

  if (erroLeitura) return { erro: erroLeitura.message, ok: false };
  if (!atual) return { erro: "Cliente não encontrado.", ok: false };

  const antes = atual as Record<string, unknown>;
  const mudancas: Record<string, null | string> = {};
  const trilha: Record<string, unknown>[] = [];

  for (const campo of CAMPOS_EDITAVEIS) {
    if (!(campo in args.campos)) continue;
    const novo = valorParaBanco(campo, texto(args.campos[campo]));
    const velho = texto(antes[campo]);
    if (novo === velho) continue;

    mudancas[campo] = novo;
    trilha.push({
      autor: args.autor,
      autor_origem: args.autorOrigem ?? "careli",
      campo,
      cliente_codigo: args.codigo,
      valor_anterior: velho,
      valor_novo: novo,
    });
  }

  const statusPedido = args.status;
  const statusAtual = texto(antes.status_validacao) ?? "pendente";

  if (statusPedido && statusPedido !== statusAtual) {
    trilha.push({
      autor: args.autor,
      autor_origem: args.autorOrigem ?? "careli",
      campo: "status_validacao",
      cliente_codigo: args.codigo,
      valor_anterior: statusAtual,
      valor_novo: statusPedido,
    });
  }

  if (trilha.length === 0) return { alterados: 0, ok: true };

  const atualizacao: Record<string, unknown> = { ...mudancas };

  if (statusPedido) {
    atualizacao.status_validacao = statusPedido;
    // Carimbo de quem assinou embaixo. Só no `validado`: nos outros estados a ficha ainda está em
    // trânsito, e carimbar ali daria a entender que alguém conferiu.
    if (statusPedido === "validado") {
      atualizacao.validado_em = new Date().toISOString();
      atualizacao.validado_por = args.autor;
    }
  } else if (statusAtual === "pendente") {
    // Mexeu em algo sem dizer o status: sai de "pendente" sozinho, senão a lista de "ninguém
    // olhou" continua contando ficha que já foi trabalhada.
    atualizacao.status_validacao = "em_analise";
  }

  const { error: erroUpdate } = await admin
    .from("lsoft_clientes")
    .update(atualizacao)
    .eq("codigo", args.codigo);

  if (erroUpdate) return { erro: erroUpdate.message, ok: false };

  const { error: erroTrilha } = await admin.from("lsoft_clientes_edicoes").insert(trilha);
  // ⚠️ A TRILHA NÃO DERRUBA A EDIÇÃO. Se ela falhar, o dado já foi salvo e desfazer seria pior:
  // o registro fica no log do servidor para conferência.
  if (erroTrilha) console.error("[lsoft] trilha de edição falhou", erroTrilha);

  return { alterados: trilha.length, ok: true };
}

/** O histórico de quem mudou o quê nesta ficha, do mais recente para o mais antigo. */
export async function lerEdicoesDoLsoft(codigo: string): Promise<
  { edicoes: EdicaoDoLsoft[]; ok: true } | { erro: string; ok: false }
> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  const { data, error } = await admin
    .from("lsoft_clientes_edicoes")
    .select("*")
    .eq("cliente_codigo", codigo)
    .order("criado_em", { ascending: false })
    .limit(120);

  if (error) return { erro: error.message, ok: false };

  return {
    edicoes: ((data ?? []) as LinhaDaView[]).map((e) => ({
      autor: String(e.autor ?? ""),
      autorOrigem: String(e.autor_origem ?? "careli"),
      campo: String(e.campo ?? ""),
      criadoEm: String(e.criado_em ?? ""),
      valorAnterior: texto(e.valor_anterior),
      valorNovo: texto(e.valor_novo),
    })),
    ok: true,
  };
}

export type EdicaoDoLsoft = {
  autor: string;
  autorOrigem: string;
  campo: string;
  criadoEm: string;
  valorAnterior: null | string;
  valorNovo: null | string;
};
