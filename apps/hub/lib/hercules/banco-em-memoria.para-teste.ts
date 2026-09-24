import type { SupabaseClient } from "@supabase/supabase-js";

// O BANCO EM MEMÓRIA DOS TESTES DO REFLEXO DA TÊMIS NO HÉRCULES — e da soltura do lote.
//
// ⚠️ É O MESMO DUBLÊ DE `concluir-cancelamento-server.test.ts`, TIRADO PARA FORA PORQUE AGORA SERVE A
// SEIS ARQUIVOS. A casa tem um dublê por arquivo de teste, e isso é deliberado quando o dublê imita
// só o que aquele arquivo lê. O reflexo atravessa módulos (o envio, o webhook, a volta para correção,
// a marcação de atividade e o motor do cancelamento gravam a MESMA venda), e seis cópias do mesmo
// banco divergiriam no primeiro conserto. Este arquivo NÃO é importado por código de produção.
//
// ⚠️ ELE CONFERE NOMES DE COLUNA. As listas abaixo vieram de `information_schema.columns` em
// produção em 24/09/2026 (projeto bxgukywoxgivlrhjkwjx), recortadas para o que os testes usam. Uma
// consulta com coluna que não existe no banco de verdade vira `problemas`, que o teste confere no
// fim: o `select` é string e o typecheck não o alcança.


export type Linha = Record<string, unknown>;
type ErroDoBanco = { code: string; message: string };
type Resposta = { data: unknown; error: ErroDoBanco | null };
type Operacao = "insert" | "select" | "update";
export type Consulta = { filtros: readonly string[]; n: number; operacao: Operacao; tabela: string };

type Construtor = PromiseLike<Resposta> & {
  eq(coluna: string, valor: unknown): Construtor;
  in(coluna: string, valores: readonly unknown[]): Construtor;
  insert(linha: Linha | Linha[]): Construtor;
  is(coluna: string, valor: null): Construtor;
  limit(n: number): Construtor;
  maybeSingle(): Construtor;
  neq(coluna: string, valor: unknown): Construtor;
  not(coluna: string, operador: string, valor: unknown): Construtor;
  or(expressao: string): Construtor;
  order(coluna: string, opcoes?: { ascending?: boolean }): Construtor;
  range(de: number, ate: number): Construtor;
  select(colunas?: string): Construtor;
  single(): Construtor;
  update(patch: Linha): Construtor;
};

export type Banco = {
  cliente: SupabaseClient;
  consultas: Consulta[];
  depois(quando: (c: Consulta) => boolean, fazer: (banco: Banco) => void): void;
  falhar(quando: (c: Consulta) => boolean): void;
  linha(tabela: string, id: string): Linha | undefined;
  linhas(tabela: string): Linha[];
  problemas: string[];
  semear(tabela: string, linha: Linha): void;
};

