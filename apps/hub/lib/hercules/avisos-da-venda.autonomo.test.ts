import { beforeEach, describe, expect, it, vi } from "vitest";

// O AVISO DA VENDA DO CORRETOR AUTÔNOMO — sem imobiliária, e sem cair no silêncio.
//
// Lucas (28/09/2026): a reserva passa a exigir *"um dos dois"*. Com autônomo não há imobiliária, e o
// aviso tem de ir para ELE e para o coordenador.
//
// ⚠️ O DEFEITO QUE ESTE ARQUIVO FECHA NÃO É "FALTA UM DESTINATÁRIO": É QUE O COORDENADOR ERA AVISADO
// E O REGISTRO DO AVISO SE PERDIA CALADO. Até 28/09/2026 `destinosDoAviso` empurrava o destino da
// imobiliária SEM NENHUM `if`, e usava `dados.imobiliariaId` como `entityId` de TODO destino de
// coordenador. Com a imobiliária vazia saíam três estragos juntos:
//   1. um destino FANTASMA de papel `imobiliaria`, com o nome literal "Imobiliária" e telefone nulo,
//      que a tela traduzia como "imobiliária não tem telefone cadastrado" — frase FALSA que manda o
//      operador procurar um cadastro que não existe nesta venda;
//   2. o WhatsApp do coordenador SAINDO de verdade (o telefone dele é real);
//   3. e o INSERT em `apolo_disparos` desse coordenador morrendo no cast de uuid, com o erro
//      ENGOLIDO (`catch {}` em lib/apolo/disparo-credenciamento.ts).
//
// ⚠️ A FICHA ONDE O REGISTRO PENDURA É O QUE MUDA, E ELA EXISTE. MEDIDO em produção
// (bxgukywoxgivlrhjkwjx, 28/09/2026, só SELECT): `apolo_disparos.entity_id` é `uuid` com
// `is_nullable = NO` e SEM nenhuma FK (`select conname, pg_get_constraintdef(oid) from pg_constraint
// where conrelid='public.apolo_disparos'::regclass;` → só a PK). E `select d.destinatario, count(*)
// filter (where e.entity_kind='pj') as pj, count(*) filter (where e.entity_kind='pf') as pf from
// apolo_disparos d join apolo_entities e on e.id=d.entity_id where d.tipo='hercules_reserva' group by
// 1;` → coordenador 56 PJ / 0 PF, corretor 0 PJ / 53 PF. Ou seja: hoje o registro do coordenador
// pendura numa PJ porque a PJ é a imobiliária. Sem ela, a única ficha da venda é a do autônomo — e o
// dado já prova que uma ficha `pf` é destino válido de disparo de reserva.

const estado = vi.hoisted(() => ({
  coordenadores: { coordenadores: [], motivo: "Empreendimento sem coordenador de vendas no Panteon nem no C2X." } as {
    coordenadores: Array<{ entityId: string; fonte: string; nome: string; telefone: null | string }>;
    motivo?: string;
  },
  entradas: [] as Array<Record<string, unknown>>,
  inserido: [] as Array<{ linhas: unknown; tabela: string }>,
  vinculados: [] as Array<{ nome: string; telefone: null | string }>,
}));

vi.mock("@/lib/apolo/disparo-credenciamento", () => ({
  enviarPeloRelacionamento: async (_client: unknown, entrada: Record<string, unknown>) => {
    estado.entradas.push(entrada);
    if (entrada.impedimento) return { erro: entrada.impedimento, ok: false };
    if (!entrada.telefone) return { erro: "sem telefone", ok: false };
    return { ok: true, para: String(entrada.telefone) };
  },
}));

vi.mock("@/lib/apolo/coordenador-do-empreendimento", () => ({
  MOTIVO_FALHA_DE_LEITURA: "Não foi possível ler o coordenador do empreendimento agora.",
  MOTIVO_SEM_COORDENADOR: "Empreendimento sem coordenador de vendas no Panteon nem no C2X.",
  coordenadoresDosPedidos: async (_client: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, estado.coordenadores])),
}));

vi.mock("./quem-pode-vender", () => ({
  coordenadoresDoPanteon: async () => estado.vinculados,
}));

import {
  avisarSobreAVenda,
  type DestinatariosDaVenda,
  destinatariosDaVenda,
  registrarAvisoNaoEnviado,
} from "./avisos-da-venda";
import { avisosDaReserva, comoFoiOAviso } from "./reserva";

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";

/** Sem imobiliária: só o autônomo tem nome e telefone, e o coordenador vem do empreendimento. */
const SEM_IMOBILIARIA: DestinatariosDaVenda = {
  coordenadores: [{ nome: "Nivea", telefone: "62999990000" }],
  corretor: { nome: "JOAO AUTONOMO", telefone: "62988887777" },
  imobiliaria: null,
};

function clienteFalso() {
  return {
    from: (tabela: string) => ({
      insert: async (linhas: unknown) => {
        estado.inserido.push({ linhas, tabela });
        return { data: null, error: null };
      },
    }),
  } as unknown as Parameters<typeof registrarAvisoNaoEnviado>[0];
}

/** Supabase de mentira para `destinatariosDaVenda`: só a ficha do autônomo existe. */
function clienteDosDestinatarios() {
  const consulta = (linhas: unknown[]) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.in = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok);
    return q;
  };
  return {
    from: (tabela: string) =>
      tabela === "apolo_entities"
        ? consulta([{ display_name: "JOAO AUTONOMO", id: AUTONOMO, legal_name: null, trade_name: null }])
        : consulta([
            { contact_type: "whatsapp", entity_id: AUTONOMO, is_primary: true, value: "62988887777" },
          ]),
  } as unknown as Parameters<typeof destinatariosDaVenda>[0];
}

