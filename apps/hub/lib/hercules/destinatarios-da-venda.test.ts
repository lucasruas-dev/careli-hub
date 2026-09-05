import { describe, expect, it } from "vitest";

import { forcaDoContato, telefonesPorEntidade } from "./telefone-do-aviso";

// A ESCOLHA DO NÚMERO PARA ONDE O AVISO DA VENDA VAI.
//
// ⚠️ ISTO NASCEU DE UM DEFEITO MEDIDO EM PRODUÇÃO. Nas cinco reservas já disparadas, corretor e
// coordenador receberam e a imobiliária falhou nas CINCO, sempre com "sem telefone" — a RAIANE
// IMOBILIARIA tem contato cadastrado como `whatsapp` e `email`, e nunca teve `phone`. A consulta
// de `destinatariosDaVenda` filtrava `contact_type = 'phone'` e só isso.
//
// O tamanho do buraco, medido no banco: das 5.745 entidades com algum contato, 3.941 têm APENAS
// `whatsapp` — 69% invisíveis para um disparo que sai justamente por WhatsApp.

const escolher = telefonesPorEntidade;

const wa = (entity_id: string, value: string, is_primary = false) => ({
  contact_type: "whatsapp",
  entity_id,
  is_primary,
  value,
});

const fone = (entity_id: string, value: string, is_primary = false) => ({
  contact_type: "phone",
  entity_id,
  is_primary,
  value,
});

describe("para qual número o aviso da venda vai", () => {
  it("⚠️ acha quem só tem whatsapp — o caso dos 3.941 invisíveis", () => {
    // A RAIANE IMOBILIARIA, exatamente como ela está no banco: whatsapp e email, sem phone.
    const escolhido = escolher([wa("imob-1", "62991234567", true)]);
    expect(escolhido.get("imob-1")).toBe("62991234567");
  });

  it("⚠️ com os dois cadastrados, o whatsapp ganha — é o canal do disparo", () => {
    // O `phone` pode ser um fixo, que o gateway aceita e nunca entrega.
    const escolhido = escolher([
      fone("imob-1", "6232221111", true),
      wa("imob-1", "62991234567"),
    ]);
    expect(escolhido.get("imob-1")).toBe("62991234567");
  });

  it("entre dois whatsapp, o primário ganha", () => {
    const escolhido = escolher([wa("corr-1", "62988880000"), wa("corr-1", "62999991111", true)]);
    expect(escolhido.get("corr-1")).toBe("62999991111");
  });

  it("só phone continua valendo — ninguém perde o número que já funcionava", () => {
    const escolhido = escolher([fone("coord-1", "6232221111")]);
    expect(escolhido.get("coord-1")).toBe("6232221111");
  });

  it("valor vazio ou só espaço não vira destinatário", () => {
    // Um contato em branco escolhido como destino manda a mensagem para lugar nenhum e ainda
    // esconde o número bom que viria depois na lista.
    const escolhido = escolher([wa("imob-1", "   ", true), fone("imob-1", "6232221111")]);
    expect(escolhido.get("imob-1")).toBe("6232221111");
  });

  it("entidade sem contato nenhum fica de fora, e não com string vazia", () => {
    expect(escolher([]).get("imob-1")).toBeUndefined();
  });

  it("cada entidade escolhe o seu, sem misturar", () => {
    const escolhido = escolher([
      wa("imob-1", "62991111111", true),
      wa("corr-1", "62992222222", true),
      fone("coord-1", "6233333333"),
    ]);
    expect(escolhido.get("imob-1")).toBe("62991111111");
    expect(escolhido.get("corr-1")).toBe("62992222222");
    expect(escolhido.get("coord-1")).toBe("6233333333");
  });
});

describe("forcaDoContato", () => {
  it("ordena whatsapp-primario > whatsapp > phone-primario > phone", () => {
    const wp = forcaDoContato({ contact_type: "whatsapp", is_primary: true });
    const w = forcaDoContato({ contact_type: "whatsapp", is_primary: false });
    const fp = forcaDoContato({ contact_type: "phone", is_primary: true });
    const f = forcaDoContato({ contact_type: "phone", is_primary: false });
    expect(wp).toBeGreaterThan(w);
    expect(w).toBeGreaterThan(fp);
    expect(fp).toBeGreaterThan(f);
  });
});
