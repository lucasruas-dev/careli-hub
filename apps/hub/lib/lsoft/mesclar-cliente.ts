// O CADASTRO QUE A CARGA GRAVA: o do LSoft, sem apagar o que o banco já sabe.
//
// ⚠️ O QUE JÁ SE PERDEU, medido em 24/09/2026 pela revisão adversarial: o MOST rodou em 19/08 e
// gravou nome da mãe e data de nascimento (R$ 2,23 por CPF). As cargas de 08/09 e 16/09 fizeram
// upsert por código mandando `mae: texto(c.MAE)` e `nascimento: data(c.NASCIMENTO)`, e o LSoft tem
// esses campos EM BRANCO. O upsert trocou o que existia por nulo: hoje 200 clientes têm a mãe no
// JSON do enriquecimento e a coluna vazia, e 218 o mesmo com o nascimento. Na tela, cerca de 200
// fichas perderam 2 dos 9 pontos da régua "campos para o C2X".
//
// A regra, que é a da casa para qualquer sync (ver a memória "sync apaga metadata": mesclar, nunca
// substituir):
//   1. LSoft em branco NUNCA apaga valor do banco.
//   2. Campo que o time corrigiu na tela VENCE o LSoft, mesmo quando o LSoft traz valor.
//   3. A lista de empreendimentos do cliente SOMA: uma carga só do Giant Towers não pode tirar o
//      Garden de quem compra nos dois (antes, tirava).
//   4. Cliente novo entra como o LSoft manda.
//
// ⚠️ ISTO NÃO DEVOLVE O QUE JÁ SE PERDEU. As 200 mães e os 218 nascimentos só voltam copiando do
// JSON `enriquecimento`, e isso é escrita no banco, com OK do Lucas. Esta regra impede que se perca
// de novo.

export type ClienteDaCarga = Record<string, unknown> & { codigo: null | string; empreendimentos?: string[] };

/** O que vale como "vazio" do lado do LSoft. `(sem nome)` é o marcador que o importador põe no NOT NULL. */
function vazio(campo: string, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  if (campo === "nome" && v === "(sem nome)") return true;
  return false;
}

/** Campos que a carga nunca mescla: a chave e o que é do LSoft por natureza. */
const DO_LSOFT_SEMPRE = new Set(["codigo", "bloqueado"]);

export function mesclarCliente(
  doLsoft: ClienteDaCarga,
  doBanco: null | Record<string, unknown> | undefined,
  /** Campos deste cliente que alguém corrigiu na tela (trilha sem o prefixo "parcela."). */
  editadosNaTela: ReadonlySet<string> = new Set(),
): ClienteDaCarga {
  if (!doBanco) return doLsoft;

  const saida: ClienteDaCarga = { ...doLsoft };
  for (const campo of Object.keys(doLsoft)) {
    if (DO_LSOFT_SEMPRE.has(campo)) continue;

    if (campo === "empreendimentos") {
      const doB = Array.isArray(doBanco.empreendimentos) ? (doBanco.empreendimentos as string[]) : [];
      const doL = Array.isArray(doLsoft.empreendimentos) ? doLsoft.empreendimentos : [];
      saida.empreendimentos = [...new Set([...doB, ...doL])].sort();
      continue;
    }

    const valorDoBanco = doBanco[campo];
    if (editadosNaTela.has(campo) && !vazio(campo, valorDoBanco)) {
      saida[campo] = valorDoBanco;
      continue;
    }
    if (vazio(campo, doLsoft[campo]) && !vazio(campo, valorDoBanco)) {
      saida[campo] = valorDoBanco;
    }
  }
  return saida;
}
