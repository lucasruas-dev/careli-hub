// REVISÃO DE 18/09/2026, LENTE "A PESSOA CERTA": a escolha da ficha (item A) também monta o CONTRATO.
//
// Lucas: *"tudo tem que ser alimentado pelo panteon"*. A regra do item A: a ficha apontada, depois a
// ponte pelo id do C2X, depois a que tem cadastro; o que faltar na escolhida vem de outra ficha do
// MESMO documento, e a escolhida SEMPRE tem precedência.
//
// ⚠️ ATÉ A RODADA 2 (18/09/2026) OS TESTES DO SEGUNDO BLOCO TINHAM "DEFEITO" NO NOME E FICAVAM
// VERMELHOS DE PROPÓSITO: cada um reconstrói, sem dado pessoal, uma forma medida em produção (dump
// pseudonimizado, 12 nativas + 200 importadas abertas, rodando o dadosDaProposta da origin/main e o
// do worktree). Corrigidos na rodada 2, viraram guardas. O número de casos está no próprio teste.
//
// O banco de mentira daqui FILTRA e ORDENA como o PostgREST (status, created_at, id; nulos do jeito do
// Postgres): a escolha da ficha depende da ordem, e um duplo que ignora `.order` esconderia o defeito.

import { describe, expect, it } from "vitest";

import { dadosDaProposta, mesmoNome } from "./dados-do-contrato";

type Linha = Record<string, unknown>;

function banco(tabelas: Record<string, Linha[]>) {
  const AUSENTES = new Set(["apolo_carteira_vendas", "apolo_carteira_parcelas"]);
  const construir = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    const ordens: Array<{ asc: boolean; col: string }> = [];
    const vivo = (v: unknown) => v !== null && v !== undefined;
    const resolver = () => {
      if (AUSENTES.has(tabela)) {
        return {
          data: null,
          error: { code: "PGRST205", message: `Could not find the table 'public.${tabela}' in the schema cache` },
        };
      }
      const linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      const ordenadas = linhas
        .map((l, i) => ({ i, l }))
        .sort((a, b) => {
          for (const o of ordens) {
            const va = a.l[o.col] ?? null;
            const vb = b.l[o.col] ?? null;
            if (va === vb) continue;
            if (va === null) return o.asc ? 1 : -1;
            if (vb === null) return o.asc ? -1 : 1;
            const c =
              typeof va === "boolean" ? Number(va) - Number(vb) : String(va) < String(vb) ? -1 : 1;
            return o.asc ? c : -c;
          }
          return a.i - b.i;
        })
        .map((x) => ({ ...x.l }));
      return { data: ordenadas, error: null };
    };
    const api: Record<string, unknown> = {
      eq: (c: string, v: unknown) => {
        filtros.push((l) => vivo(l[c]) && String(l[c]) === String(v));
        return api;
      },
      in: (c: string, vs: unknown[]) => {
        const s = new Set(vs.map(String));
        filtros.push((l) => vivo(l[c]) && s.has(String(l[c])));
        return api;
      },
      limit: () => api,
      maybeSingle: async () => {
        const r = resolver();
        return r.error ? r : { data: (r.data as Linha[])[0] ?? null, error: null };
      },
      or: (expr: string) => {
        const partes = expr.split(",").map((p) => {
          const [col, , ...resto] = p.split(".");
          return [col!, resto.join(".")] as const;
        });
        filtros.push((l) => partes.some(([c, v]) => vivo(l[c]) && String(l[c]) === v));
        return api;
      },
      order: (col: string, opt?: { ascending?: boolean }) => {
        ordens.push({ asc: opt?.ascending !== false, col });
        return api;
      },
      range: () => api,
      select: () => api,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
    };
    return api;
  };
  return { from: (t: string) => construir(t) } as never;
}

// ── O CENÁRIO: um CPF, duas fichas vivas (o espelho do C2X e a CAD pública) ──────────────────────

const VLO = "e0000000-0000-0000-0000-00000000000a";
const VOL = "e0000000-0000-0000-0000-00000000000c";
const UNIDADE = "d0000000-0000-0000-0000-000000000001";
const ESPELHO = "a0000000-0000-0000-0000-000000000001";
const CAD = "a0000000-0000-0000-0000-000000000002";
const OUTRA_PESSOA = "b0000000-0000-0000-0000-000000000001";
const IMOBILIARIA = "c0000000-0000-0000-0000-000000000001";
const COORD_VOL = "c0000000-0000-0000-0000-000000000004";
const COORD_VLO = "c0000000-0000-0000-0000-000000000005";

