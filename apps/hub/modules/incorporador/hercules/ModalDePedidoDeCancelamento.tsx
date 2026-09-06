"use client";

import { useEffect, useState } from "react";

import { T } from "../tema";

// PEDIR O CANCELAMENTO DE UMA VENDA QUE JÁ FOI PARA CONTRATO.
//
// ⚠️ NÃO É O MESMO BOTÃO DO CANCELAMENTO DA RESERVA E DA PROPOSTA, e é por isso que ele tem rótulo,
// modal e rota próprios. Lá o coordenador desfaz e o lote volta ao estoque na hora. Aqui quem
// desfaz é o jurídico, o instrumento depende de fatos do contrato, e a venda CONTINUA em contrato
// até a decisão sair. Um botão só para as duas coisas é o botão que alguém clica errado.
//
// ⚠️ E A TELA NÃO PERGUNTA NADA. A primeira versão fazia duas perguntas — assinou? pagou? — e o
// Lucas reprovou na hora (06/09/2026): *"essas informações do cancelamento de contrato é o sistema
// que tem que saber e dar opção com base nisso, não é o usuário que faz"*. Ele está certo: os dois
// fatos estão gravados (eventos de assinatura e de pagamento da proposta, mais as datas dela), e
// "zero eventos" numa venda que nasceu aqui não é ignorância — é resposta. A modal agora ABRE
// mostrando o que o sistema apurou e a classificação que sai daí; o coordenador lê e confirma.
//
// ⚠️ O AJUSTE EXISTE, ESCONDIDO, PORQUE UM CASO ESCAPA. Pagamento por fora do sistema — PIX na mão
// do corretor — não deixa rastro nenhum aqui, e classificar como cancelamento simples um caso com
// dinheiro do cliente é o erro caro deste fluxo. Quem ajusta assume: o card da Têmis diz em letras
// claras que a classificação foi corrigida à mão, e mostra ao lado o que o sistema tinha apurado.

type Apuracao = {
  assinaturaCompleta: boolean;
  comoSoube: { assinatura: string; pagamento: string };
  devolveValores: boolean;
  houvePagamento: boolean;
  porque: string;
  tipo: "cancelamento" | "distrato";
};

