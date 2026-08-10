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
      --inc-gold:#d6b56f; --inc-btn-bg:#f7f8fa; --inc-btn-fg:#121722;
      color-scheme: dark;
    }
    /* A marca clara só aparece no tema claro, e vice-versa. Duas <img> em vez de <picture> com
       media: assim o mesmo mecanismo serve para quem só tem UMA versão da logo — sem a escura,
       a clara continua valendo nos dois temas. */
    .inc .marca-clara { display: none; }
    .inc .marca-escura { display: inline-block; }
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
  page: "var(--inc-page)",
  soft: "var(--inc-soft)",
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