const CPF = "111.444.777-35";
const CPF_OUTRA = "222.555.888-40";

const espelho = (extra: Linha = {}): Linha => ({
  created_at: "2026-09-16T12:00:00Z",
  display_name: "NOME DO ESPELHO",
  document_masked: CPF,
  entity_kind: "pf",
  id: ESPELHO,
  legal_name: null,
  metadata: {},
  status: "active",
  trade_name: null,
  ...extra,
});

const cad = (extra: Linha = {}): Linha => ({
  created_at: "2026-09-14T12:00:00Z",
  display_name: "NOME DA CAD",
  document_masked: CPF,
  entity_kind: "pf",
  id: CAD,
  legal_name: null,
  metadata: {
    cadastro: { dataNascimento: "1990-01-02", estadoCivilId: "1", nacionalidade: "Brasileira", profissaoId: "3" },
  },
  status: "review",
  trade_name: null,
  ...extra,
});

const outraPessoa = (extra: Linha = {}): Linha => ({
  created_at: "2026-01-01T00:00:00Z",
  display_name: "OUTRA PESSOA",
  document_masked: CPF_OUTRA,
  entity_kind: "pf",
  id: OUTRA_PESSOA,
  legal_name: null,
  metadata: {
    c2xUserId: "4880",
    cadastro: { dataNascimento: "1955-05-05", estadoCivilId: "5", nacionalidade: "Italiana", profissaoId: "3" },
  },
  status: "review",
  trade_name: null,
  ...extra,
});

const endereco = (entity_id: string, sufixo: string): Linha => ({
  city: `Cidade ${sufixo}`,
  complement: null,
  district: `Bairro ${sufixo}`,
  entity_id,
  is_primary: true,
  number: `${sufixo}0`,
  postal_code: `3500${sufixo}-000`,
  state: "MG",
  street: `Rua ${sufixo}`,
});

/** A venda NATIVA, como as 12 de produção: um comprador titular, CAD apontada, vínculo gravado. */
const nativa = (extra: Linha = {}): Linha => ({
  cliente_c2x_id: null,
  cliente_documento: "11144477735",
  cliente_entity_id: CAD,
  cliente_nome: "NOME DA CAD",
  compradores: [{ cpf: "11144477735", nome: "NOME DA CAD", participacao: 100, telefone: "31900000000", titular: true }],
  condicoes: { anuais: [], mensais: [{ valor: 1000 }], totais: { entrada: 10000, financiado: 90000 } },
  contrato_parcelas: 90,
  corretor_entity_id: null,
  corretor_nome: null,
  data_assinatura: null,
  data_ato: null,
  data_faturamento: null,
  dia_vencimento: 10,
  empreendimento_id: VOL,
  etapa_c2x: null,
  id: "p-nativa",
  imobiliaria_c2x_id: null,
  imobiliaria_entity_id: IMOBILIARIA,
  imobiliaria_nome: "IMOBILIARIA",
  origem_c2x_id: null,
  plano_nome: "Plano 90x",
  plano_parcelas: 90,
  unidade_id: UNIDADE,
  valor: 100000,
  ...extra,
});

/** A venda IMPORTADA do C2X: ponte pelo usuário 4880, sem vínculo, apontando o pai. */
const importada = (extra: Linha = {}): Linha => ({
  ...nativa(),
  cliente_c2x_id: 4880,
  cliente_entity_id: null,
  compradores: [{ c2x_user_id: 4880, documento: CPF, nome: "NOME DA CAD", percentual: 100, titular: true }],
  condicoes: null,
  contrato_parcelas: null,
  empreendimento_id: VLO,
  id: "p-importada",
  imobiliaria_c2x_id: 2456,
  imobiliaria_entity_id: null,
  origem_c2x_id: 4918,
  ...extra,
});

