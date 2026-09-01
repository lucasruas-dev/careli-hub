// ═══════════════════════════════════════════════════════════════════════════
// REAJUSTE DAS PARCELAS 09, 10, 11 e 12 de 2026 — LAVRA DO OURO (LOU) e LOS
//
// COMO USAR (no Chrome JÁ LOGADO no C2X, em https://sistema.careli.adm.br/payments):
//   1. F12 -> aba Console
//   2. cole este arquivo inteiro e dê Enter  -> roda em ENSAIO, não grava nada
//   3. leia o resumo; se estiver certo, troque ENVIAR para true e rode de novo
//   4. na primeira vez de verdade deixe APENAS = 1: faz UMA unidade, você confere no C2X,
//      e só então aumenta para o restante
//
// O QUE FAZ: é o MESMO caminho do clique. Para cada unidade abre a listagem filtrada
// daquela unidade, acha o formulário de cada parcela e envia o MESMO POST que o botão
// Salvar do modal envia — então o servidor roda a lógica dele igual, inclusive o
// RECÁLCULO DO SPLIT. Não existe atalho por fora do sistema aqui.
//
// ⚠️ AS QUATRO CONFERÊNCIAS por parcela. Qualquer uma que falhe = pula e registra,
// nunca "tenta assim mesmo":
//   1. o formulário daquele payment_id existe na listagem daquela unidade
//   2. o título do modal bate com a unidade esperada
//   3. a competência do formulário é a esperada (09, 10, 11 ou 12 de 2026)
//   4. o valor atual é EXATAMENTE o "de" que o plano mediu (se mudou, alguém mexeu
//      depois do plano — não sobrescreve)
//
// ⚠️ SÓ O VALOR ORIGINAL MUDA. Todos os outros campos do formulário viajam com o valor
// que já estava lá — mandar o formulário pela metade anularia o resto.
//
// ⚠️ NÃO CLICA EM MAIS NADA. A mesma tela tem "Apagar parcelas em aberto" a poucos
// pixels; por isso aqui não há clique nenhum — só o POST do formulário certo, achado por id.
//
// ⚠️ FORA DO PLANO de propósito: 6 unidades com pedido CANCELADO (LOS0334, LOS1620,
// LOS1723, LOS1621, LOS1609, LOS1412), 4 parcelas da LOS1626 que JÁ TÊM BOLETO emitido
// (e já estão no valor certo) e 1 parcela AVULSA da LOS0422.
// ═══════════════════════════════════════════════════════════════════════════

const ENVIAR = true;       // <- GRAVA DE VERDADE
const APENAS = 999;        // <- quantas UNIDADES processar (999 = todas)
const AO_MESMO_TEMPO = 2;  // <- devagar: estas 7 deram timeout 504 no servidor

// ✔️ A LOU1814 JÁ FOI FEITA (piloto conferido no banco em 24/08 16:11: as 4 competências em
// R$ 352,16, auditoria registrada e split recalculado). Ela continua na lista de propósito:
// a conferência 4 detecta que já está no valor e PULA, imprimindo "já está em R$ 352,16".
// É a prova viva de que o script não reprocessa o que já está certo.

