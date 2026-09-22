// O PRODUTO QUE SÓ EXISTE NO PANTEON, NA LISTA DE APOLO > EMPREENDIMENTOS.
//
// Por que existe (onda 2 do portal da Cecílio, achado 27, 16/09/2026): a lista do hub lia SÓ o C2X
// (`loadApoloEnterprises`). Desde a decisão do Lucas de cadastrar produto novo no Panteon (id a
// partir de 100000, sequence da 0170; o C2X legado é somente leitura), o prédio criado pelo hub ou
// pelo portal não aparecia em lugar nenhum do Apolo: sem linha, não havia como abrir a ficha, ver as
// unidades nem ligar CAD, credenciamento e pré-venda no Setup dele. Parecia que o cadastro não tinha
// gravado.
//
// ⚠️ SÓ ENTRA O QUE O C2X NÃO TEM. A regra é `ehIdDoPanteon` (id >= 100000): o legado continua sendo a
// fonte das linhas dele (números, grupos, espelho), e o ZZ TESTE 9001 e as divisões do Vale do Ouro,
// que também estão no cadastro, não viram linha repetida. Mesmo um id do Panteon que um dia apareça no
// C2X (não deveria) sai daqui, para a tela nunca ter duas linhas com a mesma chave.
//
// ⚠️ O CENÁRIO SAI ZERADO, E É DE PROPÓSITO. Os números da lista são as agregações do C2X, e o produto
// do Panteon não tem unidade lá. Somar `hercules_unidades` aqui seria uma segunda régua de balde, com
// outra leitura a cada abertura da tela; a aba Unidades da ficha já lê as unidades reais do Panteon.
// Zerado também não mexe no total geral, que continua sendo o do C2X.
//
// Pura (sem banco e sem rede) para o teste e para a rota usarem a mesma.
import type { ApoloEnterpriseRow, ApoloEnterpriseScenario } from "@/lib/apolo/empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { ehIdDoPanteon } from "@/lib/hercules/produto-novo";

function cenarioZerado(): ApoloEnterpriseScenario {
  const zero = () => ({ units: 0, value: 0 });
  return {
    bloqueado: zero(),
    disponivel: zero(),
    em_cancelamento: zero(),
    negociacao: zero(),
    reservado: zero(),
    total: zero(),
    vendido: zero(),
  };
}

function texto(valor: null | string | undefined): null | string {
  const limpo = String(valor ?? "").trim();
  return limpo ? limpo : null;
}

/** Todo id que o C2X já desenha na lista, inclusive as etapas de um grupo consolidado. */
function idsDasLinhas(linhas: readonly ApoloEnterpriseRow[], saida = new Set<string>()): Set<string> {
  for (const linha of linhas) {
    saida.add(String(linha.id).trim());
    idsDasLinhas(linha.stages ?? [], saida);
  }
  return saida;
}

/**
 * As linhas do Apolo para os produtos nascidos no Panteon.
 *
 * @param cadastro    O cadastro inteiro (`hercules_empreendimentos`), na ordem dele.
 * @param linhasDoC2x As linhas que o C2X já devolveu (para não repetir id).
 * @returns Uma linha simples por produto do Panteon: id, código, nome, cidade e UF do cadastro,
 *          sem etapas, sem espelho e com o cenário zerado.
 */
export function linhasDoPanteonParaApolo(
  cadastro: readonly LinhaDoCadastro[],
  linhasDoC2x: readonly ApoloEnterpriseRow[],
): ApoloEnterpriseRow[] {
  const vistos = idsDasLinhas(linhasDoC2x);
  const saida: ApoloEnterpriseRow[] = [];

  for (const linha of cadastro) {
    const id = String(linha.c2xEnterpriseId ?? "").trim();
    if (!ehIdDoPanteon(id) || vistos.has(id)) continue;
    vistos.add(id);

    // Mesmo desenho de `mapEnterpriseRow`: sem código, a chave vira o id (a tela precisa de algo
    // para buscar as unidades e para mostrar na coluna).
    const code = texto(linha.codigo)?.toUpperCase() ?? id;

    saida.push({
      city: texto(linha.cidade),
      code,
      codes: [code],
      id,
      // O incorporador da lista é o do C2X. Quem opera o produto do Panteon mora em `operado_por`,
      // e a tela do Setup já mostra o nome do portal.
      incorporador: null,
      mirror: false,
      mirrorLabel: null,
      mirrorNote: null,
      name: texto(linha.nome) ?? code,
      scenario: cenarioZerado(),
      state: texto(linha.uf)?.toUpperCase() ?? null,
      stages: [],
    });
  }

  return saida;
}