function montar(t: {
  ajustes?: Linha[];
  contatos?: Linha[];
  enderecos?: Linha[];
  entidades: Linha[];
  esteira?: Linha[];
  links?: Linha[];
  proposta: Linha;
  relacionamentos?: Linha[];
}) {
  return banco({
    apolo_addresses: t.enderecos ?? [],
    apolo_contacts: t.contatos ?? [],
    apolo_enterprise_settings: t.ajustes ?? [
      {
        comissao_coordenadora_percentual: "2.000",
        comissao_imobiliaria_percentual: "4.000",
        coordenadora_entity_id: COORD_VOL,
        enterprise_id: "36",
      },
    ],
    apolo_entities: [
      ...t.entidades,
      { display_name: "IMOBILIARIA", document_masked: "44.555.666/0001-81", entity_kind: "pj", id: IMOBILIARIA },
      { display_name: "COORDENADORA DO VOL", document_masked: "11.222.333/0001-81", entity_kind: "pj", id: COORD_VOL, trade_name: "Coordenadora do VOL" },
      { display_name: "COORDENADORA DO VLO", document_masked: "55.666.777/0001-81", entity_kind: "pj", id: COORD_VLO, trade_name: "Coordenadora do VLO" },
    ],
    apolo_esteira: t.esteira ?? [],
    apolo_relationships: t.relacionamentos ?? [],
    apolo_source_links: t.links ?? [],
    hercules_empreendimentos: [
      { c2x_enterprise_id: "35", cidade: "Pará de Minas", codigo: "VLO", id: VLO, nome: "Vale do Ouro", pai_id: null, uf: "MG" },
      { c2x_enterprise_id: "36", cidade: "Pará de Minas", codigo: "VOL", id: VOL, nome: "Vale do Ouro · VOL", pai_id: VLO, uf: "MG" },
    ],
    hercules_proposta_eventos: [],
    hercules_propostas: [t.proposta],
    hercules_unidades: [
      { area: 360, codigo: "VOL0101", enterprise_id: "36", id: UNIDADE, lote: "01", matricula: "1", preco_tabela: 100000, quadra: "01", tipo_unidade: "lote" },
    ],
    temis_envelopes: [],
  });
}

const link = (entity_id: string, source_id: string): Linha => ({
  entity_id,
  source_id,
  source_system: "c2x",
  source_table: "users",
});

async function comprador(sb: never, propostaId: string, i = 0) {
  const r = await dadosDaProposta(propostaId, sb);
  expect(r).not.toBeNull();
  return { avisos: r!.avisos, gerais: r!.dados.gerais, v: r!.dados.compradores[i]?.valores ?? {} };
}

// ── O QUE SEGURA (passa) ─────────────────────────────────────────────────────

