// ═══════════════════════════════════════════════════════════════════════════
// BAIXA DO "ATO" DE R$ 1.000 — VALE DO OURO
//
// COMO USAR (no Chrome JÁ LOGADO no C2X, em https://sistema.careli.adm.br/payments):
//   1. F12 -> aba Console
//   2. cole este arquivo inteiro e dê Enter  -> roda em ENSAIO, não grava nada
//   3. leia o resumo; se estiver certo, troque ENVIAR para true e rode de novo
//   4. na primeira vez de verdade deixe APENAS = 1: faz UMA baixa, você confere no C2X,
//      e só então aumenta para o restante
//
// O QUE FAZ POR UNIDADE: abre a listagem filtrada por AQUELA unidade + tipo ATO, acha o
// formulário daquele pagamento e envia o MESMO PATCH que o botão Salvar do modal envia.
//
// ⚠️ AS QUATRO CONFERÊNCIAS. Qualquer uma que falhe = pula e registra, nunca "tenta assim
// mesmo":
//   1. o formulário daquele payment_id existe na listagem daquela unidade
//   2. o título do modal bate com a unidade esperada
//   3. o valor da parcela é R$ 1.000,00
//   4. a data de pagamento está VAZIA (se já tem, alguém baixou antes — não mexe)
//
// ⚠️ A DATA LANÇADA É A DO PIX (23 a 30/07), não a de hoje. O dinheiro entrou em julho;
// lançar agosto bagunçaria o histórico e qualquer conferência futura com o extrato.
//
// ⚠️ O STATUS NÃO É ENVIADO. Na tela ele aparece desabilitado: o servidor deriva "Pago" a
// partir da data e do valor. Mandar o campo à mão seria inventar um caminho que a tela não usa.
//
// ⚠️ NÃO CLICA EM MAIS NADA. A mesma tela tem "Apagar parcelas em aberto" a poucos pixels;
// por isso aqui não há clique nenhum — só o POST do formulário certo, achado por id.
// ═══════════════════════════════════════════════════════════════════════════

const ENVIAR = false;   // <- true grava de verdade
const APENAS = 1;       // <- quantas processar (deixe 1 na primeira vez de verdade)

