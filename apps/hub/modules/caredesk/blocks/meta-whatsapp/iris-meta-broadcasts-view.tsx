"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  Send,
  SlidersHorizontal,
  UsersRound,
  Wifi,
} from "lucide-react";

import { BuilderCard, EmptyState, SignalCard } from "../shared/iris-ui";
import type {
  IrisData,
  IrisMetaEvent,
  IrisMetaEventsResponse,
  IrisMetaEventsSummary,
  IrisMetaRef,
  IrisSnapshot,
} from "../../types/iris-types";

export type IrisMetaBroadcastsHelpers = {
  formatCount: (value: number) => string;
  formatDateTime: (value?: string | null) => string;
};

const emptyMetaSummary: IrisMetaEventsSummary = {
  inbound: 0,
  refsKnown: 0,
  statuses: 0,
  total: 0,
};

export function IrisMetaBroadcastsView({
  data,
  getAccessToken,
  helpers,
  snapshot,
}: {
  data: Pick<IrisData, "broadcasts">;
  getAccessToken: () => Promise<string>;
  helpers: IrisMetaBroadcastsHelpers;
  snapshot: Pick<IrisSnapshot, "contacts">;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
      <section className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <SignalCard
            icon={Megaphone}
            title="Campanhas"
            value={`${helpers.formatCount(data.broadcasts.length)} ativas`}
            tone="gold"
          />
          <SignalCard
            icon={UsersRound}
            title="Base apta"
            value={helpers.formatCount(snapshot.contacts)}
          />
          <SignalCard
            icon={Clock3}
            title="Janela"
            value="09h-18h"
            tone="blue"
          />
          <SignalCard
            icon={CheckCircle2}
            title="Aprovacao"
            value="Obrigatoria"
            tone="green"
          />
        </div>

        <IrisMetaWhatsAppEnginePanel
          getAccessToken={getAccessToken}
          helpers={helpers}
        />

        <div className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">Disparos</h3>
            <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#A07C3B] px-3 text-sm font-semibold text-white">
              <Send className="h-4 w-4" />
              Novo disparo
            </button>
          </div>
          <div className="space-y-2">
            {data.broadcasts.length > 0 ? (
              data.broadcasts.map((campaign) => (
                <div
                  key={campaign.id}
                  className="grid grid-cols-[minmax(0,1fr)_150px_130px_110px] items-center gap-3 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3"
                >
                  <div>
                    <p className="font-semibold">{campaign.name}</p>
                    <p className="text-xs text-[#63708a]">
                      {campaign.scheduledAt
                        ? helpers.formatDateTime(campaign.scheduledAt)
                        : "Sem agendamento"}
                    </p>
                  </div>
                  <span className="text-sm text-[#34415a]">WhatsApp</span>
                  <IrisMetaStatusPill label={campaign.status} />
                  <button className="justify-self-end rounded-lg border border-[#dbe3ef] px-3 py-2 text-xs font-semibold text-[#34415a]">
                    Abrir
                  </button>
                </div>
              ))
            ) : (
              <EmptyState
                icon={Megaphone}
                title="Nenhum disparo criado"
                description="Campanhas e comunicados em massa devem nascer nas tabelas de disparo do Iris."
              />
            )}
          </div>
        </div>
      </section>

      <aside className="space-y-3">
        <BuilderCard
          icon={SlidersHorizontal}
          title="Segmentacao"
          rows={[
            ["Publico", "Base de contatos do Iris"],
            ["Regra", "Fila + perfil + consentimento"],
            ["Canal", "Canal ativo"],
            ["Aprovacao", "Equipe Careli"],
          ]}
        />
        <BuilderCard
          icon={LockKeyhole}
          title="Governanca"
          rows={[
            ["Mensagem", "Personalizada"],
            ["Anexos", "Controlados"],
            ["Tom", "Careli"],
            ["Bloqueio", "Sem envio automatico"],
          ]}
        />
      </aside>
    </div>
  );
}

