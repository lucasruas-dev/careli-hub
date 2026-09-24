import {
  abrirDocumento,
  cabecalhoTimbrado,
  type Cartao,
  desenharCartoes,
  desenharRodapes,
  desenharTabelaLimpa,
  dinheiro,
  garantirEspaco,
  mesPorExtenso,
  paragrafo,
  sanitizarNomeDeArquivo,
  tituloDeSecao,
  topico,
} from "@/lib/apolo/pdf-timbrado";
import { type CenarioDeProjecao } from "@/lib/apolo/reajuste/projecao";
import { type EvolucaoDoContrato } from "@/lib/apolo/reajuste/projecao-do-contrato";

// A EVOLUÇÃO DA PARCELA EM PDF TIMBRADO — o mesmo papel dos outros relatórios da casa.
//
// Lucas (23/09/2026): *"agora falta criar o relatório em PDF igual temos os outros"*.
//
// ⚠️ MESMA APURAÇÃO DA TELA, e é por isso que o PDF sai de `EvolucaoDoContrato` em vez de refazer
// a conta: tela e papel divergirem sobre a parcela de um cliente é o tipo de erro que vira
// reunião. Quem monta os números é `projecao-do-contrato.ts`; aqui só se desenha.
//
// ⚠️ ESTE PAPEL PODE CHEGAR AO CLIENTE, e por isso a honestidade é estrutural, não uma nota de
// rodapé em corpo 6: cada linha da tabela diz se é o valor de hoje ou estimativa, a premissa vai
// escrita por extenso, e o fecho afirma que o valor que vale é o do boleto. A folha do espelho já
// resolve isso assim ("não constitui proposta"); esta segue o mesmo caminho.
//
// ⚠️ O QUE ESTE PDF NÃO FAZ: não promete, não corrige parcela e não substitui o extrato. Ele
// responde uma pergunta só — "para onde a minha parcela caminha?" — e o extrato continua sendo a
// peça do saldo.
//
// ⚠️ OS TRÊS CENÁRIOS VÃO NA MESMA FOLHA, lado a lado (Lucas, 24/09/2026: *"pode fazer as três
// visões em um relatório só"*). E isso é mais honesto do que três PDFs separados: um papel com um
// número só é lido como previsão; três colunas mostram que o resultado é uma FAIXA, que é o que a
// estimativa realmente é. Quem receber vê o piso e o teto na mesma linha.

const TITULO_DA_PECA = "Evolução da Parcela";

const ROTULO_DO_CENARIO: Record<string, string> = {
  conservador: "conservador (média de 10 anos, com folga para cima)",
  otimista: "otimista (média dos últimos 3 anos, com folga para baixo)",
  tendencia: "tendência (média dos últimos 5 anos)",
};

/** "AAAAMM" -> "set/2026". Usa a régua da casa quando dá; cai no formato curto quando não. */
function competencia(aaaamm: null | string): string {
  if (!aaaamm || aaaamm.length !== 6) return "-";
  const porExtenso = mesPorExtenso(`${aaaamm.slice(0, 4)}-${aaaamm.slice(4, 6)}-01`);
  if (porExtenso) return porExtenso;
  return `${aaaamm.slice(4, 6)}/${aaaamm.slice(0, 4)}`;
}

function percentual(valor: number, casas = 1): string {
  return `${valor.toFixed(casas).replace(".", ",")}%`;
}

export type DadosDaEvolucaoPdf = {
  cenario: string;
  cliente: { documentoMascarado: null | string; nome: null | string };
  contratos: EvolucaoDoContrato[];
  /** 'YYYY-MM-DD' da apuração. */
  posicaoEm: string;
};

