// ABRIR O SIMULADOR DE PROPOSTA DO MASTERPLAN JÁ NO LOTE CERTO.
//
// Lucas (03/09/2026), mostrando o "Monte o plano de pagamento" do masterplan: *"coloca um botão de
// simulador de proposta, aí abre o simulador, esse simulador aqui tem que ser esse"*.
//
// ⚠️ POR QUE REUSAR EM VEZ DE PORTAR. Aquele simulador tem a tabela oficial do empreendimento
// aplicada ao lote, desconto por plano, reforços anuais, o modo "parto da parcela do cliente" que
// varre as composições que fecham, e o "Copiar resumo". São cerca de 1.500 linhas de JS já
// validadas em uso diário — o Cecílio trabalha nelas. Reescrever isso em React numa rodada seria
// trocar uma coisa que funciona por uma que ainda vai ser depurada, e a conta é de DINHEIRO.
//
// ⚠️ O SCRIPT ENTRA NO MESMO ESCOPO. O masterplan é um `<script>` clássico, e um segundo script
// injetado depois dele enxerga os `const` do topo (`lotes`) e as `function` declaradas (`selecionar`,
// `abre`). Não é gambiarra de janela: é como dois scripts clássicos da mesma página se enxergam.
//
// ⚠️ E SE O LOTE NÃO EXISTIR, o simulador abre mesmo assim, sem lote — melhor do que uma tela que
// não responde ao clique. O masterplan do pai pode não ter o lote de um filho (o espelho do Vale do
// Ouro está parado desde a divisão), e isso não pode virar tela morta.

/** Esconde a casca e deixa só o popup do plano, que é a tela do simulador. */
const ESTILO = `<style id="so-simulador">
  /* ⚠️ A CENA SAI JUNTO COM A CASCA. O primeiro corte escondia só a casca e deixava o mapa: a modal
     abria com o loteamento inteiro na tela e o simulador atrás dele. Aqui o assunto é o plano de
     pagamento — o mapa já está na Mesa, atrás da modal. */
  .topo, .macro, .unidade, .rodape, .rail, .cena, #scrim { display: none !important; }
  body { display: block !important; overflow: hidden !important; background: var(--base) !important; }
  /* O popup deixa de flutuar e vira a página inteira. */
  #popPlano {
    display: flex !important; position: static !important; transform: none !important;
    width: 100% !important; max-width: none !important; height: 100vh !important;
    max-height: 100vh !important; border: 0 !important; border-radius: 0 !important;
    box-shadow: none !important;
  }
  /* O "x" do popup fecharia só ele, deixando a página vazia: quem fecha é o botão da modal. */
  #popPlano [data-fecha] { display: none !important; }
</style>`;

function abridor(quadra: string, lote: string): string {
  // JSON.stringify escapa aspas e barras: o valor vem da URL, e entrar cru num script seria abrir
  // uma porta para injeção.
  const q = JSON.stringify(quadra);
  const l = JSON.stringify(lote);

  return `<script id="abrir-simulador">
(function () {
  // ⚠️ ACHAR O LOTE E ABRIR O SIMULADOR SÃO DUAS COISAS, e a primeira não pode impedir a segunda.
  // Na primeira versão as duas estavam no mesmo try: quando a busca falhava — e ela falha sempre no
  // Vale do Ouro, cujo espelho não tem os lotes dos filhos — o catch engolia a abertura junto, e a
  // modal ficava mostrando o mapa. Agora, sem lote, o simulador abre com o valor editável.
  function acharLote() {
    try {
      if (typeof lotes === "undefined" || !Array.isArray(lotes)) return null;
      var q = String(${q}).trim().replace(/^0+/, "");
      var l = String(${l}).trim().replace(/^0+/, "");
      return lotes.find(function (x) {
        return String(x.q).trim().replace(/^0+/, "") === q
          && String(x.lote).trim().replace(/^0+/, "") === l;
      }) || null;
    } catch (e) {
      return null;
    }
  }

  function tentar(resta) {
    if (typeof abre !== "function") {
      // O masterplan monta o mapa em etapas; se ainda não chegou nas funções, tenta de novo.
      if (resta > 0) setTimeout(function () { tentar(resta - 1); }, 120);
      return;
    }

    var alvo = acharLote();
    if (alvo && typeof selecionar === "function") {
      try { selecionar(alvo); } catch (e) { /* sem seleção, o plano abre com o valor editável */ }
    }

    try {
      abre("popPlano");
    } catch (e) {
      // Último recurso: a classe é o que o CSS do popup observa.
      var p = document.getElementById("popPlano");
      if (p) p.classList.add("on");
    }
  }

  if (document.readyState === "complete") tentar(60);
  else window.addEventListener("load", function () { tentar(60); });
})();
</script>`;
}

/**
 * Injeta o estilo e o abridor antes do `</body>`.
 *
 * ⚠️ O ÚLTIMO `</body>`, e não o primeiro: o arquivo do masterplan tem um `</body>` DENTRO de uma
 * string JavaScript (o HTML que ele exporta), e injetar ali colocaria o script dentro de um texto.
 */
export function comSimuladorAberto(html: string, quadra: string, lote: string): string {
  const pedaco = ESTILO + abridor(quadra, lote);
  const fim = html.lastIndexOf("</body>");
  return fim === -1 ? html + pedaco : html.slice(0, fim) + pedaco + html.slice(fim);
}

/** `12|06` → `{ lote: "06", quadra: "12" }`. Vazio quando o pedido não traz o lote. */
export function loteDoPedido(valor: null | string | undefined): null | { lote: string; quadra: string } {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return null;

  const [quadra, lote] = bruto.split("|");
  if (!quadra || !lote) return null;
  // Só dígito e letra: o valor vai para dentro de um script, e o resto não tem por que passar.
  const limpo = (v: string) => v.replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return { lote: limpo(lote), quadra: limpo(quadra) };
}
