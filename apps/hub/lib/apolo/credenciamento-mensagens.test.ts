import { describe, expect, it } from "vitest";

import {
  mensagemCoordenadorHabilitacao,
  mensagemImobiliariaCorrecao,
  mensagemImobiliariaHabilitada,
  mensagemImobiliariaIndeferida,
} from "./credenciamento-mensagens";

// Regra do Lucas (15/08/2026): "pode ser que a imobiliária só fez o processo de habilitar para
// trabalhar aquele empreendimento, pois ela já possuía cadastro, e vão ter imobiliária que estão
// trabalhando a primeira vez com a gente, a mensagem tem que ser diferente".

const vale = [{ label: "VALE DO OURO" }];

describe("mensagem para a imobiliária", () => {
  it("PRIMEIRA VEZ: dá as boas-vindas e diz que está credenciada", () => {
    const texto = mensagemImobiliariaHabilitada({
      empreendimentos: vale,
      imobiliaria: "ALPHA VILLA",
      primeiraVez: true,
      representante: "Marcos Antonio Silva",
    });

    expect(texto).toContain("Olá, Marcos!");
    expect(texto).toContain("credenciada");
    expect(texto).toContain("*ALPHA VILLA*");
    // Não pode sugerir que ela já trabalhava com a gente.
    expect(texto).not.toContain("mais um empreendimento");
    expect(texto).not.toContain("já fazem nos outros");
  });

  it("JÁ CREDENCIADA: fala de empreendimento novo, e NUNCA de 'cadastro aprovado'", () => {
    const texto = mensagemImobiliariaHabilitada({
      empreendimentos: vale,
      imobiliaria: "DIIMOVEIS",
      primeiraVez: false,
    });

    expect(texto).toContain("mais um empreendimento");
    expect(texto).toContain("já fazem nos outros");
    // Dizer isto a um parceiro antigo soa como se tivéssemos perdido o cadastro dele.
    expect(texto).not.toContain("cadastro da");
    expect(texto).not.toContain("foi aprovado");
  });

  it("concorda no plural quando são vários empreendimentos", () => {
    const varios = [{ label: "VALE DO OURO" }, { label: "GARDEN" }];

    expect(
      mensagemImobiliariaHabilitada({
        empreendimentos: varios,
        imobiliaria: "X",
        primeiraVez: false,
      }),
    ).toContain("mais empreendimentos");
    expect(
      mensagemImobiliariaHabilitada({
        empreendimentos: varios,
        imobiliaria: "X",
        primeiraVez: true,
      }),
    ).toContain("Empreendimentos liberados:");
  });

  it("usa SÓ o primeiro nome, e conserta a CAIXA ALTA do cadastro", () => {
    // É assim que o sócio vem gravado em metadata.cadastro.socios[0].nome.
    const texto = mensagemImobiliariaHabilitada({
      empreendimentos: vale,
      imobiliaria: "ATLAS",
      primeiraVez: true,
      representante: "FERNANDO BARBOSA MACHADO",
    });

    expect(texto.startsWith("Olá, Fernando!")).toBe(true);
    expect(texto).not.toContain("FERNANDO");
    expect(texto).not.toContain("BARBOSA");
  });

  it("sem o nome do representante, não inventa saudação quebrada", () => {
    const texto = mensagemImobiliariaHabilitada({
      empreendimentos: vale,
      imobiliaria: "X",
      primeiraVez: true,
    });

    expect(texto.startsWith("Olá!")).toBe(true);
  });

  it("negrito do WhatsApp é UM asterisco, nunca dois", () => {
    const texto = mensagemImobiliariaHabilitada({
      empreendimentos: vale,
      imobiliaria: "X",
      primeiraVez: true,
    });

    expect(texto).not.toContain("**");
  });

  it("nenhuma mensagem para fora usa travessão", () => {
    const textos = [
      mensagemImobiliariaHabilitada({ empreendimentos: vale, imobiliaria: "X", primeiraVez: true }),
      mensagemImobiliariaHabilitada({ empreendimentos: vale, imobiliaria: "X", primeiraVez: false }),
      mensagemImobiliariaIndeferida({
        imobiliaria: "X",
        motivos: ["Contrato social ilegível ou incompleto"],
      }),
    ];

    for (const texto of textos) {
      expect(texto).not.toContain("—");
      expect(texto).not.toContain("–");
    }
  });
});

