// O ENXERTO: o quadro de assinaturas montado COM a D4Sign como fonte do status.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. `reconciliarAssinaturasComD4Sign` (lib/apolo/d4sign-assinaturas)
// resolve a verdade, mas ela sozinha NÃO muda a tela: quem monta o quadro é
// `montarQuadroDeAssinaturas`, e ele recalcula fila, KPIs e prazos a partir das linhas. Chamar a
// reconciliação e não trocar o que entra na montagem é código que sobe verde, passa nos testes e
// não muda um pixel. Pior: trocar só as `linhas` e esquecer o `arPorEnvio` faz o contrato
// cancelado SUMIR da tela em vez de voltar para "aguardando emissão".
//
// Então a troca é UMA função, com as três amarrações no lugar certo:
//   1. as linhas entram já corrigidas pela D4Sign (assinou / assinou quando);
//   2. o envio que a D4Sign diz CANCELADO sai da conta — das linhas, do `arPorEnvio` e do
//      `semAssinante` — e a venda volta a aparecer como contrato a emitir, exatamente como já
//      acontece com o cancelado que o C2X conhece (`contract_signature_status_id <> 6`);
//   3. cada linha da lista volta sabendo DE ONDE veio (`fonte`) e com o `aviso` daquele envio, e o
//      quadro volta com o `avisoDaFonte` do recorte inteiro.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ ONDE ISTO ESTÁ LIGADO (feito em 18/08/2026 — antes disso o módulo não era fonte de nada):
//
//   • lib/apolo/incorporador/assinaturas.ts, em `lerAssinaturasDoPortal` — o portal do
//     incorporador (visão Contratos de modules/incorporador/TelaVendas.tsx);
//   • lib/apolo/assinaturas/painel-contratos.ts, em `carregarPainelDeContratos` — a tela Contratos
//     do Apolo (modules/apolo/blocks/assinaturas/painel-contratos.tsx).
//
// Os dois montam `EnvioParaConciliar[]` a partir do envio ESCOLHIDO de cada contrato (csId, uuidDoc
// e o `contract_signature_status_id`, que é o que dá qualidade à divergência de status) e chamam
// esta função no lugar de `montarQuadroDeAssinaturas`.
//
// ⚠️ QUEM ACRESCENTAR UM TERCEIRO LEITOR TEM QUE ENTRAR POR AQUI. Chamar
// `reconciliarAssinaturasComD4Sign` na mão e passar as linhas adiante deixa o cancelado dentro do
// `arPorEnvio` — e aí a unidade some da tela em vez de voltar para "aguardando emissão".
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  AVISOS_DA_FONTE,
  reconciliarAssinaturasComD4Sign,
  type EnvioParaConciliar,
  type ResumoDaReconciliacao,
} from "@/lib/apolo/d4sign-assinaturas";
import {
  montarQuadroDeAssinaturas,
  type ContratoVivo,
  type EnvioSemAssinante,
  type QuadroDeAssinaturas,
  type UnidadeDeAssinatura,
} from "@/lib/apolo/incorporador/assinaturas";
import type { LinhaAssinatura } from "@/lib/apolo/painel-assinatura";
import { catalogoEstaQuente } from "@/lib/guardian/d4sign-consulta";
import type { OpcoesDeLote } from "@/lib/guardian/d4sign-consulta";

/**
 * A linha da lista sabendo de onde veio o que está escrito nela.
 *
 * ⚠️ HOJE ISTO É SÓ UM APELIDO. `aviso` e `fonte` moram no próprio `UnidadeDeAssinatura` desde
 * 18/08/2026, e é o que faz o sinal atravessar sem ninguém precisar lembrar: `ContratoDoPainel`
 * (lib/apolo/assinaturas/nucleo.ts) é `Omit<UnidadeDeAssinatura, "esquema"> & …`, e enquanto os
 * campos moravam só aqui o spread os carregava em tempo de execução e o TIPO os apagava — a tela
 * interna recebia o aviso e não conseguia enxergá-lo. O apelido fica porque o nome é usado nos
 * testes e diz o que a linha é.
 */
export type UnidadeComFonte = UnidadeDeAssinatura;

/**
 * O quadro de sempre, mais os números da reconciliação.
 *
 * É um `QuadroDeAssinaturas` para todos os efeitos (só acrescenta campos), então quem já lê o
 * quadro continua lendo sem mudar uma linha. Os DOIS avisos (`avisoDaFonte` e `avisoDosAssinantes`)
 * já são do quadro base — a tela precisa deles mesmo quando ninguém consultou a D4Sign.
 */
export type QuadroComFonte = QuadroDeAssinaturas & {
  /** Os `csId` que a D4Sign diz cancelados e que saíram da lista. Diagnóstico, não tela. */
  cancelados: number[];
  /**
   * A tela veio do C2X porque ninguém quis esperar, e o aquecimento está a caminho: PERGUNTE DE
   * NOVO em alguns segundos e a resposta virá conciliada.
   *
   * Só fica `true` com `semEsperar` ligado E o catálogo frio. Catálogo quente já responde com o
   * status conciliado, que é o que corrige a tela — o detalhe assinante a assinante que ainda
   * falte não muda número nenhum e não justifica pedir de novo.
   */
  conciliando: boolean;
  /** Os números da reconciliação: confirmados, só-status, fallback, cancelados, corrigidas. */
  resumoDaFonte: ResumoDaReconciliacao;
};