/** As colunas de verdade (information_schema, 24/09/2026). */
export const COLUNAS: Record<string, readonly string[]> = {
  hercules_proposta_etapas: ["autor_c2x_id", "autor_nome", "criado_em", "de", "de_c2x", "id", "motivo", "observacao", "origem_c2x_id", "para", "para_c2x", "proposta_id", "quando", "workspace_id"],
  hercules_proposta_eventos: ["criado_em", "descricao", "documento", "id", "origem_c2x_id", "proposta_id", "quando", "quem", "tipo", "valor", "workspace_id"],
  hercules_propostas: ["aberta", "ajuste_modo", "ajuste_valor", "atualizado_em", "atualizado_em_c2x", "bens_e_permutas", "cancelada_em", "cancelada_motivo", "cancelada_por", "cancelada_por_nome", "cancelamento_pedido_em", "cancelamento_pedido_motivo", "cancelamento_pedido_por", "cancelamento_pedido_tipo", "cliente_c2x_id", "cliente_documento", "cliente_entity_id", "cliente_nome", "codigo", "compradores", "condicoes", "contrato_parcelas", "corretor_entity_id", "corretor_nome", "criado_em", "criado_em_c2x", "criado_por", "criado_por_nome", "data_assinatura", "data_ato", "data_faturamento", "dia_vencimento", "empreendimento_codigo", "empreendimento_id", "etapa", "etapa_c2x", "etapa_desde", "etapa_por", "id", "imobiliaria_c2x_id", "imobiliaria_entity_id", "imobiliaria_nome", "importado_em", "motivo", "observacao", "origem", "origem_c2x_id", "parcelas_sinal", "plano_c2x_id", "plano_correcao", "plano_juros", "plano_nome", "plano_parcelas", "plano_personalizado", "preco_tabela", "primeiro_sinal", "protocolo_numero", "reserva_id", "unidade_id", "unidade_nome", "validade_em", "valor", "workspace_id"],
  hercules_reservas: ["atualizado_em", "cancelada_em", "cancelada_motivo", "cancelada_por", "cancelada_por_nome", "corretor_entity_id", "criado_em", "criado_por", "criado_por_nome", "empreendimento_id", "evento_id", "id", "imobiliaria_entity_id", "observacao", "origem", "prometeu_reserva_id", "proponentes", "protocolo_numero", "situacao", "terreno_chave", "unidade_id", "validade_em", "venda_id", "workspace_id"],
  hercules_unidades: ["andar", "apartamento", "area", "area_extenso", "atualizado_em", "bloqueado_em", "bloqueado_por", "bloqueado_por_nome", "bloqueio_motivo", "categoria_id", "codigo", "criado_em", "enterprise_id", "espelho_de", "id", "lote", "matricula", "matricula_livro", "origem_c2x_id", "preco_extenso", "preco_tabela", "quadra", "segmento_id", "situacao", "tipo_unidade", "tipologia", "torre", "vagas", "vinculo_em", "vinculo_origem", "vinculo_por", "vinculo_por_nome", "workspace_id"],
  prometeu_reservas: ["area", "cancelada_em", "cancelada_motivo", "codigo", "created_at", "credenciado_id", "criado_por", "criado_por_nome", "evento_id", "grupo_id", "id", "lote", "pa_impressa_em", "pa_impressa_vezes", "preco_tabela", "proponentes", "proposta_lancada_em", "proposta_lancada_por", "quadra", "situacao", "unidade_c2x_id", "updated_at"],
  temis_assinatura_eventos: ["aplicado", "assinatura_cabecalho", "assinatura_conferida", "envelope_id", "evento", "headers", "id", "payload", "provedor", "provedor_documento_id", "recebido_em"],
  temis_envelopes: ["atualizado_em", "compromisso_id", "criado_em", "documento_id", "enterprise_id", "envelope_id", "enviado_em", "enviado_por", "enviado_por_nome", "estado", "estado_cru", "falha", "fechado_em", "id", "nome", "ordenada", "proposta_id", "provedor", "provedor_documento_id", "signatarios", "unidade_id", "workspace_id"],
  temis_trabalho_etapas: ["de", "id", "motivo", "observacao", "origem", "para", "proposta_id", "quando", "quem", "quem_nome", "trabalho_id", "trabalho_tipo", "workspace_id"],
  temis_trabalhos: ["aberto_por", "arrependimento_inicio", "atividades_feitas", "atualizado_em", "canal", "cliente_cpf", "cliente_nome", "criado_em", "enterprise_codigo", "enterprise_id", "enterprise_nome", "estagio", "estagio_desde", "evidencia_path", "id", "indeferido_em", "indeferido_motivo", "indeferido_observacao", "indeferido_por", "indeferido_por_nome", "iris_ticket_id", "observacao", "operado_por", "proposta_id", "tipo", "trabalho_origem_id", "unidade", "venda_id", "workspace_id"],
};