describe("A. a pessoa certa — o que segura", () => {
  it("nativa: a CAD apontada vence o espelho `active`, e o CPF impresso é sempre o da venda", async () => {
    const { v } = await comprador(
      montar({ entidades: [espelho(), cad()], proposta: nativa() }),
      "p-nativa",
    );
    expect(v.nome_cliente).toBe("NOME DA CAD");
    expect(v.cpf_cliente).toBe(CPF);
    expect(v.data_nascimento_cliente).toBe("02/01/1990");
  });

  it("`cliente_entity_id` apontando ficha de OUTRO CPF não traz a outra pessoa para o contrato", async () => {
    const { v } = await comprador(
      montar({
        entidades: [espelho(), outraPessoa()],
        proposta: nativa({ cliente_entity_id: OUTRA_PESSOA }),
      }),
      "p-nativa",
    );
    expect(v.nome_cliente).toBe("NOME DO ESPELHO");
    expect(v.cpf_cliente).toBe(CPF);
    expect(v.data_nascimento_cliente).toBeUndefined();
    expect(v.nacionalidade_cliente).toBeUndefined();
  });

  it("id do C2X repetido numa ficha de OUTRO CPF (metadata e source_link) não puxa a outra pessoa", async () => {
    const { v } = await comprador(
      montar({
        entidades: [espelho(), outraPessoa()],
        links: [link(OUTRA_PESSOA, "4880")],
        proposta: importada(),
      }),
      "p-importada",
    );
    expect(v.nome_cliente).toBe("NOME DO ESPELHO");
    expect(v.cpf_cliente).toBe(CPF);
    expect(v.data_nascimento_cliente).toBeUndefined();
    expect(v.estado_civil_cliente).toBeUndefined();
  });

  it("ficha ARQUIVADA apontada pela proposta não ganha da viva e não completa nada", async () => {
    const { v } = await comprador(
      montar({ entidades: [espelho(), cad({ status: "archived" })], proposta: nativa() }),
      "p-nativa",
    );
    expect(v.nome_cliente).toBe("NOME DO ESPELHO");
    expect(v.data_nascimento_cliente).toBeUndefined();
  });

  it("segundo proponente: cada comprador fica com as fichas do PRÓPRIO CPF, e o titular não empresta nada", async () => {
    const segundo = outraPessoa({ metadata: { cadastro: { dataNascimento: "1955-05-05", nacionalidade: "Italiana" } } });
    const proposta = nativa({
      compradores: [
        { cpf: "11144477735", nome: "NOME DA CAD", participacao: 50, titular: true },
        { cpf: "22255588840", nome: "OUTRA PESSOA", participacao: 50, titular: false },
      ],
    });
    const sb = montar({ entidades: [espelho(), cad(), segundo], proposta });
    const titular = await comprador(sb, "p-nativa", 0);
    const conjuge = await comprador(sb, "p-nativa", 1);
    expect(titular.v.nome_cliente).toBe("NOME DA CAD");
    expect(titular.v.nacionalidade_cliente).toBe("Brasileira");
    expect(conjuge.v.nome_cliente).toBe("OUTRA PESSOA");
    expect(conjuge.v.cpf_cliente).toBe(CPF_OUTRA);
    expect(conjuge.v.nacionalidade_cliente).toBe("Italiana");
    // Nada do titular no segundo (estado civil e profissão só existem na CAD do titular).
    expect(conjuge.v.estado_civil_cliente).toBeUndefined();
    expect(conjuge.v.profissao_cliente).toBeUndefined();
  });

  it("B. nativa sem RG: nenhum aviso cita RG; com RG na ficha, ele sai impresso como número + órgão", async () => {
    const sem = await comprador(montar({ entidades: [cad()], proposta: nativa() }), "p-nativa");
    expect(sem.v.rg_cliente).toBeUndefined();
    expect(sem.avisos.join(" | ")).not.toMatch(/\bRG\b/);

    const com = await comprador(
      montar({
        entidades: [cad()],
        esteira: [{ enterprise_id: "36", entity_id: CAD, ficha: { orgaoEmissor: "SSP/MG", rg: "MG-1" } }],
        proposta: nativa(),
      }),
      "p-nativa",
    );
    expect(com.v.rg_cliente).toBe("MG-1 SSP/MG");
  });

  it("C. nativa do VOL: comissão e coordenadora são as da divisão (36), mesmo com o pai (35) tendo outra", async () => {
    const { gerais } = await comprador(
      montar({
        ajustes: [
          { comissao_coordenadora_percentual: "2.000", comissao_imobiliaria_percentual: "4.000", coordenadora_entity_id: COORD_VOL, enterprise_id: "36" },
          { comissao_coordenadora_percentual: "9.000", comissao_imobiliaria_percentual: "9.000", coordenadora_entity_id: COORD_VLO, enterprise_id: "35" },
        ],
        entidades: [cad()],
        proposta: nativa(),
      }),
      "p-nativa",
    );
    expect(gerais.percentual_comissao_coordenadora_vendas).toBe("2%");
    expect(gerais.percentual_comissao_vinculado).toBe("4%");
    expect(gerais.nome_fantasia_coordenadora_vendas).toBe("Coordenadora do VOL");
  });
});

// ── O QUE QUEBRA (falha de propósito) ────────────────────────────────────────