function IrisMetaWhatsAppEnginePanel({
  getAccessToken,
  helpers,
}: {
  getAccessToken: () => Promise<string>;
  helpers: IrisMetaBroadcastsHelpers;
}) {
  const [events, setEvents] = useState<IrisMetaEvent[]>([]);
  const [refs, setRefs] = useState<IrisMetaRef[]>([]);
  const [summary, setSummary] =
    useState<IrisMetaEventsResponse["summary"]>(emptyMetaSummary);
  const [to, setTo] = useState("");
  const [body, setBody] = useState("Teste Iris - WhatsApp homologacao.");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      const response = await fetch("/api/iris/meta/events?limit=20", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response
        .json()
        .catch(() => null)) as IrisMetaEventsResponse | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel carregar eventos Meta.",
        );
      }

      setEvents(payload?.events ?? []);
      setRefs(payload?.refs ?? []);
      setSummary(payload?.summary ?? emptyMetaSummary);
    } catch (eventError) {
      console.error("[iris] falha ao carregar eventos meta", eventError);
      setError(
        eventError instanceof Error
          ? eventError.message
          : "Nao foi possivel carregar eventos Meta.",
      );
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function sendTestMessage() {
    if (sending) {
      return;
    }

    setSending(true);
    setFeedback(null);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body,
          to,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        messageId?: string;
        persistence?: { ok?: boolean; warning?: string };
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Meta rejeitou o envio.");
      }

      setFeedback(
        payload?.persistence?.warning ??
          `Mensagem enviada pela Iris: ${payload?.messageId ?? "sem id"}.`,
      );
      setBody("");
      await loadEvents();
    } catch (sendError) {
      console.error("[iris] falha ao enviar meta whatsapp", sendError);
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Nao foi possivel enviar pelo WhatsApp.",
      );
    } finally {
      setSending(false);
    }
  }

  const latestOutbound = refs.find((ref) => ref.direction === "outbound");
  const latestInbound = events.find((event) => event.direction === "inbound");

  return (
    <section className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Meta WhatsApp
              </p>
              <h3 className="text-base font-semibold text-slate-950">
                Motor de homologacao
              </h3>
            </div>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Envio manual protegido e leitura dos webhooks recebidos. Automacoes
            e disparo em massa continuam fora deste teste.
          </p>
        </div>

        <button
          type="button"
          onClick={loadEvents}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Activity className="h-4 w-4" aria-hidden="true" />
          Atualizar
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <MiniMetaStat
              label="Eventos"
              value={summary?.total ?? 0}
              helpers={helpers}
            />
            <MiniMetaStat
              label="Entradas"
              value={summary?.inbound ?? 0}
              helpers={helpers}
            />
            <MiniMetaStat
              label="Status"
              value={summary?.statuses ?? 0}
              helpers={helpers}
            />
            <MiniMetaStat
              label="Refs"
              value={summary?.refsKnown ?? 0}
              helpers={helpers}
            />
          </div>

          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-2">
              <p className="text-sm font-semibold text-slate-950">
                Ultimos webhooks
              </p>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                {loading ? "Carregando" : `${events.length} eventos`}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {events.length ? (
                events.map((event) => (
                  <MetaEventRow
                    event={event}
                    helpers={helpers}
                    key={event.id}
                  />
                ))
              ) : (
                <div className="rounded-lg border border-slate-200/70 bg-white p-4 text-center text-sm font-medium text-slate-500">
                  {loading
                    ? "Carregando eventos..."
                    : "Nenhum webhook encontrado."}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-[#A07C3B]/15 bg-[#fbf6ec] p-3">
            <p className="text-sm font-semibold text-slate-950">Envio manual</p>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              WhatsApp destino
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="55DDDnumero"
                className="mt-1 h-10 w-full rounded-lg border border-[#d8c8aa] bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#A07C3B]"
              />
            </label>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Mensagem
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={4}
                className="mt-1 w-full resize-none rounded-lg border border-[#d8c8aa] bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#A07C3B]"
              />
            </label>
            <button
              type="button"
              onClick={sendTestMessage}
              disabled={sending || !to.trim() || !body.trim()}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {sending ? "Enviando" : "Enviar pela Iris"}
            </button>
          </div>

          {feedback ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              {feedback}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {error}
            </div>
          ) : null}

          <BuilderCard
            icon={Wifi}
            title="Estado do motor"
            rows={[
              ["Ultima entrada", latestInbound?.messageText ?? "Sem entrada"],
              [
                "Ultima saida",
                latestOutbound?.deliveryStatus
                  ? latestOutbound.deliveryStatus
                  : "Aguardando envio",
              ],
              ["Canal", "Meta Cloud API"],
              ["Modo", "Homologacao manual"],
            ]}
          />
        </aside>
      </div>
    </section>
  );
}

function MiniMetaStat({
  helpers,
  label,
  value,
}: {
  helpers: IrisMetaBroadcastsHelpers;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-950">
        {helpers.formatCount(value)}
      </p>
    </div>
  );
}

function MetaEventRow({
  event,
  helpers,
}: {
  event: IrisMetaEvent;
  helpers: IrisMetaBroadcastsHelpers;
}) {
  const tone =
    event.direction === "inbound"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : event.direction === "status"
        ? "bg-sky-50 text-sky-700 ring-sky-100"
        : "bg-slate-50 text-slate-600 ring-slate-200";

  return (
    <div className="mb-2 rounded-lg border border-slate-200/70 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}
            >
              {event.providerEventType}
            </span>
            <span className="text-[11px] font-semibold text-slate-400">
              {helpers.formatDateTime(event.receivedAt)}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-slate-950">
            {event.contactName ?? event.contactWaId ?? "Contato Meta"}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
            {event.messageText ??
              event.statusDetail ??
              event.messageId ??
              "Evento sem texto operacional."}
          </p>
        </div>
        <IrisMetaStatusPill
          label={event.signatureValid ? "Assinado" : "Sem assinatura"}
          tone={event.signatureValid ? "green" : "danger"}
        />
      </div>
    </div>
  );
}

function IrisMetaStatusPill({
  label,
  tone = "gold",
}: {
  label: string;
  tone?: "blue" | "danger" | "gold" | "green" | "neutral";
}) {
  const classes =
    tone === "danger"
      ? "border-rose-100 bg-rose-50 text-rose-700"
      : tone === "blue"
        ? "border-sky-100 bg-sky-50 text-sky-700"
        : tone === "green"
          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
          : tone === "neutral"
            ? "border-slate-200 bg-slate-50 text-slate-600"
            : "border-[#eadcc2] bg-[#fbf6ec] text-[#8a682f]";

  return (
    <span
      className={`inline-flex w-fit rounded-full border px-2 py-1 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  );
}
