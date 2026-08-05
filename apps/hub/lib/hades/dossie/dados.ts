import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool } from "@/lib/guardian/db";

import {
  atualizarParcela,
  extrairEncargosDoContrato,
  somarAtualizacao,
  type EncargosDoContrato,
  type ParcelaAtualizada,
} from "./encargos";

// AGREGADOR DO DOSSIÊ JURÍDICO — junta, para UMA negociação, tudo que o relatório executivo pede.
//
// O documento (modelo da Careli, 13 seções) vai para o processo, então a regra aqui é: cada
// número tem origem rastreável no C2X ou no contrato, e o que não existe aparece como "não
// apurado" — nunca estimado em silêncio.
//
// O que NÃO vem daqui (é análise humana, escolhida na hora de gerar): motivo do encaminhamento
// e recomendação operacional. O histórico das tratativas vem do Hades (Supabase) e é juntado
// na camada de cima, para este módulo depender só do C2X.

type Linha = RowDataPacket & Record<string, unknown>;

export type DossieParcela = {
  numero: string;
  pagamento: string | null;
  situacao: string;
  // "Parcela", "Sinal", "Ato"... — é o tipo que diz o que é entrada e o que é mensalidade.
  tipo: string;
  valor: number;
  vencimento: string;
};

export type DossieDados = {
  // 1. Identificação
  cliente: string;
  // id do cliente no C2X (users.id). É por ele que se acham as tratativas do Hades e a
  // entidade do Apolo — a coluna acquisition_request_c2x_id do motor nunca é preenchida.
  clienteC2xId: number | null;
  documento: string;
  empreendimento: string;
  quadra: string;
  lote: string;
  unidade: string;
  codigoVenda: string;
  dataVenda: string | null;
  situacaoAtual: string;
  responsavelComercial: string | null;

  // 2. Dashboard — valores
  valorTotalLote: number;
  valorCorretagem: number;
  valorGlobal: number;
  totalPago: number;
  saldoDevedor: number;

  // 2. Dashboard — inadimplência
  parcelasTotal: number;
  parcelasPagas: number;
  parcelasEmAberto: number;
  parcelasInadimplentes: number;
  valorInadimplenciaOriginal: number;
  valorInadimplenciaAtualizado: number;
  // Multa + juros. A correção fica em linha própria porque é digitada, não calculada.
  encargosApurados: number;
  correcaoAplicada: number;
  correcaoPercent: number | null;
  primeiroVencimentoAberto: string | null;
  ultimoVencimentoAberto: string | null;
  diasEmAtraso: number;

  // 3. Score e risco (régua do próprio documento)
  score: number;
  scoreDetalhe: { criterio: string; pontos: number }[];
  prioridade: "BAIXA" | "MÉDIA" | "ALTA";
  recuperabilidade: "Alta" | "Média" | "Baixa";

  // 4/5. Contrato
  encargos: EncargosDoContrato;
  planoNome: string | null;
  qtdParcelasContrato: number | null;
  valorParcela: number | null;
  valorSinal: number | null;
  // Data do primeiro pagamento do sinal (acquisition_requests.first_signal_payment).
  dataPrimeiroSinal: string | null;

  // 6. Fluxo financeiro + memória de cálculo
  parcelas: DossieParcela[];
  memoriaCalculo: ParcelaAtualizada[];

  // meta
  contratoEncontrado: boolean;
  geradoEm: string;
};

const fmtData = (v: unknown): string | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
};
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// A régua de pontos é a do próprio documento (seção 3). Mantida literal para o jurídico conferir.
function calcularScore(input: {
  diasAtraso: number;
  parcelasInadimplentes: number;
  valorAtualizado: number;
  acordoDescumprido: boolean;
  semRetorno: boolean;
  reincidencia: boolean;
}) {
  const detalhe: { criterio: string; pontos: number }[] = [];
  const add = (criterio: string, pontos: number) => detalhe.push({ criterio, pontos });

  if (input.diasAtraso > 90) add("Acima de 90 dias", 30);
  else if (input.diasAtraso > 60) add("61 a 90 dias", 20);
  else if (input.diasAtraso > 30) add("31 a 60 dias", 10);
  else if (input.diasAtraso > 0) add("Até 30 dias", 5);

  if (input.parcelasInadimplentes > 5) add("Mais de 5 parcelas vencidas", 20);
  if (input.valorAtualizado > 50000) add("Dívida superior a R$ 50.000,00", 20);
  if (input.semRetorno) add("Cliente sem retorno", 10);
  if (input.acordoDescumprido) add("Descumprimento de acordo", 15);
  if (input.reincidencia) add("Reincidência", 15);

  const score = detalhe.reduce((s, d) => s + d.pontos, 0);

  // Semáforo da seção 3: o critério é atraso/parcelas, não o score.
  const prioridade: "ALTA" | "BAIXA" | "MÉDIA" =
    input.diasAtraso > 90 || input.parcelasInadimplentes > 5
      ? "ALTA"
      : input.diasAtraso >= 31 || input.parcelasInadimplentes >= 3
        ? "MÉDIA"
        : "BAIXA";

  // Recuperabilidade: quanto mais velho e mais parcelas, menor a chance de recuperar sem judicial.
  const recuperabilidade: "Alta" | "Baixa" | "Média" =
    score >= 65 ? "Baixa" : score >= 35 ? "Média" : "Alta";

  return { detalhe, prioridade, recuperabilidade, score };
}

