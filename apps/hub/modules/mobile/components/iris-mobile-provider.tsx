"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  enrichTicketsWithCrm360,
  loadIrisData,
} from "@/modules/caredesk/data/iris-data-client";
import type {
  IrisMessage,
  IrisTicket,
} from "@/modules/caredesk/types/iris-types";
import { getMobileAccessToken } from "@/modules/mobile/lib/access-token";

type IrisMobileStatus = "error" | "loading" | "ready";

type IrisMobileContextValue = {
  appendMessage: (ticketId: string, message: IrisMessage) => void;
  error: string | null;
  refresh: () => void;
  status: IrisMobileStatus;
  tickets: IrisTicket[];
};

const IrisMobileContext = createContext<IrisMobileContextValue | null>(null);

/**
 * Carrega os atendimentos do Iris UMA vez para a sessao mobile (loadIrisData ja
 * traz cada ticket com suas mensagens embutidas), evitando recarga dupla entre
 * a lista e a conversa. Reaproveita o data-client de producao do caredesk.
 */
export function IrisMobileProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets] = useState<IrisTicket[]>([]);
  const [status, setStatus] = useState<IrisMobileStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current;

    setStatus((current) => (current === "ready" ? current : "loading"));
    setError(null);

    loadIrisData({})
      .then((data) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        // Mostra a lista já; o perfil/adimplência (crm360) preenche em seguida.
        setTickets(data.tickets);
        setStatus("ready");

        void enrichTicketsWithCrm360(data, {
          getAccessToken: async () => {
            try {
              return await getMobileAccessToken();
            } catch {
              return null;
            }
          },
        })
          .then((enriched) => {
            if (requestId === requestIdRef.current) {
              setTickets(enriched.tickets);
            }
          })
          .catch(() => undefined);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError("Nao foi possivel carregar os atendimentos.");
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const appendMessage = useCallback(
    (ticketId: string, message: IrisMessage) => {
      setTickets((current) =>
        current.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                lastMessageAt: message.createdAt,
                lastMessagePreview: message.body,
                messages: [
                  ...ticket.messages.filter((item) => item.id !== message.id),
                  message,
                ],
              }
            : ticket,
        ),
      );
    },
    [],
  );

  const value = useMemo<IrisMobileContextValue>(
    () => ({ appendMessage, error, refresh, status, tickets }),
    [appendMessage, error, refresh, status, tickets],
  );

  return (
    <IrisMobileContext.Provider value={value}>
      {children}
    </IrisMobileContext.Provider>
  );
}

export function useIrisMobile() {
  const context = useContext(IrisMobileContext);

  if (!context) {
    throw new Error("useIrisMobile deve ser usado dentro de IrisMobileProvider.");
  }

  return context;
}