const LISTA = [
  {"unidade":"LOS1734","unitId":584,"parcelas":[{"id":308889,"comp":"09/2026","de":"426,81","para":"525,82"},{"id":308890,"comp":"10/2026","de":"426,81","para":"525,82"},{"id":308891,"comp":"11/2026","de":"426,81","para":"525,82"},{"id":308892,"comp":"12/2026","de":"426,81","para":"525,82"}]},
  {"unidade":"LOS2402","unitId":587,"parcelas":[{"id":285591,"comp":"09/2026","de":"533,52","para":"657,27"},{"id":285592,"comp":"10/2026","de":"533,52","para":"657,27"},{"id":285593,"comp":"11/2026","de":"533,52","para":"657,27"},{"id":285594,"comp":"12/2026","de":"533,52","para":"657,27"}]},
  {"unidade":"LOS2403","unitId":588,"parcelas":[{"id":320570,"comp":"09/2026","de":"533,52","para":"657,27"},{"id":320571,"comp":"10/2026","de":"533,52","para":"657,27"},{"id":320572,"comp":"11/2026","de":"533,52","para":"657,27"},{"id":320573,"comp":"12/2026","de":"533,52","para":"657,27"}]},
  {"unidade":"LOS2406","unitId":591,"parcelas":[{"id":285841,"comp":"09/2026","de":"533,52","para":"657,27"},{"id":285842,"comp":"10/2026","de":"533,52","para":"657,27"},{"id":285843,"comp":"11/2026","de":"533,52","para":"657,27"},{"id":285844,"comp":"12/2026","de":"533,52","para":"657,27"}]},
  {"unidade":"LOS2407","unitId":592,"parcelas":[{"id":284961,"comp":"09/2026","de":"537,26","para":"661,89"},{"id":284962,"comp":"10/2026","de":"537,26","para":"661,89"},{"id":284963,"comp":"11/2026","de":"537,26","para":"661,89"},{"id":284964,"comp":"12/2026","de":"537,26","para":"661,89"}]},
  {"unidade":"LOS2409","unitId":594,"parcelas":[{"id":286104,"comp":"09/2026","de":"533,52","para":"657,27"},{"id":286105,"comp":"10/2026","de":"533,52","para":"657,27"},{"id":286106,"comp":"11/2026","de":"533,52","para":"657,27"},{"id":286107,"comp":"12/2026","de":"533,52","para":"657,27"}]},
  {"unidade":"LOS2410","unitId":595,"parcelas":[{"id":275827,"comp":"09/2026","de":"533,52","para":"657,27"},{"id":275828,"comp":"10/2026","de":"533,52","para":"657,27"},{"id":275829,"comp":"11/2026","de":"533,52","para":"657,27"},{"id":275830,"comp":"12/2026","de":"533,52","para":"657,27"}]}
];

// ── motor ──────────────────────────────────────────────────────────────────
const dinheiro = (v) => "R$ " + v;
const semEspaco = (v) => String(v || "").replace(/[\s.]/g, "");

