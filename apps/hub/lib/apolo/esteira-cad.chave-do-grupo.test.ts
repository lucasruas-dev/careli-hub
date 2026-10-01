import { beforeEach, describe, expect, it } from "vitest";

import { expandirPeloCadastro } from "@/lib/apolo/habilitacao-pelo-cadastro";
import { limparMemoriaDaMigration0203 } from "@/lib/hercules/chave-do-grupo";

import { lerEmpreendimentosDoCadastro } from "./esteira-cad";

// A LEITURA DO CADASTRO QUE O MOVER CAD E O BOARD USAM, COM A CHAVE DO GRUPO (PAN-124, pendência da F4).
//
// A F4 (1.403.0) trocou o casamento de `group:<x>` para a chave congelada (0203), mas esta leitura
// continuava sem a coluna: no Mover CAD, a habilitação do autônomo num grupo era expandida pelo NOME
// do pai, e um pai renomeado no Panteon deixava o grupo sem divisões. O que estes testes cobram:
//   1. a leitura traz a chave; sem a 0203, repete sem a coluna e não derruba o Mover;
//   2. a expansão que o Mover faz (o mesmo mapeamento de lib/apolo/mover-cad.ts) acha o grupo pela
//      chave com o pai renomeado.

type Linha = Record<string, unknown>;

function clienteFalso(linhas: Linha[], semColuna = false) {
  const selects: string[] = [];
  const client = {
    from() {
      let colunas = "";
      const consulta = {
        eq: () => consulta,
        order: () => consulta,
        range: () => consulta,
        select(cols: string) {
          colunas = cols;
          selects.push(cols);
          return consulta;
        },
        then(ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) {
          const resposta =
            semColuna && colunas.includes("chave_do_grupo")
              ? { data: null, error: { code: "42703", message: "column chave_do_grupo does not exist" } }
              : {
                  data: linhas.map((l) =>
                    Object.fromEntries(Object.entries(l).filter(([k]) => colunas.includes(k))),
                  ),
                  error: null,
                };
          return Promise.resolve(resposta).then(ok, falha);
        },
      };
      return consulta;
    },
  };
  return { client: client as never, selects };
}

// A decisão 2 do Lucas (26/09/2026): o ACT (30) filho da ACP (42). Grupo fora de ENTERPRISE_GROUPS,
// então só a chave o acha depois de um renome do pai.
const ALDEIA_RENOMEADA: Linha[] = [
  { c2x_enterprise_id: "42", chave_do_grupo: "Aldeia das Cachoeiras das Pedras", codigo: "ACP", id: "u-acp", nome: "Aldeia Brumadinho", pai_id: null },
  { c2x_enterprise_id: "30", chave_do_grupo: null, codigo: "ACT", id: "u-act", nome: "Aldeia · ACT", pai_id: "u-acp" },
];

/** O mesmo mapeamento que o Mover CAD faz antes de expandir (lib/apolo/mover-cad.ts). */
function comoOMoverExpande(id: string, cadastro: Awaited<ReturnType<typeof lerEmpreendimentosDoCadastro>>) {
  return expandirPeloCadastro(
    id,
    cadastro.map((linha) => ({ ...linha, codigo: linha.codigo ?? "", nome: linha.nome ?? "" })),
  );
}

describe("lerEmpreendimentosDoCadastro com a chave do grupo", () => {
  beforeEach(() => limparMemoriaDaMigration0203());

  it("traz a chave numa leitura só", async () => {
    const { client, selects } = clienteFalso(ALDEIA_RENOMEADA);
    const cadastro = await lerEmpreendimentosDoCadastro(client);

    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain("chave_do_grupo");
    expect(cadastro.find((l) => l.codigo === "ACP")?.chaveDoGrupo).toBe("Aldeia das Cachoeiras das Pedras");
    expect(cadastro.find((l) => l.codigo === "ACT")?.chaveDoGrupo).toBeNull();
  });

  it("🔴 o Mover expande o grupo pela CHAVE com o pai renomeado no Panteon", async () => {
    const { client } = clienteFalso(ALDEIA_RENOMEADA);
    const cadastro = await lerEmpreendimentosDoCadastro(client);

    expect(comoOMoverExpande("group:Aldeia das Cachoeiras das Pedras", cadastro)).toEqual(["30"]);
    expect(comoOMoverExpande("group:Aldeia Brumadinho", cadastro)).toEqual([]);
  });

  it("sem a 0203, repete sem a coluna e não derruba o Mover (e sem a chave o renome desfaz o grupo)", async () => {
    const { client, selects } = clienteFalso(ALDEIA_RENOMEADA, true);
    const cadastro = await lerEmpreendimentosDoCadastro(client);

    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain("chave_do_grupo");
    expect(cadastro).toHaveLength(2);
    expect(comoOMoverExpande("group:Aldeia das Cachoeiras das Pedras", cadastro)).toEqual([]);
  });
});
