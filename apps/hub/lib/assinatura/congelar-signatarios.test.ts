import { describe, expect, it } from "vitest";

import { congelarSignatarios } from "./congelar-signatarios";

// O QUE ESTE TESTE TRAVA (Nívea, 24/09/2026): *"Deu erro no envio dos acordos. Não recebi e não
// consigo reenviar."*
//
// Medido em 24/09/2026: o ENVIO de AC-000051 não falhou (`temis_envelopes` com `falha` vazia,
// `estado='aguardando'`, `estado_cru='clicksign:signature_started'`, `enviado_em` 23/09 13:11:33Z,
// que é o "enviado em 23/09/2026 10:11" do print). Quem devolvia 422 era o REENVIO: o endpoint é
// `POST /envelopes/{id}/signers/{signer_id}/notifications`, e o id que a Clicksign criou existia
// por milissegundos dentro de `enviarParaAssinatura` e era jogado fora — o carimbo congelava só
// {email, nome, ordem, papel}.
//
// ⚠️ O CAMPO É `chave`, E NÃO UM NOME NOVO. `temis_envelopes.signatarios` já tem essa chave desde a
// troca de e-mail ("o id na Clicksign, quando já sabemos"), com leitor pronto em
// `lib/temis/trocar-signatario.ts:66-99`. Um `signerId` ao lado seria um segundo nome para a mesma
// coisa, e o leitor antigo não o veria.

const pessoa = {
  email: "Comprador@Exemplo.test",
  nome: "Iago Barbosa Ferreira Mesquita",
  ordem: 1,
  papel: "comprador" as const,
};

const vendedora = {
  email: "representante@incorporadora.test",
  nome: "Fulana Representante Legal",
  ordem: 2,
  papel: "vendedora" as const,
};

describe("congelarSignatarios", () => {
  it("congela o id que a Clicksign devolveu, casando pelo e-mail sem ligar para a caixa alta", () => {
    const congelados = congelarSignatarios([pessoa, vendedora], {
      "comprador@exemplo.test": "sig-clicksign-1",
      "representante@incorporadora.test": "sig-clicksign-2",
    });

    expect(congelados).toEqual([
      {
        chave: "sig-clicksign-1",
        email: "Comprador@Exemplo.test",
        nome: "Iago Barbosa Ferreira Mesquita",
        ordem: 1,
        papel: "comprador",
      },
      {
        chave: "sig-clicksign-2",
        email: "representante@incorporadora.test",
        nome: "Fulana Representante Legal",
        ordem: 2,
        papel: "vendedora",
      },
    ]);
  });

  it("sem o mapa de ids a lista continua igual à de antes, e NÃO inventa chave", () => {
    // É o caso dos 16 envelopes de acordo já enviados: eles nasceram sem id congelado e vão
    // continuar sem. O que não pode acontecer é nascer uma `chave` falsa no lugar.
    const congelados = congelarSignatarios([pessoa], undefined);

    expect(congelados).toEqual([
      { email: "Comprador@Exemplo.test", nome: "Iago Barbosa Ferreira Mesquita", ordem: 1, papel: "comprador" },
    ]);
    expect("chave" in (congelados[0] ?? {})).toBe(false);
  });

  it("e-mail que não está no mapa não ganha a chave de outra pessoa", () => {
    const congelados = congelarSignatarios([pessoa, vendedora], {
      "comprador@exemplo.test": "sig-clicksign-1",
    });

    expect(congelados[0]?.chave).toBe("sig-clicksign-1");
    expect(congelados[1]?.chave).toBeUndefined();
  });
});
