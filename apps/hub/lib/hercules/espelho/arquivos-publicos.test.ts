import { describe, expect, it, vi } from "vitest";

import {
  acharArquivoDoEspelho,
  arquivosPublicosDoEspelho,
  type ArquivoPublicoDoEspelho,
} from "./arquivos-publicos";

// O QUE ESTE TESTE PROTEGE: a lista de arquivos que o ESPELHO PÚBLICO entrega a quem abre o link
// do corretor (`c2x.app.br/e/garden-ksewinpw`). Não há login do outro lado.
//
// Três coisas precisam ser verdade, e as três já custaram defeito nesta casa:
//
//   1. o corpo inteiro só tem id, nome, ordem e tipo — nada de caminho no bucket, tamanho, mime,
//      quem enviou ou quando ([[feedback_corretor_nao_ve_divisao_interna]] é a mesma disciplina);
//   2. um id de OUTRO empreendimento não resolve caminho nenhum, senão a porta pública vira uma
//      porta para ler qualquer objeto do bucket `produto-arquivos`;
//   3. falha de leitura NÃO derruba o espelho: a galeria é um extra, o mapa é o produto.
//
// Os dados são os do Garden MEDIDOS em 22/09/2026 no banco: 47 linhas vivas no `enterprise_id`
// "39", ordem 1 a 47 — `Video 1.mp4`, `Book Garden.pdf` e `Cena 1` a `Cena 45`.

type Linha = {
  criado_em: string;
  enterprise_id: string;
  id: string;
  mime: string;
  miniatura_path: null | string;
  nome: string;
  ordem: null | number;
  removido_em: null | string;
  storage_path: string;
  tamanho_bytes: number;
  tipo: string;
  workspace_id: string;
};

const ID_DO_VIDEO = "e1b1ed1d-7db7-42cc-b937-b8eec954bf1e";
const ID_DO_BOOK = "84fc9e7e-bd30-4795-936e-21a39c2c2901";

function linha(parcial: Partial<Linha>): Linha {
  const id = parcial.id ?? "00000000-0000-4000-8000-000000000000";
  return {
    criado_em: "2026-09-22T12:00:00.000Z",
    enterprise_id: "39",
    id,
    mime: "image/jpeg",
    miniatura_path: `39/${id}.thumb.jpg`,
    nome: "Cena.jpg",
    ordem: null,
    removido_em: null,
    storage_path: `39/${id}.jpg`,
    tamanho_bytes: 5_377_433,
    tipo: "imagem",
    workspace_id: "careli",
    ...parcial,
  };
}

/** O Garden como está no banco: vídeo, book e 45 cenas, na ordem 1..47. */
const GARDEN: Linha[] = [
  linha({
    id: ID_DO_VIDEO,
    mime: "video/mp4",
    nome: "Video 1.mp4",
    ordem: 1,
    storage_path: `39/${ID_DO_VIDEO}.mp4`,
    tamanho_bytes: 14_968_564,
    tipo: "video",
  }),
  linha({
    id: ID_DO_BOOK,
    mime: "application/pdf",
    // ⚠️ MEDIDO: o Book é o ÚNICO documento e é o único sem miniatura no banco.
    miniatura_path: null,
    nome: "Book Garden.pdf",
    ordem: 2,
    storage_path: `39/${ID_DO_BOOK}.pdf`,
    tamanho_bytes: 212_799_580,
    tipo: "documento",
  }),
  ...Array.from({ length: 45 }, (_, i) =>
    linha({
      id: `0000${String(i + 1).padStart(4, "0")}-0000-4000-8000-000000000000`,
      nome: `Cena ${i + 1}.jpg`,
      ordem: i + 3,
    }),
  ),
];

/** Um arquivo de OUTRO empreendimento, no mesmo bucket. */
const DO_VILLA_PARIS = linha({
  enterprise_id: "12",
  id: "11111111-2222-4333-8444-555555555555",
  nome: "Planta Villa Paris.jpg",
  ordem: 1,
  storage_path: "12/11111111-2222-4333-8444-555555555555.jpg",
});

type Consulta = { colunas: string; filtros: Record<string, unknown>; tabela: string };

/**
 * Um Supabase de mentira que RESPEITA os filtros — é isso que faz o teste do id de outro
 * empreendimento valer alguma coisa.
 */
