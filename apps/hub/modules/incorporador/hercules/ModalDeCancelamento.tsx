"use client";

import { useEffect, useState } from "react";

import {
  comoFoiOAviso,
  conferirCancelamento,
  MOTIVOS_DE_CANCELAMENTO,
} from "@/lib/hercules/reserva";

import { T } from "../tema";

// O CANCELAMENTO DA RESERVA.
//
// Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar, tem que
// habilitar esses dois botões quando está na etapa de reserva"*.
//
// ⚠️ NENHUM BOTÃO DAQUI SE CHAMA "CANCELAR". A tela inteira fala de cancelar uma reserva, e um
// botão "Cancelar" ao lado de "Cancelar reserva" significaria as duas coisas opostas na mesma
// linha. Quem desiste do cancelamento clica em *Voltar*.
//
// ⚠️ O MOTIVO É PERGUNTA DE UMA VEZ SÓ. Depois do clique a reserva já era, e "por que caiu" vira
// uma ligação para o coordenador — se ele lembrar. Por isso a lista aparece antes do botão, e não
// como um campo opcional escondido.

export function ModalDeCancelamento({
  onCancelada,
  onFechar,
  unidade,
}: {
  onCancelada: (mensagem: string) => void;
  onFechar: () => void;
  unidade: { id: string; nome: string; produto: string };
}) {
  const [motivo, setMotivo] = useState<string>("");
  const [detalhe, setDetalhe] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState<null | string>(null);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [onFechar]);

  const pedido = { detalhe, motivo, unidadeId: unidade.id };
  const erros = conferirCancelamento(pedido);
  const erroDe = (campo: "detalhe" | "motivo") =>
    tentou ? (erros.find((e) => e.campo === campo)?.mensagem ?? null) : null;

  async function cancelar() {
    setTentou(true);
    setErroDoServidor(null);
    if (erros.length > 0) return;

    setEnviando(true);
    try {
      const r = await fetch("/api/incorporador/venda/reserva", {
        body: JSON.stringify(pedido),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      const texto = await r.text();
      const corpo = texto
        ? (JSON.parse(texto) as {
            data?: {
              avisos: Array<{ motivo?: string; ok: boolean; para: string }>;
              codigo?: string;
            };
            erros?: Array<{ mensagem: string }>;
            error?: string;
          })
        : {};

      if (!r.ok) {
        setErroDoServidor(
          corpo.error ??
            corpo.erros?.map((e) => e.mensagem).join(" ") ??
            "Não foi possível cancelar.",
        );
        return;
      }

      const cod = corpo.data?.codigo ? `${corpo.data.codigo} · ` : "";
      onCancelada(
        `${cod}Reserva de ${unidade.nome} cancelada. A unidade voltou para a disponibilidade. ${comoFoiOAviso(
          corpo.data?.avisos ?? [],
        )}`,
      );
    } catch {
      setErroDoServidor("Não foi possível cancelar agora.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      style={{
        background: "rgb(0 0 0 / .55)",
        display: "grid",
        inset: 0,
        padding: 24,
        placeItems: "center",
        position: "fixed",
        zIndex: 70,
      }}
    >
      <div
        style={{
          background: T.page,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          color: T.text,
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(92vh, 720px)",
          overflow: "hidden",
          width: "min(94vw, 520px)",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            justifyContent: "space-between",
            padding: "12px 16px",
          }}
        >
          <div>
            <b style={{ fontSize: 14 }}>Cancelar a reserva de {unidade.nome}</b>
            <div style={{ color: T.muted, fontSize: 11.5 }}>{unidade.produto}</div>
          </div>
          <button
            onClick={onFechar}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              color: T.sub,
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              padding: "5px 12px",
            }}
            type="button"
          >
            Voltar
          </button>
        </div>

        <div style={{ display: "grid", gap: 14, overflow: "auto", padding: 16 }}>
          <p
            style={{
              background: T.soft,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              color: T.sub,
              fontSize: 12.5,
              lineHeight: 1.5,
              margin: 0,
              padding: "10px 12px",
            }}
          >
            A unidade volta para a disponibilidade na hora e pode ser reservada por outra pessoa.
            Corretor, imobiliária e coordenador recebem o aviso com o motivo.
          </p>

          <section
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div
              style={{
                color: T.muted,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".06em",
                marginBottom: 8,
                textTransform: "uppercase",
              }}
            >
              Por que está cancelando
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MOTIVOS_DE_CANCELAMENTO.map((m) => {
                const escolhido = m === motivo;
                return (
                  <button
                    key={m}
                    onClick={() => setMotivo(m)}
                    style={{
                      background: escolhido ? T.btnBg : "transparent",
                      border: `1px solid ${escolhido ? T.btnBg : T.border}`,
                      borderRadius: 999,
                      color: escolhido ? T.btnFg : T.sub,
                      cursor: "pointer",
                      font: "inherit",
                      fontSize: 12.5,
                      fontWeight: escolhido ? 650 : 500,
                      padding: "7px 13px",
                    }}
                    type="button"
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            {erroDe("motivo") ? <Erro texto={erroDe("motivo")!} /> : null}

            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="detalhe-do-cancelamento"
                style={{ color: T.muted, display: "block", fontSize: 11.5, marginBottom: 5 }}
              >
                {motivo === "Outro" ? "Escreva o motivo" : "Detalhe (opcional)"}
              </label>
              <textarea
                id="detalhe-do-cancelamento"
                maxLength={300}
                onChange={(e) => setDetalhe(e.target.value)}
                placeholder="O que aconteceu, para quem ler daqui a três meses entender."
                rows={3}
                style={{
                  background: T.soft,
                  border: `1px solid ${erroDe("detalhe") ? T.danger : T.border}`,
                  borderRadius: 8,
                  color: T.text,
                  font: "inherit",
                  fontSize: 13,
                  lineHeight: 1.45,
                  padding: "8px 10px",
                  resize: "vertical",
                  width: "100%",
                }}
                value={detalhe}
              />
              {erroDe("detalhe") ? <Erro texto={erroDe("detalhe")!} /> : null}
              <p style={{ color: T.muted, fontSize: 11, margin: "6px 0 0" }}>
                O motivo vai na mensagem do WhatsApp e fica no histórico da unidade.
              </p>
            </div>
          </section>

          {erroDoServidor ? <Erro texto={erroDoServidor} /> : null}
        </div>

        <div
          style={{
            alignItems: "center",
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            padding: "12px 16px",
          }}
        >
          <button
            disabled={enviando}
            onClick={cancelar}
            style={{
              background: enviando ? T.soft : T.danger,
              border: "none",
              borderRadius: 9,
              color: enviando ? T.muted : "#fff",
              cursor: enviando ? "default" : "pointer",
              font: "inherit",
              fontSize: 13,
              fontWeight: 650,
              padding: "9px 20px",
              whiteSpace: "nowrap",
            }}
            type="button"
          >
            {enviando ? "Cancelando…" : "Cancelar reserva"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return <p style={{ color: T.danger, fontSize: 11.5, margin: "5px 0 0" }}>{texto}</p>;
}