export async function montarEvolucaoPdf(dados: DadosDaEvolucaoPdf): Promise<Uint8Array> {
  const ctx = await abrirDocumento(TITULO_DA_PECA);

  await cabecalhoTimbrado(ctx, {
    contexto: `Posição em ${dados.posicaoEm.split("-").reverse().join("/")}`,
    titulo: TITULO_DA_PECA,
  });

  ctx.y -= 6;
  paragrafo(
    ctx,
    `Titular: ${dados.cliente.nome ?? "-"}${
      dados.cliente.documentoMascarado ? ` (${dados.cliente.documentoMascarado})` : ""
    }`,
    { size: 8 },
  );

  ctx.y -= 4;
  paragrafo(
    ctx,
    "Este relatório mostra quanto a mensalidade tende a ficar nos próximos anos, aplicando sobre o " +
      "valor que você paga hoje a média histórica do índice de correção do seu contrato. São três " +
      "cenários, do mais otimista ao mais conservador, porque o resultado é uma faixa e não um " +
      "número: é uma estimativa, e não um compromisso.",
    { justificado: true, size: 8.2 },
  );

  for (const contrato of dados.contratos) {
    desenharContrato(ctx, contrato, dados.cenario);
  }

  ctx.y -= 8;
  tituloDeSecao(ctx, "O que este relatório considera");
  topico(
    ctx,
    "O ponto de partida é o valor da parcela que está sendo cobrada hoje, e não o valor original " +
      "do contrato. A diferença entre os dois é a correção que já foi aplicada.",
  );
  topico(
    ctx,
    "A correção é lançada na emissão de cada boleto. Por isso as parcelas mais distantes ainda " +
      "aparecem no extrato pelo valor de origem: elas serão corrigidas quando forem emitidas.",
  );
  topico(
    ctx,
    "A projeção sobe uma vez por ano, no aniversário do reajuste, do jeito que o contrato " +
      "determina — e não mês a mês.",
  );
  topico(
    ctx,
    "O índice futuro ninguém conhece. O que está aqui é a média do passado, que pode não se " +
      "repetir: o valor definitivo de cada parcela é sempre o do boleto.",
  );

  // ⚠️ O AVISO DO RODAPÉ REPETE EM TODA PÁGINA, de propósito: a folha circula solta, e a
  // página 2 sem a ressalva vira "a Careli disse que vai custar isso".
  desenharRodapes(
    ctx.doc,
    ctx.font,
    "Estimativa de correção, sem valor de compromisso. O valor devido de cada parcela é o do boleto.",
  );
  return ctx.doc.save();
}

