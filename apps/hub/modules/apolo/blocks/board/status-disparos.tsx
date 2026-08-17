"use client";

import {
  AlertTriangle,
  Check,
  CheckCheck,
  Info,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// O QUE A GENTE MANDOU PARA ESTA IMOBILIÁRIA, e o que aconteceu com cada mensagem.
//
// Pedido do Lucas (17/08/2026): *"seria ótimo trazer os status do envio das mensagens, se foi
// enviado, hora, se recebeu, quem recebeu, para a gente não ficar no escuro"*. O operador
// habilitava a imobiliária, via "habilitada" na tela e não tinha como saber se o WhatsApp saiu.
// Os avisos falham com frequência (número que não é WhatsApp, ficha sem telefone) e a prova
// ficava só no banco.
//
// ⚠️ NÃO INVENTAMOS "RECEBIDO". `delivered_at`/`read_at` só existem quando a Meta devolve a
// devolutiva, casando por `wa_message_id`. Os avisos de credenciamento saem pelo gateway do
// número do Relacionamento, que não devolve recibo nenhum (medido: 24 de 24 disparos sem os três
// campos). Onde não há confirmação, a tela DIZ que não há.

type Disparo = {
  confirmaEntrega: boolean;
  contato: null | string;
  entregueEm: null | string;
  evento: string;
  id: string;
  lidoEm: null | string;
  motivo: null | string;
  motivoTecnico: null | string;
  para: string;
  quando: string;
  reenvio: boolean;
  resultado: "entregue" | "enviado" | "falhou" | "lido";
};

type Reenvio = {
  aviso: null | string;
  descricao: null | string;
  destino: { contato: null | string; nome: null | string };
  motivo: null | string;
  pode: boolean;
};

function hora(iso: null | string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function StatusDisparos({ entityId }: { entityId: string }) {
  const [disparos, setDisparos] = useState<Disparo[] | null>(null);
  const [reenvio, setReenvio] = useState<null | Reenvio>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const [ok, setOk] = useState<null | string>(null);

  const carregar = useCallback(async () => {
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/apolo/board/${encodeURIComponent(entityId)}/disparos`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await resposta.json().catch(() => null)) as {
        data?: { disparos?: Disparo[]; reenvio?: Reenvio };
      } | null;

      setDisparos(corpo?.data?.disparos ?? []);
      setReenvio(corpo?.data?.reenvio ?? null);
    } catch {
      setDisparos([]);
    }
  }, [entityId]);

  useEffect(() => {
    setDisparos(null);
    setErro(null);
    setOk(null);
    void carregar();
  }, [carregar]);

  const reenviar = async () => {
    setEnviando(true);
    setErro(null);
    setOk(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/apolo/board/${encodeURIComponent(entityId)}/disparos`,
        {
          body: "{}",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const corpo = (await resposta.json().catch(() => null)) as {
        data?: { erro?: null | string; ok?: boolean; para?: null | string };
        error?: string;
      } | null;

      if (!resposta.ok) {
        setErro(corpo?.error ?? `Não foi possível reenviar (${resposta.status}).`);
      } else if (corpo?.data?.ok) {
        setOk(`Mensagem reenviada para ${corpo.data.para ?? "o contato da ficha"}.`);
      } else {
        // O disparo FALHOU, mas ficou registrado: o operador precisa ler o motivo, não um "ok".
        setErro(corpo?.data?.erro ?? "O envio não saiu. Veja a lista abaixo.");
      }
    } catch {
      setErro("Falha de rede. Nada foi reenviado.");
    } finally {
      setEnviando(false);
      // A lista sempre recarrega: o registro do disparo existe mesmo quando o envio falha.
      void carregar();
    }
  };

  // Alguma mensagem saiu por um canal que não devolve recibo? Então a tela precisa avisar, uma
  // vez só, que "entregue"/"lido" não existem aqui.
  const semRecibo = (disparos ?? []).some((d) => !d.confirmaEntrega);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
          <Send aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="m-0 text-sm font-semibold text-ink">Mensagens enviadas</h4>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            O que saiu desta ficha, para quem, quando e o que aconteceu.
          </p>
        </div>
        <button
          aria-label="Atualizar"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:bg-subtle"
          onClick={() => void carregar()}
          title="Atualizar"
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      {disparos === null ? (
        <div className="flex items-center gap-2 px-4 py-4 text-xs text-ink-muted">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          Carregando os envios…
        </div>
      ) : disparos.length === 0 ? (
        <p className="m-0 px-4 py-4 text-xs text-ink-muted">
          Nenhuma mensagem registrada para esta ficha.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-4">
          {disparos.map((d) => (
            <li
              className={`rounded-xl border px-3 py-2.5 ${
                d.resultado === "falhou"
                  ? "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10"
                  : "border-line bg-surface"
              }`}
              key={d.id}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-ink">{d.evento}</span>
                {d.reenvio ? (
                  <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">
                    reenvio
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-ink-muted">{hora(d.quando)}</span>
              </div>

              <p className="m-0 mt-1 text-xs text-ink-soft">
                Para: <span className="font-medium text-ink">{d.para}</span>
                {d.contato ? ` · ${d.contato}` : ""}
              </p>

              {d.resultado === "falhou" ? (
                <p
                  className="m-0 mt-1.5 flex items-start gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"
                  title={d.motivoTecnico ?? undefined}
                >
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  Não foi enviada: {d.motivo ?? "falha no envio"}
                </p>
              ) : d.resultado === "lido" ? (
                <p className="m-0 mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCheck aria-hidden="true" className="size-3.5" />
                  Lida em {hora(d.lidoEm)}
                </p>
              ) : d.resultado === "entregue" ? (
                <p className="m-0 mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCheck aria-hidden="true" className="size-3.5" />
                  Entregue em {hora(d.entregueEm)}
                </p>
              ) : (
                <p className="m-0 mt-1.5 flex items-center gap-1.5 text-xs text-ink-soft">
                  <Check aria-hidden="true" className="size-3.5" />
                  Saiu do nosso lado
                  {d.confirmaEntrega ? " · aguardando confirmação de entrega" : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {semRecibo ? (
        <p className="m-0 flex items-start gap-2 border-t border-line bg-subtle/30 px-4 py-3 text-[11px] text-ink-muted">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            O WhatsApp do Relacionamento não devolve confirmação de entrega nem de leitura. Dá para
            afirmar que a mensagem saiu do nosso lado (ou que falhou, com o motivo), não que a
            pessoa recebeu ou leu.
          </span>
        </p>
      ) : null}

      {erro ? (
        <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {erro}
        </p>
      ) : null}

      {ok ? (
        <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {ok}
        </p>
      ) : null}

      {reenvio ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="min-w-0 text-xs text-ink-muted">
            {reenvio.pode ? (
              <>
                Reenviar <span className="font-semibold text-ink">{reenvio.descricao}</span> para{" "}
                <span className="font-semibold text-ink">
                  {reenvio.destino.nome ?? "o contato da ficha"}
                </span>
                {reenvio.destino.contato ? ` · ${reenvio.destino.contato}` : ""}
              </>
            ) : (
              reenvio.motivo
            )}
          </span>

          <button
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!reenvio.pode || enviando}
            onClick={() => void reenviar()}
            type="button"
          >
            {enviando ? (
              <>
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                Reenviando…
              </>
            ) : (
              <>
                <Send aria-hidden="true" className="size-3.5" />
                Reenviar mensagem
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
