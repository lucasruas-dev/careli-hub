"use client";

import { useEffect, useState } from "react";

import { classificarCancelamento } from "@/lib/temis/cancelamento";

import { T } from "../tema";

// PEDIR O CANCELAMENTO DE UMA VENDA QUE JÁ FOI PARA CONTRATO.
//
// ⚠️ NÃO É O MESMO BOTÃO DO CANCELAMENTO DA RESERVA E DA PROPOSTA, e é por isso que ele tem rótulo,
// modal e rota próprios. Lá o coordenador desfaz e o lote volta ao estoque na hora. Aqui quem
// desfaz é o jurídico, o instrumento depende de fatos do contrato, e a venda CONTINUA em contrato
// até a decisão sair. Um botão só para as duas coisas é o botão que alguém clica errado.
//
// ⚠️ AS DUAS PERGUNTAS SÃO O CORAÇÃO DISTO. Quem abre não escolhe entre "cancelamento" e
// "distrato": `classificarCancelamento` decide, e ela decide por fato — assinou? pagou? —, não por
// opinião. É a regra do Lucas (02/09/2026): *"o sistema vai ter que identificar se aquele
// cancelamento vai precisar de um distrato ou não"*. Um atendente escolhendo o tipo acertaria na
// maioria e erraria no caso raro, que é justamente o que tem dinheiro do cliente no meio.
//
// ⚠️ E A CLASSIFICAÇÃO APARECE ANTES DE CONFIRMAR. Ela muda enquanto ele responde: é assim que
// alguém percebe que marcou errado, olhando "distrato com devolução" numa venda que ele sabe que
// ninguém pagou.

type Resposta = "nao" | "sim" | null;

