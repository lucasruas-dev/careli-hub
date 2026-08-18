// TEMA DO PORTAL DO INCORPORADOR — claro e escuro, decidido pelo aparelho do cliente.
//
// Por que variável CSS e não os tokens em objeto: as telas públicas do repo usam estilo inline
// (ficam autocontidas, sem depender do CSS do hub), e estilo inline NÃO responde a media query.
// Declarando as cores como variável num <style> de uma vez, o `prefers-color-scheme` faz o
// trabalho sozinho, sem JavaScript, sem piscar tela clara antes de virar escura e sem precisar
// de estado no React.
//
// Os valores claros são os mesmos de modules/publico/ui/tokens (paleta do Panteon). Os escuros
// são a escala NEUTRA que o Lucas aprovou em 07/08 depois de reprovar cinco versões azuladas
// (#0a0a0a / #171717 / #121212 / #242424, com a borda clara e translúcida em vez de cinza
// opaco — era daí que vinha o azul).

export const TEMA_CSS = `
  .inc {
    --inc-page:#f7f8fa; --inc-card:#ffffff; --inc-soft:#eef1f4;
    --inc-border:#dce2ea; --inc-text:#121722; --inc-sub:#485466; --inc-muted:#667085;
    --inc-danger:#c24135; --inc-danger-bg:#fdf3f2; --inc-gold:#a07c3b;
    --inc-ok:#2f7d59; --inc-ok-bg:#eef7f2;
    --inc-sombra:0 12px 32px rgba(0,0,0,0.14);
    --inc-btn-bg:#121722; --inc-btn-fg:#ffffff;
    color-scheme: light;
  }
  /* ⚠️ ESTA REGRA VEM ANTES DA MEDIA QUERY, e a ordem não é estilo, é o que faz funcionar: CSS
     de mesma especificidade resolve pela ÚLTIMA declaração. Com o display:none da marca escura
     depois do bloco dark, ele vencia lá dentro também e as DUAS logos sumiam no tema escuro,
     tela sem marca nenhuma, que foi exatamente o que apareceu no primeiro teste. */
  .inc .marca-clara { display: inline-block; }
  .inc .marca-escura { display: none; }
  .inc input::placeholder { color: var(--inc-muted); opacity: 1; }
  @media (prefers-color-scheme: dark) {
    .inc {
      --inc-page:#0a0a0a; --inc-card:#171717; --inc-soft:#242424;
      --inc-border:rgb(255 255 255 / .075); --inc-text:#f7f8fa; --inc-sub:#dce2ea;
      --inc-muted:#a5afbd; --inc-danger:#e08278; --inc-danger-bg:rgb(194 65 53 / .12);
      --inc-ok:#7cc4a1; --inc-ok-bg:rgb(47 125 89 / .16);
      --inc-sombra:0 12px 32px rgba(0,0,0,0.55);
      --inc-gold:#d6b56f; --inc-btn-bg:#f7f8fa; --inc-btn-fg:#121722;
      color-scheme: dark;
    }
    /* A marca clara só aparece no tema claro, e vice-versa. Duas <img> em vez de <picture> com
       media: assim o mesmo mecanismo serve para quem só tem UMA versão da logo — sem a escura,
       a clara continua valendo nos dois temas. */
    .inc .marca-clara { display: none; }
    .inc .marca-escura { display: inline-block; }
  }

  /* ── A CASCA DO PORTAL: menu à esquerda, conteúdo à direita ─────────────────
     Lucas, 12/08: "no sidebar lateral queria ter poucas abas: CRM - Vendas - Carteira".
     Está em CSS e não em estilo inline pelo mesmo motivo das cores: precisa virar barra
     horizontal no celular, e media query não alcança estilo inline. */
  .inc-shell { display: flex; min-height: 100dvh; }
  .inc-side {
    background: var(--inc-card); border-right: 1px solid var(--inc-border);
    display: flex; flex: 0 0 224px; flex-direction: column;
    height: 100dvh; position: sticky; top: 0; width: 224px;
  }
  .inc-nav { display: flex; flex-direction: column; gap: 2px; padding: 10px; }
  .inc-main { flex: 1 1 auto; min-width: 0; }
  @media (max-width: 860px) {
    .inc-shell { display: block; }
    .inc-side {
      border-bottom: 1px solid var(--inc-border); border-right: none;
      flex: none; height: auto; position: static; width: auto;
    }
    /* No celular o menu vira uma faixa que rola de lado; sem isso as abas espremem e o rótulo
       quebra em duas linhas. */
    .inc-nav { flex-direction: row; overflow-x: auto; }
    .inc-nav > button { flex: 0 0 auto; }
  }
`;

export const T = {
  border: "var(--inc-border)",
  btnBg: "var(--inc-btn-bg)",
  btnFg: "var(--inc-btn-fg)",
  card: "var(--inc-card)",
  danger: "var(--inc-danger)",
  dangerBg: "var(--inc-danger-bg)",
  gold: "var(--inc-gold)",
  muted: "var(--inc-muted)",
  // O verde de ESTADO (adimplência, "em dia"). Nasceu hardcoded no Chip da TelaCrm; virou token
  // para a próxima tela que precisar do mesmo verde não duplicar o hex. É o par do `danger`.
  ok: "var(--inc-ok)",
  okBg: "var(--inc-ok-bg)",
  page: "var(--inc-page)",
  soft: "var(--inc-soft)",
  // A sombra de popover/modal, mais funda no tema escuro (sombra clara some no fundo preto).
  sombra: "var(--inc-sombra)",
  sub: "var(--inc-sub)",
  text: "var(--inc-text)",
} as const;

/**
 * A marca, na versão certa para cada tema. Quem não tem versão em negativo continua com a clara
 * nos dois: melhor a logo dele um pouco fora de tom do que sumida.
 */
export function Marca({
  altura,
  escuraUrl,
  largura,
  nome,
  url,
}: {
  altura: number;
  escuraUrl: string | null;
  largura: number | string;
  nome: string;
  url: string | null;
}) {
  if (!url && !escuraUrl) {
    return <span style={{ color: T.text, fontSize: 22, fontWeight: 600 }}>{nome}</span>;
  }

  // ⚠️ SEM `display` AQUI. Ele mora no CSS abaixo, e a razão é dura: estilo inline vence regra
  // de classe, então um `display` neste objeto reacende a logo que o tema mandou esconder — foi
  // assim que as DUAS marcas apareceram na mesma tela, uma embaixo da outra.
  const estilo = {
    maxHeight: altura,
    maxWidth: largura,
    objectFit: "contain" as const,
    width: "100%",
  };

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local, sem otimização */}
      <img alt={nome} className="marca-clara" src={url ?? escuraUrl ?? ""} style={estilo} />
      {escuraUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- asset local, sem otimização
        <img alt={nome} className="marca-escura" src={escuraUrl} style={estilo} />
      ) : null}
    </>
  );
}
