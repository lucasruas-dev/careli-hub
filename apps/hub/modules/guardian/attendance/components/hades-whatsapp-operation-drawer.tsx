"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, FileText, HandCoins, X } from "lucide-react";
import {
  HadesWhatsAppEditableField,
  HadesWhatsAppReadonlyField,
} from "@/modules/guardian/attendance/components/hades-whatsapp-fields";
import { calculateAgreement } from "@/modules/guardian/attendance/hades-agreement-calculator";
import { buildC2xBoletos } from "@/modules/guardian/attendance/hades-c2x-boletos";
import type {
  OperationDrawerMode,
  WhatsAppTicket,
} from "@/modules/guardian/attendance/hades-whatsapp-types";
import type {
  OperationalTimelineEvent,
  PortfolioUnit,
  QueueClient,
} from "@/modules/guardian/attendance/types";

export function HadesWhatsAppOperationDrawer({
  client,
  mode,
  onClose,
  onSaved,
  selectedUnit,
  ticket,
}: {
  client: QueueClient;
  mode: OperationDrawerMode;
  onClose: () => void;
  onSaved: (mode: OperationDrawerMode, event: OperationalTimelineEvent) => void;
  selectedUnit?: PortfolioUnit;
  ticket: WhatsAppTicket;
}) {
  const isPromise = mode === "promise";
  const isAgreement = mode === "agreement";
  const isBoleto = mode === "boleto";
  const [unitId, setUnitId] = useState(selectedUnit?.id ?? client.carteira.unidades[0]?.id ?? "");
  const unit = client.carteira.unidades.find((item) => item.id === unitId) ?? client.carteira.unidades[0];
  const [promisedValue, setPromisedValue] = useState(client.parcelas.ultimaParcela);
  const [promisedDate, setPromisedDate] = useState("-");
  const [originalValue, setOriginalValue] = useState(client.agreement.originalDebt);
  const [discount, setDiscount] = useState(client.agreement.discount);
  const [entry, setEntry] = useState(client.agreement.entry);
  const [entryDueDate, setEntryDueDate] = useState("-");
  const [installmentsCount, setInstallmentsCount] = useState(`${client.agreement.installmentsCount}`);
  const [firstDueDate, setFirstDueDate] = useState("-");
  const c2xBoletos = useMemo(() => buildC2xBoletos(client), [client]);
  const [selectedBoletoId, setSelectedBoletoId] = useState(c2xBoletos[0]?.id ?? "");
  const selectedBoleto = c2xBoletos.find((boleto) => boleto.id === selectedBoletoId) ?? c2xBoletos[0];
  const [note, setNote] = useState(
    isPromise
      ? "-"
      : isBoleto
        ? "-"
        : mode === "installments"
          ? "-"
          : client.agreement.aiSuggestion.composition
  );

  const agreementCalc = calculateAgreement(originalValue, discount, entry, installmentsCount);

  function save() {
    if (isBoleto || mode === "installments") {
      onSaved(mode, {
        actionType: isBoleto ? "Envio de boleto C2X" : "Consulta de boleto C2X",
        id: `${client.id}-${mode}-whatsapp-${unit?.id ?? "unit"}-${selectedBoleto?.id ?? "boleto"}`,
        protocol: ticket.protocol,
        type: isBoleto ? "Boleto C2X" : "Observação operacional",
        title: isBoleto ? "Boleto C2X enviado pelo WhatsApp" : "Boletos C2X consultados",
        description: isBoleto
          ? `Boleto original do C2X enviado para a parcela ${selectedBoleto?.parcela ?? "-"} da unidade ${unit?.matricula ?? "-"} a partir do Ticket ${ticket.protocol}. Linha digitável registrada para auditoria operacional.`
          : `Operador consultou parcelas e boletos originais do C2X da unidade ${unit?.matricula ?? "-"} durante o Ticket ${ticket.protocol}.`,
        occurredAt: "-",
        operator: client.responsavel,
        status: isBoleto ? "Enviado" : "Registrado",
        unitCode: unit?.matricula,
        unitLabel: unit?.unidadeLote,
      });
      return;
    }

    onSaved(mode, {
      actionType: isPromise ? "Promessa WhatsApp" : "Acordo WhatsApp",
      id: `${client.id}-${mode}-whatsapp-${isPromise ? "promise" : "agreement"}`,
      protocol: ticket.protocol,
      type: isPromise ? "Promessa de pagamento" : "Acordo gerado",
      title: isPromise ? "Promessa criada pelo WhatsApp" : "Acordo criado pelo WhatsApp",
      description: isPromise
        ? `Origem: WhatsApp • Ticket ${ticket.protocol}. Promessa de ${promisedValue} para ${promisedDate}, unidade ${unit?.matricula ?? "-"}. Workflow sinalizado como Promessa realizada.`
        : `Origem: WhatsApp • Ticket ${ticket.protocol}. Acordo em negociação com valor negociado de ${agreementCalc.negotiatedValue}, entrada de ${entry} e ${installmentsCount} parcela(s). Workflow sinalizado como Em negociação.`,
      occurredAt: "-",
      operator: client.responsavel,
      status: isPromise ? "Prometido" : "Gerado",
      unitCode: unit?.matricula,
      unitLabel: unit?.unidadeLote,
    });
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-slate-950/25 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fechar operacao"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              WhatsApp operacional
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {isPromise ? "Registrar promessa" : isAgreement ? "Criar acordo" : isBoleto ? "Enviar boleto" : "Consultar parcelas"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{client.nome} · {client.dados360.telefone}</p>
            <p className="mt-1 text-xs font-semibold text-[#7A5E2C]">Origem: WhatsApp • Ticket {ticket.protocol}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar formulário"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <div className="grid gap-3 sm:grid-cols-2">
            <HadesWhatsAppReadonlyField label="Cliente" value={client.nome} />
            <HadesWhatsAppReadonlyField label="Telefone" value={client.dados360.telefone} />
            <label className="min-w-0 rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-3 py-2.5 sm:col-span-2">
              <span className="text-xs font-semibold text-[#7A5E2C]">Unidade relacionada à ação</span>
              <select
                value={unit?.id ?? ""}
                onChange={(event) => setUnitId(event.target.value)}
                className="mt-2 h-9 w-full rounded-lg border border-[#A07C3B]/20 bg-white px-3 text-sm font-semibold text-slate-700 outline-none"
              >
                {client.carteira.unidades.map((portfolioUnit) => (
                  <option key={portfolioUnit.id} value={portfolioUnit.id}>
                    {portfolioUnit.matricula} · {portfolioUnit.empreendimento} · {portfolioUnit.unidadeLote}
                  </option>
                ))}
              </select>
            </label>
            <HadesWhatsAppReadonlyField label="Empreendimento" value={unit?.empreendimento ?? client.carteira.empreendimento} />
            <HadesWhatsAppReadonlyField label="Cod. unidade" value={unit?.matricula ?? "-"} />
            <HadesWhatsAppReadonlyField label="Unidade/lote" value={unit?.unidadeLote ?? "-"} />
            <HadesWhatsAppReadonlyField label="Canal" value="WhatsApp" />
            <HadesWhatsAppReadonlyField label="Operador responsável" value={client.responsavel} />
            <HadesWhatsAppReadonlyField label="Ticket de origem" value={ticket.protocol} />
            <HadesWhatsAppReadonlyField label="Status inicial" value={isPromise ? "Promessa realizada" : isAgreement ? "Em negociação" : "Registrado"} />

            {isPromise ? (
              <>
                <HadesWhatsAppReadonlyField label="Parcelas relacionadas" value="-" />
                <HadesWhatsAppEditableField label="Valor prometido" value={promisedValue} onChange={setPromisedValue} />
                <HadesWhatsAppEditableField label="Data prometida" value={promisedDate} onChange={setPromisedDate} />
              </>
            ) : isAgreement ? (
              <>
                <HadesWhatsAppReadonlyField label="Parcelas incluídas" value="-" />
                <HadesWhatsAppEditableField label="Valor original" value={originalValue} onChange={setOriginalValue} />
                <HadesWhatsAppEditableField label="Desconto" value={discount} onChange={setDiscount} />
                <HadesWhatsAppReadonlyField label="Valor negociado" value={agreementCalc.negotiatedValue} />
                <HadesWhatsAppEditableField label="Entrada" value={entry} onChange={setEntry} />
                <HadesWhatsAppEditableField label="Vencimento da entrada" value={entryDueDate} onChange={setEntryDueDate} />
                <HadesWhatsAppEditableField label="Quantidade de parcelas" value={installmentsCount} onChange={setInstallmentsCount} />
                <HadesWhatsAppReadonlyField label="Valor das parcelas" value={agreementCalc.installmentValue} />
                <HadesWhatsAppEditableField label="Primeiro vencimento" value={firstDueDate} onChange={setFirstDueDate} />
                <HadesWhatsAppReadonlyField label="Saldo parcelado" value={agreementCalc.installmentBalance} />
                <HadesWhatsAppReadonlyField label="% de entrada" value={`${agreementCalc.entryRate}%`} />
                <HadesWhatsAppReadonlyField label="Recuperação estimada" value={`${agreementCalc.recoveryRate}%`} />
              </>
            ) : (
              <>
                <HadesWhatsAppReadonlyField label="Fonte financeira" value="C2X" />
                <HadesWhatsAppReadonlyField label="Ação do Hades" value={isBoleto ? "Enviar boleto original" : "Consultar boletos originais"} />
                <HadesWhatsAppReadonlyField label="Saldo em atraso" value={client.saldoDevedor} />
                <HadesWhatsAppReadonlyField label="Preparado para" value="visualizado, vencido, pago e reenvio" />
              </>
            )}
          </div>

          {isBoleto || mode === "installments" ? (
            <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Consulta C2X</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">Boletos originais vinculados à unidade</p>
                </div>
                <span className="w-fit rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  Hades não gera boletos
                </span>
              </div>

              <div className="mt-3 grid gap-2">
                {c2xBoletos.map((boleto) => {
                  const active = selectedBoleto?.id === boleto.id;

                  return (
                    <button
                      key={boleto.id}
                      type="button"
                      onClick={() => setSelectedBoletoId(boleto.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? "border-[#A07C3B]/30 bg-white shadow-sm"
                          : "border-slate-200/70 bg-white/70 hover:border-[#A07C3B]/20 hover:bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-950">Parcela {boleto.parcela}</p>
                        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                          {boleto.status}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <HadesWhatsAppReadonlyField label="Vencimento" value={boleto.vencimento} />
                        <HadesWhatsAppReadonlyField label="Valor" value={boleto.valor} />
                        <HadesWhatsAppReadonlyField label="Linha digitável" value={boleto.linhaDigitavel} />
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedBoleto ? (
                <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">Preview C2X</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">Boleto original • Parcela {selectedBoleto.parcela}</p>
                      <p className="mt-1 font-mono text-xs text-slate-500">{selectedBoleto.linhaDigitavel}</p>
                    </div>
                    <span className="rounded-md bg-[#A07C3B]/5 px-2 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                      C2X
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <label className="mt-4 block rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">Observação</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>
        </div>

        <footer className="border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={save}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35]"
          >
            {isPromise ? <CalendarCheck className="size-4" aria-hidden="true" /> : isAgreement ? <HandCoins className="size-4" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
            {isPromise ? "Salvar promessa" : isAgreement ? "Salvar acordo" : isBoleto ? "Enviar boleto" : "Registrar consulta"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