export async function montarDadosDoDossie(input: {
  acquisitionRequestId: number;
  // Sinais que vêm do Hades (acordos/tratativas) e entram na pontuação.
  acordoDescumprido?: boolean;
  reincidencia?: boolean;
  semRetorno?: boolean;
  // % de correção monetária acumulada no período, digitado por quem gera o dossiê.
  // Entra na conta de cada parcela vencida; ausente = correção não somada.
  correcaoPercent?: number | null;
}): Promise<DossieDados | null> {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) throw new Error("C2X indisponível.");
  const { pool } = poolResult;
  const arId = input.acquisitionRequestId;

  const [[negocio]] = await pool.query<Linha[]>(
    `SELECT ar.id, ar.code, ar.created_at AS data_venda, ar.act_date, ar.sign_date,
            ar.quantity_signal_parcels, ar.first_signal_payment,
            s.name AS etapa,
            u.id AS cliente_c2x_id, u.name AS cliente, u.cpf, u.cnpj,
            eu.name AS unidade, eu.block AS quadra, eu.lot AS lote, eu.price,
            e.name AS empreendimento, e.id AS enterprise_id,
            cp.name AS plano, cp.parcels AS plano_parcelas, cp.initial_input_value,
            cor.name AS corretor,
            pol.total_value_commission AS comissao_percent
       FROM acquisition_requests ar
       JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
       JOIN enterprises e ON e.id = eu.enterprise_id
       JOIN acquisition_request_stages s ON s.id = ar.acquisition_request_stage_id
       LEFT JOIN users u ON u.id = ar.client_id
       LEFT JOIN users cor ON cor.id = ar.corretor_id
       LEFT JOIN commercial_plans cp ON cp.id = ar.commercial_plan_id
       LEFT JOIN commercial_policies pol ON pol.enterprise_id = e.id
      WHERE ar.id = ?
      LIMIT 1`,
    [arId],
  );
  if (!negocio) return null;

  // O TEXTO DO CONTRATO é a fonte dos encargos (regra do Lucas): multa, juros e índice saem dele.
  const [[contrato]] = await pool.query<Linha[]>(
    `SELECT complete_text FROM acquisition_request_contracts
      WHERE acquisition_request_id = ? ORDER BY id DESC LIMIT 1`,
    [arId],
  );
  const encargos = extrairEncargosDoContrato((contrato?.complete_text as string) ?? null);

  const [parcelasRaw] = await pool.query<Linha[]>(
    `SELECT p.id, p.current_total_parcel, p.total_parcels, p.due_date, p.payment_date,
            p.initial_value, p.paid_value, p.payment_status_id, ps.name AS situacao,
            pt.name AS tipo
       FROM payments p
       LEFT JOIN payment_statuses ps ON ps.id = p.payment_status_id
       LEFT JOIN parcel_types pt ON pt.id = p.parcel_type_id
      WHERE p.acquisition_request_id = ? AND COALESCE(p.payment_to_delete, 0) = 0
      ORDER BY p.due_date, p.id`,
    [arId],
  );

  const hoje = new Date();
  const parcelas: DossieParcela[] = [];
  const vencidas: ParcelaAtualizada[] = [];
  let pagas = 0, emAberto = 0, totalPago = 0, inadimplenteOriginal = 0;
  let primeiroAberto: Date | null = null, ultimoAberto: Date | null = null;

  for (const p of parcelasRaw) {
    const status = Number(p.payment_status_id);
    const valor = n(p.initial_value);
    const tipo = String(p.tipo ?? "-");
    const numero = p.current_total_parcel ? String(p.current_total_parcel) : tipo;
    const venc = p.due_date ? new Date(String(p.due_date)) : null;

    parcelas.push({
      numero,
      pagamento: fmtData(p.payment_date),
      situacao: String(p.situacao ?? "-"),
      tipo,
      valor,
      vencimento: fmtData(p.due_date) ?? "-",
    });

    if (status === 5) {
      pagas++;
      totalPago += n(p.paid_value) || valor;
    } else {
      emAberto++;
      if (venc) {
        if (!primeiroAberto || venc < primeiroAberto) primeiroAberto = venc;
        if (!ultimoAberto || venc > ultimoAberto) ultimoAberto = venc;
      }
      // Vencida (status 7) = inadimplente. "A vencer" (6) fica de fora da atualização.
      if (status === 7 && venc) {
        inadimplenteOriginal += valor;
        vencidas.push(
          atualizarParcela({
            correcaoPercent: input.correcaoPercent,
            encargos,
            hoje,
            numero,
            valorOriginal: valor,
            vencimento: venc,
          }),
        );
      }
    }
  }

  const totais = somarAtualizacao(vencidas);
  const diasEmAtraso = vencidas.reduce((max, v) => Math.max(max, v.diasAtraso), 0);

  // ⚠️ enterprise_unities.price é o PREÇO TOTAL DA AQUISIÇÃO (lote + corretagem) — conferido no
  // contrato real em 03/08. A corretagem sai do percentual da política comercial; sem política
  // cadastrada, fica zero e o dossiê marca a linha como não apurada.
  const precoTotal = n(negocio.price);
  const comissaoPercent = n(negocio.comissao_percent);
  const valorCorretagem = comissaoPercent > 0 ? precoTotal * (comissaoPercent / 100) : 0;
  const valorTotalLote = precoTotal - valorCorretagem;

  const scoreCalc = calcularScore({
    acordoDescumprido: input.acordoDescumprido ?? false,
    diasAtraso: diasEmAtraso,
    parcelasInadimplentes: vencidas.length,
    reincidencia: input.reincidencia ?? false,
    semRetorno: input.semRetorno ?? false,
    valorAtualizado: totais.atualizado,
  });

  const documento = String(negocio.cpf ?? negocio.cnpj ?? "").replace(/\D/g, "");

  // ⚠️ `acquisition_requests.first_signal_payment` é DATA (data do primeiro pagamento do sinal),
  // não valor — usá-la como número imprimia o timestamp em reais (R$ 1,7 trilhão na 1ª amostra).
  // O valor do sinal é a soma das parcelas de entrada: tipos "Sinal" e "Ato".
  const ENTRADA = /^(sinal|ato|entrada)$/i;
  const valorSinal = parcelas
    .filter((p) => ENTRADA.test(p.tipo))
    .reduce((s, p) => s + p.valor, 0);

  return {
    cliente: String(negocio.cliente ?? "-"),
    clienteC2xId: Number(negocio.cliente_c2x_id) || null,
    codigoVenda: String(negocio.code ?? `#${arId}`),
    contratoEncontrado: Boolean(contrato?.complete_text),
    correcaoAplicada: totais.correcao,
    correcaoPercent:
      Number.isFinite(Number(input.correcaoPercent)) && Number(input.correcaoPercent) > 0
        ? Number(input.correcaoPercent)
        : null,
    dataPrimeiroSinal: fmtData(negocio.first_signal_payment),
    dataVenda: fmtData(negocio.act_date) ?? fmtData(negocio.data_venda),
    diasEmAtraso,
    documento:
      documento.length === 11
        ? documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
        : documento.length === 14
          ? documento.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
          : documento || "-",
    empreendimento: String(negocio.empreendimento ?? "-"),
    encargos,
    encargosApurados: totais.multa + totais.juros,
    // valorInadimplenciaAtualizado (mais abaixo) JÁ inclui a correção — vem de totais.atualizado.
    geradoEm: hoje.toLocaleString("pt-BR"),
    lote: String(negocio.lote ?? "-"),
    memoriaCalculo: vencidas,
    parcelas,
    parcelasEmAberto: emAberto,
    parcelasInadimplentes: vencidas.length,
    parcelasPagas: pagas,
    parcelasTotal: parcelas.length,
    planoNome: (negocio.plano as string) ?? null,
    prioridade: scoreCalc.prioridade,
    primeiroVencimentoAberto: primeiroAberto ? primeiroAberto.toLocaleDateString("pt-BR") : null,
    qtdParcelasContrato: negocio.plano_parcelas ? Number(negocio.plano_parcelas) : null,
    quadra: String(negocio.quadra ?? "-"),
    recuperabilidade: scoreCalc.recuperabilidade,
    responsavelComercial: (negocio.corretor as string) ?? null,
    saldoDevedor: Math.max(0, precoTotal - totalPago),
    score: scoreCalc.score,
    scoreDetalhe: scoreCalc.detalhe,
    situacaoAtual: String(negocio.etapa ?? "-"),
    totalPago,
    ultimoVencimentoAberto: ultimoAberto ? ultimoAberto.toLocaleDateString("pt-BR") : null,
    unidade: String(negocio.unidade ?? "-"),
    valorCorretagem,
    valorGlobal: precoTotal,
    valorInadimplenciaAtualizado: totais.atualizado,
    valorInadimplenciaOriginal: inadimplenteOriginal,
    valorParcela: parcelas.find((p) => /^\d+$/.test(p.numero))?.valor ?? null,
    valorSinal: valorSinal || null,
    valorTotalLote,
  };
}
