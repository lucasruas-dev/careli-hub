// Paleta e medidas das telas PÚBLICAS (formulário do corretor e auto-cadastro de imobiliária).
//
// MOBILE-FIRST DE VERDADE: "os corretores usam muito o celular" (Lucas). Desenhado primeiro
// para 375px; o desktop é o caso ampliado, não o contrário. Um caminho de código só,
// adaptativo por LARGURA — nunca por user-agent (detecção de dispositivo erra, largura não).
//
// Estilo inline em vez de classe: é o padrão das outras telas públicas do repo
// (modules/cads/CadPublicDashboard.tsx) e mantém a página autocontida, sem depender do CSS do
// hub que essas telas não carregam.

// ⚠️ PALETA DO PANTEON, não uma paleta própria. Correção do Lucas em 20/jul: a primeira versão
// veio bege/marrom (copiada do dashboard público de CADs) e ele reprovou na hora: "o layout está
// errado, tem que seguir o que temos hoje no panteon, o preto em destaque, não gosto desse
// marrom".
//
// Os valores abaixo são cópia literal de `packages/uix/styles.css` (tema claro). São repetidos
// em hex de propósito: estas telas usam estilo inline para ficarem autocontidas, sem depender do
// CSS do hub. Se a paleta do uix mudar, ESTE arquivo precisa acompanhar.
//
// O DESTAQUE É O PRETO (#121722 = --uix-text-primary / --uix-surface-inverse): é ele que pinta
// botão primário, barra de progresso e etapa atual. O dourado da marca é acento pontual, nunca
// área grande, e nada aqui é marrom.

// Dourado institucional (--uix-color-brand-primary). Uso pontual: detalhe, nunca fundo.
export const GOLD = "#a07c3b";

export const C = {
  border: "#dce2ea", // --uix-border-subtle
  card: "#ffffff", // --uix-surface-base
  danger: "#c24135", // --uix-color-danger
  muted: "#667085", // --uix-text-muted
  ok: "#14804a", // --uix-color-success
  page: "#f7f8fa", // --uix-surface-canvas
  soft: "#eef1f4", // --uix-surface-subtle
  sub: "#485466", // --uix-text-secondary
  text: "#121722", // --uix-text-primary
} as const;

// 44px é o mínimo confortável de toque. Campos e botões ficam acima disso de propósito: quem
// preenche está de pé, em movimento, com uma mão só.
export const ALVO_TOQUE = 52;

export const CARD_MAX = 480;

export const fonte =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const estilos = {
  botaoPrimario: {
    background: C.text,
    border: "none",
    borderRadius: 12,
    color: "#FFFFFF",
    cursor: "pointer",
    fontFamily: fonte,
    fontSize: 16,
    fontWeight: 600,
    minHeight: ALVO_TOQUE,
    width: "100%",
  },
  botaoSecundario: {
    background: "transparent",
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    color: C.sub,
    cursor: "pointer",
    fontFamily: fonte,
    fontSize: 15,
    fontWeight: 500,
    minHeight: ALVO_TOQUE,
    width: "100%",
  },
  campo: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    color: C.text,
    fontFamily: fonte,
    // ⚠️ 16px NÃO É ESTÉTICA: abaixo disso o Safari do iOS aplica zoom automático ao focar o
    // campo, e a tela "pula". É a causa clássica de formulário que parece quebrado no iPhone.
    fontSize: 16,
    minHeight: ALVO_TOQUE,
    outline: "none",
    padding: "0 14px",
    width: "100%",
  },
  rotulo: {
    color: C.sub,
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0.2,
    marginBottom: 6,
  },
} as const;
