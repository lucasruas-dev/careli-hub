// O EMPREENDIMENTO COMO O PORTAL DO INCORPORADOR MOSTRA: o nome, os códigos e o mapa.
//
// Três decisões moravam espalhadas e viviam saindo do lugar:
//   • quais empreendimentos têm masterplan interno pronto (a rota de Produtos mantinha um Set, a
//     rota do masterplan mantinha o Record de arquivos, e o comentário de lá dizia com todas as
//     letras que as duas listas TÊM que casar: oferecer o que a outra não entrega dá quadro vazio);
//   • como o nome do C2X ("VISTA ALEGRE") vira nome de tela ("Vista Alegre");
//   • como os códigos autorizados viram os cards que o cliente vê.
//
// ⚠️ ESTE ARQUIVO NÃO AUTORIZA NADA. Ele só rotula e agrupa o que `codigosDaSessao` já liberou.
// Toda função aqui recebe a lista de códigos autorizados e só consegue REDUZI-LA: é por isso que
// o filtro de empreendimento da tela pode ser aceito sem virar porta de entrada.
import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";

/**
 * Código do C2X -> arquivo da tela A-INTERNO. O Vale do Ouro tem TRÊS códigos apontando para o
 * mesmo mapa: no chão é um loteamento só, e a divisão em VOL (Lino) e VOC (Cecílio) foi feita
 * lote a lote.
 */
// ⚠️ O VALE DO OURO TEM UM ARQUIVO SÓ PARA TRÊS CÓDIGOS, e por isso ele NUNCA é servido cru.
//
// `vale-do-ouro.html` cobre o loteamento histórico inteiro: 298 lotes das divisões VOL (família
// Lino) e VOC (Cecílio), cada linha com quadra, lote, situação, área, PREÇO e NOME COMPLETO do
// comprador, e a tela ainda exporta tudo para planilha. Entregar o arquivo a quem tem só uma das
// divisões é entregar a carteira do vizinho — foi o vazamento encontrado na revisão de 17/08/2026.
//
// A rota recorta antes de servir (`recortarMasterplan`): os lotes que não são do portal saem do
// arquivo e voltam só como desenho cinza, sem nenhum dado. É a mesma regra que o Lucas deu para a
// Lagoa Bonita: *"colocar uma cor cinza para as unidades que não foram do empreendimento que
// estamos trabalhando"*.
//
// O Garden é arquivo de um empreendimento só: não precisa de recorte, e o `recortarMasterplan`
// devolve o arquivo intacto quando o escopo cobre tudo.
//
// A LAGOA BONITA é o caso do Vale do Ouro elevado: UM arquivo (`lagoa-bonita.html`, 495 lotes com
// preço e comprador) para TRÊS glebas de donos diferentes — LBR (240 lotes), LBP (125) e LBF (47,
// a gleba do Fernando, o portal piloto). O recorte na rota é o mesmo: quem chega com LBF vê os 47
// dele com dado e os outros 448 como desenho cinza. A chave lote a lote é (block, lot) do C2X, e
// na Lagoa o bloco tem LETRA ("C01"/"L08") — o `chaveDoLote` entende os dois formatos.
//
// O VISTA ALEGRE (126 lotes) e o RECANTO DO PARÁ (199) são como o Garden: um arquivo, um
// empreendimento, sem divisões — o recorte confere o escopo e devolve o arquivo intacto quando
// ele cobre tudo, que é o caso normal desses dois. A quadra deles é UMA letra ("A".."I" no VAL,
// "A".."E" no REP), e no REP o lote é a numeração sequencial do loteamento (passa de 99).
export const MASTERPLANS_INTERNOS: Record<string, string> = {
  GDN: "garden.html",
  LBF: "lagoa-bonita.html",
  LBP: "lagoa-bonita.html",
  LBR: "lagoa-bonita.html",
  REP: "recanto-do-para.html",
  VAL: "vista-alegre.html",
  VLO: "vale-do-ouro.html",
  VOC: "vale-do-ouro.html",
  VOL: "vale-do-ouro.html",
};

