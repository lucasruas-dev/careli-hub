"use client";

import { useEffect } from "react";

import { T } from "../tema";

// CONFIRMAR O ENVIO PARA CONTRATO.
//
// Lucas (05/09/2026): *"tem que ter um botão para confirmar o envio para contrato; podemos mostrar
// a proposta para ele e ele confirmar o envio, pois senão pode clicar errado e dar problema"*.
//
// ⚠️ EU TINHA DECIDIDO O CONTRÁRIO, E ESTAVA ERRADO. O primeiro desenho mandava direto — "é o
// coordenador dizendo que o cliente aceitou, não há o que perguntar". Só que o botão fica no meio
// de outros três, do mesmo tamanho, e o que ele dispara não volta: a venda muda de etapa, um
// trabalho entra na fila do jurídico e o "Gerar proposta" apaga. Confirmação não é cerimônia quando
// o clique é irreversível.
//
// ⚠️ E ELA MOSTRA A PROPOSTA, não uma pergunta genérica. "Tem certeza?" não ajuda ninguém a
// perceber que clicou no lote errado; ver o COD, o cliente, o lote e o valor é o que faz alguém
// dizer "não era essa". É a mesma razão pela qual o cancelamento pergunta o motivo em vez de só
// confirmar.

export function ModalDeContrato({
  aoConfirmar,
  aoFechar,
  enviando,
  proposta,
}: {
  aoConfirmar: () => void;
  aoFechar: () => void;
  /** Enquanto o POST está no ar: o botão vira "Enviando…" e a janela não fecha. */
  enviando: boolean;
  proposta: {
    cliente: null | string;
    codigo: null | string;
    imobiliaria: null | string;
    plano: null | string;
    produto: string;
    unidade: string;
    valor: null | number;
  };
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      // ⚠️ ENQUANTO ENVIA, O ESC NÃO FECHA — a mesma regra da modal de proposta. Fechar não cancela
      // o POST: o trabalho abre na Têmis e a venda anda, mas o recado morre junto com a tela e o
      // coordenador clica de novo por cima de uma etapa que não aceita ser movida duas vezes.
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

  const linha = (rotulo: string, valor: null | string) => (
    <div
      style={{
        borderBottom: `1px dashed ${T.border}`,
        display: "flex",
        gap: 12,
        justifyContent: "space-between",
        padding: "7px 0",
      }}
    >
      <span style={{ color: T.muted, fontSize: 12 }}>{rotulo}</span>
      <b style={{ fontSize: 12.5, textAlign: "right" }}>{valor || "—"}</b>
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
          maxHeight: "min(92vh, 640px)",
          overflow: "hidden",
          width: "min(94vw, 480px)",
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
            <b style={{ fontSize: 14 }}>Enviar para contrato</b>
            <div style={{ color: T.muted, fontSize: 11.5 }}>{proposta.produto}</div>
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
            A proposta vai para a Têmis, que faz o contrato. A venda avança para a fase de contrato
            e deixa de aceitar nova proposta.
          </p>

          <section
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: "6px 12px 10px",
            }}
          >
            {linha("Unidade", proposta.unidade)}
            {linha("COD", proposta.codigo)}
            {linha("Cliente", proposta.cliente)}
            {linha("Imobiliária", proposta.imobiliaria)}
            {linha("Plano", proposta.plano)}
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "space-between",
                paddingTop: 9,
              }}
            >
              <span style={{ color: T.muted, fontSize: 12 }}>Valor negociado</span>
              <b style={{ fontSize: 14 }}>
                {proposta.valor
                  ? `R$ ${proposta.valor.toLocaleString("pt-BR", {
                      maximumFractionDigits: 2,
                      minimumFractionDigits: 2,
                    })}`
                  : "—"}
              </b>
            </div>
          </section>
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
          {enviando ? (
            <span style={{ color: T.muted, fontSize: 11.5, marginRight: "auto" }}>
              Não feche esta janela.
            </span>
          ) : null}
          <button
            disabled={enviando}
            onClick={aoConfirmar}
            style={{
              background: enviando ? T.soft : T.okBg,
              border: `1px solid ${enviando ? T.border : T.ok}`,
              borderRadius: 9,
              color: enviando ? T.muted : T.ok,
              cursor: enviando ? "default" : "pointer",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 16px",
            }}
            type="button"
          >
            {/* ⚠️ SÓ `enviando` MANDA NO RÓTULO. Um "já cliquei" local deixaria o botão preso em
                "Enviando…" quando o POST falhasse — e a pessoa sem como tentar de novo. */}
            {enviando ? "Enviando…" : "Confirmar e enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