function clienteFalso(banco: Linha[], consultas: Consulta[] = [], quebrar = false) {
  return {
    from(tabela: string) {
      const consulta: Consulta = { colunas: "", filtros: {}, tabela };
      consultas.push(consulta);
      const construtor = {
        eq(coluna: string, valor: unknown) {
          consulta.filtros[coluna] = valor;
          return construtor;
        },
        in(coluna: string, valores: unknown[]) {
          consulta.filtros[`${coluna}:in`] = valores;
          return construtor;
        },
        is(coluna: string, valor: unknown) {
          consulta.filtros[`${coluna}:is`] = valor;
          return construtor;
        },
        async maybeSingle() {
          const achadas = filtrar();
          return { data: achadas[0] ?? null, error: null };
        },
        order() {
          return construtor;
        },
        async range(de: number, ate: number) {
          if (quebrar) return { data: null, error: { message: "sem rede" } };
          return { data: filtrar().slice(de, ate + 1), error: null };
        },
        select(colunas: string) {
          consulta.colunas = colunas;
          return construtor;
        },
      };

      function filtrar(): Linha[] {
        if (quebrar) throw new Error("sem rede");
        return banco.filter((l) => {
          for (const [chave, valor] of Object.entries(consulta.filtros)) {
            if (chave.endsWith(":in")) {
              const coluna = chave.slice(0, -3) as keyof Linha;
              if (!(valor as unknown[]).includes(l[coluna])) return false;
            } else if (chave.endsWith(":is")) {
              const coluna = chave.slice(0, -3) as keyof Linha;
              if (l[coluna] !== valor) return false;
            } else if (l[chave as keyof Linha] !== valor) {
              return false;
            }
          }
          return true;
        });
      }

      return construtor;
    },
  } as never;
}