const LISTA = [
  {
    "dataDoPix": "2026-07-25",
    "empresaId": 37,
    "paymentId": 350656,
    "refAsaas": "pay_neqqb029iq38tzf7",
    "unidade": "VOC0715",
    "unitId": 5657
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 349861,
    "refAsaas": "pay_7zyp5jhbevx6660q",
    "unidade": "VOC0116",
    "unitId": 5528
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 348906,
    "refAsaas": "pay_7ugt0ltv0w0mutf0",
    "unidade": "VOC0223",
    "unitId": 5554
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 329062,
    "refAsaas": "pay_nq87o7xc47ps64sd",
    "unidade": "VOL0802",
    "unitId": 5669
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 349702,
    "refAsaas": "pay_oj1hzp0unt3mn9st",
    "unidade": "VOC1006",
    "unitId": 5692
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 329050,
    "refAsaas": "pay_tc0l686kie4pbzj7",
    "unidade": "VOL0524",
    "unitId": 5626
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 346741,
    "refAsaas": "pay_529m1o9bdku3bfjo",
    "unidade": "VOC0219",
    "unitId": 5550
  },
  {
    "dataDoPix": "2026-07-30",
    "empresaId": 36,
    "paymentId": 338806,
    "refAsaas": "pay_qgzaz30gveypiype",
    "unidade": "VOL0204",
    "unitId": 5535
  },
  {
    "dataDoPix": "2026-07-25",
    "empresaId": 36,
    "paymentId": 341186,
    "refAsaas": "pay_gx2aqdvzi7lnbkou",
    "unidade": "VOL1228",
    "unitId": 5769
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 339915,
    "refAsaas": "pay_1z5s831eoua8wndg",
    "unidade": "VOL1212",
    "unitId": 5753
  },
  {
    "dataDoPix": "2026-07-29",
    "empresaId": 37,
    "paymentId": 329159,
    "refAsaas": "pay_x9c6dy7ugualmpju",
    "unidade": "VOC0310",
    "unitId": 5575
  },
  {
    "dataDoPix": "2026-07-27",
    "empresaId": 37,
    "paymentId": 334845,
    "refAsaas": "pay_ndh8ijqnmpw005ua",
    "unidade": "VOC0412",
    "unitId": 6215
  },
  {
    "dataDoPix": "2026-07-27",
    "empresaId": 37,
    "paymentId": 335321,
    "refAsaas": "pay_g4v2z4s7eu218as7",
    "unidade": "VOC1227",
    "unitId": 5768
  },
  {
    "dataDoPix": "2026-07-25",
    "empresaId": 37,
    "paymentId": 333415,
    "refAsaas": "pay_ugozeim24ei2i58c",
    "unidade": "VOC0228",
    "unitId": 5559
  },
  {
    "dataDoPix": "2026-07-25",
    "empresaId": 36,
    "paymentId": 339281,
    "refAsaas": "pay_go7fmql1ppf60boi",
    "unidade": "VOL0207",
    "unitId": 5538
  },
  {
    "dataDoPix": "2026-07-25",
    "empresaId": 36,
    "paymentId": 340391,
    "refAsaas": "pay_td7y1o0u63a4124m",
    "unidade": "VOL1213",
    "unitId": 5754
  },
  {
    "dataDoPix": "2026-07-25",
    "empresaId": 36,
    "paymentId": 339441,
    "refAsaas": "pay_8xug7tap8bz5q114",
    "unidade": "VOL1034",
    "unitId": 5720
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 336585,
    "refAsaas": "pay_0h7mffyja3sehi4q",
    "unidade": "VOL0316",
    "unitId": 5581
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 347853,
    "refAsaas": "pay_25x7qgucsu4cr1w5",
    "unidade": "VOC0717",
    "unitId": 5659
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 347695,
    "refAsaas": "pay_2kjamtvlb8f1312v",
    "unidade": "VOC0501",
    "unitId": 5603
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 331669,
    "refAsaas": "pay_8s356jwpa0rl71eu",
    "unidade": "VOC0521",
    "unitId": 5623
  },
  {
    "dataDoPix": "2026-07-25",
    "empresaId": 36,
    "paymentId": 339599,
    "refAsaas": "pay_j0ir262x5raxajm2",
    "unidade": "VOL0302",
    "unitId": 5567
  },
  {
    "dataDoPix": "2026-07-29",
    "empresaId": 36,
    "paymentId": 338330,
    "refAsaas": "pay_bxvfq9n4gyj6q9pe",
    "unidade": "VOL0232",
    "unitId": 5563
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 339757,
    "refAsaas": "pay_pvl101csmxmd4qn4",
    "unidade": "VOL0509",
    "unitId": 5611
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 350337,
    "refAsaas": "pay_rmcs5cd8rhjitpnh",
    "unidade": "VOL0709",
    "unitId": 5652
  },
  {
    "dataDoPix": "2026-07-26",
    "empresaId": 36,
    "paymentId": 337378,
    "refAsaas": "pay_uqin8n1mqdoqf9r1",
    "unidade": "VOL0118",
    "unitId": 5530
  },
  {
    "dataDoPix": "2026-07-28",
    "empresaId": 36,
    "paymentId": 346583,
    "refAsaas": "pay_tbgsw7966ce3rb36",
    "unidade": "VOL0208",
    "unitId": 5539
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 334369,
    "refAsaas": "pay_dt8814mkojramk58",
    "unidade": "VOC0406",
    "unitId": 5595
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 348587,
    "refAsaas": "pay_cxij5jsastdt4q3r",
    "unidade": "VOL0114",
    "unitId": 5526
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 347218,
    "refAsaas": "pay_50nb0bzpmo0n15uo",
    "unidade": "VOC0324",
    "unitId": 5589
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 336110,
    "refAsaas": "pay_vjz1z6xi6013qm4f",
    "unidade": "VOC0401",
    "unitId": 5590
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 344363,
    "refAsaas": "pay_qokm6celwgsm15y7",
    "unidade": "VOL0211",
    "unitId": 5542
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 331985,
    "refAsaas": "pay_artvxajr7exx6lzz",
    "unidade": "VOC0113",
    "unitId": 5525
  },
  {
    "dataDoPix": "2026-07-30",
    "empresaId": 37,
    "paymentId": 334527,
    "refAsaas": "pay_1q4kqvao3ybc99or",
    "unidade": "VOC0313",
    "unitId": 5578
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 348377,
    "refAsaas": "pay_96izttqeiwe3w33q",
    "unidade": "VOC0525",
    "unitId": 5627
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 336905,
    "refAsaas": "pay_710mdpa6fodsqoj3",
    "unidade": "VOL0216",
    "unitId": 5547
  },
  {
    "dataDoPix": "2026-07-24",
    "empresaId": 36,
    "paymentId": 344202,
    "refAsaas": "pay_a7u4otom6lp87bt9",
    "unidade": "VOL1312",
    "unitId": 5786
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 331038,
    "refAsaas": "pay_tgrk2ksimem0azhp",
    "unidade": "VOC0108",
    "unitId": 5520
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 347379,
    "refAsaas": "pay_ijys7qd9w3nzetzj",
    "unidade": "VOC0321",
    "unitId": 5586
  },
  {
    "dataDoPix": "2026-07-24",
    "empresaId": 36,
    "paymentId": 341820,
    "refAsaas": "pay_mf4xwe2gz4s4nqzq",
    "unidade": "VOL1232",
    "unitId": 5773
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 348746,
    "refAsaas": "pay_1c1ht3de013jj08r",
    "unidade": "VOC0112",
    "unitId": 5524
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 332143,
    "refAsaas": "pay_91hh2jy443jcsxzm",
    "unidade": "VOC0704",
    "unitId": 5647
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 343886,
    "refAsaas": "pay_u0cdebk3k3ygr8zm",
    "unidade": "VOC0405",
    "unitId": 5594
  },
  {
    "dataDoPix": "2026-07-30",
    "empresaId": 37,
    "paymentId": 350496,
    "refAsaas": "pay_04178dzb710s0hv1",
    "unidade": "VOC1108",
    "unitId": 5737
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 331354,
    "refAsaas": "pay_qa15y7i8vmp3f01o",
    "unidade": "VOC0109",
    "unitId": 5521
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 335952,
    "refAsaas": "pay_9gecdx0ctu115jzm",
    "unidade": "VOC0516",
    "unitId": 5618
  },
  {
    "dataDoPix": "2026-07-30",
    "empresaId": 36,
    "paymentId": 350816,
    "refAsaas": "pay_2bnl7j874q00f9y1",
    "unidade": "VOL1230",
    "unitId": 5771
  },
  {
    "dataDoPix": "2026-07-27",
    "empresaId": 37,
    "paymentId": 334687,
    "refAsaas": "pay_vzosjb7rd4nqwhtd",
    "unidade": "VOC1029",
    "unitId": 5715
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 336426,
    "refAsaas": "pay_5rkosbdesxap19ki",
    "unidade": "VOL1008",
    "unitId": 5694
  },
  {
    "dataDoPix": "2026-07-24",
    "empresaId": 37,
    "paymentId": 330721,
    "refAsaas": "pay_br93mn8ukoicsd09",
    "unidade": "VOC0213",
    "unitId": 5544
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 351489,
    "refAsaas": "pay_xpymw0lljcom3pzn",
    "unidade": "VOL0705",
    "unitId": 5648
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 337856,
    "refAsaas": "pay_z5owfv0ssi1k0lxg",
    "unidade": "VOL1012",
    "unitId": 5698
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 347537,
    "refAsaas": "pay_nxtekp1dz2hn05uv",
    "unidade": "VOC0234",
    "unitId": 5565
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 340075,
    "refAsaas": "pay_mifec1rlkxda9p6g",
    "unidade": "VOL1208",
    "unitId": 5749
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 338648,
    "refAsaas": "pay_p1wqfqwaabx0lgr2",
    "unidade": "VOL0901",
    "unitId": 5670
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 349223,
    "refAsaas": "pay_fdzg27g3f365zfk9",
    "unidade": "VOL0103",
    "unitId": 5515
  },
  {
    "dataDoPix": "2026-07-24",
    "empresaId": 37,
    "paymentId": 349383,
    "refAsaas": "pay_bz31p5sm53hs2vl2",
    "unidade": "VOC0209",
    "unitId": 5540
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 344999,
    "refAsaas": "pay_tu2j2ixbjsl6wlwq",
    "unidade": "VOL1503",
    "unitId": 5809
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 328998,
    "refAsaas": "pay_a2qrkoxwq76t5l0x",
    "unidade": "VOL0505",
    "unitId": 5607
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 335163,
    "refAsaas": "pay_bm8wl8x5br9yv5iy",
    "unidade": "VOC0502",
    "unitId": 5604
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 345632,
    "refAsaas": "pay_rx3acj5rvxr8ivan",
    "unidade": "VOL0101",
    "unitId": 5513
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 36,
    "paymentId": 342297,
    "refAsaas": "pay_n73cyw9apijllhut",
    "unidade": "VOL1304",
    "unitId": 5778
  },
  {
    "dataDoPix": "2026-07-23",
    "empresaId": 37,
    "paymentId": 345947,
    "refAsaas": "pay_o5us0lzund6esuh7",
    "unidade": "VOC0526",
    "unitId": 5628
  },
  {
    "dataDoPix": "2026-07-27",
    "empresaId": 37,
    "paymentId": 345474,
    "refAsaas": "pay_1rh1s5akch456fnx",
    "unidade": "VOC1028",
    "unitId": 5714
  },
  {
    "dataDoPix": "2026-07-27",
    "empresaId": 37,
    "paymentId": 329313,
    "refAsaas": "pay_h7z8uuvm3i8g1psd",
    "unidade": "VOC0917",
    "unitId": 5686
  }
];