/**
 * Monta o quadro com a D4Sign mandando no status. Substitui `montarQuadroDeAssinaturas` nas duas
 * telas (ver o cabeçalho).
 *
 * ⚠️ SEM POLLING, e não deve haver. Quem chama é uma carga de tela; o que segura o custo é a
 * LISTAGEM EM LOTE (3 s pelo acervo inteiro, cacheada 5 min) mais o cache por documento — a conta
 * está no cabeçalho de lib/guardian/d4sign-consulta.
 *
 * ⚠️ FALHA ABERTA PARA O LEGADO, NUNCA FECHADA. D4Sign fora do ar não some com a tela: as linhas
 * do C2X seguem, marcadas com `fonte: "c2x-legado"` e o `aviso` que explica o que pode estar
 * errado nelas. A régua e o porquê estão em `AVISOS_DA_FONTE`.
 */
export async function montarQuadroComD4Sign(args: {
  /** De qual proposta (`ar_id`) é cada envio. Os cancelados são removidos daqui. */
  arPorEnvio: Map<number, number>;
  /** Os envios ESCOLHIDOS de cada contrato, com o uuid do documento. */
  envios: EnvioParaConciliar[];
  linhas: LinhaAssinatura[];
  opcoes?: OpcoesDeLote;
  semAssinante?: EnvioSemAssinante[];
  vivos: ContratoVivo[];
}): Promise<QuadroComFonte> {
  const { arPorEnvio, envios, linhas, opcoes = {}, semAssinante = [], vivos } = args;

  const fonte = await reconciliarAssinaturasComD4Sign(linhas, envios, opcoes);

  // ⚠️ O CANCELADO SAI DOS TRÊS LUGARES. Só tirar as linhas faria a unidade sumir da tela: sem
  // linha ela não entra na lista, e com o `arPorEnvio` ainda apontando para ela o contrato também
  // não cai no balde "aguardando emissão". Tirando das três entradas, ela volta a aparecer como
  // contrato a emitir — o mesmo destino do cancelado que o C2X já conhece.
  const arPorEnvioVivo =
    fonte.enviosCancelados.size === 0
      ? arPorEnvio
      : new Map([...arPorEnvio].filter(([csId]) => !fonte.enviosCancelados.has(csId)));
  const semAssinanteVivo =
    fonte.enviosCancelados.size === 0
      ? semAssinante
      : semAssinante.filter((envio) => !fonte.enviosCancelados.has(envio.csId));

  const quadro = montarQuadroDeAssinaturas(fonte.linhas, vivos, arPorEnvioVivo, semAssinanteVivo);

  // ⚠️ O CANCELADO PRECISA CONTINUAR DIZÍVEL DEPOIS DE SAIR DA CONTA. Tirado dos três lugares, ele
  // reaparece como "Aguardando emissão" — que é o comportamento certo (a venda está viva, o
  // contrato dela precisa ser emitido de novo) e uma explicação péssima: a unidade muda de balde e
  // ninguém sabe por quê. Como a linha de "aguardando emissão" não tem envio (`envioId` 0) nem
  // carrega o `ar_id`, a ponte de volta é a chave que a lista usa para batizar a unidade —
  // empreendimento + unidade —, montada a partir do `arPorEnvio` de ANTES da remoção.
  const unidadesCanceladas = new Set<string>();
  if (fonte.enviosCancelados.size > 0) {
    const fichaPorAr = new Map(vivos.map((vivo) => [vivo.arId, vivo.ficha]));
    for (const csId of fonte.enviosCancelados) {
      const ficha = fichaPorAr.get(arPorEnvio.get(csId) ?? -1);
      if (ficha) unidadesCanceladas.add(`${ficha.empreendimento}:${ficha.unidade}`);
    }
  }

  return {
    ...quadro,
    avisoDaFonte: fonte.aviso,
    avisoDosAssinantes: fonte.avisoDosAssinantes,
    cancelados: [...fonte.enviosCancelados],
    conciliando: opcoes.semEsperar === true && !catalogoEstaQuente(),
    resumoDaFonte: fonte.resumo,
    unidades: quadro.unidades.map((unidade) => {
      // `envioId` 0 é o contrato que nunca saiu para assinar: não há documento, não há fonte a
      // discutir, e o aviso "sem documento no D4Sign" só repetiria o chip "Aguardando emissão". A
      // exceção é justamente a unidade que caiu aqui porque a D4Sign cancelou o documento dela.
      if (unidade.envioId === 0) {
        const cancelada = unidadesCanceladas.has(`${unidade.empreendimento}:${unidade.unidade}`);

        return {
          ...unidade,
          aviso: cancelada ? AVISOS_DA_FONTE.cancelado : null,
          fonte: cancelada ? ("d4sign" as const) : ("c2x-legado" as const),
        };
      }

      return {
        ...unidade,
        aviso: fonte.avisoPorEnvio.get(unidade.envioId) ?? null,
        fonte: fonte.fontePorEnvio.get(unidade.envioId) ?? "c2x-legado",
      };
    }),
  };
}