describe("A. a pessoa certa: os defeitos medidos na revisão, corrigidos na rodada 2", () => {
  it("endereço NÃO é costurado: a escolhida tem o endereço inteiro na tabela, e o bairro da outra ficha fica de fora", async () => {
    // Forma medida na importada 64c07060 (produção, 18/09/2026): o espelho ganha pela ponte e tem o
    // endereço em `apolo_addresses`; a CAD do mesmo CPF tem na ficha da esteira SÓ o bairro. O bloco
    // de endereço da escolhida é olhado só na FICHA (vazia), então o bairro da CAD entra, e
    // `unirEndereco` o põe por cima da tabela do espelho: rua, número e CEP de um cadastro, bairro de
    // outro. Das 212 vendas medidas, 3 importadas saem costuradas (247f9650, 64c07060, e147b581) e 9
    // imprimem campo de endereço de outra ficha tendo a escolhida o seu. Nativas: 0.
    //
    // ⚠️ AS DUAS FICHAS TÊM O MESMO NOME (a mesma pessoa, como em 64c07060): com nomes diferentes a CAD
    // nem completaria (ver `ehAMesmaPessoa`), e o teste passaria sem exercitar o endereço.
    const { v } = await comprador(
      montar({
        enderecos: [endereco(ESPELHO, "1"), endereco(CAD, "2")],
        entidades: [espelho(), cad({ display_name: "NOME DO ESPELHO" })],
        esteira: [{ enterprise_id: "35", entity_id: CAD, ficha: { bairro: "Bairro 2", nacionalidade: "Brasileira" } }],
        links: [link(ESPELHO, "4880")],
        proposta: importada(),
      }),
      "p-importada",
    );
    expect(v.nome_cliente).toBe("NOME DO ESPELHO");
    // A CAD completou a qualificação (é a mesma pessoa)...
    expect(v.nacionalidade_cliente).toBe("Brasileira");
    // ...e o endereço é inteiro da escolhida.
    expect(v.rua_cliente).toBe("Rua 1");
    expect(v.bairro_cliente).toBe("Bairro 1");
  });

  it("o endereço inteiro de outra ficha NÃO substitui o da escolhida, que tinha o seu", async () => {
    // Forma medida em 5d86f389, 87ebadbd, 5fd99b16, 81eacfba, cda281bc, f91dfd6a: a escolhida (espelho,
    // pela ponte) tem endereço na tabela; a outra ficha do CPF tem o endereço na esteira. A regra do
    // item A diz que a escolhida tem precedência; o contrato sai com o endereço da outra.
    const { v } = await comprador(
      montar({
        enderecos: [endereco(ESPELHO, "1")],
        entidades: [espelho(), cad({ display_name: "NOME DO ESPELHO" })],
        esteira: [
          {
            enterprise_id: "35",
            entity_id: CAD,
            ficha: { bairro: "Bairro 2", cep: "35002-000", cidade: "Cidade 2", logradouro: "Rua 2", numero: "20", uf: "MG" },
          },
        ],
        links: [link(ESPELHO, "4880")],
        proposta: importada(),
      }),
      "p-importada",
    );
    expect(v.nome_cliente).toBe("NOME DO ESPELHO");
    expect(v.data_nascimento_cliente).toBe("02/01/1990");
    expect(v.rua_cliente).toBe("Rua 1");
    expect(v.cep_cliente).toBe("35001-000");
    expect(v.cidade_cliente).toBe("Cidade 1/MG");
  });

  it("sem endereço em camada nenhuma da escolhida, ele vem INTEIRO (ficha e tabela) da outra ficha da mesma pessoa", async () => {
    const { v } = await comprador(
      montar({
        enderecos: [endereco(CAD, "2")],
        entidades: [espelho(), cad({ display_name: "NOME DO ESPELHO" })],
        esteira: [{ enterprise_id: "35", entity_id: CAD, ficha: { numero: "22" } }],
        links: [link(ESPELHO, "4880")],
        proposta: importada(),
      }),
      "p-importada",
    );
    expect(v.nome_cliente).toBe("NOME DO ESPELHO");
    // A ficha da CAD por cima da tabela da CAD: a regra de sempre, dentro da MESMA entidade.
    expect(v.rua_cliente).toBe("Rua 2");
    expect(v.numero_cliente).toBe("22");
    expect(v.cep_cliente).toBe("35002-000");
  });

  it("ficha da esteira VAZIA ({}) NÃO conta como 'cadastro preenchido', e a CAD vence o espelho", async () => {
    // Forma medida em 247f9650 e e147b581: as duas fichas são ligadas ao usuário do C2X (o espelho pelo
    // source_link, a CAD pelo `metadata.c2xUserId`), o espelho tem uma linha na esteira com `ficha =
    // {}` e a CAD tem o cadastro. `temCadastro` faz `Boolean(fichas.get(id))`, e `{}` é verdadeiro: o
    // critério 3 empata, a ordem do banco (active < review) decide, e sai o espelho — completado pela
    // CAD, com o endereço costurado. Em produção, 137 das 835 linhas de `apolo_esteira` têm `ficha =
    // {}`. Corrigindo só esse teste (numa cópia fora do repo), a escolha muda nesses 2 compradores e
    // 2 dos 3 endereços costurados somem.
    //
    // ⚠️ AS DUAS COM O MESMO NOME, para o critério do nome da proposta empatar e só o cadastro decidir.
    // Quem ganhou se vê pelo endereço: o da CAD é a Rua 2.
    const { v } = await comprador(
      montar({
        enderecos: [endereco(ESPELHO, "1"), endereco(CAD, "2")],
        entidades: [
          espelho({ display_name: "NOME DA CAD" }),
          cad({ metadata: { ...(cad().metadata as Linha), c2xUserId: "4880" } }),
        ],
        esteira: [{ enterprise_id: "35", entity_id: ESPELHO, ficha: {} }],
        links: [link(ESPELHO, "4880")],
        proposta: importada(),
      }),
      "p-importada",
    );
    expect(v.nome_cliente).toBe("NOME DA CAD");
    expect(v.rua_cliente).toBe("Rua 2");
  });

  it("o WhatsApp de outra ficha NÃO vence o telefone da escolhida", async () => {
    // Forma medida nas nativas 82011db5, ca03bbcb e c7bf89e7 (e em 62 compradores importados): a CAD
    // apontada tem contato `phone`, o espelho tem `whatsapp`, e `primeiroContato` procura o TIPO
    // antes da ficha, na lista das duas juntas. Em 46 das 47 escolhidas é o mesmo número; em 1
    // (importadas cce7a7ca e e4f85c72, segundo comprador) sai outro número.
    const { v } = await comprador(
      montar({
        contatos: [
          { contact_type: "phone", entity_id: CAD, is_primary: true, value: "(31) 3333-0001" },
          { contact_type: "whatsapp", entity_id: ESPELHO, is_primary: true, value: "(31) 99999-0002" },
          { contact_type: "email", entity_id: ESPELHO, is_primary: true, value: "espelho@exemplo.invalid" },
        ],
        // O espelho com o mesmo nome: a mesma pessoa, e o e-mail que só ele tem completa a escolhida.
        entidades: [espelho({ display_name: "NOME DA CAD" }), cad()],
        proposta: nativa({ compradores: [{ cpf: "11144477735", nome: "NOME DA CAD", participacao: 100, titular: true }] }),
      }),
      "p-nativa",
    );
    expect(v.nome_cliente).toBe("NOME DA CAD");
    expect(v.telefone_cliente).toBe("(31) 3333-0001");
    expect(v.email_cliente).toBe("espelho@exemplo.invalid");
  });

  it("D NÃO põe o PRÓPRIO comprador como corretor da venda importada (a CAD pública em que ele se cadastrou como corretor)", async () => {
    // O formulário público da CAD grava como corretor quem preenche a primeira etapa, e o cliente que
    // preenche sozinho vira corretor de si mesmo. Em produção, 24 das 179 linhas de `apolo_esteira` com
    // corretor apontam a PRÓPRIA ficha. `quemVendeuPeloApolo` não confere isso: das 98 importadas que
    // passam a ter corretor no estrato medido (todas as abertas com duas fichas vivas do mesmo CPF),
    // 17 imprimem o comprador como corretor (0e24719b, 1b24895c, 2ea9ce41, 3a498011, 411d1dee,
    // 46156e86, 470a52eb, 583d085e, 586ad0e5, 67da32a5, 6e304fb5, 80653365, bb6509e9, c281ed4f,
    // c99f1abc, e4a674da, fc616f01).
    const { gerais } = await comprador(
      montar({
        entidades: [espelho(), cad({ metadata: { ...(cad().metadata as Linha), c2xUserId: "4880" } })],
        esteira: [{ corretor_entity_id: CAD, enterprise_id: "35", entity_id: CAD, ficha: null, imobiliaria_entity_id: null }],
        links: [link(ESPELHO, "4880")],
        proposta: importada({ imobiliaria_c2x_id: null, imobiliaria_nome: null }),
      }),
      "p-importada",
    );
    expect(gerais.corretor_nome ?? "").not.toBe("NOME DA CAD");
  });

  it("(latente, 0 casos hoje) o cônjuge da ficha de outra entidade NÃO vence o cônjuge cadastrado na escolhida", async () => {
    // A escolhida tem o cônjuge em `apolo_relationships` (é onde o wizard o grava) e nenhuma chave
    // `conjuge*` na ficha; a outra ficha do CPF tem `conjugeNome`. O bloco do cônjuge vem inteiro da
    // outra, e `unirConjuge` dá à ficha precedência sobre o relacionamento: o contrato qualifica — e
    // pede a assinatura de — o cônjuge que a escolhida NÃO tem. Medido: 0 dos 222 compradores hoje.
    const { v } = await comprador(
      montar({
        // O espelho com o mesmo nome: a mesma pessoa (com outro nome ele nem entraria).
        entidades: [
          espelho({ display_name: "NOME DA CAD" }),
          cad({ metadata: { cadastro: { estadoCivilId: "2", regimeBensId: "1" } } }),
        ],
        esteira: [{ enterprise_id: "36", entity_id: ESPELHO, ficha: { conjugeCpf: "333.666.999-50", conjugeNome: "CONJUGE ANTIGO" } }],
        proposta: nativa(),
        relacionamentos: [
          { entity_id: CAD, label: "CONJUGE ATUAL", metadata: { cpf: "444.777.000-60" }, relationship_type: "conjuge", status: "active" },
        ],
      }),
      "p-nativa",
    );
    expect(v.nome_cliente).toBe("NOME DA CAD");
    expect(v.nome_conjuge).toBe("CONJUGE ATUAL");
    expect(v.cpf_conjuge).toBe("444.777.000-60");
  });

  it("sem cônjuge na escolhida, o bloco vem INTEIRO da outra ficha da mesma pessoa", async () => {
    const { v } = await comprador(
      montar({
        entidades: [
          espelho({ display_name: "NOME DA CAD" }),
          cad({ metadata: { cadastro: { estadoCivilId: "2", regimeBensId: "1" } } }),
        ],
        esteira: [{ enterprise_id: "36", entity_id: ESPELHO, ficha: { conjugeCpf: "333.666.999-50", conjugeNome: "CONJUGE DA FICHA" } }],
        proposta: nativa(),
      }),
      "p-nativa",
    );
    expect(v.nome_conjuge).toBe("CONJUGE DA FICHA");
    expect(v.cpf_conjuge).toBe("333.666.999-50");
  });
});

