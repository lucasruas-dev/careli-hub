// VERSÃO CLARA DA TELA DO MASTERPLAN.
//
// Pedido do Lucas (11/08): "tem que fazer a versão claro dessa tela", depois de ver o masterplan
// escuro dentro do portal claro do incorporador.
//
// COMO ISTO NÃO É REDESENHAR. A tela é o A-INTERNO, aprovado com nove prints de validação, e o
// desenho dela não muda aqui: nenhuma medida, nenhum espaçamento, nenhuma estrutura. O que muda é
// a PALETA, e ela já vive quase toda em tokens (`--canvas`, `--base`, `--txt`…) no `:root` do
// próprio arquivo. Redefinir esses tokens vira a tela inteira de uma vez.
//
// O bloco abaixo é injetado DEPOIS do <style> original, então vence por ordem, sem precisar de
// `!important` e sem editar o arquivo aprovado — que segue servindo, intacto, para quem quiser o
// escuro.
//
// A paleta clara é a do Panteon (packages/uix, `:root[data-uix-theme="light"]`), a mesma do portal
// do incorporador: é isso que o Lucas quis dizer com "seguir o esquema de cor do sistema".
//
// ⚠️ O QUE NÃO É TOKEN. Sobraram alguns valores cravados no CSS original, todos escritos partindo
// do princípio de que o fundo é escuro: realce branco translúcido (`rgb(255 255 255 / .05)`),
// divisa quase preta (`rgb(12 12 12 / .28)`), azul-claro de texto (`#cfe0ff`). Sobre fundo claro,
// realce branco desaparece e azul-claro não lê. Cada um está corrigido abaixo, com o mesmo papel
// que tinha no escuro — realce continua realce, divisa continua divisa.

export const CSS_TEMA_CLARO = `
:root{
  /* superfícies e texto: paleta clara do Panteon */
  --canvas:#f7f8fa;
  --base:#ffffff;
  --raised:#ffffff;
  --subtle:#eef1f4;
  --linha:#dce2ea;
  --linha-forte:#c5ceda;
  --txt:#121722;
  --txt2:#485466;
  --txt3:#667085;
  --txt4:#8894a5;

  /* As tintas de texto existem porque cor pura em corpo pequeno não lê sobre fundo escuro. Sobre
     fundo claro o problema se inverte: agora elas escurecem, em vez de clarear. */
  --ok-t:color-mix(in srgb,var(--ok) 82%,#121722);
  --warn-t:color-mix(in srgb,var(--warn) 82%,#121722);
  --dang-t:color-mix(in srgb,var(--dang) 82%,#121722);

  /* O rail e os painéis laterais no claro são superfície de papel, não o gradiente grafite. */
  --rail:linear-gradient(180deg,#ffffff,#fbfcfd),#ffffff;
}

/* ---- DIVISAS: eram quase pretas para separar grafite de grafite. ---- */
.rail,
.painel-esq,
.painel-dir,
[class*="painel"]{ border-color:var(--linha) !important; }
.rail{ box-shadow:inset -1px 0 0 rgb(18 23 34 / .04); }

/* ---- REALCE: branco translúcido some sobre branco. Vira grafite translúcido. ---- */
table.tq tbody tr:hover td{ background:rgb(18 23 34 / .04); }
table.tq tr.on td{ background:rgb(18 23 34 / .07); }
table.dados tbody tr:hover td{ background:rgb(18 23 34 / .035); }
.barq{ background:rgb(18 23 34 / .08); }
.s-tit{ background:rgb(18 23 34 / .02); }
.s-seg button.on,
.s-ajusta button.on{ box-shadow:inset 0 0 0 1px var(--linha); }
.rail a:hover{ background:rgb(18 23 34 / .06); color:var(--txt); }

/* ---- O ITEM ATIVO DO RAIL: era um bloco escuro sobre grafite; vira um bloco claro com o fio
       dourado da marca, que é o que o identifica no Panteon. ---- */
.rail a.on{
  background:var(--subtle);
  color:var(--txt);
  box-shadow:inset 0 0 0 1px rgb(160 124 59 / .45);
}
.rail a{ color:var(--txt3); }

/* ---- CAMPO DE BUSCA: fundo branco translúcido não existe sobre branco. ---- */
input[type="search"], .busca, .busca input{
  background:var(--canvas);
  border-color:var(--linha);
}

/* ---- AZUL DE APOIO do simulador: #cfe0ff foi escolhido para ler sobre grafite. ---- */
.s-inp.s-calc input,
.s-pz.on b, .s-pz.on small{ color:color-mix(in srgb,var(--foco) 78%,#121722); }
.s-pz.on{ background:color-mix(in srgb,var(--foco) 8%,var(--raised)); }

/* ---- MAPA: o realce de hover e a sombra da seleção eram branco sobre foto escurecida. Sobre a
       mesma foto num tema claro, branco continua funcionando para o hover (clareia o lote), mas a
       sombra da seleção precisa escurecer para o fio de seleção ter contra o que aparecer. ---- */
#selSombra{ fill:#121722; fill-opacity:.28; }

/* ---- BARRA DE ROLAGEM ---- */
::-webkit-scrollbar-thumb{ background:var(--linha-strong,#c5ceda); }
`;

/**
 * Aplica o tema claro ao HTML do masterplan.
 *
 * Duas coisas: o atributo do `<html>` (o arquivo nasce `data-uix-theme="dark"`, e há CSS do
 * Panteon que se pendura nele) e o bloco de tokens, injetado ANTES de `</head>` para vir depois do
 * `<style>` original e vencer por ordem de cascata.
 *
 * Se a âncora `</head>` não existir, devolve o HTML intacto: melhor a tela escura do que uma tela
 * quebrada com o CSS solto no meio do corpo.
 */
export function comTemaClaro(html: string): string {
  const claro = html.replace('data-uix-theme="dark"', 'data-uix-theme="light"');

  return claro.includes("</head>")
    ? claro.replace("</head>", `<style>${CSS_TEMA_CLARO}</style></head>`)
    : claro;
}