describe("mensagem para o coordenador", () => {
  it("PRIMEIRA VEZ: anuncia parceiro novo", () => {
    const texto = mensagemCoordenadorHabilitacao({
      cnpj: "61.991.479/0001-60",
      corretores: 2,
      empreendimentos: vale,
      imobiliaria: "ALPHA VILLA",
      primeiraVez: true,
    });

    expect(texto).toContain("*Imobiliária credenciada*");
    expect(texto).toContain("2 corretores cadastrados.");
    expect(texto).not.toContain("já trabalha com a gente");
  });

  it("JÁ CREDENCIADA: avisa que ela entrou NO EMPREENDIMENTO dele", () => {
    const texto = mensagemCoordenadorHabilitacao({
      corretores: 0,
      empreendimentos: vale,
      imobiliaria: "DIIMOVEIS",
      primeiraVez: false,
    });

    expect(texto).toContain("*Imobiliária habilitada no seu empreendimento*");
    expect(texto).toContain("já trabalha com a gente em outros empreendimentos");
    expect(texto).toContain("Ainda sem corretor cadastrado.");
  });
});

describe("indeferimento", () => {
  it("lista os motivos e mantém a porta aberta para retomar", () => {
    const texto = mensagemImobiliariaIndeferida({
      imobiliaria: "X",
      motivos: ["Contrato social ilegível ou incompleto", "CRECI da imobiliária não localizado ou vencido"],
      representante: "Ana Paula",
    });

    expect(texto).toContain("Olá, Ana!");
    expect(texto).toContain("Motivos:");
    expect(texto).toContain("• Contrato social ilegível ou incompleto");
    // Sem o caminho de volta, a imobiliária refaz o cadastro do zero (foi o que a FN fez).
    expect(texto).toContain("sem precisar preencher tudo de novo");
  });
});

// ── CORREÇÃO: a terceira decisão da validação (Lucas, 17/08) ────────────────────────────────
describe("mensagemImobiliariaCorrecao", () => {
  const base = {
    imobiliaria: "63.375.899 BEATRIZ TEODORA DE ARAUJO",
    motivos: ["Enviou o Cartão de CNPJ no lugar do contrato social"],
    representante: "BEATRIZ TEODORA DE ARAUJO",
  };

  it("NÃO diz que o cadastro foi recusado: é pedido de ajuste", () => {
    const texto = mensagemImobiliariaCorrecao(base);

    expect(texto).not.toMatch(/não pôde ser aprovado|recusad|indeferid/i);
    expect(texto).toContain("faltou um ajuste");
  });

  it("tranquiliza sobre o que já foi enviado, para ela não recomeçar do zero", () => {
    const texto = mensagemImobiliariaCorrecao(base);

    expect(texto).toContain("Seu cadastro está guardado");
  });

  it("diz o que precisa ser corrigido", () => {
    const texto = mensagemImobiliariaCorrecao(base);

    expect(texto).toContain("Cartão de CNPJ no lugar do contrato social");
  });

  it("chama pelo primeiro nome, com a inicial maiúscula", () => {
    // O cadastro grava em CAIXA ALTA e "Olá, BEATRIZ!" parece grito de robô.
    expect(mensagemImobiliariaCorrecao(base)).toContain("Olá, Beatriz!");
  });

  it("sem representante, não inventa nome", () => {
    const texto = mensagemImobiliariaCorrecao({ ...base, representante: null });

    expect(texto).toContain("Olá!");
    expect(texto).not.toContain("undefined");
  });

  it("acrescenta a observação livre do operador quando existe", () => {
    const texto = mensagemImobiliariaCorrecao({
      ...base,
      observacao: "Pode mandar em PDF, foto do papel não dá para ler.",
    });

    expect(texto).toContain("Pode mandar em PDF");
  });
});
