import type { LinhaAssinatura } from "./painel-assinatura";

// AS UNIDADES COM O COMPRADOR ASSINADO — o cálculo, num lugar só.
//
// ⚠️ ISTO ESTAVA DUPLICADO LINHA A LINHA em duas telas: o painel interno
// (modules/apolo/blocks/assinaturas/painel-assinatura.tsx) e o painel público do coordenador
// (modules/publico/painel/aba-assinatura.tsx). As duas mostram a MESMA lista para as MESMAS
// pessoas, então uma divergência entre elas é um bug que ninguém percebe: cada uma conta um número
// e as duas parecem certas.
//
// Quando o Lucas pediu as barras (25/08/2026) foi preciso enriquecer o cálculo, e ficou claro que
// mexer em dois lugares idênticos é como o par se desencontra. Ponto único, com testes.

/** Uma unidade pronta para virar barra: o que a lista precisa sem refazer a conta. */
export type UnidadeComAssinatura = {
  /** Quantas assinaturas do contrato já saíram. */
  assinadas: number;
  /** Todas as pessoas do contrato, na ordem da fila. */
  assinantes: LinhaAssinatura[];
  /** A ordem que está travando a fila agora. `null` = contrato completo. */
  degrau: null | number;
  /** Dias entre o envio e a última assinatura do comprador. */
  dias: null | number;
  /** Quem está com a bola neste momento. */
  esperando: string[];
  /** Data em que o contrato saiu para assinatura. */
  envio: null | string;
  /** Nome dos compradores, separados por vírgula. */
  nomes: string;
  /** Total de assinaturas previstas no contrato. */
  total: number;
  /** Data da última assinatura do comprador. */
  ultima: null | string;
  un: string;
};

/**
 * Monta a lista de unidades cujos compradores JÁ assinaram, com o andamento de cada contrato.
 *
 * ⚠️ SÓ ENTRA QUEM TEM COMPRADOR E TODOS ELES ASSINARAM. Unidade sem nenhum comprador na lista de
 * assinantes fica de fora — não dá para dizer que "o comprador assinou" quando não há comprador.
 *
 * ⚠️ O DEGRAU É O MENOR PENDENTE, não o maior nem o próximo na sequência. A fila da D4Sign é
 * ordenada: quem está no degrau 5 só é chamado quando TODOS os anteriores assinarem, então o menor
 * degrau ainda em aberto é o que trava o contrato inteiro atrás dele.
 *
 * ⚠️ `degrau || 99` MANDA QUEM NÃO TEM ORDEM PARA O FIM. Assinatura sem `after_position` vem com 0,
 * e 0 seria o menor de todos — o contrato apareceria travado numa ordem que não existe.
 */
export function agruparUnidadesComCompradorAssinado(
  porUnidade: Map<string, LinhaAssinatura[]>,
): UnidadeComAssinatura[] {
  const saida: UnidadeComAssinatura[] = [];

  for (const [un, linhas] of porUnidade) {
    const primeira = linhas[0];
    if (!primeira) continue;

    const compradores = linhas.filter((x) => x.perfil === "Comprador");
    if (compradores.length === 0 || !compradores.every((x) => x.assinou)) continue;

    const datas = compradores
      .map((x) => x.assinadoEm)
      .filter((d): d is string => Boolean(d))
      .sort();
    const ultima = datas[datas.length - 1] ?? null;

    const pendentes = linhas.filter((x) => !x.assinou);
    const degrau = pendentes.length ? Math.min(...pendentes.map((x) => x.degrau || 99)) : null;

    saida.push({
      assinadas: linhas.filter((x) => x.assinou).length,
      // Na ordem da fila, com desempate pelo nome: a tabela do detalhe conta a história na
      // sequência em que as assinaturas acontecem, não na ordem que o banco devolveu.
      assinantes: [...linhas].sort(
        (a, b) =>
          (a.degrau || 99) - (b.degrau || 99) || a.usuario.localeCompare(b.usuario, "pt-BR"),
      ),
      degrau,
      dias: ultima
        ? Math.round(
            (new Date(ultima).getTime() - new Date(primeira.envio).getTime()) / 86_400_000,
          )
        : null,
      esperando:
        degrau === null
          ? []
          : [
              ...new Set(
                pendentes.filter((x) => (x.degrau || 99) === degrau).map((x) => x.usuario),
              ),
            ],
      envio: primeira.envio,
      // ⚠️ O DENOMINADOR É O CONTRATO INTEIRO, não só o que falta: "4 de 12" é a leitura que o
      // Lucas pediu com as barras.
      total: linhas.length,
      nomes: [...new Set(compradores.map((x) => x.usuario))].join(", "),
      ultima,
      un,
    });
  }

  // Mais recente primeiro; empate resolve pela unidade, para a ordem não dançar entre recargas.
  return saida.sort(
    (a, b) => (b.ultima ?? "").localeCompare(a.ultima ?? "") || a.un.localeCompare(b.un),
  );
}