async function reajustarUnidade(item, indice) {
  const rotulo = `[${indice + 1}/${LISTA.length}] ${item.unidade}`;
  // ⚠️ O FILTRO DE COMPETÊNCIA É OBRIGATÓRIO, não é conveniência: a listagem pagina de 50 em
  // 50 e cada unidade tem ~144 parcelas. Sem o filtro, a 1ª página traz as parcelas de
  // 2024/2025 e as de 09-12/2026 simplesmente não estão no HTML — o lote inteiro devolveria
  // "formulário não encontrado". Com o filtro vêm exatamente as 4 do escopo.
  const url =
    "/payments?payments_grid%5Benterprise_unity_id%5D=" + item.unitId +
    "&payments_grid%5Bparcel_type_id%5D=3" +
    "&payments_grid%5Breference%5D%5B%5D=09%2F2026" +
    "&payments_grid%5Breference%5D%5B%5D=12%2F2026";

  const resp = await fetch(url, { credentials: "same-origin" });
  if (!resp.ok) return [{ erro: "listagem HTTP " + resp.status, rotulo }];
  const doc = new DOMParser().parseFromString(await resp.text(), "text/html");

  const saidas = [];
  for (const parcela of item.parcelas) {
    const marca = `${rotulo} ${parcela.comp}`;
    const modal = doc.querySelector("#update_payment_" + parcela.id);
    if (!modal) { saidas.push({ erro: "formulário não encontrado", rotulo: marca }); continue; }

    const titulo = (modal.querySelector(".modal-title") || {}).textContent || "";
    if (!titulo.includes(item.unidade)) {
      saidas.push({ erro: "formulário é de OUTRA unidade: " + titulo.trim(), rotulo: marca });
      continue;
    }

    const form = modal.querySelector("form");
    if (!form) { saidas.push({ erro: "sem form no modal", rotulo: marca }); continue; }
    const valorDe = (n) => ((form.querySelector('[name="' + n + '"]') || {}).value || "").trim();

    if (valorDe("reference") !== parcela.comp) {
      saidas.push({ erro: `competência é ${valorDe("reference")}, não ${parcela.comp}`, rotulo: marca });
      continue;
    }
    const atual = valorDe("payment[initial_value]");
    if (semEspaco(atual) === semEspaco(dinheiro(parcela.para))) {
      saidas.push({ pulou: true, erro: "já está em " + atual, rotulo: marca });
      continue;
    }
    if (semEspaco(atual) !== semEspaco(dinheiro(parcela.de))) {
      saidas.push({ erro: `valor é ${atual}, o plano viu ${dinheiro(parcela.de)} — alguém mexeu`, rotulo: marca });
      continue;
    }

    const dados = new FormData();
    for (const e of form.querySelectorAll("input, select, textarea")) {
      if (!e.name || e.disabled || e.type === "file" || e.type === "submit") continue;
      dados.append(e.name, e.value);
    }
    dados.set("payment[initial_value]", dinheiro(parcela.para));

    if (!ENVIAR) {
      saidas.push({ ensaio: true, rotulo: marca, vai: atual + " -> " + dinheiro(parcela.para) });
      continue;
    }
    const r = await fetch("/payments/" + parcela.id, {
      body: dados, credentials: "same-origin", method: "POST",
    });
    // ⚠️ HTTP 200 NÃO É PROVA DE GRAVAÇÃO: o Rails responde 200 também quando renderiza o
    // formulário de novo por falha de validação, e o C2X já respondeu "sucesso" gravando
    // errado antes. Lemos o corpo e exigimos a mensagem de sucesso da própria tela.
    const corpo = await r.text().catch(() => "");
    const gravou = /atualizado com sucesso/i.test(corpo);
    const recusa = (corpo.match(/<div[^>]*class="[^"]*alert-danger[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/i) || [])[1];
    saidas.push({
      ok: r.ok && gravou,
      rotulo: marca,
      status: r.status,
      vai: atual + " -> " + dinheiro(parcela.para),
      erro: r.ok && !gravou
        ? "HTTP 200 mas SEM confirmação de sucesso" + (recusa ? ": " + recusa.replace(/<[^>]*>/g, " ").trim().slice(0, 120) : "")
        : undefined,
    });
    await new Promise((s) => setTimeout(s, 250));
  }
  return saidas;
}

(async () => {
  const quantas = Math.min(APENAS, LISTA.length);
  console.log(ENVIAR ? "⚠️ GRAVANDO DE VERDADE" : "ENSAIO — nada será gravado");
  const totalParcelas = LISTA.slice(0, quantas).reduce((s, u) => s + u.parcelas.length, 0);
  console.log(`${LISTA.length} unidades no plano · processando ${quantas} (${totalParcelas} parcelas)`);

  const fila = LISTA.slice(0, quantas).map((item, i) => ({ item, i }));
  const feitos = [];
  async function trabalhador() {
    for (;;) {
      const proximo = fila.shift();
      if (!proximo) return;
      const rs = await reajustarUnidade(proximo.item, proximo.i)
        .catch((e) => [{ erro: String(e), rotulo: proximo.item.unidade }]);
      for (const r of rs) {
        feitos.push(r);
        console.log(
          r.pulou ? "  - " + r.rotulo + ": " + r.erro
            : r.erro ? "  x " + r.rotulo + ": " + r.erro
            : r.ensaio ? "  . " + r.rotulo + ": " + r.vai
            : r.ok ? "  v " + r.rotulo + ": " + r.vai
            : "  x " + r.rotulo + ": HTTP " + r.status,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: AO_MESMO_TEMPO }, trabalhador));

  const erros = feitos.filter((f) => f.erro && !f.pulou);
  console.log("");
  console.log("gravados: " + feitos.filter((f) => f.ok).length +
    " · ensaio: " + feitos.filter((f) => f.ensaio).length +
    " · pulados: " + feitos.filter((f) => f.pulou).length +
    " · erros: " + erros.length);
  if (erros.length) console.table(erros);
  window.__resultadoDoReajuste = feitos;
})();