beforeEach(() => {
  estado.coordenadores = {
    coordenadores: [{ entityId: "coord", fonte: "panteon", nome: "Nivea", telefone: "62999990000" }],
  };
  estado.entradas = [];
  estado.inserido = [];
  estado.vinculados = [];
});

describe("destinatariosDaVenda sem imobiliária", () => {
  it("⚠️ devolve `imobiliaria: null`, e NÃO o nome fabricado 'Imobiliária'", async () => {
    const d = await destinatariosDaVenda(clienteDosDestinatarios(), {
      corretorId: AUTONOMO,
      empreendimento: { c2xId: "37", nome: "Vale do Ouro" },
      imobiliariaId: null,
    });
    expect(d.imobiliaria).toBeNull();
    expect(d.corretor).toEqual({ nome: "JOAO AUTONOMO", telefone: "62988887777" });
    expect(d.coordenadores).toEqual([{ nome: "Nivea", telefone: "62999990000" }]);
  });
});

describe("avisarSobreAVenda na reserva do autônomo", () => {
  it("⚠️ avisa ELE e o coordenador, e nenhum destino de papel `imobiliaria` nasce", async () => {
    const resultados = await avisarSobreAVenda(clienteFalso(), {
      corretorId: AUTONOMO,
      destinatarios: SEM_IMOBILIARIA,
      imobiliariaId: null,
      origem: "reserva:whatsapp",
      textos: avisosDaReserva({
        cliente: "Maria da Silva",
        codigo: "000123",
        corretor: "JOAO AUTONOMO",
        cpf: "529.982.247-25",
        empreendimento: "Vale do Ouro",
        imobiliaria: null,
        unidade: "Quadra 12 · Lote 06",
        validadeEm: "2026-10-01T23:59:59.000Z",
      }),
      tipo: "hercules_reserva",
    });

    expect(resultados.map((r) => r.para).sort()).toEqual(["coordenador", "corretor"]);
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(estado.entradas.map((e) => e.destinatario).sort()).toEqual(["coordenador", "corretor"]);
  });

  it("⚠️ o registro do coordenador pendura na ficha do AUTÔNOMO, nunca num id vazio", async () => {
    // `apolo_disparos.entity_id` é uuid NOT NULL (medido): um "" ali morre no cast e o erro é
    // engolido pelo `catch {}` do disparo — coordenador avisado e histórico sem linha nenhuma.
    await avisarSobreAVenda(clienteFalso(), {
      corretorId: AUTONOMO,
      destinatarios: SEM_IMOBILIARIA,
      imobiliariaId: null,
      origem: "reserva:whatsapp",
      textos: [
        { papel: "corretor", texto: "a" },
        { papel: "coordenador", texto: "c" },
      ],
      tipo: "hercules_reserva",
    });
    expect(estado.entradas.map((e) => e.entityId)).toEqual([AUTONOMO, AUTONOMO]);
    expect(estado.entradas.some((e) => !e.entityId)).toBe(false);
  });

  it("⚠️ a frase da tela não inventa imobiliária sem telefone", async () => {
    const resultados = await avisarSobreAVenda(clienteFalso(), {
      corretorId: AUTONOMO,
      destinatarios: SEM_IMOBILIARIA,
      imobiliariaId: null,
      origem: "reserva:whatsapp",
      textos: [
        { papel: "corretor", texto: "a" },
        { papel: "coordenador", texto: "c" },
      ],
      tipo: "hercules_reserva",
    });
    const frase = comoFoiOAviso(resultados);
    expect(frase).not.toMatch(/imobiliária/);
    expect(frase).toBe("Aviso enviado para corretor e coordenador.");
  });

  it("com imobiliária, os três destinos continuam existindo, com o entityId dela no coordenador", async () => {
    await avisarSobreAVenda(clienteFalso(), {
      corretorId: "cor-1",
      destinatarios: {
        coordenadores: [{ nome: "Nivea", telefone: "62999990000" }],
        corretor: { nome: "João", telefone: "62988887777" },
        imobiliaria: { nome: "GURGEL", telefone: "6232220000" },
      },
      imobiliariaId: "imo-1",
      origem: "reserva:whatsapp",
      textos: [
        { papel: "corretor", texto: "a" },
        { papel: "imobiliaria", texto: "b" },
        { papel: "coordenador", texto: "c" },
      ],
      tipo: "hercules_reserva",
    });
    expect(estado.entradas.map((e) => `${e.destinatario}:${e.entityId}`)).toEqual([
      "corretor:cor-1",
      "imobiliaria:imo-1",
      "coordenador:imo-1",
    ]);
  });
});

describe("registrarAvisoNaoEnviado na venda do autônomo (o portal do Cecílio)", () => {
  it("⚠️ grava uma linha por destino, todas na ficha do autônomo, e nenhuma com entity_id vazio", async () => {
    // Um único `entity_id` inválido derrubaria o LOTE INTEIRO do insert, e nem o registro do
    // corretor sobreviveria: a reserva ficaria sem NENHUMA linha de disparo.
    const resultados = await registrarAvisoNaoEnviado(clienteFalso(), {
      corretorId: AUTONOMO,
      destinatarios: SEM_IMOBILIARIA,
      imobiliariaId: null,
      origem: "reserva:whatsapp",
      tipo: "hercules_reserva",
    });
    expect(resultados.map((r) => r.para).sort()).toEqual(["coordenador", "corretor"]);

    const linhas = estado.inserido[0]?.linhas as Array<Record<string, unknown>>;
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.entity_id)).toEqual([AUTONOMO, AUTONOMO]);
    expect(linhas.map((l) => l.destinatario).sort()).toEqual(["coordenador", "corretor"]);
  });
});
