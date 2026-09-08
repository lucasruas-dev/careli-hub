"use client";

import { AlertTriangle, FileText, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

import { T } from "../tema";

// A PRÉVIA DO CONTRATO NA TELA — a minuta preenchida com os dados da proposta.
//
// Lucas, 08/09/2026: *"eu havia falado que deveria ter um campo para visualização do contrato
// preenchido, tipo uma prévia antes de enviar, isso foi construído?"*. Não estava: até esta manhã
// não existia motor nenhum, e as variáveis marcadas na minuta eram lidas só por auditoria.
//
// ⚠️ ESTA É A TELA DE CONFERÊNCIA, e é onde o erro sai barato. Um contrato errado descoberto aqui
// custa um clique; o mesmo contrato descoberto depois de assinado custa um aditivo, uma conversa
// com o cliente e, quando envolve preço, uma renegociação.
//
// ⚠️ E ELA MOSTRA O QUE FALTOU, EM CIMA. As variáveis sem valor saem impressas no corpo como
// `[cpf_cliente]` — de propósito, para saltarem aos olhos —, mas procurá-las no meio de 50 mil
// caracteres é o trabalho que esta tela existe para poupar. A lista fica no topo, antes do texto.

type Resposta = {
  avisos?: string[];
  erro?: string;
  html?: string;
  minuta?: { id: string; nome: string; versao: null | number };
  semValor?: string[];
  vezesDoLaco?: number;
};

export function PreviaDoContrato({
  aoFechar,
  propostaId,
}: {
  aoFechar: () => void;
  propostaId: string;
}) {
  const [carregando, setCarregando] = useState(true);
  const [resposta, setResposta] = useState<null | Resposta>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      try {
        const token = await getApoloAccessToken();
        const r = await fetch("/api/temis/contrato/previa", {
          body: JSON.stringify({ propostaId }),
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method: "POST",
        });
        const dados = (await r.json().catch(() => ({}))) as Resposta;
        if (vivo) setResposta(dados);
      } catch (e) {
        // ⚠️ O MOTIVO CHEGA À TELA. Uma prévia que falha calada manda a pessoa tentar de novo sem
        // saber o que mudar — e foi exatamente o que custou duas rodadas de teste no agente da
        // minuta, na mesma semana.
        if (vivo) {
          setResposta({ erro: e instanceof Error ? e.message : "Falha ao gerar a prévia." });
        }
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [propostaId]);

  const semValor = resposta?.semValor ?? [];
  const avisos = resposta?.avisos ?? [];

  return (
    <div
      onClick={aoFechar}
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,.45)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: 20,
        position: "fixed",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          boxShadow: T.sombra,
          display: "flex",
          flexDirection: "column",
          maxHeight: "92vh",
          maxWidth: 900,
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            gap: 10,
            padding: "12px 16px",
          }}
        >
          <FileText aria-hidden="true" size={16} style={{ color: T.gold }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: 13.5, fontWeight: 700 }}>
              Prévia do contrato
            </div>
            {resposta?.minuta ? (
              <div style={{ color: T.muted, fontSize: 11 }}>
                {resposta.minuta.nome}
                {resposta.minuta.versao ? ` · v${resposta.minuta.versao}` : ""}
                {resposta.vezesDoLaco
                  ? ` · ${resposta.vezesDoLaco} ${resposta.vezesDoLaco === 1 ? "comprador" : "compradores"}`
                  : ""}
              </div>
            ) : null}
          </div>
          <button
            aria-label="Fechar"
            onClick={aoFechar}
            style={{
              background: "transparent",
              border: "none",
              color: T.muted,
              cursor: "pointer",
              padding: 4,
            }}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div style={{ minHeight: 0, overflow: "auto", padding: 16 }}>
          {carregando ? (
            <div
              style={{
                alignItems: "center",
                color: T.muted,
                display: "flex",
                fontSize: 12.5,
                gap: 8,
                justifyContent: "center",
                padding: "40px 0",
              }}
            >
              <Loader2 aria-hidden="true" className="animate-spin" size={14} />
              Montando o contrato…
            </div>
          ) : resposta?.erro ? (
            <p
              style={{
                background: T.dangerBg,
                borderRadius: 10,
                color: T.danger,
                fontSize: 12.5,
                margin: 0,
                padding: "10px 12px",
              }}
            >
              {resposta.erro}
            </p>
          ) : (
            <>
              {semValor.length > 0 || avisos.length > 0 ? (
                <div
                  style={{
                    background: T.dangerBg,
                    borderRadius: 10,
                    marginBottom: 14,
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      alignItems: "center",
                      color: T.danger,
                      display: "flex",
                      fontSize: 12,
                      fontWeight: 700,
                      gap: 6,
                    }}
                  >
                    <AlertTriangle aria-hidden="true" size={13} />
                    Confira antes de emitir
                  </div>
                  {semValor.length > 0 ? (
                    <p style={{ color: T.sub, fontSize: 11.5, margin: "6px 0 0" }}>
                      {semValor.length === 1
                        ? "1 variável ficou sem valor e saiu impressa no texto: "
                        : `${semValor.length} variáveis ficaram sem valor e saíram impressas no texto: `}
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>
                        {semValor.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {avisos.map((a) => (
                    <p key={a} style={{ color: T.sub, fontSize: 11.5, margin: "4px 0 0" }}>
                      {a}
                    </p>
                  ))}
                </div>
              ) : null}

              {/* ⚠️ A FOLHA IMITA O PAPEL — fundo branco, largura de página, serifa. A prévia serve
                  para conferir o contrato, e conferir um contrato com a cara do editor esconde
                  justamente os problemas de diagramação que só aparecem no papel.

                  ⚠️ O HTML VEM DO NOSSO SERIALIZADOR, sobre a nossa minuta e os nossos dados — não é
                  conteúdo de terceiro. */}
              <div
                dangerouslySetInnerHTML={{ __html: resposta?.html ?? "" }}
                style={{
                  background: "#fff",
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  color: "#111",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: 13,
                  lineHeight: 1.55,
                  padding: "32px 40px",
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
