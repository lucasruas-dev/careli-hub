"use client";

import { useRef, useState } from "react";

import { C, fonte, GOLD } from "@/modules/publico/ui/tokens";

// Widget da CACÁ nos formulários públicos.
//
// Carregado SOB DEMANDA (dynamic import no CadPublicoFlow): quem não abre o chat não baixa o
// chat. O corretor está em 4G, e peso de página é requisito, não detalhe.
//
// A conversa vive só no estado deste componente. Não há histórico persistido, e é de propósito:
// num formulário anônimo não existe identidade a que amarrar histórico.
type Turno = { conteudo: string; papel: "assistente" | "corretor" };

const ABERTURA: Turno = {
  conteudo:
    "Oi! Sou a CACÁ. Posso explicar o processo, tirar dúvidas do preenchimento e ajudar se algo travar. O que você precisa?",
  papel: "assistente",
};

export function AssistenteCaca({
  onFechar,
  preSessao,
  sessao,
}: {
  onFechar: () => void;
  preSessao?: string;
  sessao?: string;
}) {
  const [turnos, setTurnos] = useState<Turno[]>([ABERTURA]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  const enviar = async () => {
    const pergunta = texto.trim();
    if (!pergunta || pensando) return;

    const novos: Turno[] = [...turnos, { conteudo: pergunta, papel: "corretor" }];
    setTurnos(novos);
    setTexto("");
    setPensando(true);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sessao) headers["x-cad-sessao"] = sessao;
      if (preSessao) headers["x-cad-pre-sessao"] = preSessao;

      const resposta = await fetch("/api/publico/cad/assistente", {
        body: JSON.stringify({ turnos: novos }),
        headers,
        method: "POST",
      });
      const dados = (await resposta.json().catch(() => ({}))) as { resposta?: string };
      setTurnos([
        ...novos,
        {
          conteudo:
            dados.resposta ||
            "Não consegui responder agora. Fale com a nossa central que a gente ajuda por lá.",
          papel: "assistente",
        },
      ]);
    } catch {
      setTurnos([
        ...novos,
        { conteudo: "Não consegui responder agora. Tente de novo em instantes.", papel: "assistente" },
      ]);
    } finally {
      setPensando(false);
      requestAnimationFrame(() => fim.current?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Assistente CACÁ"
      style={{
        background: C.card,
        borderTop: `1px solid ${C.border}`,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        bottom: 0,
        boxShadow: "0 -8px 32px rgba(0,0,0,.14)",
        display: "flex",
        flexDirection: "column",
        fontFamily: fonte,
        left: 0,
        // No celular ocupa quase a tela toda; no desktop vira um painel no canto.
        maxHeight: "76dvh",
        maxWidth: 420,
        paddingBottom: "env(safe-area-inset-bottom)",
        position: "fixed",
        right: 0,
        margin: "0 auto",
        width: "100%",
        zIndex: 30,
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          justifyContent: "space-between",
          padding: "14px 18px",
        }}
      >
        <strong style={{ color: C.text, fontSize: 15 }}>CACÁ</strong>
        <button
          aria-label="Fechar"
          onClick={onFechar}
          style={{
            background: "transparent",
            border: "none",
            color: C.sub,
            cursor: "pointer",
            fontSize: 22,
            // Alvo de toque confortável, mesmo sendo um "×".
            height: 44,
            width: 44,
          }}
          type="button"
        >
          ×
        </button>
      </div>

      <div style={{ display: "grid", flex: 1, gap: 10, overflowY: "auto", padding: "16px 18px" }}>
        {turnos.map((turno, i) => (
          <div
            key={i}
            style={{
              alignSelf: turno.papel === "corretor" ? "flex-end" : "flex-start",
              background: turno.papel === "corretor" ? C.text : C.soft,
              borderRadius: 14,
              color: turno.papel === "corretor" ? "#FFFFFF" : C.text,
              fontSize: 15,
              lineHeight: 1.5,
              maxWidth: "86%",
              padding: "10px 14px",
              whiteSpace: "pre-wrap",
            }}
          >
            {turno.conteudo}
          </div>
        ))}
        {pensando ? (
          <div style={{ color: C.muted, fontSize: 14 }}>Escrevendo...</div>
        ) : null}
        <div ref={fim} />
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, padding: 12 }}>
        <input
          onChange={(event) => setTexto(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") enviar();
          }}
          placeholder="Escreva sua dúvida"
          style={{
            background: C.page,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            color: C.text,
            flex: 1,
            fontFamily: fonte,
            // 16px: abaixo disso o Safari do iOS dá zoom ao focar.
            fontSize: 16,
            minHeight: 48,
            outline: "none",
            padding: "0 14px",
          }}
          value={texto}
        />
        <button
          disabled={pensando || !texto.trim()}
          onClick={enviar}
          style={{
            // Preto: o destaque do Panteon (Lucas, 20/jul).
            background: C.text,
            border: "none",
            borderRadius: 12,
            color: "#FFFFFF",
            cursor: pensando ? "default" : "pointer",
            fontSize: 15,
            fontWeight: 600,
            minHeight: 48,
            opacity: pensando || !texto.trim() ? 0.5 : 1,
            padding: "0 18px",
          }}
          type="button"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
