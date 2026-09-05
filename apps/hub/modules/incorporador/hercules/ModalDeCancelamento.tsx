"use client";

import { useEffect, useState } from "react";

import {
  conferirCancelamentoDaProposta,
  MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA,
} from "@/lib/hercules/proposta";
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

/**
 * O que esta modal cancela.
 *
 * ⚠️ MESMA MODAL, DOIS ATOS — e a diferença está só nos dados, não no desenho. Duplicar as 300
 * linhas para trocar a rota e a lista de motivos criaria duas telas que precisam ser corrigidas
 * juntas para sempre, e a segunda é a que fica para trás.
 *
 * ⚠️ OS MOTIVOS NÃO SÃO OS MESMOS: quem cancela proposta já mandou condições ao cliente, e por isso
 * a lista dela tem "Condições não aceitas" e "Cliente pediu outro plano" — recusas que na reserva
 * ainda não existiam.
 */
const ALVOS = {
  proposta: {
    aviso: "A unidade volta para a disponibilidade na hora, e o PDF que já foi enviado deixa de valer.",
    conferir: conferirCancelamentoDaProposta,
    feito: "Proposta",
    motivos: MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA as readonly string[],
    rota: "/api/incorporador/venda/proposta",
    titulo: "Cancelar a proposta de",
    verbo: "Cancelar proposta",
  },
  reserva: {
    aviso: "A unidade volta para a disponibilidade na hora e pode ser reservada por outra pessoa.",
    conferir: conferirCancelamento,
    feito: "Reserva",
    motivos: MOTIVOS_DE_CANCELAMENTO as readonly string[],
    rota: "/api/incorporador/venda/reserva",
    titulo: "Cancelar a reserva de",
    verbo: "Cancelar reserva",
  },
} as const;

export function ModalDeCancelamento({
  alvo = "reserva",
  onCancelada,
  onFechar,
  propostaId,
  unidade,
}: {
  /** `reserva` (o padrão, que já estava no ar) ou `proposta`. */
  alvo?: "proposta" | "reserva";
  onCancelada: (mensagem: string) => void;
  onFechar: () => void;
  /**
   * A proposta que ESTA tela está mostrando. Vai no corpo para o servidor conferir.
   *
   * ⚠️ SEM ELE, UMA ABA VELHA CANCELA A PROPOSTA DE OUTRO CLIENTE — a busca do servidor é por
   * unidade, e a unidade pode ter ganhado outra proposta desde que esta tela carregou. Só faz
   * sentido no alvo `proposta`; a reserva se endereça pela unidade como sempre.
   */
  propostaId?: null | string;
  unidade: { id: string; nome: string; produto: string };
}) {
  const oQue = ALVOS[alvo];
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

  const pedido = {
    detalhe,
    motivo,
    ...(alvo === "proposta" && propostaId ? { propostaId } : {}),
    unidadeId: unidade.id,
  };
  const erros = oQue.conferir(pedido);
  const erroDe = (campo: "detalhe" | "motivo") =>
    tentou ? (erros.find((e) => e.campo === campo)?.mensagem ?? null) : null;

  async function cancelar() {
    setTentou(true);
    setErroDoServidor(null);
    if (erros.length > 0) return;

    setEnviando(true);
    try {
      const r = await fetch(oQue.rota, {
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
        `${cod}${oQue.feito} de ${unidade.nome} cancelada. A unidade voltou para a disponibilidade. ${comoFoiOAviso(
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
            <b style={{ fontSize: 14 }}>
              {oQue.titulo} {unidade.nome}
            </b>
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
            {/* ⚠️ O `{" "}` SEGURA O ESPAÇO ENTRE AS DUAS FRASES. Enquanto isto era um texto só em
                duas linhas, o compilador juntava as linhas com um espaço; virando expressão + texto,
                ele remove a quebra inteira e não repõe nada — e o parágrafo saía "…por outra
                pessoa.Corretor, imobiliária e…", colado, na modal de reserva que já está no ar. */}
            {oQue.aviso}{" "}
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
              {oQue.motivos.map((m) => {
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
            {enviando ? "Cancelando…" : oQue.verbo}
          </button>
        </div>
      </div>
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return <p style={{ color: T.danger, fontSize: 11.5, margin: "5px 0 0" }}>{texto}</p>;
}
