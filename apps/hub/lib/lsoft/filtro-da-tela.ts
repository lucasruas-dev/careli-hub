// O QUE A TELA "LSoft Integração" MOSTRA, dado o que veio do servidor e os dois checkboxes.
//
// Pedido do Lucas (29/09/2026): *"coloca exportação para xlsx por favor nessa tela"*.
//
// ⚠️ EXISTE PARA A TELA E O ARQUIVO NÃO SE DESCOLAREM. A busca e o empreendimento filtram NO
// SERVIDOR (`lerCarteiraDoLsoft`), mas "Só o que falta validar" e "Só patrimônio" filtravam NO
// NAVEGADOR, num `.filter` escrito dentro de CarteiraLsoft.tsx. A planilha é montada no servidor
// (as parcelas não vêm na lista, só na ficha), então precisaria de uma SEGUNDA cópia dessa regra.
// Duas cópias garantem que um dia uma muda e a outra não, e o arquivo passa a trazer cliente que a
// tela não mostra. Por isso a regra mora aqui, e as duas pontas chamam a mesma função.
//
// ⚠️ SEM IMPORTAR NADA DE SERVIDOR NEM O EXCELJS: a tela do navegador importa este arquivo. O
// `import type` some na compilação e não arrasta `carteira.ts` (que fala com o Supabase) para o
// bundle.
import type { ClienteDaCarteira } from "@/lib/lsoft/carteira";

/** Os dois checkboxes da tela. */
export type FiltroDaTela = {
  /** "Só o que falta validar": tudo que ainda não está `validado` (dispensado fica). */
  somentePendentes: boolean;
  /** "Só patrimônio": quem tem parcela da categoria 17 em aberto. */
  somentePatrimonio: boolean;
};

/** Tudo o que define o recorte da tela: o que filtra no servidor e o que filtra no navegador. */
export type FiltroDaExportacao = FiltroDaTela & {
  /** A busca APLICADA (a do botão Buscar), não a que está digitada na caixa. */
  busca: string;
  /** Vazio = todos os empreendimentos. */
  empreendimento: string;
};

type ClienteFiltravel = Pick<ClienteDaCarteira, "patrimonioParcelasAbertas" | "statusValidacao">;

/**
 * Os clientes que a tela mostra, na MESMA ordem em que vieram do servidor.
 *
 * ⚠️ "FALTA VALIDAR" É TUDO QUE NÃO É `validado`, inclusive `dispensado`. É a regra que a tela
 * sempre teve; mudar aqui muda a tela junto, e é justamente essa a intenção.
 */
export function clientesDaTela<T extends ClienteFiltravel>(
  clientes: readonly T[],
  filtro: FiltroDaTela,
): T[] {
  return clientes.filter(
    (cliente) =>
      (!filtro.somentePendentes || cliente.statusValidacao !== "validado") &&
      (!filtro.somentePatrimonio || cliente.patrimonioParcelasAbertas > 0),
  );
}

/**
 * Os parâmetros da URL da exportação. Os nomes `q` e `emp` são os mesmos que a leitura da lista
 * já usa nas duas rotas; os checkboxes entram como `pendentes=1` e `patrimonio=1`.
 */
export function parametrosDaExportacao(filtro: FiltroDaExportacao): URLSearchParams {
  const parametros = new URLSearchParams();
  const busca = filtro.busca.trim();
  if (busca) parametros.set("q", busca);
  if (filtro.empreendimento) parametros.set("emp", filtro.empreendimento);
  if (filtro.somentePendentes) parametros.set("pendentes", "1");
  if (filtro.somentePatrimonio) parametros.set("patrimonio", "1");
  parametros.set("formato", "xlsx");
  return parametros;
}

/** O caminho de volta, na rota: o que a tela mandou em `parametrosDaExportacao`. */
export function filtroDaExportacao(parametros: URLSearchParams): FiltroDaExportacao {
  return {
    busca: (parametros.get("q") ?? "").trim(),
    empreendimento: (parametros.get("emp") ?? "").trim(),
    somentePatrimonio: parametros.get("patrimonio") === "1",
    somentePendentes: parametros.get("pendentes") === "1",
  };
}
