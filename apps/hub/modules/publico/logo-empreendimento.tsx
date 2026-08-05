"use client";

import { useState } from "react";

// Logo de empreendimento PADRONIZADA (pedido do Lucas, 03/08: "padronizado, visível, bonito").
// Três regras que curam os três males vistos no print do cadastro de imobiliária:
//   1. `contain`, nunca `cover` — cover cortava a arte horizontal ("Vale d| our...");
//   2. caixa uniforme com fundo BRANCO e borda sutil — cada arte traz o próprio fundo (a do
//      Veredas é escura), e o branco neutro deixa todas legíveis e do mesmo tamanho;
//   3. fallback com o código dourado quando a imagem QUEBRA — a URL assinada do Storage vence
//      em 1h, e a página aberta desde cedo mostrava o ícone quebrado do navegador.
export function LogoEmpreendimento({
  altura = 52,
  code,
  logoUrl,
  name,
  largura = 88,
}: {
  altura?: number;
  code?: string | null;
  logoUrl?: string | null;
  name: string;
  largura?: number;
}) {
  const [quebrou, setQuebrou] = useState(false);
  const rotulo = (code || name.slice(0, 3)).toUpperCase();

  return (
    <span
      aria-hidden
      style={{
        alignItems: "center",
        background: "#ffffff",
        border: "1px solid #e5e0d5",
        borderRadius: 10,
        display: "flex",
        flexShrink: 0,
        height: altura,
        justifyContent: "center",
        overflow: "hidden",
        padding: 6,
        width: largura,
      }}
    >
      {logoUrl && !quebrou ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          onError={() => setQuebrou(true)}
          src={logoUrl}
          style={{ height: "100%", objectFit: "contain", width: "100%" }}
        />
      ) : (
        <span
          style={{ color: "#a07c3b", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em" }}
        >
          {rotulo}
        </span>
      )}
    </span>
  );
}
