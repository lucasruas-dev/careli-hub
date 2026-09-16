// QUAIS CADs AUTOMÁTICAS ANTERIORES A REGENERAÇÃO PODE APAGAR.
//
// Por que existe (revisão da onda do Cecílio, 16/09/2026): `gerarESalvarCad` (lib/apolo/salvar-cad.ts)
// roda a cada mudança de etapa e, depois de subir o PDF novo, apagava do bucket e da tabela TODA CAD
// automática anterior da pessoa, sem olhar empreendimento. Desde a 0080 a mesma pessoa tem uma CAD
// por empreendimento: mover a CAD do Garden apagava o PDF da CAD do Lagoa Bonita. Com o Cecílio
// podendo mover etapa pelo portal, uma ação dele destruía documento de outro cliente. E a CAD nova
// subia sem `metadata.enterpriseId`, então para quem tem dois produtos ela sumia dos dois portais
// (documentos-do-portal.ts não consegue provar de onde ela é).
//
// A régua, que só fecha:
//   • CAD anterior MARCADA: apaga só a do mesmo empreendimento da regenerada;
//   • CAD anterior SEM marca (todas as de antes desta data): apaga só quando a pessoa tem, no
//     máximo, UM empreendimento na esteira, e ele é o da regenerada. Com dois ou mais, não dá para
//     saber de qual produto ela é, e ela fica (sobra um PDF antigo; nunca some o do vizinho).
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";

export type CadAutomaticaAnterior = {
  /** `metadata.enterpriseId` da CAD anterior; nulo nas gravadas antes de 16/09/2026. */
  enterpriseId: null | string;
  id: string;
  storage_bucket: null | string;
  storage_path: null | string;
};

export function cadsAutomaticasParaApagar<T extends CadAutomaticaAnterior>(
  anteriores: readonly T[],
  contexto: {
    /** O empreendimento da CAD que acabou de ser gerada; nulo quando não deu para saber. */
    alvo: null | string;
    /** Os `enterprise_id` de todas as CADs da pessoa em `apolo_esteira`. */
    esteiraDaPessoa: readonly string[];
  },
): T[] {
  const alvo = normalizarEnterpriseId(contexto.alvo);
  const daPessoa = new Set(
    contexto.esteiraDaPessoa
      .map((id) => normalizarEnterpriseId(id))
      .filter((id): id is string => id !== null),
  );
  const soUmProduto = daPessoa.size === 0 || (daPessoa.size === 1 && (alvo === null || daPessoa.has(alvo)));

  return anteriores.filter((cad) => {
    const marcada = normalizarEnterpriseId(cad.enterpriseId);
    if (marcada !== null) return alvo !== null && marcada === alvo;
    return soUmProduto;
  });
}
