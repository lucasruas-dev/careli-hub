import { describe, expect, it, vi } from "vitest";

// O CORRETOR QUE A IMOBILIÁRIA DECLAROU PELO CPF — a porta do CAD público tem de reconhecê-lo.
//
// Caso real (18/09/2026): a imobiliária CINTHIA DUARTE PIRES - CONSULTORIA FUNDIARIA (CNPJ
// 62.103.009/0001-85) foi cadastrada no Apolo com a representante legal também como corretora, pela
// regra do Lucas: *"se o usuário não cadastrar nenhum corretor, ele cadastra o representante como
// corretor"*. O vínculo nasceu SÓ COM O CPF na metadata (`related_entity_id` nulo), e a porta só
// enxergava vínculo ligado à ficha: a corretora digitou o CPF e caiu em "Não localizamos esse CNPJ
// entre as imobiliárias credenciadas".

vi.mock("@/lib/apolo/server", () => ({
  hashIdentifier: (tipo: string, valor: string) => `h:${tipo}:${valor}`,
}));
vi.mock("@/lib/apolo/cadastro-persist", () => ({ createApoloEntity: async () => null }));
vi.mock("@/lib/apolo/credenciamento", () => ({
  listEmpreendimentosAtivos: async () => [],
  listEmpreendimentosParaCad: async () => [],
}));

import { buscarCorretorPorCpf } from "./dados";
import { resolverVinculo } from "./regras";

type Linha = Record<string, unknown>;

function valor(linha: Linha, coluna: string): unknown {
  const [base, chave] = coluna.split("->>");
  if (!chave) return linha[coluna];
  const json = linha[base as string];
  return json && typeof json === "object" ? (json as Record<string, unknown>)[chave] : undefined;
}

// Banco em memória com o pedaço do PostgREST que a porta usa: select, eq, in, is, limit e
// maybeSingle. O `select` é ignorado de propósito: a linha volta inteira.
function bancoFalso(tabelas: Record<string, Linha[]>) {
  return {
    from(tabela: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let teto = Infinity;
      const resultado = () => {
        const linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
        return linhas.slice(0, teto);
      };
      const construtor = {
        eq(coluna: string, v: unknown) {
          filtros.push((l) => valor(l, coluna) === v);
          return construtor;
        },
        in(coluna: string, lista: unknown[]) {
          filtros.push((l) => lista.includes(valor(l, coluna)));
          return construtor;
        },
        is(coluna: string, v: null) {
          filtros.push((l) => (valor(l, coluna) ?? null) === v);
          return construtor;
        },
        limit(n: number) {
          teto = n;
          return construtor;
        },
        maybeSingle() {
          return Promise.resolve({ data: resultado()[0] ?? null, error: null });
        },
        select() {
          return construtor;
        },
        then(resolver: (r: { data: Linha[]; error: null }) => unknown) {
          return Promise.resolve({ data: resultado(), error: null }).then(resolver);
        },
      };
      return construtor;
    },
  };
}

const CPF = "11910091650";
const CORRETORA = "ficha-da-cinthia";
const IMOBILIARIA = "imobiliaria-da-cinthia";

function base(vinculos: Linha[], perfilDaImobiliaria = "active"): Record<string, Linha[]> {
  return {
    apolo_entities: [
      { display_name: "CINTHIA DUARTE PIRES", id: CORRETORA, legal_name: null },
      {
        display_name: "CINTHIA DUARTE PIRES - CONSULTORIA FUNDIARIA E ADMINISTRATIVA LTDA",
        id: IMOBILIARIA,
        legal_name: "CINTHIA DUARTE PIRES - CONSULTORIA FUNDIARIA E ADMINISTRATIVA LTDA",
      },
    ],
    apolo_entity_identifiers: [
      { entity_id: CORRETORA, identifier_type: "cpf", value_hash: `h:cpf:${CPF}` },
    ],
    apolo_entity_profiles: [
      { entity_id: CORRETORA, profile: "corretor", status: "active" },
      { entity_id: IMOBILIARIA, profile: "imobiliaria", status: perfilDaImobiliaria },
    ],
    apolo_relationships: vinculos,
  };
}

