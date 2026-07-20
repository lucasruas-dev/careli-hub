import type { ReactNode } from "react";

import { C, CARD_MAX, fonte } from "@/modules/publico/ui/tokens";

// Casca das telas públicas NOVAS (formulário de CAD do corretor e auto-cadastro de
// imobiliária): cabeçalho com a marca, área segura do iOS e o card centralizado.
//
// ⚠️ POR QUE É UM COMPONENTE E NÃO UM app/publico/layout.tsx: um layout do Next envolveria
// TAMBÉM o /publico/cads/[empreendimento], que é um dashboard já no ar com desenho próprio de
// página inteira. Ele ganharia um cabeçalho que ninguém pediu.
//
// LOGO DO C2X: a empresa dona do Panteon, a marca institucional que assina as telas públicas e
// o documento. Servida de /c2x-logo.png, versão web de 560px e ~5 KB — o original tem 6000px e
// 753 KB, indefensável no topo de um formulário aberto em 4G. Ver scripts/gerar-logo-cad.mjs.
//
// ⚠️ Sempre a versão CLARA: a `c2x_escuro` só serve para fundo escuro e renderiza X duplicado
// quando invertida.
export function CascaPublica({
  children,
  rodape,
  topo,
}: {
  children: ReactNode;
  // Fica colado no pé, com `position: sticky` DENTRO do container (nunca `fixed` na viewport:
  // com `fixed` o iOS joga o botão por baixo do teclado aberto).
  rodape?: ReactNode;
  topo?: ReactNode;
}) {
  return (
    <div
      style={{
        background: C.page,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: fonte,
        // 100dvh e não 100vh: com 100vh o iOS conta a barra de endereço e a tela "estoura".
        minHeight: "100dvh",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: C.page,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          gap: 10,
          justifyContent: "center",
          padding: "12px 16px 10px",
          position: "sticky",
          top: 0,
          zIndex: 5,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="C2X"
          height={315}
          src="/c2x-logo.png"
          style={{ display: "block", height: "auto", width: 84 }}
          width={560}
        />
        {topo ? <div style={{ maxWidth: CARD_MAX, width: "100%" }}>{topo}</div> : null}
      </div>

      <main
        style={{
          flex: 1,
          margin: "0 auto",
          maxWidth: CARD_MAX,
          padding: "24px 20px 8px",
          width: "100%",
        }}
      >
        {children}
      </main>

      {rodape ? (
        <div
          style={{
            background: C.page,
            borderTop: `1px solid ${C.border}`,
            bottom: 0,
            margin: "0 auto",
            maxWidth: CARD_MAX,
            padding: "12px 20px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
            position: "sticky",
            width: "100%",
          }}
        >
          {rodape}
        </div>
      ) : null}
    </div>
  );
}