describe("arquivosPublicosDoEspelho", () => {
  it("os 47 do Garden chegam na ordem do cadastro: o vídeo, o book e as 45 cenas", async () => {
    const lista = await arquivosPublicosDoEspelho(clienteFalso(GARDEN), ["39"]);

    expect(lista).toHaveLength(47);
    expect(lista.map((a) => a.nome).slice(0, 4)).toEqual([
      "Video 1.mp4",
      "Book Garden.pdf",
      "Cena 1.jpg",
      "Cena 2.jpg",
    ]);
    expect(lista[46]?.nome).toBe("Cena 45.jpg");
    expect(lista.map((a) => a.ordem)).toEqual(Array.from({ length: 47 }, (_, i) => i + 1));
  });

  it("⚠️ O CORPO INTEIRO É id, nome, ordem e tipo — e nada mais sai para a rua", async () => {
    const lista = await arquivosPublicosDoEspelho(clienteFalso(GARDEN), ["39"]);

    for (const item of lista) {
      expect(Object.keys(item).sort()).toEqual(["id", "nome", "ordem", "tipo"]);
    }

    // O corpo INTEIRO, como ele viaja: serializado. Se um dia alguém espalhar a linha do banco
    // com `...linha`, é aqui que quebra.
    const corpo = JSON.stringify(lista);
    for (const proibido of [
      "storage",
      "39/",
      "thumb",
      "miniatura",
      "tamanho",
      "bytes",
      "mime",
      "enviado",
      "criado",
      "workspace",
      "enterprise",
      "removido",
    ]) {
      expect(corpo).not.toContain(proibido);
    }
  });

  it("⚠️ A LISTA NEM SELECIONA O CAMINHO: o que não é lido não vaza", async () => {
    const consultas: Consulta[] = [];
    await arquivosPublicosDoEspelho(clienteFalso(GARDEN, consultas), ["39"]);

    const [consulta] = consultas;
    expect(consulta?.tabela).toBe("apolo_empreendimento_arquivos");
    expect(consulta?.colunas).not.toContain("storage_path");
    expect(consulta?.colunas).not.toContain("miniatura_path");
    expect(consulta?.colunas).not.toContain("enviado");
    // E lê só o que é deste espelho, deste workspace, e o que não foi removido.
    expect(consulta?.filtros).toMatchObject({
      "enterprise_id:in": ["39"],
      "removido_em:is": null,
      workspace_id: "careli",
    });
  });

  it("o arquivo de outro empreendimento não entra na lista deste link", async () => {
    const lista = await arquivosPublicosDoEspelho(
      clienteFalso([...GARDEN, DO_VILLA_PARIS]),
      ["39"],
    );

    expect(lista).toHaveLength(47);
    expect(lista.some((a) => a.nome.includes("Villa Paris"))).toBe(false);
  });

  it("o removido não aparece", async () => {
    const removido = linha({
      id: "99999999-9999-4999-8999-999999999999",
      nome: "Cena velha.jpg",
      ordem: 99,
      removido_em: "2026-09-21T10:00:00.000Z",
    });

    const lista = await arquivosPublicosDoEspelho(clienteFalso([...GARDEN, removido]), ["39"]);

    expect(lista).toHaveLength(47);
  });

  it("empreendimento sem arquivo nenhum: lista vazia, e sem ida ao banco quando não há id", async () => {
    const consultas: Consulta[] = [];

    expect(await arquivosPublicosDoEspelho(clienteFalso([], consultas), ["41"])).toEqual([]);
    expect(await arquivosPublicosDoEspelho(clienteFalso([], consultas), [])).toEqual([]);
    // O segundo nem consultou: sem id não há o que perguntar.
    expect(consultas).toHaveLength(1);
  });

  it("⚠️ FALHA DE LEITURA NÃO DERRUBA O ESPELHO: devolve vazio, e o mapa continua", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(arquivosPublicosDoEspelho(clienteFalso(GARDEN, [], true), ["39"])).resolves.toEqual(
      [],
    );

    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe("acharArquivoDoEspelho", () => {
  it("o id do próprio espelho resolve o caminho no bucket, que o cliente nunca viu", async () => {
    const achado = await acharArquivoDoEspelho(clienteFalso(GARDEN), ["39"], ID_DO_VIDEO);

    expect(achado).toEqual({
      id: ID_DO_VIDEO,
      mime: "video/mp4",
      miniaturaPath: `39/${ID_DO_VIDEO}.thumb.jpg`,
      nome: "Video 1.mp4",
      storagePath: `39/${ID_DO_VIDEO}.mp4`,
      tipo: "video",
    });
  });

  it("⚠️ O ID DE OUTRO EMPREENDIMENTO NÃO RESOLVE NADA", async () => {
    const achado = await acharArquivoDoEspelho(
      clienteFalso([...GARDEN, DO_VILLA_PARIS]),
      ["39"],
      DO_VILLA_PARIS.id,
    );

    expect(achado).toBeNull();
  });

  it("⚠️ CAMINHO DE STORAGE NO LUGAR DO ID NÃO CHEGA AO BANCO", async () => {
    const consultas: Consulta[] = [];
    const cliente = clienteFalso(GARDEN, consultas);

    expect(await acharArquivoDoEspelho(cliente, ["39"], `39/${ID_DO_BOOK}.pdf`)).toBeNull();
    expect(await acharArquivoDoEspelho(cliente, ["39"], "../outro-bucket/segredo.pdf")).toBeNull();
    expect(await acharArquivoDoEspelho(cliente, ["39"], "")).toBeNull();
    expect(consultas).toHaveLength(0);
  });

  it("o book resolve sem miniatura: é o que a tela usa para mostrar o ícone", async () => {
    const achado = await acharArquivoDoEspelho(clienteFalso(GARDEN), ["39"], ID_DO_BOOK);

    expect(achado?.miniaturaPath).toBeNull();
    expect(achado?.tipo).toBe("documento");
  });

  it("falha de leitura devolve null, nunca um caminho adivinhado", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      acharArquivoDoEspelho(clienteFalso(GARDEN, [], true), ["39"], ID_DO_VIDEO),
    ).resolves.toBeNull();

    erro.mockRestore();
  });
});

describe("o tipo que a tela recebe", () => {
  it("é o mesmo do portal: documento, imagem ou vídeo", async () => {
    const lista: ArquivoPublicoDoEspelho[] = await arquivosPublicosDoEspelho(
      clienteFalso(GARDEN),
      ["39"],
    );

    expect([...new Set(lista.map((a) => a.tipo))].sort()).toEqual([
      "documento",
      "imagem",
      "video",
    ]);
  });
});
