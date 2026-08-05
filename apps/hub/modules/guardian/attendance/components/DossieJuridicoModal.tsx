"use client";

import { FileText, Loader2, Scale, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type { QueueClient } from "@/modules/guardian/attendance/types";

// DOSSIÊ JURÍDICO — o que o operador escolhe na hora de gerar.
//
// Pedido do Lucas (03/08): "Motivo do encaminhamento pode ser um campo clicável na hora de gerar
// (abre um pop up)... na 10 também o operador deve selecionar". Os dois campos de análise humana
// (motivo e recomendação) vêm de lista, com escape para texto livre — lista sozinha engessa,
// texto livre sozinho gera dossiê com "cliente não paga" escrito na peça que vai ao processo.
//
// O resto do documento (valores, encargos, parcelas, tratativas) é apurado pelo servidor. Aqui
// não se digita número que vá para a conta, com uma exceção declarada: a correção monetária, que
// o sistema não sabe calcular porque a tabela de índices do C2X está vazia.

const MOTIVOS = [
  "Inadimplência superior a 90 dias sem retorno do cliente às tentativas de contato realizadas pela operação.",
  "Descumprimento de acordo formalizado com a Careli, sem regularização após nova cobrança.",
  "Cliente inlocalizável: contatos telefônicos, WhatsApp e e-mail esgotados sem retorno.",
  "Recusa expressa de negociação após apresentação de proposta de acordo.",
  "Reincidência de inadimplência após acordo anteriormente cumprido.",
  "Necessidade de rescisão contratual e retomada da unidade.",
];

const RECOMENDACOES = [
  "Notificação extrajudicial com prazo de 15 dias e, no silêncio, rescisão contratual.",
  "Ação de rescisão contratual com reintegração de posse da unidade.",
  "Cobrança judicial do débito vencido e atualizado.",
  "Protesto do título e negativação nos órgãos de proteção ao crédito.",
  "Manutenção da cobrança administrativa com nova régua de contato antes do ajuizamento.",
];

const OUTRO = "__outro__";

const inputClass =
  "h-9 w-full rounded-lg border border-line/70 bg-surface px-2.5 text-sm font-medium text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";
const areaClass =
  "min-h-16 w-full resize-none rounded-lg border border-line/70 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}

export function DossieJuridicoModal({
  client,
  onClose,
}: {
  client: QueueClient;
  onClose: () => void;
}) {
  const [motivoOpcao, setMotivoOpcao] = useState(MOTIVOS[0] ?? "");
  const [motivoLivre, setMotivoLivre] = useState("");
  const [recomendacaoOpcao, setRecomendacaoOpcao] = useState(RECOMENDACOES[0] ?? "");
  const [recomendacaoLivre, setRecomendacaoLivre] = useState("");
  const [correcaoPercent, setCorrecaoPercent] = useState("");
  const [correcaoReferencia, setCorrecaoReferencia] = useState("");
  const [erro, setErro] = useState<null | string>(null);
  const [aviso, setAviso] = useState<null | string>(null);
  const [gerando, setGerando] = useState(false);

  const motivo = motivoOpcao === OUTRO ? motivoLivre : motivoOpcao;
  const recomendacao = recomendacaoOpcao === OUTRO ? recomendacaoLivre : recomendacaoOpcao;

  async function gerar() {
    setErro(null);
    setAviso(null);

    if (!motivo.trim()) {
      setErro("Descreva o motivo do encaminhamento.");
      return;
    }
    if (!recomendacao.trim()) {
      setErro("Descreva a recomendação operacional.");
      return;
    }

    // O popup abre ANTES do await: navegador bloqueia window.open disparado depois da resposta.
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;

    setGerando(true);
    try {
      const resposta = await fetch("/api/guardian/dossie", {
        body: JSON.stringify({
          acquisitionRequestId: client.c2xAcquisitionRequestId,
          correcaoPercent: correcaoPercent.trim() || null,
          correcaoReferencia: correcaoReferencia.trim() || null,
          motivoEncaminhamento: motivo.trim(),
          recomendacao: recomendacao.trim(),
        }),
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const corpo = (await resposta.json()) as {
        data?: {
          anexado?: boolean;
          arquivo?: string;
          avisoAnexo?: null | string;
          pdfBase64?: null | string;
          url?: null | string;
        };
        error?: string;
      };

      if (!resposta.ok || !corpo.data) {
        popup?.close();
        setErro(corpo.error ?? "Não foi possível gerar o dossiê.");
        return;
      }

      // Anexado: abre a URL assinada. Sem anexo: o PDF vem em base64 para o operador não ficar
      // sem a peça só porque o cliente não tem ficha no Apolo.
      const destino = corpo.data.url
        ? corpo.data.url
        : corpo.data.pdfBase64
          ? URL.createObjectURL(
              new Blob(
                [Uint8Array.from(atob(corpo.data.pdfBase64), (c) => c.charCodeAt(0))],
                { type: "application/pdf" },
              ),
            )
          : null;

      if (!destino) {
        popup?.close();
        setErro("O dossiê foi gerado mas não retornou arquivo.");
        return;
      }

      if (popup) popup.location.href = destino;
      else window.open(destino, "_blank", "noreferrer");
      if (destino.startsWith("blob:")) {
        window.setTimeout(() => URL.revokeObjectURL(destino), 60_000);
      }

      // Avisa a ficha do cliente que tem documento novo.
      window.dispatchEvent(new CustomEvent("guardian:motor-changed"));

      if (corpo.data.avisoAnexo) {
        setAviso(corpo.data.avisoAnexo);
        return;
      }
      onClose();
    } catch (e) {
      popup?.close();
      setErro((e as Error).message);
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Fechar"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <Scale className="size-4 text-[#A07C3B]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-ink">Dossiê jurídico</h2>
            <span className="text-xs text-ink-muted">{client.nome}</span>
          </div>
          <button
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-subtle"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="border-b border-line px-5 py-1.5 text-[11px] text-ink-muted">
          Os valores, encargos e o histórico de tratativas são apurados automaticamente. O
          documento fica anexado nos documentos do cliente.
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <Field label="Motivo do encaminhamento">
            <select
              className={inputClass}
              onChange={(e) => setMotivoOpcao(e.target.value)}
              value={motivoOpcao}
            >
              {MOTIVOS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={OUTRO}>Outro (escrever)</option>
            </select>
          </Field>
          {motivoOpcao === OUTRO ? (
            <textarea
              className={areaClass}
              onChange={(e) => setMotivoLivre(e.target.value)}
              placeholder="Descreva o motivo que justifica o encaminhamento ao jurídico."
              value={motivoLivre}
            />
          ) : null}

          <Field label="Recomendação operacional">
            <select
              className={inputClass}
              onChange={(e) => setRecomendacaoOpcao(e.target.value)}
              value={recomendacaoOpcao}
            >
              {RECOMENDACOES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value={OUTRO}>Outro (escrever)</option>
            </select>
          </Field>
          {recomendacaoOpcao === OUTRO ? (
            <textarea
              className={areaClass}
              onChange={(e) => setRecomendacaoLivre(e.target.value)}
              placeholder="Descreva a medida recomendada."
              value={recomendacaoLivre}
            />
          ) : null}

          <div className="rounded-lg border border-line/70 bg-subtle/50 p-3">
            <p className="mb-2 text-xs font-semibold text-ink">Correção monetária (opcional)</p>
            <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
              O sistema não calcula a correção: os índices do C2X estão cadastrados mas sem valores.
              Informe o percentual acumulado do período para que ele entre na conta. Em branco, o
              documento declara a correção como devida e pendente de apuração.
            </p>
            <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
              <Field label="Percentual">
                <input
                  className={inputClass}
                  inputMode="decimal"
                  onChange={(e) => setCorrecaoPercent(e.target.value)}
                  placeholder="12,5"
                  value={correcaoPercent}
                />
              </Field>
              <Field label="Referência (índice e período)">
                <input
                  className={inputClass}
                  onChange={(e) => setCorrecaoReferencia(e.target.value)}
                  placeholder="IPCA acumulado de 01/2024 a 07/2026"
                  value={correcaoReferencia}
                />
              </Field>
            </div>
          </div>

          {erro ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/12 dark:text-rose-300">
              {erro}
            </p>
          ) : null}
          {aviso ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/12 dark:text-amber-300">
              {aviso}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button
            className="inline-flex h-9 items-center rounded-lg border border-line/70 bg-surface px-4 text-sm font-medium text-ink hover:bg-subtle"
            onClick={onClose}
            type="button"
          >
            Fechar
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={gerando}
            onClick={() => void gerar()}
            type="button"
          >
            {gerando ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="size-4" aria-hidden="true" />
            )}
            Gerar e anexar
          </button>
        </footer>
      </div>
    </div>
  );
}
