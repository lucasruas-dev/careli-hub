import { imobiliariaEntityIdDoCliente } from "@/lib/apolo/imobiliaria-do-cliente";
import { normalizarNome } from "@/lib/apolo/imobiliaria-match";
import type { createApoloAdminClient } from "@/lib/apolo/server";

import { nomeCanonico } from "./data";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// QUEM O TÓTEM MOSTRA TEM QUE SER QUEM A ETIQUETA DIZ.
//
// `listCredenciados` (data.ts) já resolve nome e imobiliária pela ENTIDADE do Apolo — é o que a
// fila, a etiqueta e o telão exibem. A rota do bip da posição de reserva, por atender UM
// credenciado, lia as colunas cruas de `prometeu_credenciados` e discordava das outras telas:
//
//   - imobiliária por VÍNCULO e coluna de texto vazia → a etiqueta mostrava a imobiliária e o
//     tótem não mostrava linha nenhuma (o pedido do Lucas de 28/08 falhava calado justo para
//     quem veio pelo vínculo);
//   - grafia livre → etiqueta "RR Soluções" e tótem "RR Soluções Imobiliárias LTDA", lado a
//     lado no mesmo evento;
//   - `prometeu_credenciados.nome` é o retrato do dia em que a pessoa entrou na fila e nunca
//     recebe UPDATE: nome corrigido na identidade só aparecia na fila, e o tótem — onde o nome
//     agora é o herói visual, em corpo grande na frente do cliente — insistia no errado.
//
// Esta é a MESMA cadeia da leitura em lote, resolvida um a um: vínculo do Apolo → de-para de
// texto (apolo_imobiliaria_match) → coluna crua como último recurso.
//
// ⚠️ Custo: no máximo dois round-trips (vínculo + de-para em paralelo, depois os nomes das
// entidades num único `.in`). Roda no caminho crítico do bip, então qualquer falha de consulta
// cai de volta nas colunas cruas — o salão não pode parar porque o Apolo demorou.

export type CredenciadoCru = {
  corretor: null | string;
  entity_id: null | string;
  imobiliaria: null | string;
  nome: string;
};

export type IdentidadeDoCredenciado = {
  corretor: null | string;
  imobiliaria: null | string;
  nome: string;
};

function primeiroNaoVazio(...valores: Array<null | string | undefined>): null | string {
  for (const valor of valores) {
    const texto = String(valor ?? "").trim();
    if (texto) return texto;
  }
  return null;
}

export async function identidadeCanonicaDoCredenciado(
  client: AdminClient,
  credenciado: CredenciadoCru,
): Promise<IdentidadeDoCredenciado> {
  const bruta: IdentidadeDoCredenciado = {
    corretor: credenciado.corretor,
    imobiliaria: credenciado.imobiliaria,
    nome: credenciado.nome,
  };

  try {
    const textoDaImobiliaria = String(credenciado.imobiliaria ?? "").trim();

    // ⚠️ Cada consulta dentro da SUA função async: montar as promises soltas no array fazia a
    // primeira ficar órfã quando a segunda explodia na construção, e a rejeição sem dono virava
    // unhandled rejection no servidor mesmo com o `catch` externo pegando o erro.
    const buscarVinculo = async (): Promise<null | string> => {
      if (!credenciado.entity_id) return null;
      const { imobEntityId } = await imobiliariaEntityIdDoCliente(client, credenciado.entity_id);
      return imobEntityId;
    };
    const buscarDePara = async (): Promise<null | string> => {
      if (!textoDaImobiliaria) return null;
      const { data } = await client
        .from("apolo_imobiliaria_match")
        .select("entity_id")
        .eq("nome_normalizado", normalizarNome(textoDaImobiliaria))
        .not("entity_id", "is", null)
        .maybeSingle<{ entity_id: null | string }>();
      return data?.entity_id ?? null;
    };

    const [porVinculo, porTexto] = await Promise.all([buscarVinculo(), buscarDePara()]);
    const imobEntityId = porVinculo ?? porTexto;

    const ids = [credenciado.entity_id, imobEntityId].filter((id): id is string => Boolean(id));
    if (ids.length === 0) return bruta;

    const { data } = await client
      .from("apolo_entities")
      .select("id, display_name, trade_name, legal_name")
      .in("id", ids);

    const porId = new Map<
      string,
      { display_name: null | string; legal_name: null | string; trade_name: null | string }
    >();
    for (const e of (data ?? []) as Array<{
      display_name: null | string;
      id: string;
      legal_name: null | string;
      trade_name: null | string;
    }>) {
      porId.set(e.id, { display_name: e.display_name, legal_name: e.legal_name, trade_name: e.trade_name });
    }

    // Nome da PESSOA: mesma composição da fila e da etiqueta (`legal_name` na frente,
    // MAIÚSCULAS), com a coluna crua de fallback — tótem sem nome é pior que nome velho.
    const pessoa = credenciado.entity_id ? porId.get(credenciado.entity_id) : undefined;
    const nome = pessoa
      ? nomeCanonico(pessoa.legal_name, pessoa.display_name, credenciado.nome)
      : credenciado.nome;

    // Nome da IMOBILIÁRIA: a entidade manda; sem entidade resolvida, fica a grafia da coluna.
    const empresa = imobEntityId ? porId.get(imobEntityId) : undefined;
    const imobiliaria = empresa
      ? primeiroNaoVazio(
          empresa.display_name,
          empresa.trade_name,
          empresa.legal_name,
          credenciado.imobiliaria,
        )
      : (primeiroNaoVazio(credenciado.imobiliaria) ?? null);

    return { corretor: credenciado.corretor, imobiliaria, nome };
  } catch {
    return bruta;
  }
}
