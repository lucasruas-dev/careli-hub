import { describe, expect, it } from "vitest";

// A RESERVA EXIGE UM DOS DOIS: IMOBILIÁRIA **OU** CORRETOR AUTÔNOMO, E NUNCA NENHUM.
//
// Lucas (28/09/2026), sobre deixar a reserva nascer no nome do corretor autônomo:
// *"pode fazer, exige um dos dois"*.
//
// ⚠️ NENHUM DOS DOIS É RESERVA ÓRFÃ: ninguém para avisar e ninguém para comissionar. A régua antiga
// exigia a imobiliária e por isso nunca precisou desta conta; agora a exigência é conjunta, e é o
// caso "os dois nulos" que passa a ser o furo — sem ele, a reserva sai sem dono nenhum.
//
// ⚠️ E O `campo` DO ERRO CONTINUA SENDO `imobiliaria`, de propósito. A modal desenha a frase por
// campo (`erroDe("imobiliaria")`, ModalDeReserva.tsx), e um campo novo apareceria em lugar nenhum.
//
// ⚠️ MEDIDO EM PRODUÇÃO (bxgukywoxgivlrhjkwjx, 28/09/2026, só SELECT): `select count(*) filter
// (where imobiliaria_entity_id is null and corretor_entity_id is not null) as so_corretor, count(*)
// filter (where imobiliaria_entity_id is null and corretor_entity_id is null) as sem_nenhum,
// count(*) from hercules_reservas;` → 0 / 0 / 36. Este caminho é INÉDITO: nenhuma das 36 reservas de
// hoje exercita um destes ramos.

import {
  avisosDaReserva,
  avisosDeCancelamento,
  comoFoiOAviso,
  conferirReserva,
  type PedidoDeReserva,
  RESERVA_SEM_QUEM_VENDE,
} from "./reserva";

const AGORA = "2026-09-28T17:00:00.000Z";

const PEDIDO: PedidoDeReserva = {
  corretorEntityId: null,
  imobiliariaEntityId: null,
  proponente: { documento: "529.982.247-25", nome: "Maria da Silva", telefone: "(62) 99123-4567" },
  unidadeId: "uni-1",
  validadeEm: "2026-10-01T23:59:59.000Z",
};

describe("a régua da reserva: um dos dois", () => {
  it("⚠️ com o corretor AUTÔNOMO e sem imobiliária, a reserva é aceita", () => {
    expect(conferirReserva({ ...PEDIDO, corretorEntityId: "aut-1" }, AGORA)).toEqual([]);
  });

  it("com imobiliária e sem corretor, continua aceita, exatamente como antes", () => {
    expect(conferirReserva({ ...PEDIDO, imobiliariaEntityId: "imo-1" }, AGORA)).toEqual([]);
  });

  it("com os dois, continua aceita", () => {
    expect(
      conferirReserva({ ...PEDIDO, corretorEntityId: "cor-1", imobiliariaEntityId: "imo-1" }, AGORA),
    ).toEqual([]);
  });

  it("⚠️ SEM NENHUM DOS DOIS é recusada, com a frase que diz os dois caminhos", () => {
    const erros = conferirReserva(PEDIDO, AGORA);
    expect(erros).toEqual([{ campo: "imobiliaria", mensagem: RESERVA_SEM_QUEM_VENDE }]);
    // A frase tem de nomear as DUAS saídas: quem lê "precisa de uma imobiliária" não descobre que
    // pode escolher um corretor autônomo, e vai pedir credenciamento de imobiliária.
    expect(RESERVA_SEM_QUEM_VENDE).toContain("imobiliária");
    expect(RESERVA_SEM_QUEM_VENDE).toContain("corretor autônomo");
  });

  it("string vazia conta como ausência, e não como um vínculo qualquer", () => {
    // A rota normaliza para `null`, mas a modal em cache de um coordenador continua mandando "".
    const erros = conferirReserva(
      { ...PEDIDO, corretorEntityId: "", imobiliariaEntityId: "" },
      AGORA,
    );
    expect(erros.map((e) => e.campo)).toEqual(["imobiliaria"]);
  });
});

