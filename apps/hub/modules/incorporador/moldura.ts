import type { CSSProperties } from "react";

import { fonte } from "@/modules/publico/ui/tokens";

// A MOLDURA TAILWIND DO PORTAL, num módulo SEM dependência de tela.
//
// O porquê da moldura inteira (as `--color-*` redeclaradas para os `--inc-*` do portal, e o
// `data-uix-theme` com o tema efetivo) está escrito em TelaContratos.tsx, onde ela nasceu.
//
// ⚠️ POR QUE SAIU DE LÁ (revisão da onda 3, 16/09/2026). A TelaCrm passou a importar a moldura de
// `./TelaContratos` para vestir o wizard do "Novo cliente". Só que a TelaContratos importa o quadro
// da Têmis (TemisKanban, que puxa a TelaDeTrabalho, a prévia, a organização da assinatura e a coluna
// fixa): o CRM de TODO portal, inclusive o comercial da Gurgel no celular, passava a baixar a Têmis
// inteira para ler um objeto de estilo. Aqui o objeto não carrega nada junto.
//
// A TelaContratos reexporta daqui, então quem ainda importa `MOLDURA_TAILWIND` de "../TelaContratos"
// (as telas da ficha do produto) continua com a MESMA moldura, uma só.
export const MOLDURA_TAILWIND = {
  "--color-canvas": "var(--inc-page)",
  "--color-surface": "var(--inc-card)",
  "--color-raised": "var(--inc-card)",
  "--color-subtle": "var(--inc-soft)",
  "--color-inverse": "var(--inc-btn-bg)",
  "--color-ink": "var(--inc-text)",
  "--color-ink-soft": "var(--inc-sub)",
  "--color-ink-muted": "var(--inc-muted)",
  "--color-line": "var(--inc-border)",
  "--color-line-strong": "var(--inc-border)",
  "--color-brand": "var(--inc-gold)",
  "--color-brand-ink": "var(--inc-btn-fg)",
  "--uix-border-strong": "var(--inc-border)",
  "--uix-border-subtle": "var(--inc-border)",
  "--uix-surface-base": "var(--inc-card)",
  "--uix-surface-canvas": "var(--inc-page)",
  "--uix-surface-inverse": "var(--inc-btn-bg)",
  "--uix-surface-raised": "var(--inc-card)",
  "--uix-surface-subtle": "var(--inc-soft)",
  "--uix-text-muted": "var(--inc-muted)",
  "--uix-text-primary": "var(--inc-text)",
  "--uix-text-secondary": "var(--inc-sub)",
  "--uix-color-brand-primary": "var(--inc-gold)",
  "--uix-color-brand-foreground": "var(--inc-btn-fg)",
  fontFamily: fonte,
} as CSSProperties;