function declarado(cpf: string, extra: Linha = {}): Linha {
  return {
    entity_id: IMOBILIARIA,
    metadata: { cpf, email: "DUARTECINTHIAJURIDICO@GMAIL.COM", kind: "contato", role: "corretor" },
    related_entity_id: null,
    relationship_type: "corretor",
    status: "pending",
    ...extra,
  };
}

async function buscar(tabelas: Record<string, Linha[]>) {
  // O teste só precisa do que a porta chama; o tipo real é o cliente do Supabase.
  return buscarCorretorPorCpf(bancoFalso(tabelas) as never, "119.100.916-50");
}

describe("porta do CAD: corretor declarado pela imobiliária", () => {
  it("reconhece o vínculo gravado só com o CPF, e a imobiliária credenciada abre a porta", async () => {
    const corretor = await buscar(base([declarado(CPF)]));

    expect(corretor?.candidatos).toEqual([
      {
        imobiliariaAtiva: true,
        imobiliariaEntityId: IMOBILIARIA,
        imobiliariaNome: "CINTHIA DUARTE PIRES - CONSULTORIA FUNDIARIA E ADMINISTRATIVA LTDA",
      },
    ]);
    expect(resolverVinculo(corretor?.candidatos ?? []).ok).toBe(true);
  });

  it("aceita o CPF gravado com máscara, que é como 12 dos vínculos do Apolo estão", async () => {
    const corretor = await buscar(base([declarado("119.100.916-50")]));
    expect(corretor?.candidatos.map((c) => c.imobiliariaEntityId)).toEqual([IMOBILIARIA]);
  });

  it("usa o e-mail do vínculo declarado quando não há vínculo ligado", async () => {
    const corretor = await buscar(base([declarado(CPF)]));
    expect(corretor?.email).toBe("DUARTECINTHIAJURIDICO@GMAIL.COM");
  });

  it("vínculo arquivado não autoriza: o contato foi tirado da imobiliária", async () => {
    const corretor = await buscar(base([declarado(CPF, { status: "archived" })]));
    expect(corretor?.candidatos).toEqual([]);
  });

  it("imobiliária descredenciada continua barrando, mesmo com o CPF declarado", async () => {
    const corretor = await buscar(base([declarado(CPF)], "blocked"));
    expect(resolverVinculo(corretor?.candidatos ?? []).ok).toBe(false);
  });

  it("CPF de outra pessoa não vira vínculo", async () => {
    const corretor = await buscar(base([declarado("12345678909")]));
    expect(corretor?.candidatos).toEqual([]);
  });

  it("o vínculo ligado à ficha continua valendo, e vem primeiro", async () => {
    const outra = "outra-imobiliaria";
    const tabelas = base([
      declarado(CPF),
      {
        entity_id: outra,
        metadata: { email: "ligado@exemplo.com", kind: "trabalho", role: "corretor" },
        related_entity_id: CORRETORA,
        relationship_type: "corretor",
        status: "verified",
      },
    ]);
    tabelas.apolo_entities?.push({ display_name: "OUTRA", id: outra, legal_name: null });
    tabelas.apolo_entity_profiles?.push({ entity_id: outra, profile: "imobiliaria", status: "active" });

    const corretor = await buscar(tabelas);
    expect(corretor?.candidatos.map((c) => c.imobiliariaEntityId)).toEqual([outra, IMOBILIARIA]);
    expect(corretor?.email).toBe("ligado@exemplo.com");
    const vinculo = resolverVinculo(corretor?.candidatos ?? []);
    expect(vinculo.ok && vinculo.vinculo.imobiliariaEntityId).toBe(outra);
  });
});