// ── O AVISO NÃO PODE CAIR NO SILÊNCIO, E NÃO PODE MENTIR ─────────────────────
//
// ⚠️ SEM ESTE RAMO O QUADRO DO COORDENADOR SAÍA COM `Imobiliária: *Imobiliária*` — o nome que
// `destinatariosDaVenda` fabricava quando o id chegava vazio (avisos-da-venda.ts). Mensagem enviada
// não volta, e "Imobiliária: Imobiliária" num quadro de venda de pessoa física é exatamente a
// informação que o Lucas proibiu em 27/09/2026: *"nao quero ter a informacao que pode ter pessoa
// fisica como imobiliaria"*.
describe("os textos da reserva sem imobiliária", () => {
  const DADOS = {
    cliente: "Maria da Silva",
    codigo: "000123",
    corretor: "JOAO AUTONOMO",
    cpf: "529.982.247-25",
    empreendimento: "Vale do Ouro",
    imobiliaria: null,
    unidade: "Quadra 12 · Lote 06",
    validadeEm: "2026-10-01T23:59:59.000Z",
  };

  it("⚠️ NÃO monta o texto do papel `imobiliaria`: destino sem texto vira falha calada na tela", () => {
    // `avisarSobreAVenda` casa texto e destino POR PAPEL: um texto sem destino é desperdício, mas um
    // destino sem texto volta `{ motivo: "sem texto", ok: false }` e a tela diz que o aviso falhou.
    const textos = avisosDaReserva(DADOS);
    expect(textos.map((t) => t.papel)).toEqual(["corretor", "coordenador"]);
  });

  it("⚠️ o quadro do coordenador NÃO escreve a palavra Imobiliária, e diz que a venda é de autônomo", () => {
    const coordenador = avisosDaReserva(DADOS).find((t) => t.papel === "coordenador")!;
    expect(coordenador.texto).not.toMatch(/Imobiliária/);
    expect(coordenador.texto).toContain("autônomo");
    // O corretor continua nomeado: é a única pessoa que vendeu.
    expect(coordenador.texto).toContain("JOAO AUTONOMO");
  });

  it("com imobiliária, os três textos continuam idênticos ao de sempre", () => {
    const textos = avisosDaReserva({ ...DADOS, imobiliaria: "GURGEL" });
    expect(textos.map((t) => t.papel)).toEqual(["corretor", "imobiliaria", "coordenador"]);
    expect(textos.find((t) => t.papel === "coordenador")!.texto).toContain("Imobiliária: *GURGEL*");
  });

  it("⚠️ o CANCELAMENTO da reserva do autônomo também avisa, e sem rótulo de imobiliária", () => {
    // O corretor que leu "o lote é seu até quinta" não pode descobrir pelo mapa que deixou de ser.
    const textos = avisosDeCancelamento({
      cliente: "Maria da Silva",
      codigo: "000123",
      corretor: "JOAO AUTONOMO",
      empreendimento: "Vale do Ouro",
      imobiliaria: null,
      motivo: "Cliente desistiu",
      unidade: "Quadra 12 · Lote 06",
    });
    expect(textos.map((t) => t.papel)).toEqual(["corretor", "coordenador"]);
    expect(textos.find((t) => t.papel === "coordenador")!.texto).not.toMatch(/Imobiliária/);
  });
});

describe("a frase que o operador lê depois de reservar", () => {
  it("⚠️ não fala de telefone de imobiliária numa venda que não tem imobiliária", () => {
    // A frase falsa era "imobiliária não tem telefone cadastrado", que manda o operador procurar
    // cadastro que não existe nesta venda.
    const frase = comoFoiOAviso([
      { ok: true, para: "corretor" },
      { ok: true, para: "coordenador" },
    ]);
    expect(frase).toBe("Aviso enviado para corretor e coordenador.");
    expect(frase).not.toMatch(/imobiliária/);
  });
});