function desenharContrato(ctx: Ctx, contrato: EvolucaoDoContrato, cenario: string): void {
  ctx.y -= 10;
  garantirEspaco(ctx, 120);

  tituloDeSecao(
    ctx,
    `${contrato.empreendimento ?? "Contrato"} · ${contrato.codigo}`,
  );

  const cartoes: Cartao[] = [
    {
      apoio: "o valor de origem",
      icone: "igual",
      rotulo: "Valor de contrato",
      valor: dinheiro(contrato.mensalidadeBase),
    },
    {
      apoio:
        contrato.defasagemPct > 0.05
          ? `${percentual(contrato.defasagemPct)} acima do contrato`
          : "sem correção aplicada ainda",
      icone: "moeda",
      rotulo: "Parcela de hoje",
      valor: dinheiro(contrato.mensalidadeVigente),
    },
    {
      apoio: contrato.indiceDoContrato ?? "não registrado no contrato",
      icone: "relogio",
      rotulo: "Correção do contrato",
      valor:
        contrato.indiceNoAno != null
          ? `${percentual(contrato.indiceNoAno, 2)} em 12 meses`
          : "-",
    },
  ];
  desenharCartoes(ctx, cartoes);

  if (contrato.motivo) {
    ctx.y -= 6;
    paragrafo(ctx, contrato.motivo, { size: 8 });
  }

  // ⚠️ A ORDEM DAS COLUNAS É OTIMISTA → TENDÊNCIA → CONSERVADOR, do menor para o maior. Quem lê
  // da esquerda para a direita vê a faixa crescer, e o número do meio é o que a casa considera
  // mais provável.
  const ORDEM: CenarioDeProjecao[] = ["otimista", "tendencia", "conservador"];
  const porCenario = contrato.porCenario;

  if (porCenario) {
    // A régua de linhas é a do cenário do meio: os três projetam as MESMAS competências, porque o
    // degrau é anual em todos. Usar um deles como esqueleto evita cruzar listas por data.
    const esqueleto = porCenario.tendencia ?? [];

    if (esqueleto.length > 0) {
      ctx.y -= 8;
      desenharTabelaLimpa(ctx, {
        colunas: [
          { label: "Quando", peso: 0.19 },
          { label: "O que é", peso: 0.21 },
          { align: "right", label: "Otimista", peso: 0.2 },
          { align: "right", label: "Tendência", peso: 0.2 },
          { align: "right", label: "Conservador", peso: 0.2 },
        ],
        linhas: esqueleto.map((linha, indice) => [
          competencia(linha.competencia),
          linha.origem === "real"
            ? "O que paga hoje"
            : linha.origem === "represado"
              ? "Correção já publicada"
              : "Estimativa",
          ...ORDEM.map((c) => {
            const daColuna = porCenario[c]?.[indice];
            return daColuna ? dinheiro(daColuna.valor) : "-";
          }),
        ]),
        vazio: "Sem projeção para este contrato.",
      });

      ctx.y -= 6;
      paragrafo(
        ctx,
        "Cada coluna aplica uma média diferente do mesmo índice, ao mês, em degrau anual: " +
          ORDEM.map((c) => {
            const taxa = contrato.mesTipicoPorCenario?.[c];
            return `${ROTULO_DO_CENARIO[c] ?? c}, ${
              taxa != null ? percentual(taxa, 2) : "média"
            }`;
          }).join("; ") +
          ". O índice real pode vir acima, abaixo ou fora dessa faixa.",
        { justificado: true, size: 7.8 },
      );
    }
  } else if (contrato.linhas.length > 0) {
    // Caminho de um cenário só, que a tela usa quando pede a rota JSON.
    ctx.y -= 8;
    desenharTabelaLimpa(ctx, {
      colunas: [
        { label: "Quando", peso: 0.22 },
        { label: "O que é", peso: 0.32 },
        { align: "right", label: "Parcela estimada", peso: 0.26 },
        { align: "right", label: "Sobre hoje", peso: 0.2 },
      ],
      linhas: contrato.linhas.map((linha) => {
        const sobreHoje =
          contrato.mensalidadeVigente > 0
            ? (linha.valor / contrato.mensalidadeVigente - 1) * 100
            : 0;
        return [
          competencia(linha.competencia),
          linha.origem === "real"
            ? "O que paga hoje"
            : linha.origem === "represado"
              ? "Correção já publicada"
              : "Estimativa",
          dinheiro(linha.valor),
          sobreHoje <= 0.05 ? "-" : `+${percentual(sobreHoje)}`,
        ];
      }),
      vazio: "Sem projeção para este contrato.",
    });

    ctx.y -= 6;
    paragrafo(
      ctx,
      `A estimativa aplica ${
        contrato.mesTipicoPct != null ? percentual(contrato.mesTipicoPct, 2) : "a média"
      } ao mês, que é a média do ${contrato.indice ?? "índice"} no cenário ${
        ROTULO_DO_CENARIO[cenario] ?? cenario
      }. O índice real pode vir acima ou abaixo disso.`,
      { size: 7.8 },
    );
  }

  if (contrato.eventos.length > 0) {
    ctx.y -= 6;
    paragrafo(ctx, "O que já aconteceu com esta parcela:", { size: 8 });
    for (const evento of contrato.eventos) {
      topico(ctx, evento.rotulo);
    }
  }
}

/** O contexto do pdf-timbrado, só para tipar o desenho acima. */
type Ctx = Awaited<ReturnType<typeof abrirDocumento>>;

/**
 * O nome do arquivo, no MESMO formato do extrato ("Extrato - Fulano - LOS0617 - 24-09-2026.pdf").
 *
 * ⚠️ ESPAÇO NO NOME É O PADRÃO DAQUI, e não um descuido: as duas peças caem na mesma pasta de
 * download do atendente, e um nome com traço e outro com espaço faz o par parecer de sistemas
 * diferentes.
 */
export function nomeDoArquivoEvolucao(dados: DadosDaEvolucaoPdf): string {
  const cliente = (dados.cliente.nome ?? "Cliente").trim();
  const unidade =
    dados.contratos.length === 1
      ? (dados.contratos[0]?.codigo ?? "-")
      : `${dados.contratos.length} contratos`;
  const dia = dados.posicaoEm.split("-").reverse().join("-");

  return sanitizarNomeDeArquivo(`Evolucao da Parcela - ${cliente} - ${unidade} - ${dia}.pdf`);
}
