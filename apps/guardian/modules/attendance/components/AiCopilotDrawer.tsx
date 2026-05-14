"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Send, Sparkles, X } from "lucide-react";
import type { QueueClient } from "@/modules/attendance/types";

type ChatMessage = {
  id: string;
  role: "ai" | "user";
  content: string;
};

type AiCopilotDrawerProps = {
  client: QueueClient;
};

export function AiCopilotDrawer({ client }: AiCopilotDrawerProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const intelligence = useMemo(() => buildClientIntelligence(client), [client]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: `initial-${client.id}`,
      role: "ai",
      content: intelligence.initialMessage,
    },
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMessages([
        {
          id: `initial-${client.id}`,
          role: "ai",
          content: intelligence.initialMessage,
        },
      ]);
      setInputValue("");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [client.id, intelligence.initialMessage]);

  useEffect(() => {
    if (!open) {
      return;
    }

    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, open]);

  function addAssistantMessage(content: string) {
    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        role: "ai",
        content,
      },
    ]);
  }

  function sendMockQuestion() {
    const question = inputValue.trim();

    if (!question) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-user`,
        role: "user",
        content: question,
      },
      {
        id: `${Date.now()}-ai`,
        role: "ai",
        content: `Recebi sua pergunta sobre ${client.nome}. Nesta versão mockada, posso apoiar com resumo, próxima ação, mensagem de WhatsApp, risco de quebra ou composição de acordo pelas sugestões rápidas.`,
      },
    ]);
    setInputValue("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir Assistente Guardian"
        className="fixed right-5 top-1/2 z-50 flex size-12 -translate-y-1/2 items-center justify-center rounded-2xl border border-[#A07C3B]/20 bg-white text-[#A07C3B] shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-[calc(50%+2px)] hover:bg-[#A07C3B]/5"
      >
        <Brain className="size-5" aria-hidden="true" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Fechar Assistente Guardian"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]"
          />

          <aside className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <header className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                    <Brain className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">Assistente Guardian</h2>
                    <p className="mt-1 text-sm text-slate-500">Copiloto de cobrança inteligente</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar painel"
                  className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {intelligence.summaryCards.map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2.5"
                  >
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex items-start gap-3 ${
                      message.role === "user" ? "justify-end" : ""
                    }`}
                  >
                    {message.role === "ai" ? (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                        <Sparkles className="size-4" aria-hidden="true" />
                      </div>
                    ) : null}

                    <div
                      className={`max-w-[315px] rounded-2xl px-4 py-3 ${
                        message.role === "user"
                          ? "rounded-tr-sm bg-[#A07C3B] text-white"
                          : "rounded-tl-sm border border-slate-200/70 bg-slate-50/80 text-slate-700"
                      }`}
                    >
                      <p className="text-sm leading-6">{message.content}</p>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-normal text-slate-400">
                  Sugestões rápidas
                </p>
                <div className="flex flex-wrap gap-2">
                  {intelligence.quickSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.label}
                      type="button"
                      onClick={() => addAssistantMessage(suggestion.response)}
                      className="rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 p-4">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      sendMockQuestion();
                    }
                  }}
                  placeholder="Pergunte ao Assistente Guardian"
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  aria-label="Enviar pergunta"
                  onClick={sendMockQuestion}
                  className="flex size-9 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8f6e33]"
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function buildClientIntelligence(client: QueueClient) {
  const risk = getRiskDescriptor(client.prioridade);
  const unitsCount = client.carteira.unidades.length;
  const mainEnterprise = client.carteira.unidades[0]?.empreendimento ?? client.carteira.empreendimento;
  const nextAction = getNextAction(client.prioridade);
  const approach = getRecommendedApproach(client.prioridade);
  const agreement = client.agreement;

  return {
    initialMessage: `Analisei ${client.nome} e identifiquei risco ${risk.label} por ${client.parcelas.vencidas} parcelas vencidas, atraso médio de ${client.atrasoDias} dias e saldo em atraso de ${client.saldoDevedor}. O acordo está ${agreement.status.toLowerCase()}, com ${agreement.aiSuggestion.breakChance}% de chance de quebra; recomendo ${approach.toLowerCase()}.`,
    summaryCards: [
      ["Risco", risk.card],
      ["Score de risco", `${client.scoreRisco}/100`],
      ["Parcelas vencidas", `${client.parcelas.vencidas}`],
      ["Atraso médio", `${client.atrasoDias} dias`],
      ["Saldo em atraso", client.saldoDevedor],
      ["Workflow", client.workflow.stage],
      ["Acordo", agreement.status],
      ["Chance de quebra", `${agreement.aiSuggestion.breakChance}%`],
      ["Próxima ação", nextAction],
    ],
    quickSuggestions: [
      {
        label: "Resumir cliente",
        response: `Resumo do cliente: ${client.nome} é ${client.dados360.tipoPessoa}, ${client.dados360.profissao}, ${client.dados360.idade}, residente em ${client.dados360.cidade}. Possui ${unitsCount} unidade${unitsCount > 1 ? "s" : ""}/lote${unitsCount > 1 ? "s" : ""} vinculada${unitsCount > 1 ? "s" : ""}, ${client.parcelas.vencidas} parcelas vencidas e saldo em atraso de ${client.saldoDevedor}.`,
      },
      {
        label: "Sugerir próxima ação",
        response: `Próxima ação sugerida: ${client.workflow.nextAction.toLowerCase()}, alinhada à etapa ${client.workflow.stage} e reforçando a possibilidade de regularização sem escalonamento jurídico imediato.`,
      },
      {
        label: "Criar mensagem WhatsApp",
        response: `Mensagem sugerida: Olá, ${getFirstName(client.nome)}. Tudo bem? Identificamos pendências vinculadas ao seu lote no empreendimento ${mainEnterprise} e queremos te ajudar a regularizar da melhor forma possível. Podemos avaliar uma condição de pagamento mais adequada para este momento?`,
      },
      {
        label: "Propor acordo",
        response: `Proposta sugerida: ${agreement.aiSuggestion.composition} Chance prevista de quebra: ${agreement.aiSuggestion.breakChance}%. Próxima ação: ${agreement.aiSuggestion.nextAction}.`,
      },
      {
        label: "Risco do acordo",
        response: `Risco operacional do acordo: ${agreement.aiSuggestion.operationalRisk}. Status atual: ${agreement.status}. Valor negociado: ${agreement.negotiatedValue}, entrada: ${agreement.entry}, recuperação atual: ${agreement.recoveredValue}.`,
      },
    ],
  };
}

