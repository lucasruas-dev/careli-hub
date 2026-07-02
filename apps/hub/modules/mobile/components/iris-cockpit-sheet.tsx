"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  Clock,
  ExternalLink,
  Loader2,
  User,
  Wallet,
  X,
} from "lucide-react";

import type {
  IrisApoloContextEntity,
  IrisApoloContextInstallment,
  IrisTicket,
} from "@/modules/caredesk/types/iris-types";
import { MobileAvatar } from "@/modules/mobile/components/mobile-ui";
import { loadApoloContextForTicket } from "@/modules/mobile/lib/apolo-context";

export type CockpitTab = "carteira" | "cliente" | "financeiro" | "timeline";

const TABS: readonly { icon: typeof User; key: CockpitTab; label: string }[] = [
  { icon: User, key: "cliente", label: "Cliente" },
  { icon: Building2, key: "carteira", label: "Carteira" },
  { icon: Wallet, key: "financeiro", label: "Financeiro" },
  { icon: Clock, key: "timeline", label: "Timeline" },
];

// Popup (folha de baixo) do cockpit dentro da conversa do Iris. Aba Cliente vem
// do ticket (crm360, instantânea); Carteira/Financeiro/Timeline vêm do contexto
// do Apolo, buscado ao abrir (loadApoloContextForTicket).
export function IrisCockpitSheet({
  initialTab = "cliente",
  onClose,
  ticket,
}: {
  initialTab?: CockpitTab;
  onClose: () => void;
  ticket: IrisTicket;
}) {
  const [tab, setTab] = useState<CockpitTab>(initialTab);
  const [entity, setEntity] = useState<IrisApoloContextEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    setError(null);
    loadApoloContextForTicket(ticket)
      .then((result) => {
        if (!mounted) {
          return;
        }

        setEntity(result);

        if (!result) {
          setError("Cliente não localizado no Apolo para este atendimento.");
        }
      })
      .catch(() => {
        if (mounted) {
          setError("Não foi possível consultar o Apolo agora.");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [ticket]);

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col justify-end bg-[#080c12]/45"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[85%] flex-col overflow-hidden rounded-t-[20px] bg-[#f5f6f8]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#e4e9f0] bg-white px-4 py-3">
          <MobileAvatar label={ticket.contactLabel} size={36} url={ticket.contactAvatarUrl} />
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm font-semibold text-[#101820]">
              {entity?.displayName || ticket.contactLabel}
            </p>
            <p className="m-0 truncate text-xs text-[#9aa6b5]">Cockpit · Apolo</p>
          </div>
          <button
            aria-label="Fechar"
            className="grid h-8 w-8 place-items-center rounded-full bg-[#f0f2f6] text-[#526078] outline-none transition active:scale-90"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto px-3 pb-1 pt-3">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = item.key === tab;

            return (
              <button
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium outline-none transition ${
                  active ? "bg-[#101820] text-white" : "bg-[#e9edf2] text-[#526078]"
                }`}
                key={item.key}
                onClick={() => setTab(item.key)}
                type="button"
              >
                <Icon aria-hidden="true" size={14} />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-1">
          {tab === "cliente" ? (
            <ClienteTab entity={entity} ticket={ticket} />
          ) : loading ? (
            <div className="grid place-items-center py-14 text-[#6b778c]">
              <Loader2 aria-hidden="true" className="animate-spin" size={22} />
            </div>
          ) : !entity ? (
            <p className="px-4 py-12 text-center text-sm text-[#6b778c]">
              {error ?? "Sem dados do Apolo para este cliente."}
            </p>
          ) : tab === "carteira" ? (
            <CarteiraTab entity={entity} />
          ) : tab === "financeiro" ? (
            <FinanceiroTab entity={entity} />
          ) : (
            <TimelineTab entity={entity} />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 mt-4 text-[11px] font-medium text-[#9aa6b5] first:mt-3">
      {children}
    </p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e4e9f0] bg-white px-3">
      {children}
    </div>
  );
}

function Line({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "green" | "red";
  value?: string | null;
}) {
  const toneClass =
    tone === "red"
      ? "text-[#c0392b]"
      : tone === "green"
        ? "text-[#1d7a52]"
        : "text-[#101820]";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#eef1f5] py-2.5 text-[13px] last:border-b-0">
      <span className="shrink-0 text-[#6b778c]">{label}</span>
      <span className={`text-right font-medium ${toneClass}`}>
        {value && value.trim() ? value : "—"}
      </span>
    </div>
  );
}

function ClienteTab({
  entity,
  ticket,
}: {
  entity: IrisApoloContextEntity | null;
  ticket: IrisTicket;
}) {
  const crm = ticket.crm360Registration ?? null;
  const delinquency = crm?.delinquency ?? null;
  const registered = crm?.status === "registered" || Boolean(entity);
  const profiles = entity?.profiles?.length
    ? entity.profiles.join(", ")
    : (crm?.profileLabel ?? ticket.profileLabel);

  return (
    <>
      <SectionLabel>Cadastro</SectionLabel>
      <Card>
        <Line label="Documento" value={entity?.documentMasked ?? crm?.documentMasked ?? ticket.contactDocument} />
        <Line label="Telefone" value={ticket.contactPhone} />
        <Line label="Perfil" value={profiles} />
        <Line
          label="Cadastro Apolo"
          tone={registered ? "green" : undefined}
          value={registered ? "Vinculado" : "Sem cadastro"}
        />
        {delinquency ? (
          <Line
            label="Situação"
            tone={delinquency === "inadimplente" ? "red" : "green"}
            value={delinquency === "inadimplente" ? "Inadimplente" : "Adimplente"}
          />
        ) : null}
        {entity?.locationLabel ? (
          <Line label="Local" value={entity.locationLabel} />
        ) : null}
      </Card>

      <SectionLabel>Atendimento</SectionLabel>
      <Card>
        <Line label="Fila" value={ticket.queueLabel} />
        <Line label="Protocolo" value={ticket.protocol} />
        <Line label="Canal" value={ticket.channelLabel || ticket.sourceLabel} />
      </Card>
    </>
  );
}

function CarteiraTab({ entity }: { entity: IrisApoloContextEntity }) {
  const links = entity.commercialLinks ?? [];

  if (!links.length) {
    return (
      <p className="px-4 py-12 text-center text-sm text-[#6b778c]">
        Nenhuma unidade/contrato vinculado no Apolo.
      </p>
    );
  }

  return (
    <>
      {links.map((link, index) => (
        <div key={link.unitCode ?? link.referenceLabel ?? index}>
          <SectionLabel>
            {link.enterprise?.trim() || `Contrato ${index + 1}`}
          </SectionLabel>
          <Card>
            <Line label="Unidade" value={link.unit ?? link.unitCode} />
            <Line label="Etapa" value={link.stage} />
            <Line label="Situação" value={link.contractStatus} />
            <Line label="Papel" value={link.role} />
            <Line label="Valor de tabela" value={link.tableValue} />
          </Card>
        </div>
      ))}
    </>
  );
}

function collectInstallments(
  entity: IrisApoloContextEntity,
): IrisApoloContextInstallment[] {
  const all = (entity.commercialLinks ?? []).flatMap(
    (link) => link.installments ?? [],
  );

  return all
    .filter((installment) => installment.dueDate || installment.value)
    .sort((a, b) => {
      const ta = a.dueDate ? Date.parse(a.dueDate) : Number.MAX_SAFE_INTEGER;
      const tb = b.dueDate ? Date.parse(b.dueDate) : Number.MAX_SAFE_INTEGER;

      return ta - tb;
    });
}

function classifyInstallment(
  installment: IrisApoloContextInstallment,
): "aVencer" | "liquidada" | "vencida" {
  const status = (installment.status ?? "").toLowerCase();

  if (
    installment.paidAt ||
    status.includes("liquid") ||
    status.includes("pag") ||
    status.includes("quit")
  ) {
    return "liquidada";
  }

  if (status.includes("vencid") || status.includes("atras")) {
    return "vencida";
  }

  return "aVencer";
}

function CockpitMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "blue" | "green" | "red";
  value: number;
}) {
  const color =
    tone === "green" ? "#1d7a52" : tone === "red" ? "#c0392b" : "#185fa5";

  return (
    <div className="rounded-xl border border-[#e4e9f0] bg-white px-2 py-2.5 text-center">
      <p className="m-0 text-lg font-semibold" style={{ color }}>
        {value}
      </p>
      <p className="m-0 text-[11px] text-[#6b778c]">{label}</p>
    </div>
  );
}

function FinanceiroTab({ entity }: { entity: IrisApoloContextEntity }) {
  const [showAll, setShowAll] = useState(false);
  const financial = entity.financial ?? null;
  const installments = collectInstallments(entity);
  const visible = showAll ? installments : installments.slice(0, 6);
  const counts = installments.reduce(
    (acc, item) => {
      acc[classifyInstallment(item)] += 1;
      return acc;
    },
    { aVencer: 0, liquidada: 0, vencida: 0 },
  );

  return (
    <>
      {installments.length ? (
        <div className="mb-1 mt-3 grid grid-cols-3 gap-2">
          <CockpitMetric label="Liquidadas" tone="green" value={counts.liquidada} />
          <CockpitMetric label="A vencer" tone="blue" value={counts.aVencer} />
          <CockpitMetric label="Vencidas" tone="red" value={counts.vencida} />
        </div>
      ) : null}

      <SectionLabel>Resumo financeiro</SectionLabel>
      <Card>
        <Line label="Carteira total" value={financial?.totalPortfolio} />
        <Line
          label="Em atraso"
          tone={
            (financial?.overdueInstallments ?? 0) > 0 ? "red" : undefined
          }
          value={
            financial?.overdueAmount
              ? `${financial.overdueAmount}${
                  financial.overdueInstallments
                    ? ` · ${financial.overdueInstallments} parc.`
                    : ""
                }`
              : null
          }
        />
        <Line label="Pago" value={financial?.paidAmount} />
        <Line label="Comportamento" value={financial?.paymentBehavior} />
        <Line label="Risco" value={financial?.risk} />
      </Card>

      {installments.length ? (
        <>
          <SectionLabel>Parcelas ({installments.length})</SectionLabel>
          <div className="grid gap-2">
            {visible.map((installment, index) => {
              const link = installment.paymentUrl ?? installment.invoiceUrl;
              const kind = classifyInstallment(installment);
              const statusColor =
                kind === "liquidada"
                  ? "#1d7a52"
                  : kind === "vencida"
                    ? "#c0392b"
                    : "#185fa5";

              return (
                <div
                  className="flex items-center gap-3 rounded-xl border border-[#e4e9f0] bg-white px-3 py-2.5"
                  key={installment.id ?? `${installment.number}-${index}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-[13px] font-medium text-[#101820]">
                      {installment.value || "—"}
                      {installment.number ? (
                        <span className="font-normal text-[#9aa6b5]">
                          {" "}· nº {installment.number}
                        </span>
                      ) : null}
                    </p>
                    <p className="m-0 truncate text-[11.5px] text-[#6b778c]">
                      {installment.dueDate ? `Vence ${installment.dueDate}` : ""}
                      {installment.status ? (
                        <span style={{ color: statusColor }}>
                          {" "}· {installment.status}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {link ? (
                    <a
                      aria-label="Abrir boleto"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e7f6ee] text-[#1d7a52] outline-none transition active:scale-90"
                      href={link}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink aria-hidden="true" size={15} />
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
          {installments.length > visible.length ? (
            <button
              className="mt-2 w-full rounded-xl border border-[#e4e9f0] bg-white py-2.5 text-xs font-semibold text-[#526078] outline-none transition active:scale-[0.99]"
              onClick={() => setShowAll(true)}
              type="button"
            >
              Ver todas as {installments.length} parcelas
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function TimelineTab({ entity }: { entity: IrisApoloContextEntity }) {
  const events = entity.timeline ?? [];

  if (!events.length) {
    return (
      <p className="px-4 py-12 text-center text-sm text-[#6b778c]">
        Sem histórico registrado no Apolo.
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-2">
      {events.map((event, index) => {
        const tone =
          event.status === "blocked"
            ? "#c0392b"
            : event.status === "attention"
              ? "#ba7517"
              : "#1d9e75";

        return (
          <div
            className="flex gap-3 rounded-xl border border-[#e4e9f0] bg-white px-3 py-2.5"
            key={index}
          >
            <span
              aria-hidden="true"
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: tone }}
            />
            <div className="min-w-0 flex-1">
              <p className="m-0 flex items-center justify-between gap-2 text-[13px] font-medium text-[#101820]">
                <span className="truncate">{event.title ?? "Evento"}</span>
                {event.date ? (
                  <span className="shrink-0 text-[11px] font-normal text-[#9aa6b5]">
                    {event.date}
                  </span>
                ) : null}
              </p>
              {event.description ? (
                <p className="m-0 mt-0.5 text-[11.5px] text-[#6b778c]">
                  {event.description}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