const VALOR = "R$ 1.000,00";
const dataBR = (iso) => iso.split("-").reverse().join("/");

async function baixar(item, indice) {
  const rotulo = `[${indice + 1}] ${item.unidade}`;
  const url =
    "/payments?payments_grid%5Benterprise_unity_id%5D=" + item.unitId +
    "&payments_grid%5Bparcel_type_id%5D=1";

  const pagina = await fetch(url, { credentials: "same-origin" }).then((r) => r.text());
  const doc = new DOMParser().parseFromString(pagina, "text/html");
  const modal = doc.querySelector("#update_payment_" + item.paymentId);
  if (!modal) return { erro: "formulário não encontrado nessa unidade", rotulo };

  const titulo = (modal.querySelector(".modal-title") || {}).textContent || "";
  if (!titulo.includes(item.unidade)) {
    return { erro: "o formulário é de OUTRA unidade: " + titulo.trim(), rotulo };
  }

  const campo = (n) => (modal.querySelector('[name="payment[' + n + ']"]') || {}).value || "";
  const semEspaco = (v) => v.replace(/\s/g, "");
  if (semEspaco(campo("initial_value")) !== semEspaco(VALOR)) {
    return { erro: "valor é " + campo("initial_value") + ", não " + VALOR, rotulo };
  }
  if (campo("payment_date").trim() !== "") {
    return { pulou: true, erro: "já baixado em " + campo("payment_date"), rotulo };
  }

  const form = modal.querySelector("form");
  const dados = new FormData();
  for (const e of form.querySelectorAll("input, select, textarea")) {
    if (!e.name || e.disabled || e.type === "file" || e.type === "submit") continue;
    dados.append(e.name, e.value);
  }
  dados.set("payment[payment_date]", dataBR(item.dataDoPix));
  dados.set("payment[paid_value]", VALOR);

  if (!ENVIAR) {
    return { ensaio: true, rotulo, vai: "data " + dataBR(item.dataDoPix) + " · pago " + VALOR };
  }

  const r = await fetch("/payments/" + item.paymentId, {
    body: dados,
    credentials: "same-origin",
    method: "POST",
  });
  return { ok: r.ok, rotulo, status: r.status };
}

