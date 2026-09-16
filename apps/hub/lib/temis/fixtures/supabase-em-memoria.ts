// UM SUPABASE DE MENTIRA, EM MEMÓRIA — para os testes das portas da Têmis (hub e portal).
//
// Existe para provar o RECORTE: quem consultou o quê, e se alguma gravação ou assinatura de Storage
// aconteceu antes (ou em vez) do 404. Por isso ele anota toda consulta, toda gravação e toda chamada
// ao Storage, e imita as três respostas do PostgREST que as funções tratam de propósito:
//   • `22P02` quando um uuid torto chega num filtro `id` de tabela com chave uuid;
//   • `PGRST204` quando a gravação cita uma coluna que a migration ainda não criou;
//   • o erro que o teste mandar, por tabela.
//
// ⚠️ SÓ PARA TESTE. Não é importado por código de produção.

export type Linha = Record<string, unknown>;

export type Consulta = {
  colunas: string;
  filtros: Array<[string, string, unknown]>;
  tabela: string;
  tipo: "delete" | "insert" | "select" | "update";
  valores?: unknown;
};

export type EstadoDoBanco = {
  /** Colunas que "ainda não existem": gravação que as cite volta com PGRST204. */
  colunasAusentes: string[];
  consultas: Consulta[];
  /** Erro forçado por tabela (vale para qualquer operação nela). */
  erros: Record<string, { code: string; message: string }>;
  storage: {
    info: string[];
    remove: string[][];
    signedUpload: string[];
    signedUrl: Array<{ path: string; ttl: number }>;
  };
  tabelas: Record<string, Linha[]>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABELAS_COM_UUID = new Set([
  "hercules_unidades",
  "temis_anexos",
  "temis_assinantes",
  "temis_categorias",
  "temis_minutas",
]);

export function novoEstado(): EstadoDoBanco {
  return {
    colunasAusentes: [],
    consultas: [],
    erros: {},
    storage: { info: [], remove: [], signedUpload: [], signedUrl: [] },
    tabelas: {},
  };
}

let sequencia = 0;
function novoId(): string {
  sequencia += 1;
  return `00000000-0000-4000-8000-${String(sequencia).padStart(12, "0")}`;
}

function casa(linha: Linha, filtro: [string, string, unknown]): boolean {
  const [coluna, op, valor] = filtro;
  const atual = linha[coluna] ?? null;
  if (op === "eq") return String(atual) === String(valor);
  if (op === "neq") return String(atual) !== String(valor);
  if (op === "in") return Array.isArray(valor) && valor.map(String).includes(String(atual));
  if (op === "is") return atual === valor;
  if (op === "not.is") return atual !== valor;
  if (op === "or") {
    return String(valor)
      .split(",")
      .some((parte) => {
        const [col, operador, ...resto] = parte.split(".");
        return operador === "eq" && String(linha[col ?? ""] ?? "") === resto.join(".");
      });
  }
  return true;
}

export function clienteEmMemoria(estado: EstadoDoBanco) {
  const construir = (tabela: string) => {
    const consulta: Consulta = { colunas: "", filtros: [], tabela, tipo: "select" };
    let contagem = false;
    let cabeca = false;
    let faixa: [number, number] | null = null;
    let limite: null | number = null;

    const resolver = (): { count?: number; data: unknown; error: unknown } => {
      estado.consultas.push(consulta);
      const forcado = estado.erros[tabela];
      if (forcado) return { data: null, error: forcado };

      const porId = consulta.filtros.find(([c, op]) => c === "id" && op === "eq");
      if (porId && TABELAS_COM_UUID.has(tabela) && !UUID.test(String(porId[2]))) {
        return { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } };
      }

      if (consulta.tipo === "insert" || consulta.tipo === "update") {
        const valores = (Array.isArray(consulta.valores) ? consulta.valores[0] : consulta.valores) as Linha;
        const ausente = estado.colunasAusentes.find((c) => c in (valores ?? {}));
        if (ausente) {
          return {
            data: null,
            error: {
              code: "PGRST204",
              message: `Could not find the '${ausente}' column of '${tabela}' in the schema cache`,
            },
          };
        }
      }

      const linhas = (estado.tabelas[tabela] ??= []);
      const alvo = linhas.filter((l) => consulta.filtros.every((f) => casa(l, f)));

      if (consulta.tipo === "insert") {
        const nova = { id: novoId(), ...(consulta.valores as Linha) };
        linhas.push(nova);
        return { data: [nova], error: null };
      }
      if (consulta.tipo === "update") {
        for (const l of alvo) Object.assign(l, consulta.valores as Linha);
        return { data: alvo, error: null };
      }
      if (consulta.tipo === "delete") {
        estado.tabelas[tabela] = linhas.filter((l) => !alvo.includes(l));
        return { data: alvo, error: null };
      }

      let saida = alvo;
      if (faixa) saida = saida.slice(faixa[0], faixa[1] + 1);
      if (limite !== null) saida = saida.slice(0, limite);
      if (contagem) return { count: alvo.length, data: cabeca ? null : saida, error: null };
      return { data: saida, error: null };
    };

    const api = {
      delete: () => {
        consulta.tipo = "delete";
        return api;
      },
      eq: (coluna: string, valor: unknown) => {
        consulta.filtros.push([coluna, "eq", valor]);
        return api;
      },
      in: (coluna: string, valor: unknown) => {
        consulta.filtros.push([coluna, "in", valor]);
        return api;
      },
      insert: (valores: unknown) => {
        consulta.tipo = "insert";
        consulta.valores = valores;
        return api;
      },
      is: (coluna: string, valor: unknown) => {
        consulta.filtros.push([coluna, "is", valor]);
        return api;
      },
      limit: (n: number) => {
        limite = n;
        return api;
      },
      maybeSingle: async () => {
        const { data, error } = resolver();
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      neq: (coluna: string, valor: unknown) => {
        consulta.filtros.push([coluna, "neq", valor]);
        return api;
      },
      not: (coluna: string, operador: string, valor: unknown) => {
        consulta.filtros.push([coluna, `not.${operador}`, valor]);
        return api;
      },
      or: (expressao: string) => {
        consulta.filtros.push(["", "or", expressao]);
        return api;
      },
      order: () => api,
      range: (de: number, ate: number) => {
        faixa = [de, ate];
        return api;
      },
      select: (colunas?: string, opcoes?: { count?: string; head?: boolean }) => {
        if (consulta.tipo === "select") consulta.colunas = colunas ?? "*";
        contagem = Boolean(opcoes?.count);
        cabeca = Boolean(opcoes?.head);
        return api;
      },
      single: async () => {
        const { data, error } = resolver();
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      then: (aceitar: (v: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(aceitar, recusar),
      update: (valores: unknown) => {
        consulta.tipo = "update";
        consulta.valores = valores;
        return api;
      },
    };
    return api;
  };

  return {
    from: (tabela: string) => construir(tabela),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => {
          estado.storage.signedUpload.push(path);
          return { data: { path, signedUrl: "https://x/upload", token: "tok-1" }, error: null };
        },
        createSignedUrl: async (path: string, ttl: number) => {
          estado.storage.signedUrl.push({ path, ttl });
          return {
            data: {
              signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=abc`,
            },
            error: null,
          };
        },
        info: async (path: string) => {
          estado.storage.info.push(path);
          return { data: { contentType: "application/pdf", size: 1024 }, error: null };
        },
        remove: async (paths: string[]) => {
          estado.storage.remove.push(paths);
          return { data: null, error: null };
        },
      }),
    },
  };
}

/** As gravações (insert, update, delete) de uma tabela, na ordem em que aconteceram. */
export function gravacoesEm(estado: EstadoDoBanco, tabela: string): Consulta[] {
  return estado.consultas.filter((c) => c.tabela === tabela && c.tipo !== "select");
}