/** As origens que o check da 0153 aceita HOJE em produção (sem a 0177). */
export const ORIGENS_DA_0153 = [
  "abertura", "atividade", "contrato_gerado", "envio_assinatura", "webhook_assinatura",
  "indeferimento", "retorno_para_correcao",
];

const texto = (valor: unknown): null | string =>
  valor === null || valor === undefined ? null : String(valor);

/** Separa por vírgula só no nível de fora (nem dentro de parênteses, nem dentro de aspas). */
function separarNoTopo(expressao: string): string[] {
  const partes: string[] = [];
  let atual = "";
  let nivel = 0;
  let aspas = false;
  for (const ch of expressao) {
    if (ch === '"') aspas = !aspas;
    else if (!aspas && ch === "(") nivel += 1;
    else if (!aspas && ch === ")") nivel -= 1;
    else if (!aspas && nivel === 0 && ch === ",") {
      partes.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}

/** A lista `(a,"b")` do PostgREST, sem parênteses nem aspas. */
function listaDoPostgrest(valor: string): null | Set<string> {
  if (!valor.startsWith("(") || !valor.endsWith(")")) return null;
  return new Set(separarNoTopo(valor.slice(1, -1)).map((v) => v.trim().replace(/^"(.*)"$/, "$1")));
}

function condicaoDoOr(expressao: string): null | { coluna: string; teste: (l: Linha) => boolean } {
  const m = /^([a-z_0-9]+)\.(eq|in)\.(.+)$/.exec(expressao.trim());
  if (!m) return null;
  const coluna = m[1] ?? "";
  const valor = m[3] ?? "";
  if (m[2] === "eq") return { coluna, teste: (l) => texto(l[coluna]) === valor };
  const aceitos = listaDoPostgrest(valor);
  if (!aceitos) return null;
  return {
    coluna,
    teste: (l) => {
      const t = texto(l[coluna]);
      return t !== null && aceitos.has(t);
    },
  };
}

/** As regras que o banco de verdade faz valer e que importam aqui. */
function violacao(tabela: string, linha: Linha, outras: readonly Linha[], origens: readonly string[]): ErroDoBanco | null {
  if (tabela === "temis_trabalho_etapas" && !origens.includes(String(linha.origem))) {
    return {
      code: "23514",
      message:
        'new row for relation "temis_trabalho_etapas" violates check constraint "temis_trabalho_etapas_origem_valida"',
    };
  }
  if (tabela !== "hercules_reservas") return null;
  const viva = (l: Linha) => ["ativa", "proposta"].includes(String(l.situacao));
  if (viva(linha) && outras.some((o) => viva(o) && texto(o.unidade_id) === texto(linha.unidade_id))) {
    return {
      code: "23505",
      message: 'duplicate key value violates unique constraint "hercules_reservas_uma_viva_por_unidade"',
    };
  }
  return null;
}

export function criarBanco(inicial: Record<string, Linha[]>, opcoes: { origensDaPassagem?: readonly string[] } = {}): Banco {
  const origens = opcoes.origensDaPassagem ?? ORIGENS_DA_0153;
  const tabelas = new Map<string, Linha[]>();
  const consultas: Consulta[] = [];
  const problemas: string[] = [];
  const falhas: Array<(c: Consulta) => boolean> = [];
  const ganchos: Array<{ fazer: (b: Banco) => void; quando: (c: Consulta) => boolean }> = [];
  let contador = 0;

  const daTabela = (tabela: string): Linha[] => {
    const existente = tabelas.get(tabela);
    if (existente) return existente;
    const nova: Linha[] = [];
    tabelas.set(tabela, nova);
    return nova;
  };

  const comPadroes = (tabela: string, linha: Linha): Linha => {
    const base: Linha = Object.fromEntries((COLUNAS[tabela] ?? []).map((c) => [c, null]));
    contador += 1;
    base.id = `${tabela}-${contador}`;
    return { ...base, ...linha };
  };

  function from(tabela: string): Construtor {
    let operacao: Operacao = "select";
    let colunas: null | string[] = null;
    let devolver = false;
    let unico = false;
    let exigeUma = false;
    let carga: Linha[] = [];
    let ordem: null | { ascendente: boolean; coluna: string } = null;
    let faixa: null | readonly [number, number] = null;
    let teto: null | number = null;
    const filtros: Array<(l: Linha) => boolean> = [];
    const descricao: string[] = [];
    const erros: string[] = [];

    const conferir = (coluna: string, onde: string) => {
      const conhecidas = COLUNAS[tabela];
      if (!conhecidas) erros.push(`a tabela ${tabela} não existe`);
      else if (!conhecidas.includes(coluna)) erros.push(`${onde}: a coluna ${tabela}.${coluna} não existe`);
    };

    const projetar = (l: Linha): Linha =>
      colunas ? Object.fromEntries(colunas.map((c) => [c, l[c] ?? null])) : { ...l };

    const saida = (linhas: Linha[]): Resposta => {
      const projetadas = linhas.map(projetar);
      if (!unico) return { data: projetadas, error: null };
      if (projetadas.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      if (exigeUma && projetadas.length === 0) return { data: null, error: { code: "PGRST116", message: "no rows" } };
      return { data: projetadas[0] ?? null, error: null };
    };

    const responder = (): Resposta => {
      const todas = daTabela(tabela);
      const casa = (l: Linha) => filtros.every((f) => f(l));
      if (operacao === "insert") {
        const novas: Linha[] = [];
        for (const bruta of carga) {
          const nova = comPadroes(tabela, bruta);
          const erro = violacao(tabela, nova, [...todas, ...novas], origens);
          if (erro) return { data: null, error: erro };
          novas.push(nova);
        }
        todas.push(...novas);
        return devolver ? saida(novas) : { data: null, error: null };
      }
      if (operacao === "update") {
        const alvo = todas.filter(casa);
        const patch = carga[0] ?? {};
        for (const l of alvo) {
          const erro = violacao(tabela, { ...l, ...patch }, todas.filter((o) => o !== l), origens);
          if (erro) return { data: null, error: erro };
        }
        for (const l of alvo) Object.assign(l, patch);
        return devolver ? saida(alvo) : { data: null, error: null };
      }
      let linhas = todas.filter(casa);
      if (ordem) {
        const { ascendente, coluna } = ordem;
        linhas = [...linhas].sort((a, b) => {
          const c = (texto(a[coluna]) ?? "").localeCompare(texto(b[coluna]) ?? "");
          return ascendente ? c : -c;
        });
      }
      const de = faixa ? faixa[0] : 0;
      const ate = faixa ? faixa[1] + 1 : Number.POSITIVE_INFINITY;
      linhas = linhas.slice(de, Math.min(ate, de + 1000));
      if (teto !== null) linhas = linhas.slice(0, teto);
      return saida(linhas);
    };

    const executar = (): Resposta => {
      const consulta: Consulta = { filtros: [...descricao], n: consultas.length, operacao, tabela };
      consultas.push(consulta);
      if (erros.length > 0) {
        problemas.push(...erros);
        return { data: null, error: { code: "42703", message: erros.join("; ") } };
      }
      if (falhas.some((f) => f(consulta))) {
        return { data: null, error: { code: "08006", message: "conexão perdida (falha simulada)" } };
      }
      const resposta = responder();
      if (!resposta.error) {
        for (const gancho of [...ganchos]) {
          if (!gancho.quando(consulta)) continue;
          ganchos.splice(ganchos.indexOf(gancho), 1);
          gancho.fazer(banco);
        }
      }
      return resposta;
    };

    const q: Construtor = {
      eq(coluna, valor) {
        conferir(coluna, "eq");
        descricao.push(`eq:${coluna}=${String(valor)}`);
        filtros.push((l) => texto(l[coluna]) !== null && texto(l[coluna]) === texto(valor));
        return q;
      },
      in(coluna, valores) {
        conferir(coluna, "in");
        const aceitos = new Set(valores.map(texto).filter((v): v is string => v !== null));
        descricao.push(`in:${coluna}=${[...aceitos].join(",")}`);
        filtros.push((l) => {
          const t = texto(l[coluna]);
          return t !== null && aceitos.has(t);
        });
        return q;
      },
      insert(linha) {
        operacao = "insert";
        carga = Array.isArray(linha) ? linha : [linha];
        for (const l of carga) for (const coluna of Object.keys(l)) conferir(coluna, "insert");
        return q;
      },
      is(coluna, valor) {
        conferir(coluna, "is");
        if (valor !== null) erros.push(`is(${coluna}) só é imitado com null`);
        descricao.push(`is:${coluna}=null`);
        filtros.push((l) => texto(l[coluna]) === null);
        return q;
      },
      limit(n) {
        teto = n;
        return q;
      },
      maybeSingle() {
        unico = true;
        return q;
      },
      neq(coluna, valor) {
        conferir(coluna, "neq");
        descricao.push(`neq:${coluna}=${String(valor)}`);
        filtros.push((l) => texto(l[coluna]) !== null && texto(l[coluna]) !== texto(valor));
        return q;
      },
      not(coluna, operador, valor) {
        conferir(coluna, "not");
        if (operador === "is" && valor === null) {
          descricao.push(`not:${coluna}=null`);
          filtros.push((l) => texto(l[coluna]) !== null);
          return q;
        }
        const lista = operador === "in" ? listaDoPostgrest(String(valor)) : null;
        if (!lista) {
          erros.push(`not(${coluna}, ${operador}) não é imitado`);
          return q;
        }
        descricao.push(`not-in:${coluna}=${[...lista].join(",")}`);
        filtros.push((l) => {
          const t = texto(l[coluna]);
          return t !== null && !lista.has(t);
        });
        return q;
      },
      or(expressao) {
        const condicoes = separarNoTopo(expressao).map(condicaoDoOr);
        const validas = condicoes.filter((c): c is NonNullable<typeof c> => c !== null);
        if (validas.length !== condicoes.length) erros.push(`or(${expressao}) não é imitado`);
        for (const c of validas) conferir(c.coluna, "or");
        descricao.push(`or:${expressao}`);
        filtros.push((l) => validas.some((c) => c.teste(l)));
        return q;
      },
      order(coluna, opcoesDaOrdem) {
        conferir(coluna, "order");
        ordem = { ascendente: opcoesDaOrdem?.ascending !== false, coluna };
        return q;
      },
      range(de, ate) {
        faixa = [de, ate];
        return q;
      },
      select(lista = "*") {
        const pedidas = lista.split(",").map((c) => c.trim()).filter(Boolean);
        colunas = pedidas.includes("*") ? null : pedidas;
        for (const c of colunas ?? []) conferir(c, "select");
        if (operacao !== "select") devolver = true;
        return q;
      },
      single() {
        unico = true;
        exigeUma = true;
        return q;
      },
      then(aceitar, recusar) {
        return Promise.resolve().then(executar).then(aceitar, recusar);
      },
      update(patch) {
        operacao = "update";
        carga = [patch];
        for (const coluna of Object.keys(patch)) conferir(coluna, "update");
        return q;
      },
    };
    return q;
  }

  const banco: Banco = {
    cliente: { from } as unknown as SupabaseClient,
    consultas,
    depois: (quando, fazer) => {
      ganchos.push({ fazer, quando });
    },
    falhar: (quando) => {
      falhas.push(quando);
    },
    linha: (tabela, id) => daTabela(tabela).find((l) => l.id === id),
    linhas: (tabela) => daTabela(tabela),
    problemas,
    semear: (tabela, linha) => {
      daTabela(tabela).push(comPadroes(tabela, linha));
    },
  };
  for (const [tabela, linhas] of Object.entries(inicial)) for (const l of linhas) banco.semear(tabela, l);
  return banco;
}