// ── RODADA 2: AS TRAVAS NOVAS ────────────────────────────────────────────────

describe("A e D. a mesma pessoa, e o comprador que não vende o próprio lote (rodada 2)", () => {
  it("`mesmoNome`: igual sem acento e caixa, ou um contido no outro com o mesmo primeiro nome", () => {
    expect(mesmoNome("José da Silva", "JOSE DA SILVA")).toBe(true);
    expect(mesmoNome("MARIA SOUZA", "Maria de Souza Lima")).toBe(true);
    // O espelho do C2X às vezes guarda só o primeiro nome.
    expect(mesmoNome("ANA", "ANA SOBRENOME COMUM")).toBe(true);
    // Primeiro nome diferente é outra pessoa, mesmo com o sobrenome igual (a CAD com o CPF do cônjuge).
    expect(mesmoNome("ANA SOBRENOME COMUM", "BRUNO SOBRENOME COMUM")).toBe(false);
    // Sobrenome que não está no outro nome não é "contido".
    expect(mesmoNome("MARIA SOUZA", "MARIA LIMA")).toBe(false);
    // Nome vazio não prova nada.
    expect(mesmoNome("", "ANA")).toBe(false);
  });

  it("sem id que decida, a ficha com o NOME da proposta ganha da CAD de outra pessoa que tem cadastro", async () => {
    // Pela régua da rodada 1, a outra pessoa (ativa, mais antiga e com cadastro) ganhava pelo critério
    // do cadastro, e o contrato saía com o nome e a qualificação dela sobre o CPF do comprador.
    const { avisos, v } = await comprador(
      montar({
        entidades: [
          espelho({ display_name: "NOME DO COMPRADOR", status: "review" }),
          cad({ created_at: "2026-01-01T00:00:00Z", display_name: "OUTRO NOME NO MESMO CPF", status: "active" }),
        ],
        proposta: importada({
          cliente_c2x_id: null,
          compradores: [{ documento: CPF, nome: "NOME DO COMPRADOR", percentual: 100, titular: true }],
        }),
      }),
      "p-importada",
    );
    expect(v.nome_cliente).toBe("NOME DO COMPRADOR");
    expect(v.cpf_cliente).toBe(CPF);
    // Nada da outra pessoa entra.
    expect(v.data_nascimento_cliente).toBeUndefined();
    expect(v.estado_civil_cliente).toBeUndefined();
    expect(avisos.join(" | ")).toContain("NOME DO COMPRADOR: o Apolo tem outra ficha com este CPF e outro nome");
  });

  it("a ficha ligada pela ponte do C2X completa mesmo com o nome escrito de outro jeito", async () => {
    // A prova por id vale mais que o nome: a CAD que foi enviada ao C2X com o usuário do comprador.
    const { v } = await comprador(
      montar({
        entidades: [
          espelho(),
          cad({ display_name: "N. DA CAD", metadata: { ...(cad().metadata as Linha), c2xUserId: "4880" } }),
        ],
        links: [link(ESPELHO, "4880")],
        proposta: importada(),
      }),
      "p-importada",
    );
    expect(v.data_nascimento_cliente).toBe("02/01/1990");
  });

  it("o celular da escolhida sem o nono dígito sai na grafia completa que a outra ficha da mesma pessoa tem", async () => {
    // Medido em 18/09/2026: 2 compradores do estrato saíam com o próprio celular sem o nono dígito
    // depois que a escolhida passou a ter precedência no telefone. Número DIFERENTE continua o dela.
    const contatos = (daEscolhida: string) => [
      { contact_type: "phone", entity_id: CAD, is_primary: true, value: daEscolhida },
      { contact_type: "whatsapp", entity_id: ESPELHO, is_primary: true, value: "(31) 99999-0002" },
    ];
    const proposta = nativa({ compradores: [{ cpf: "11144477735", nome: "NOME DA CAD", participacao: 100, titular: true }] });
    // O espelho com o nome da CAD: a mesma pessoa (com outro nome, ele nem entraria; ver `ehAMesmaPessoa`).
    const fichas = [espelho({ display_name: "NOME DA CAD" }), cad()];
    const mesmo = await comprador(montar({ contatos: contatos("(31) 9999-0002"), entidades: fichas, proposta }), "p-nativa");
    expect(mesmo.v.telefone_cliente).toBe("(31) 99999-0002");
    const outro = await comprador(montar({ contatos: contatos("(31) 3333-0001"), entidades: fichas, proposta }), "p-nativa");
    expect(outro.v.telefone_cliente).toBe("(31) 3333-0001");
  });

  it("o link da imobiliária da venda que é o próprio comprador não traz o CPF dele como documento da imobiliária", async () => {
    // Medido na revisão de 18/09/2026: 1 venda importada aberta com `imobiliaria_c2x_id` apontando o
    // usuário do C2X que é o comprador.
    const { gerais } = await comprador(
      montar({
        contatos: [{ contact_type: "email", entity_id: CAD, is_primary: true, value: "comprador@exemplo.invalid" }],
        entidades: [espelho(), cad()],
        links: [link(ESPELHO, "4880"), link(CAD, "2456")],
        proposta: importada(),
      }),
      "p-importada",
    );
    expect(gerais.cpf_cnpj_vinculado).toBeUndefined();
    expect(gerais.email_vinculado).toBeUndefined();
  });

  it("o corretor da CAD que NÃO é comprador continua entrando (a trava não apaga o caso bom)", async () => {
    const CORRETOR = "c0000000-0000-0000-0000-00000000000c";
    const sb = banco({
      apolo_addresses: [],
      apolo_contacts: [],
      apolo_enterprise_settings: [],
      apolo_entities: [
        espelho(),
        cad({ metadata: { ...(cad().metadata as Linha), c2xUserId: "4880" } }),
        { display_name: "CORRETOR DE VERDADE", document_masked: "222.333.444-05", entity_kind: "pf", id: CORRETOR },
      ],
      apolo_esteira: [{ corretor_entity_id: CORRETOR, enterprise_id: "35", entity_id: CAD, ficha: null, imobiliaria_entity_id: null }],
      apolo_relationships: [],
      apolo_source_links: [link(ESPELHO, "4880")],
      hercules_empreendimentos: [
        { c2x_enterprise_id: "35", cidade: "Pará de Minas", codigo: "VLO", id: VLO, nome: "Vale do Ouro", pai_id: null, uf: "MG" },
      ],
      hercules_proposta_eventos: [],
      hercules_propostas: [importada({ imobiliaria_c2x_id: null, imobiliaria_nome: null })],
      hercules_unidades: [
        { area: 360, codigo: "VLO0101", enterprise_id: "35", id: UNIDADE, lote: "01", matricula: "1", preco_tabela: 100000, quadra: "01", tipo_unidade: "lote" },
      ],
      temis_envelopes: [],
    });
    const { gerais } = await comprador(sb, "p-importada");
    expect(gerais.corretor_nome).toBe("CORRETOR DE VERDADE");
  });
});
