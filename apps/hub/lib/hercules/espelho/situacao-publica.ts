// DE QUE COR O LOTE APARECE NO ESPELHO PÚBLICO — e são DUAS cores, só.
//
// Lucas (09/09/2026): *"para esse publico são duas cores, azul para bloqueado vendido, reserva,
// proposta, contrato) e verde para disponivel"* · *"esse é o padrão externo, o interno é o que
// desenhamos e que está hoje com as cores referente aos status"*.
//
// ⚠️ A FONTE É O PANTEON, E SÓ ELE. Lucas (10/09/2026): *"nada de olhar no c2x"* · *"temo
// cadastro de unidades"*. É a virada que ele anunciou em 09/09: o Panteon deixa de refletir o
// legado e passa a ser o registro. Então o cadastro é `hercules_unidades` e o processo são
// `hercules_propostas` e `hercules_reservas` — nenhuma consulta ao MySQL entra neste caminho.
//
// ⚠️ E POR ISSO A REGRA É FAIL-CLOSED. Verde é uma AFIRMAÇÃO para quem está de fora: "este lote
// está à venda". Só sai verde o que o cadastro diz `disponivel` E não tem nada do processo por
// cima. Qualquer outra coisa — situação desconhecida, proposta aberta, reserva viva, cadastro em
// branco — sai azul. O erro caro desta tela é anunciar disponível um lote que já tem dono: o
// cliente escolhe, o corretor promete, e alguém tem de desdizer.
//
// Medido em 10/09/2026 nos oito masterplans publicados: a régua trava 3 lotes que o cadastro
// dava como disponíveis mas têm proposta aberta (1 no Veredas, 2 no Vale do Ouro). É exatamente
// o pedido do Lucas em 09/09: *"tem que comunicar com nosso processo, reservou, proposta, tem
// que refletir no espelho"*.

/** As duas cores do público. Nada de status intermediário aqui — isso é o espelho INTERNO. */
export type SituacaoPublica = "disponivel" | "indisponivel";

export type SinaisDaUnidade = {
  /**
   * Este registro é o do FILHO (a carteira que vende), e não o do pai (o espelho histórico).
   *
   * ⚠️ OS DOIS REGISTROS DO MESMO TERRENO NÃO VALEM IGUAL, e tratá-los como iguais foi o
   * primeiro desenho errado deste arquivo. Medido em 10/09/2026 no Vale do Ouro: o pai (VLO)
   * está parado e diz `vendida` em 4 lotes que os filhos dão como `disponivel`. Somar os dois
   * como pares esconderia 4 lotes à venda — o mesmo estrago do `price <= 1`
   * ([[reference_bi_preco_um_real_esconde_estoque]]). Quem vende é o filho, e é ele que sabe.
   */
  doFilho: boolean;
  /** `hercules_propostas.aberta` — proposta viva sobre este lote. */
  propostaAberta: boolean;
  /** `hercules_reservas.situacao = 'reservada'`. */
  reservaViva: boolean;
  /** `hercules_unidades.situacao`: disponivel · reservada · vendida · bloqueada. */
  situacaoNoCadastro: null | string;
};

/** O único valor do cadastro que pode virar verde. */
const CADASTRO_DISPONIVEL = "disponivel";

/**
 * A ordem das perguntas É a regra:
 *
 * 1. **Processo do Panteon primeiro.** Reserva viva ou proposta aberta tornam o lote
 *    indisponível mesmo que o cadastro ainda não tenha sido virado — o cadastro é carregado em
 *    lote, e o processo acontece agora.
 * 2. **Só então o cadastro**, e apenas o valor exato `disponivel`. Valor desconhecido (alguém
 *    acrescenta um estado novo amanhã) NÃO vira verde: vira azul, calado.
 */
export function situacaoPublica(sinais: SinaisDaUnidade): SituacaoPublica {
  if (sinais.reservaViva || sinais.propostaAberta) return "indisponivel";
  return sinais.situacaoNoCadastro === CADASTRO_DISPONIVEL
    ? "disponivel"
    : "indisponivel";
}

/**
 * A situação de um LOTE que existe em mais de um cadastro.
 *
 * ⚠️ O MESMO TERRENO EXISTE DUAS VEZES NO BANCO. Medido em 10/09/2026: o Vale do Ouro tem 298
 * unidades no pai (VLO) e 301 nos filhos (VOC, VOL, VOR) para os MESMOS 298 lotes; o Lagoa
 * Bonita tem 495 no pai e 412 nos filhos. É o resíduo de duas cargas
 * ([[reference_hercules_unidades_e_um_retrato_parado]]) e não uma decisão de modelo. A chave real
 * do lote é `quadra` + `lote`, que é única nos dois lados — o CÓDIGO não serve, porque o pai
 * grava `VLO0101` e o filho `VOL0101` para o mesmo terreno.
 *
 * A regra tem dois degraus, e a ordem importa:
 *
 * 1. **O processo trava, venha de onde vier.** Proposta aberta ou reserva viva em QUALQUER
 *    registro do terreno pinta azul. Aqui pai e filho valem igual, porque processo é fato: uma
 *    proposta lançada no pai vale tanto quanto uma lançada no filho.
 * 2. **O cadastro do FILHO decide, quando existe.** É a regra que a casa já aplica em
 *    `expandir-id-do-painel.ts` (*"quando o pai tem filho autorizado, o pai É os filhos"*) e o
 *    modelo do Lucas: o pai empresta o desenho, os filhos dizem o que aconteceu. Sem filho — os
 *    83 lotes do Lagoa Bonita que só existem no pai —, o pai responde, que é o único que tem.
 */
export function situacaoDoLoteReal(
  registros: readonly SinaisDaUnidade[],
): SituacaoPublica {
  if (registros.length === 0) return "indisponivel";

  // Degrau 1: o processo trava o terreno inteiro.
  if (registros.some((r) => r.reservaViva || r.propostaAberta)) {
    return "indisponivel";
  }

  // Degrau 2: quem responde é o filho; só na ausência dele, o pai.
  const filhos = registros.filter((r) => r.doFilho);
  const quemResponde = filhos.length > 0 ? filhos : registros;

  // Entre filhos, `some` e não `every`: quando um lote migra de carteira, o cadastro ANTIGO fica
  // `bloqueada` e o novo carrega o estado real — medido nos 3 lotes que VOC e VOR disputam. Exigir
  // unanimidade deixaria azul um lote que a carteira viva dá como disponível.
  return quemResponde.some((r) => r.situacaoNoCadastro === CADASTRO_DISPONIVEL)
    ? "disponivel"
    : "indisponivel";
}

/** Quantos de cada cor — a legenda do espelho. */
export function contarPublicas(
  situacoes: Iterable<SituacaoPublica>,
): Record<SituacaoPublica, number> {
  const total: Record<SituacaoPublica, number> = {
    disponivel: 0,
    indisponivel: 0,
  };
  for (const s of situacoes) total[s] += 1;
  return total;
}