/** O primeiro código destes que tem mapa desenhado, ou nulo. */
export function masterplanInternoDe(codes: string[]): null | string {
  for (const code of codes) {
    const limpo = String(code ?? "").trim().toUpperCase();
    if (limpo && MASTERPLANS_INTERNOS[limpo]) return limpo;
  }
  return null;
}

/**
 * O C2X guarda o nome do empreendimento em CAIXA ALTA ("VISTA ALEGRE", "GARDEN"), que serve para
 * tela de operação e fica agressivo no portal do cliente. Aqui vira "Vista Alegre" e "Garden".
 * Preposição fica minúscula, e nome que não é todo maiúsculo passa intacto: se alguém cadastrar
 * "Garden Resort Residence" com a caixa certa, respeitamos.
 */
export function nomeApresentavel(nome: string): string {
  const limpo = nome.trim().replace(/\s+/g, " ");

  if (limpo !== limpo.toUpperCase()) return limpo;

  const minusculas = new Set(["a", "as", "da", "das", "de", "do", "dos", "e", "o", "os"]);

  return limpo
    .toLowerCase()
    .split(" ")
    .map((palavra, indice) =>
      indice > 0 && minusculas.has(palavra)
        ? palavra
        : palavra.charAt(0).toUpperCase() + palavra.slice(1),
    )
    .join(" ");
}

export type EmpreendimentoDoPortal = {
  /** Códigos do C2X que ESTE cliente enxerga dentro deste empreendimento. */
  codes: string[];
  /** O id do catálogo: "group:Lagoa Bonita" no consolidado, o id do C2X no simples. */
  id: string;
  /** Código cujo masterplan interno abre. Nulo = este empreendimento não tem mapa desenhado. */
  masterplanInterno: null | string;
  nome: string;
};

/**
 * Os empreendimentos que o portal lista, montados a partir do catálogo e RECORTADOS pelos códigos
 * que a sessão já autorizou.
 *
 * ⚠️ A INTERSEÇÃO É O PONTO. Um grupo pode ter três divisões e o cliente ter só uma (o Vale do
 * Ouro é assim: o Cecílio tem o VOC, o Lino tem o VOL). Devolver os códigos do grupo inteiro
 * mostraria ao Cecílio o estoque do vizinho dentro de um card com o nome certo.
 */
export function empreendimentosDoPortal(
  catalogo: EmpreendimentoDoCatalogo[],
  codesAutorizados: string[],
): EmpreendimentoDoPortal[] {
  const autorizados = new Set(
    codesAutorizados.map((code) => String(code ?? "").trim().toUpperCase()).filter(Boolean),
  );

  const saida: EmpreendimentoDoPortal[] = [];

  for (const emp of catalogo) {
    const codes = emp.codes
      .map((code) => String(code ?? "").trim().toUpperCase())
      .filter((code) => autorizados.has(code));

    if (codes.length === 0) continue;

    saida.push({
      codes,
      id: emp.id,
      masterplanInterno: masterplanInternoDe(codes),
      nome: nomeApresentavel(emp.name),
    });
  }

  return saida.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Os códigos que a leitura vai receber, respeitando o empreendimento que a tela escolheu.
 *
 * O `pedido` é o id de um empreendimento JÁ listado para este cliente. Nunca amplia: ele só
 * escolhe um dos cards que `empreendimentosDoPortal` montou. Pedido que não casa com nada devolve
 * vazio, e a rota responde 404 em vez de cair na visão consolidada, que é o erro clássico do
 * filtro que "não achou" e vira relatório do loteamento inteiro.
 */
export function codesDoRecorte(
  empreendimentos: EmpreendimentoDoPortal[],
  pedido?: null | string,
): string[] {
  const alvo = String(pedido ?? "").trim();

  const escolhidos = alvo
    ? empreendimentos.filter((emp) => emp.id === alvo)
    : empreendimentos;

  return [...new Set(escolhidos.flatMap((emp) => emp.codes))];
}
