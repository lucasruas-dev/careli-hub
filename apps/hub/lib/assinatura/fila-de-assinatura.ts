import type { SignatarioDaProposta } from "./diario-do-envelope-db";
import { fraseDaTrocaQueVaiParaOFim } from "./recusa-de-reenvio";

// A FILA DE QUEM ASSINA — a régua única da ordem da lista e do número do degrau. Puro.
//
// ⚠️ ELA SAIU DE `diario-do-envelope-db.ts` EM 02/10/2026, SEM MUDAR UMA REGRA, PORQUE PASSOU A TER DOIS
// LEITORES. Lucas, no mesmo dia: *"tem com a gente trazer o esquema de assinatura que e criado pelo
// c2x? os card que estao pelo c2x nao tem nada na tela de assinatura"*. O painel da Têmis passou a
// mostrar também o quadro da D4Sign (`quadro-da-d4sign-db.ts`), e a fila dele é a mesma da Clicksign:
// degrau do envio, depois nome. Uma segunda régua lá daria duas ordens para o mesmo painel.
//
// ⚠️ E ELA NÃO CASA NINGUÉM POR E-MAIL. Quem sabe onde a linha está no quadro é quem chama
// (`lugarNoQuadro`): a Clicksign responde pelo e-mail da lista congelada (a CAD trava e-mail repetido),
// a D4Sign pela própria linha do quadro, porque lá o e-mail REPETE (23 envelopes da D4Sign têm duas
// pessoas com o mesmo e-mail no quadro, medido em 02/10/2026, só SELECT).

/** Onde a linha está no quadro: o degrau do envio (`0` = sem ordem). `null` = fora do quadro. */
export type LugarNoQuadro = null | { ordem: number };

/**
 * A LISTA NA ORDEM EM QUE AS PESSOAS ASSINAM — e, no empate, em ordem alfabética.
 *
 * Lucas, 02/10/2026: *"Temos que mostrar os assinantes por ordem de assinatura se não tiver ordem de
 * assinatura ordem alfabetica"* e *"vamos informar (na ordem da tela) que aquele cadastro foi para
 * ultima posição"*.
 *
 * ⚠️ TRÊS FASES, PORQUE A ORDEM DO QUADRO NÃO BASTA. (0) quem está no quadro e não foi recadastrado:
 * pelo degrau do envio (`max(1, ordem)`, o mesmo `group` que `envelope.ts` manda), depois nome; (1)
 * quem foi recadastrado com o envelope rodando: no FIM, na ordem em que entrou (cada recadastro vai
 * para o último degrau + 1 daquela hora); (2) quem não está no quadro: por nome, no fim. Envelope sem
 * ordem (todo mundo `0`) sai inteiro em ordem alfabética, e o recadastrado depois dele.
 *
 * ⚠️ ATÉ 02/10/2026 A TELA PUNHA "QUEM PRECISA DE CONSERTO" PRIMEIRO, e a ordem do envelope não
 * importava. A barra de destaque da linha continua apontando quem precisa de gesto; a posição agora
 * é a da fila, que é o que o Lucas pediu.
 *
 * ⚠️ E O AVISO DA TROCA SAI DAQUI, porque só a lista inteira sabe quantos ficam antes: corrigir o
 * e-mail de quem tem gente sem assinar na mesma posição ou depois dela a manda para trás dessa gente.
 * `semTroca` desliga o aviso onde a troca não existe (a D4Sign: ela é feita no C2X).
 */
export function naOrdemDaFila(
  juntos: SignatarioDaProposta[],
  lugarNoQuadro: (linha: SignatarioDaProposta, indice: number) => LugarNoQuadro,
  opcoes: { encerrado: boolean; semTroca?: boolean },
): SignatarioDaProposta[] {
  const fichas = juntos.map((linha, indice) => {
    const lugar = lugarNoQuadro(linha, indice);
    const fase = lugar === null ? 2 : linha.foiParaOFimEm ? 1 : 0;
    return { degrau: Math.max(1, lugar?.ordem ?? 0), fase, linha };
  });

  fichas.sort((a, b) => {
    if (a.fase !== b.fase) return a.fase - b.fase;
    if (a.fase === 0 && a.degrau !== b.degrau) return a.degrau - b.degrau;
    if (a.fase === 1) {
      const diferenca = Date.parse(a.linha.foiParaOFimEm ?? "") - Date.parse(b.linha.foiParaOFimEm ?? "");
      if (diferenca) return diferenca;
    }
    return a.linha.nome.localeCompare(b.linha.nome, "pt-BR", { sensitivity: "base" });
  });

  // A posição na fila: o degrau na fase 0; na fase 1, depois do maior degrau, um por recadastro.
  const maior = Math.max(0, ...fichas.filter((f) => f.fase === 0).map((f) => f.degrau));
  let recadastrados = 0;
  const posicoes = fichas.map((f) => (f.fase === 0 ? f.degrau : f.fase === 1 ? maior + ++recadastrados : null));

  return fichas.map((f, i) => {
    const posicao = posicoes[i] ?? null;
    const linha = { ...f.linha, posicao };
    if (opcoes.encerrado || opcoes.semTroca || posicao === null || linha.assinouEm !== null) return linha;
    const passamAFrente = fichas.filter((outra, j) => {
      const dela = posicoes[j] ?? null;
      return j !== i && outra.linha.assinouEm === null && dela !== null && dela >= posicao;
    }).length;
    return passamAFrente > 0
      ? { ...linha, trocaVaiParaOFim: fraseDaTrocaQueVaiParaOFim(linha.nome, passamAFrente) }
      : linha;
  });
}
