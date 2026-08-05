"use client";

// Resultado da análise de crédito, renderizado igual na etapa de crédito do Board e na tela de
// preview. Recebe o resumo (processado), o cru (para as restrições detalhadas e os dados
// cadastrais) e o veredito (aprovado/reprovado pela regra do empreendimento).

export type ResumoCredito = {
  cobrado?: boolean;
  consultasAnteriores?: number;
  faixa?: string;
  mensagemScore?: string;
  negativacoes?: number;
  nome?: string;
  protestos?: number;
  score?: number;
  situacao?: string;
};

export type VeredicoCredito = {
  aprovado: boolean;
  limite: number;
  motivo: string;
  total: number;
};

function moeda(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return v.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

// Restrições detalhadas (quantidade + valor) do cru, que o resumo não carrega. "collectionRecords"
// é rotulado "Dívidas vencidas" (Lucas, 21/jul).
function restricoes(cru: unknown): Array<{ balance: number; count: number; rotulo: string }> {
  const nd = (cru as { reports?: Array<{ negativeData?: Record<string, { summary?: { balance?: number; count?: number } }> }> })
    ?.reports?.[0]?.negativeData ?? {};
  const rotulos: Record<string, string> = {
    check: "Cheques sem fundo",
    collectionRecords: "Dívidas vencidas",
    notary: "Protestos (cartório)",
    pefin: "Pendências financeiras (Pefin)",
    refin: "Refin",
  };
  return Object.entries(rotulos).map(([chave, rotulo]) => ({
    balance: Number(nd[chave]?.summary?.balance ?? 0),
    count: Number(nd[chave]?.summary?.count ?? 0),
    rotulo,
  }));
}

function dadosCadastrais(cru: unknown): Record<string, string> {
  const reg = (cru as { reports?: Array<{ registration?: Record<string, unknown> }> })?.reports?.[0]?.registration ?? {};
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "—");
  return {
    Documento: t(reg.documentNumber),
    Nome: t(reg.consumerName ?? reg.companyName),
    Nascimento: t(reg.birthDate ?? reg.foundationDate),
    Sexo: reg.consumerGender === "M" ? "Masculino" : reg.consumerGender === "F" ? "Feminino" : "—",
    "Nome da mãe": t(reg.motherName),
    Situação: t(reg.statusRegistration),
  };
}

export function ResultadoCredito({
  cru,
  resumo,
  veredito,
}: {
  cru: unknown;
  resumo: ResumoCredito;
  veredito?: VeredicoCredito;
}) {
  return (
    <div className="grid gap-3">
      {/* Veredito: aprovado x reprovado pela regra do empreendimento */}
      {veredito ? (
        <div
          className={`rounded-xl border p-4 ${
            veredito.aprovado
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
              : "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
          }`}
        >
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Resultado
          </p>
          <p
            className={`m-0 text-2xl font-bold ${
              veredito.aprovado
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-rose-700 dark:text-rose-300"
            }`}
          >
            {veredito.aprovado ? "APROVADO" : "REPROVADO"}
          </p>
          <p className="m-0 mt-0.5 text-xs text-ink-soft">{veredito.motivo}</p>
        </div>
      ) : null}

      {/* Score + situação */}
      <div className="flex items-center justify-between rounded-xl border border-line bg-surface p-4">
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Score</p>
          <p className="m-0 text-3xl font-bold text-ink">
            {resumo.score ?? "—"}
            {resumo.faixa ? (
              <span className="ml-2 align-middle text-xs font-medium text-ink-muted">
                modelo {resumo.faixa}
              </span>
            ) : null}
          </p>
          {resumo.mensagemScore ? (
            <p className="m-0 mt-0.5 text-[11px] text-ink-muted">{resumo.mensagemScore}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Situação</p>
          <p className="m-0 text-base font-semibold text-ink">{resumo.situacao ?? "—"}</p>
        </div>
      </div>

      {/* Dados cadastrais */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h4 className="m-0 mb-2 text-xs font-semibold text-ink">Dados cadastrais</h4>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {Object.entries(dadosCadastrais(cru)).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-ink-muted">{k}</dt>
              <dd className="m-0 text-sm font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Restrições */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h4 className="m-0 mb-2 text-xs font-semibold text-ink">
          Restrições — {resumo.negativacoes ?? 0} negativações, {resumo.protestos ?? 0} protestos
        </h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
              <th className="pb-1.5 font-semibold">Tipo</th>
              <th className="pb-1.5 text-center font-semibold">Qtd</th>
              <th className="pb-1.5 text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {restricoes(cru).map((r) => (
              <tr className="border-t border-line" key={r.rotulo}>
                <td className="py-1.5 text-ink">{r.rotulo}</td>
                <td
                  className={`py-1.5 text-center font-semibold ${
                    r.count > 0 ? "text-rose-600 dark:text-rose-300" : "text-ink-muted"
                  }`}
                >
                  {r.count}
                </td>
                <td className="py-1.5 text-right text-ink">{moeda(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 mt-2 text-[11px] text-ink-muted">
          Consultas anteriores nos últimos meses: {resumo.consultasAnteriores ?? 0}
        </p>
      </div>
    </div>
  );
}