export function ModalDePedidoDeCancelamento({
  aoConfirmar,
  aoFechar,
  enviando,
  venda,
}: {
  aoConfirmar: (dados: {
    assinaturaCompleta: boolean;
    houvePagamento: boolean;
    motivo: string;
  }) => void;
  aoFechar: () => void;
  enviando: boolean;
  venda: { cliente: null | string; codigo: null | string; unidade: string };
}) {
  const [assinou, setAssinou] = useState<Resposta>(null);
  const [pagou, setPagou] = useState<Resposta>(null);
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [aoFechar, enviando]);

  const respondeu = assinou !== null && pagou !== null;
  const classificacao = respondeu
    ? classificarCancelamento({
        assinaturaCompleta: assinou === "sim",
        houvePagamento: pagou === "sim",
      })
    : null;
  const faltaMotivo = motivo.trim().length < 3;

  const pergunta = (
    rotulo: string,
    valor: Resposta,
    definir: (v: Resposta) => void,
    ajuda: string,
  ) => (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 10, justifyContent: "space-between" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rotulo}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {(["sim", "nao"] as const).map((opcao) => (
            <button
              disabled={enviando}
              key={opcao}
              onClick={() => definir(opcao)}
              style={{
                background: valor === opcao ? T.text : "transparent",
                border: `1px solid ${valor === opcao ? T.text : T.border}`,
                borderRadius: 8,
                color: valor === opcao ? T.page : T.sub,
                cursor: enviando ? "default" : "pointer",
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                minWidth: 52,
                padding: "5px 12px",
              }}
              type="button"
            >
              {opcao === "sim" ? "Sim" : "Não"}
            </button>
          ))}
        </div>
      </div>
      <span style={{ color: T.muted, fontSize: 11 }}>{ajuda}</span>
    </div>
  );

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
          maxHeight: "min(92vh, 660px)",
          overflow: "hidden",
          width: "min(94vw, 500px)",
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
            <b style={{ fontSize: 14 }}>Solicitar cancelamento</b>
            <div style={{ color: T.muted, fontSize: 11.5 }}>
              {[venda.codigo, venda.unidade, venda.cliente].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button
            disabled={enviando}
            onClick={aoFechar}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              color: T.sub,
              cursor: enviando ? "default" : "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              opacity: enviando ? 0.5 : 1,
              padding: "5px 12px",
            }}
            type="button"
          >
            Voltar
          </button>
        </div>

        <div style={{ display: "grid", gap: 12, overflow: "auto", padding: 16 }}>
          {/* ⚠️ UMA LINHA, E NÃO TRÊS PARÁGRAFOS. O que muda conforme a resposta é a classificação
              lá embaixo; repetir a mesma explicação em blocos empilhados é a poluição que o Lucas
              já reprovou na modal de proposta. */}
          <p style={{ color: T.sub, fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
            Isto abre um pedido na Têmis. O jurídico decide o instrumento e os valores; a venda
            continua em contrato até lá.
          </p>

          <section
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              display: "grid",
              gap: 12,
              padding: "12px 14px",
            }}
          >
            {pergunta(
              "Todas as assinaturas foram colhidas?",
              assinou,
              setAssinou,
              "Contrato com assinatura parcial conta como NÃO assinado.",
            )}
            {pergunta(
              "Houve algum pagamento?",
              pagou,
              setPagou,
              "Ato, sinal ou parcela — qualquer valor pago pelo cliente.",
            )}
          </section>

          {/* A classificação, viva. É ela que faz alguém perceber que marcou errado. */}
          {classificacao ? (
            <div
              style={{
                // ⚠️ SÓ A DEVOLUÇÃO GANHA COR. Ela é a diferença que mexe em dinheiro do cliente;
                // pintar os dois casos faria a cor parar de significar alguma coisa.
                background: classificacao.devolveValores ? T.dangerBg : T.soft,
                border: `1px solid ${classificacao.devolveValores ? T.danger : T.border}`,
                borderRadius: 10,
                display: "grid",
                gap: 3,
                padding: "10px 12px",
              }}
            >
              <b style={{ fontSize: 12.5 }}>
                {classificacao.tipo === "distrato" ? "Vai como DISTRATO" : "Vai como CANCELAMENTO"}
                {classificacao.devolveValores ? ", com devolução de valores" : ""}
              </b>
              <span style={{ color: T.sub, fontSize: 11.5, lineHeight: 1.45 }}>
                {classificacao.porque}
              </span>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 5 }}>
            <span style={{ color: T.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }}>
              MOTIVO
            </span>
            <textarea
              disabled={enviando}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por que este contrato está sendo cancelado?"
              rows={3}
              style={{
                background: T.page,
                border: `1px solid ${tentou && faltaMotivo ? T.danger : T.border}`,
                borderRadius: 9,
                color: T.text,
                font: "inherit",
                fontSize: 12.5,
                padding: "8px 10px",
                resize: "vertical",
              }}
              value={motivo}
            />
            {tentou && faltaMotivo ? (
              <span style={{ color: T.danger, fontSize: 11.5 }}>
                Diga o motivo: é o que o jurídico lê no card.
              </span>
            ) : null}
            {tentou && !respondeu ? (
              <span style={{ color: T.danger, fontSize: 11.5 }}>
                Responda as duas perguntas sobre o contrato.
              </span>
            ) : null}
          </div>
        </div>

        <div
          style={{
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "12px 16px",
          }}
        >
          <button
            disabled={enviando}
            onClick={() => {
              setTentou(true);
              if (!respondeu || faltaMotivo) return;
              aoConfirmar({
                assinaturaCompleta: assinou === "sim",
                houvePagamento: pagou === "sim",
                motivo: motivo.trim(),
              });
            }}
            style={{
              background: enviando ? T.soft : T.dangerBg,
              border: `1px solid ${enviando ? T.border : T.danger}`,
              borderRadius: 9,
              color: enviando ? T.muted : T.danger,
              cursor: enviando ? "default" : "pointer",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 16px",
            }}
            type="button"
          >
            {enviando ? "Abrindo…" : "Abrir pedido na Têmis"}
          </button>
        </div>
      </div>
    </div>
  );
}
