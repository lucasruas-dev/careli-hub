import { ShieldAlert, ShieldCheck } from "lucide-react";

// Página pública de verificação do comprovante (o QR abre aqui). Confirma a AUTENTICIDADE e mostra
// os DADOS TÉCNICOS da consulta feita ao Serasa (quando, por quem, qual relatório, ambiente). NÃO
// mostra dado de crédito (score/dívidas) — esses ficam no PDF. Sem senha (decisão do Lucas).
//
// Componente de apresentação puro (sem estado): renderizado no server pela page.

type Props = {
  autentico: boolean;
  documento?: string | null;
  emitidoEm?: string | null;
  empreendimento?: string | null;
  erro?: string | null;
  operador?: string | null;
  protocolo?: string | null;
  tipoPessoa?: string | null;
};

export function VerificarComprovante(p: Props) {
  const linhas: { rotulo: string; valor: string }[] = [];
  if (p.protocolo) linhas.push({ rotulo: "Protocolo", valor: p.protocolo });
  if (p.documento) {
    linhas.push({
      rotulo: p.tipoPessoa === "PJ" ? "CNPJ consultado" : "CPF consultado",
      valor: p.documento,
    });
  }
  if (p.emitidoEm) linhas.push({ rotulo: "Data da consulta", valor: p.emitidoEm });
  if (p.operador) linhas.push({ rotulo: "Solicitado por", valor: p.operador });
  linhas.push({ rotulo: "Base consultada", valor: "Serasa Experian" });
  linhas.push({
    rotulo: "Finalidade",
    valor: p.empreendimento ? `CAD - ${p.empreendimento}` : "CAD",
  });

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-sm font-bold tracking-widest text-slate-500">C2X</p>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div
            className={`flex items-center gap-3 px-6 py-5 ${
              p.autentico ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}
          >
            {p.autentico ? (
              <ShieldCheck aria-hidden="true" className="size-8 shrink-0" />
            ) : (
              <ShieldAlert aria-hidden="true" className="size-8 shrink-0" />
            )}
            <div>
              <p className="m-0 text-base font-bold">
                {p.autentico ? "Comprovante autêntico" : "Comprovante não verificado"}
              </p>
              <p className="m-0 text-xs opacity-80">
                {p.autentico
                  ? "Emitido pela C2X. Confira abaixo os dados da consulta."
                  : p.erro ?? "Não foi possível confirmar a autenticidade."}
              </p>
            </div>
          </div>

          {p.autentico ? (
            <div className="px-6 py-5">
              <p className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Dados da consulta ao Serasa
              </p>
              <dl className="grid gap-3 text-sm">
                {linhas.map((l) => (
                  <div className="flex items-start justify-between gap-3" key={l.rotulo}>
                    <dt className="shrink-0 text-slate-500">{l.rotulo}</dt>
                    <dd className="m-0 min-w-0 break-words text-right font-semibold text-slate-900">
                      {l.valor}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="m-0 mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
                Os valores da análise (score, restrições) constam no próprio comprovante em PDF.
              </p>
            </div>
          ) : null}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Verificação de autenticidade de comprovante de análise de crédito.
        </p>
      </div>
    </div>
  );
}
