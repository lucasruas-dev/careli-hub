// O PLANO ESCOLHIDO DA PROPOSTA — pelo ID da linha, com o nome como reserva.
//
// ⚠️ ESTA PEÇA MOROU DENTRO DE `app/api/incorporador/venda/proposta/route.ts` ATÉ 24/09/2026, e a
// mudança de casa é o conserto: a ROTA casava por id desde 22/09/2026 e a MODAL continuava fazendo
// `portao?.planos.find((p) => p.nome === condicoes?.planoNome)` para montar o cronograma que a tela
// desenha. Duas escolhas diferentes para a mesma venda, na mesma venda.
//
// ⚠️ E OS NOMES SE REPETEM DE VERDADE, MEDIDO EM 24/09/2026: `select enterprise_id,
// upper(btrim(nome)), count(*) from temis_planos group by 1,2 having count(*) > 1` devolve três
// pares. Um deles é o Jardim das Gerais (enterprise 40) com DOIS planos chamados NORMAL, um com
// índice IPCA_ANUAL e outro com POUPANCA — a tela podia desenhar o cronograma de um e o servidor
// gravar o do outro.

import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";

/** Um plano da lista da Mesa de Venda: o `PlanoComercial` com o id da linha, quando ele existe. */
export type PlanoDaMesa = PlanoComercial & { id?: null | string };

/**
 * O plano desta proposta: pelo ID da linha de `temis_planos`, com o nome como reserva.
 *
 * ⚠️ GENÉRICA DE PROPÓSITO: a ROTA a chama com `PlanoDaMesa` (o `PlanoComercial` do banco) e a
 * MODAL com `PlanoDaVenda` (o mesmo objeto com as uniões alargadas para `string`, porque a rota
 * serializa e JSON não carrega união). A ESCOLHA é a mesma nos dois lados, e é isso que importa:
 * duas cópias dela divergiriam de novo no primeiro ajuste.
 *
 * ⚠️ O NOME NÃO É CHAVE, E ISSO CUSTA DINHEIRO DE VERDADE. Até 22/09/2026 a rota casava o plano por
 * `p.nome.trim() === planoNome`, e os nomes dos planos são texto que o cadastro edita. No dia em que
 * o Garden trocou NORMAL por INVESTIDOR, INVESTIDOR PARCELADO por PROMOÇÃO PARCELADO e INVESTIDOR
 * por PROMOÇÃO À VISTA, um simulador que já estava aberto continuou mandando `planoNome:
 * "INVESTIDOR"` querendo o plano de 36 parcelas — e o nome passou a casar com a linha de 60. O
 * objeto ia inteiro para `montarCronograma` e congelava na gravação: medido no banco, o de 36x tem
 * `juros_taxa` 0,000000 e o de 60x tem 6,000000 ao ano. São 6% ao ano gravados numa proposta de
 * verdade, num cronograma que alimenta o contrato. Não é tela errada, é dinheiro errado que fica.
 *
 * ⚠️ OS DOIS SÃO ACEITOS DE PROPÓSITO. O id é a chave; o nome é a reserva para quem não o manda —
 * qualquer aba aberta antes desta subida, e o C2X, que não tem o que mandar (`commercial_plans` é
 * lido por slot e não tem id que sobreviva à leitura, então lá o nome é a única chave que existe).
 * Recusar tudo o que chega sem id pararia a venda de todo mundo no minuto do deploy.
 *
 * ⚠️ ID QUE NÃO CASA NÃO CAI NO NOME. Seria reabrir exatamente o buraco: a tela velha manda o id
 * certo E o nome velho, e um fallback silencioso a levaria de volta para a linha renomeada. Id que
 * não existe mais é uma frase para o coordenador, não um palpite.
 *
 * ⚠️ E O CAMINHO SEM ID É O `find` DE SEMPRE, DESFEITO E DEVOLVIDO NO MESMO DIA EM QUE SAIU
 * (22/09/2026). Duas regras nasceram aqui junto com o casamento por id, e as duas saíram por
 * medição, porque mudavam regra de venda de quem não pediu nada:
 *
 *   • A TRAVA DO NOME AMBÍGUO (recusar com 422 quando dois planos de mesmo nome discordavam no
 *     dinheiro) PARAVA A VENDA DO LAGOA BONITA INTEIRA, hoje e sem rename nenhum. `planosDaUnidade`
 *     achata a família (pai e irmãos), e medido em 22/09/2026 no banco: o "NORMAL 01" do LBR
 *     (enterprise 27) pede 12% de entrada e o do LBF (enterprise 33) pede 20%, os dois cadastrados
 *     de propósito; o "INVESTIDOR 02" tem a mesma diferença. São cadastros CERTOS, de produtos
 *     diferentes, que a trava comparava como se fossem candidatos ao mesmo lote.
 *
 *   • O RECORTE POR EMPREENDIMENTO DA UNIDADE, criado para consertar a trava, GRAVAVA PROPOSTA QUE
 *     SE CONTRADIZIA: ele escolhia o plano numa lista recortada enquanto a tela e
 *     `pedido.planosDaTabela` continuavam olhando a família inteira. Medido: uma proposta do LBF
 *     congelava `plano.entradaPercentual = 20` ao lado de uma entrada de 12%, no mesmo objeto.
 *
 * O nome repetido escolhe o PRIMEIRO da lista, como sempre escolheu. Quem fecha esse buraco é o id,
 * que a tela passou a mandar — e não uma recusa que para venda legítima para todo mundo.
 */
export function escolherPlanoDaProposta<
  T extends { id?: null | string; nome: string },
>(
  planos: readonly T[],
  escolhido: { id: string; nome: string },
): { motivo: string; plano: null } | { motivo: null; plano: T } {
  if (escolhido.id) {
    const porId = planos.find(
      (p) => String(p.id ?? "").trim() === escolhido.id,
    );
    return porId
      ? { motivo: null, plano: porId }
      : {
          motivo:
            "O plano escolhido não está mais disponível neste empreendimento. Abra a proposta de novo e escolha o plano na lista.",
          plano: null,
        };
  }

  if (!escolhido.nome) return { motivo: "Escolha o plano da proposta.", plano: null };

  // ⚠️ ESTE `find` É O DE SEMPRE, LETRA POR LETRA — ver o cabeçalho. Mexer nele é mexer na regra de
  // venda de todo empreendimento servido pelo C2X e de toda aba que ainda não manda o id.
  const porNome = planos.find((p) => p.nome.trim() === escolhido.nome);
  return porNome
    ? { motivo: null, plano: porNome }
    : {
        motivo: `O plano "${escolhido.nome}" não está disponível neste empreendimento.`,
        plano: null,
      };
}