export function ModalDePedidoDeCancelamento({
  aoConfirmar,
  aoFechar,
  enviando,
  venda,
}: {
  aoConfirmar: (dados: {
    ajuste: null | { assinaturaCompleta: boolean; houvePagamento: boolean };
    motivo: string;
  }) => void;
  aoFechar: () => void;
  enviando: boolean;
  venda: { cliente: null | string; codigo: null | string; unidade: string; unidadeId: string };
}) {
  const [apuracao, setApuracao] = useState<null | Apuracao>(null);
  const [erroDaApuracao, setErroDaApuracao] = useState<null | string>(null);
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);
  /** O ajuste só aparece quando alguém diz que a apuração não bate. */
  const [ajustando, setAjustando] = useState(false);
  const [assinou, setAssinou] = useState(false);
  const [pagou, setPagou] = useState(false);

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

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(
          `/api/incorporador/venda/cancelamento-de-contrato?unidade=${encodeURIComponent(
            venda.unidadeId,
          )}`,
          { cache: "no-store" },
        );
        const j = (await r.json().catch(() => null)) as null | {
          data?: Apuracao;
          error?: string;
        };
        if (!vivo) return;
        if (!r.ok || !j?.data) {
          // ⚠️ SEM APURAÇÃO NÃO HÁ PEDIDO. Deixar seguir com a classificação em branco abriria um
          // card sem instrumento definido — e o jurídico redigiria no escuro.
          setErroDaApuracao(j?.error ?? "Não foi possível apurar a situação deste contrato.");
          return;
        }
        setApuracao(j.data);
        setAssinou(j.data.assinaturaCompleta);
        setPagou(j.data.houvePagamento);
      } catch {
        if (vivo) setErroDaApuracao("Não foi possível apurar a situação deste contrato.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [venda.unidadeId]);

  const faltaMotivo = motivo.trim().length < 3;
  const mudouAApuracao =
    apuracao !== null &&
    (assinou !== apuracao.assinaturaCompleta || pagou !== apuracao.houvePagamento);
  // Com ajuste, a classificação da tela acompanha o que foi corrigido — a mesma régua do servidor.
  const vaiComoDistrato = mudouAApuracao ? pagou || assinou : apuracao?.tipo === "distrato";
  const vaiDevolver = mudouAApuracao ? pagou : Boolean(apuracao?.devolveValores);

  const encontrado = (rotulo: string, frase: string, positivo: boolean) => (
    <div style={{ alignItems: "baseline", display: "flex", gap: 8, justifyContent: "space-between" }}>
      <span style={{ color: T.muted, fontSize: 12 }}>{rotulo}</span>
      <b style={{ color: positivo ? T.text : T.sub, fontSize: 12.5, textAlign: "right" }}>{frase}</b>
    </div>
  );

  const chave = (rotulo: string, valor: boolean, definir: (v: boolean) => void) => (
    <div style={{ alignItems: "center", display: "flex", gap: 10, justifyContent: "space-between" }}>
      <span style={{ fontSize: 12.5 }}>{rotulo}</span>
      <div style={{ display: "flex", gap: 6 }}>
        {[true, false].map((opcao) => (
          <button
            disabled={enviando}
            key={String(opcao)}
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
            {opcao ? "Sim" : "Não"}
          </button>
        ))}
      </div>
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
          <p style={{ color: T.sub, fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
            Isto abre um pedido na Têmis. O jurídico decide o instrumento e os valores; a venda
            continua em contrato até lá.
          </p>

          {erroDaApuracao ? (
            <div
              style={{
                background: T.dangerBg,
                border: `1px solid ${T.danger}`,
                borderRadius: 10,
                color: T.danger,
                fontSize: 12.5,
                padding: "10px 12px",
              }}
            >
              {erroDaApuracao}
            </div>
          ) : !apuracao ? (
            <div style={{ color: T.muted, fontSize: 12, padding: "10px 2px" }}>
              Apurando a situação do contrato…
            </div>
          ) : (
            <>
              <section
                style={{
                  background: T.card,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  display: "grid",
                  gap: 8,
                  padding: "12px 14px",
                }}
              >
                <span
                  style={{
                    color: T.muted,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                  }}
                >
                  O QUE O SISTEMA ENCONTROU
                </span>
                {encontrado(
                  "Assinaturas",
                  apuracao.comoSoube.assinatura,
                  apuracao.assinaturaCompleta,
                )}
                {encontrado("Pagamentos", apuracao.comoSoube.pagamento, apuracao.houvePagamento)}
              </section>

              {/* A classificação — o que o pedido vai ser. Só a devolução ganha cor: ela é a
                  diferença que mexe em dinheiro do cliente. */}
              <div
                style={{
                  background: vaiDevolver ? T.dangerBg : T.soft,
                  border: `1px solid ${vaiDevolver ? T.danger : T.border}`,
                  borderRadius: 10,
                  display: "grid",
                  gap: 3,
                  padding: "10px 12px",
                }}
              >
                <b style={{ fontSize: 12.5 }}>
                  {vaiComoDistrato ? "Vai como DISTRATO" : "Vai como CANCELAMENTO"}
                  {vaiDevolver ? ", com devolução de valores" : ""}
                </b>
                <span style={{ color: T.sub, fontSize: 11.5, lineHeight: 1.45 }}>
                  {mudouAApuracao ? "classificação corrigida à mão" : apuracao.porque}
                </span>
              </div>

              {ajustando ? (
                <section
                  style={{
                    background: T.card,
                    border: `1px dashed ${T.border}`,
                    borderRadius: 10,
                    display: "grid",
                    gap: 10,
                    padding: "12px 14px",
                  }}
                >
                  {/* ⚠️ O CASO QUE ESCAPA É O PIX NA MÃO DO CORRETOR: ele não deixa rastro no
                      sistema, e cancelar sem devolver é o erro caro deste fluxo. */}
                  <span style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.45 }}>
                    Use só se souber de algo que não está registrado — um pagamento por fora, por
                    exemplo. O card vai dizer ao jurídico que a classificação foi corrigida à mão.
                  </span>
                  {chave("Todas as assinaturas foram colhidas?", assinou, setAssinou)}
                  {chave("Houve algum pagamento?", pagou, setPagou)}
                </section>
              ) : (
                <button
                  onClick={() => setAjustando(true)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: T.muted,
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 11.5,
                    justifySelf: "start",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                  type="button"
                >
                  Não confere com o que você sabe?
                </button>
              )}
            </>
          )}

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
            disabled={enviando || !apuracao}
            onClick={() => {
              setTentou(true);
              if (!apuracao || faltaMotivo) return;
              aoConfirmar({
                ajuste: mudouAApuracao
                  ? { assinaturaCompleta: assinou, houvePagamento: pagou }
                  : null,
                motivo: motivo.trim(),
              });
            }}
            style={{
              background: enviando || !apuracao ? T.soft : T.dangerBg,
              border: `1px solid ${enviando || !apuracao ? T.border : T.danger}`,
              borderRadius: 9,
              color: enviando || !apuracao ? T.muted : T.danger,
              cursor: enviando || !apuracao ? "default" : "pointer",
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