function getRiskDescriptor(priority: QueueClient["prioridade"]) {
  const map = {
    Crítica: { label: "crítico", card: "Crítico", entryPercent: 20 },
    Alta: { label: "alto", card: "Alto", entryPercent: 20 },
    Média: { label: "moderado", card: "Moderado", entryPercent: 25 },
    Baixa: { label: "baixo", card: "Baixo", entryPercent: 30 },
  };

  return map[priority];
}

function getNextAction(priority: QueueClient["prioridade"]) {
  const map = {
    Crítica: "Contato executivo via WhatsApp e ligação no mesmo dia",
    Alta: "WhatsApp consultivo com proposta de entrada reduzida",
    Média: "WhatsApp consultivo e lembrete de regularização",
    Baixa: "Lembrete preventivo por WhatsApp",
  };

  return map[priority];
}

function getRecommendedApproach(priority: QueueClient["prioridade"]) {
  const map = {
    Crítica: "contato humanizado com urgência operacional e alternativa flexível de acordo",
    Alta: "contato humanizado e proposta de regularização com entrada reduzida",
    Média: "abordagem consultiva com reforço de regularização amigável",
    Baixa: "abordagem preventiva, objetiva e sem tom de escalonamento",
  };

  return map[priority];
}

function getFirstName(name: string) {
  return name.split(" ")[0] ?? name;
}