(async () => {
  const quantas = Math.min(APENAS, LISTA.length);
  console.log(ENVIAR ? "GRAVANDO DE VERDADE" : "ENSAIO — nada será gravado");
  console.log(LISTA.length + " na lista · processando " + quantas);

  const feitos = [];
  for (const [i, item] of LISTA.slice(0, quantas).entries()) {
    const r = await baixar(item, i).catch((e) => ({ erro: String(e), rotulo: item.unidade }));
    feitos.push(r);
    console.log(
      r.pulou ? "  - " + r.rotulo + ": " + r.erro
        : r.erro ? "  x " + r.rotulo + ": " + r.erro
        : r.ensaio ? "  . " + r.rotulo + ": baixaria " + r.vai
        : r.ok ? "  v " + r.rotulo + ": BAIXADO"
        : "  x " + r.rotulo + ": HTTP " + r.status,
    );
    await new Promise((s) => setTimeout(s, 400));
  }

  const erros = feitos.filter((f) => f.erro && !f.pulou);
  console.log("");
  console.log("baixados: " + feitos.filter((f) => f.ok).length +
    " · pulados: " + feitos.filter((f) => f.pulou).length +
    " · erros: " + erros.length);
  if (erros.length) console.table(erros);
  window.__resultadoDaBaixa = feitos;
})();
