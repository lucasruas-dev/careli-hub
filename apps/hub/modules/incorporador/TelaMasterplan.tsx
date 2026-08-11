"use client";

import { ArrowLeft } from "lucide-react";

import { T } from "./tema";

// O MASTERPLAN INTERNO DENTRO DA ABA PRODUTOS.
//
// Pedido do Lucas (10/08): "quando eu clicar no card garden, é para abrir essa tela, assim como no
// vale do ouro" e "essas duas telas tem que está dentro do perfil do incorporador - produto".
//
// ⚠️ A TELA É O A-INTERNO, E ELE NÃO É REESCRITO AQUI. O quadro abaixo carrega o próprio arquivo
// aprovado, com o CSS, o markup e o comportamento dele — zoom, filtros, tabela, plano comercial e
// ficha do lote, tudo igual ao que foi validado nos nove prints. Já tentei trocar por outro mapa
// que existia no Apolo e foi reprovado no mesmo dia; o desenho aprovado é a especificação.
//
// Por isso um quadro (iframe) e não uma porta para fora: assim a tela é a mesma, e mesmo assim o
// cliente continua DENTRO do portal, com a marca dele em volta e sem perder a sessão de vista.
// O endereço é uma rota, não um arquivo em public/, então quem não tem sessão não abre.

export function TelaMasterplan({
  code,
  nome,
  onVoltar,
}: {
  code: string;
  nome: string;
  onVoltar: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
        <button
          onClick={onVoltar}
          style={{
            alignItems: "center",
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            color: T.sub,
            cursor: "pointer",
            display: "inline-flex",
            fontSize: 13,
            gap: 6,
            padding: "8px 12px",
          }}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={15} />
          Produtos
        </button>
        <span style={{ color: T.text, fontSize: 15, fontWeight: 600 }}>{nome}</span>
      </div>

      {/* A altura é do VIEWPORT, não do conteúdo: o masterplan é uma tela de trabalho (mapa à
          esquerda, painéis à direita) e precisa de altura para não virar duas rolagens empilhadas.
          `min-height` segura o caso do celular deitado, onde 100dvh fica muito baixo. */}
      <iframe
        src={`/api/incorporador/masterplan?code=${encodeURIComponent(code)}`}
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          display: "block",
          height: "calc(100dvh - 190px)",
          minHeight: 520,
          width: "100%",
        }}
        title={`Masterplan do ${nome}`}
      />
    </div>
  );
}
