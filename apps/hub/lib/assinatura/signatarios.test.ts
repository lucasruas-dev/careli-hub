import { describe, expect, it } from "vitest";

import type { DadosDoContrato } from "@/lib/temis/preencher-contrato";

import { conferirSignatarios, signatariosDoContrato } from "./signatarios";

// ⚠️ O QUE ESTES TESTES PROTEGEM. Estas duas funções são a última peneira antes de a Clicksign ser
// chamada, e a conta é de PRODUÇÃO: cada envelope tem custo e, uma vez ativado, não se apaga. Um
// signatário mal montado que atravessa daqui vira um envelope pago com gente faltando dentro — e o
// conserto é cancelar e criar outro, que também cobra.

const contrato = (compradores: DadosDoContrato["compradores"], gerais: Record<string, string> = {}): DadosDoContrato => ({
  compradores,
  gerais,
});

const comprador = (
  valores: Record<string, string>,
  temConjuge = false,
): DadosDoContrato["compradores"][number] => ({
  ehPessoaFisica: true,
  temConjuge,
  valores,
});

describe("de onde saem os signatários", () => {
  it("tira comprador e cônjuge das variáveis do contrato, e não de um formulário", () => {
    const { pessoas } = signatariosDoContrato(
      contrato([
        comprador(
          {
            cpf_cliente: "999.999.004-53",
            email_cliente: "henrique.vale@zzteste.careli.dev",
            email_conjuge: "patricia.vale@zzteste.careli.dev",
            nome_cliente: "Henrique Sales do Vale",
            nome_conjuge: "Patrícia Sales do Vale",
          },
          true,
        ),
      ]),
    );

    expect(pessoas.map((p) => [p.papel, p.nome, p.email])).toEqual([
      ["comprador", "Henrique Sales do Vale", "henrique.vale@zzteste.careli.dev"],
      ["conjuge", "Patrícia Sales do Vale", "patricia.vale@zzteste.careli.dev"],
    ]);
  });

  // ⚠️ A BANDEIRA MANDA, E NÃO A EXISTÊNCIA DO NOME. `temConjuge` é a MESMA que liga o bloco
  // `[inicio_dados_conjuge]` no papel: se o contrato não qualificou o cônjuge, mandá-lo assinar
  // poria no envelope alguém que o documento não menciona.
  it("não põe o cônjuge para assinar quando o contrato não o qualificou", () => {
    const { pessoas } = signatariosDoContrato(
      contrato([
        comprador(
          {
            email_cliente: "a@b.com",
            email_conjuge: "c@d.com",
            nome_cliente: "João Silva",
            nome_conjuge: "Maria Silva",
          },
          false,
        ),
      ]),
    );
    expect(pessoas.map((p) => p.papel)).toEqual(["comprador"]);
  });

  it("mantém a ordem do contrato: titular, cônjuge dele, segundo comprador, cônjuge do segundo", () => {
    const { pessoas } = signatariosDoContrato(
      contrato([
        comprador({ email_cliente: "1@x.com", nome_cliente: "João Silva", nome_conjuge: "Ana Silva", email_conjuge: "2@x.com" }, true),
        comprador({ email_cliente: "3@x.com", nome_cliente: "Pedro Souza", nome_conjuge: "Rita Souza", email_conjuge: "4@x.com" }, true),
      ]),
    );
    expect(pessoas.map((p) => p.nome)).toEqual(["João Silva", "Ana Silva", "Pedro Souza", "Rita Souza"]);
  });

  // ⚠️ MEDIDO EM 08/09/2026: dos 18 empreendimentos com settings, ZERO têm `vendedor_entity_id`, e
  // `dados-do-contrato.ts` não escreve nenhuma chave `vendedora_*`. A falta é AVISO e não recusa —
  // recusar travaria o primeiro teste do ZZ TESTE por um cadastro que ninguém preencheu ainda.
  it("avisa quando a vendedora não tem representante, sem impedir o envio", () => {
    const { avisos, pessoas } = signatariosDoContrato(
      contrato([comprador({ email_cliente: "a@b.com", nome_cliente: "João Silva" })]),
    );
    expect(pessoas.map((p) => p.papel)).toEqual(["comprador"]);
    expect(avisos.join(" ")).toContain("vendedora");
  });

  it("inclui a vendedora quando o representante dela está cadastrado", () => {
    const { avisos, pessoas } = signatariosDoContrato(
      contrato([comprador({ email_cliente: "a@b.com", nome_cliente: "João Silva" })], {
        vendedora_representante_email: "diretor@spe.com.br",
        vendedora_representante_nome: "Carlos Gurgel Neto",
      }),
    );
    expect(pessoas.map((p) => p.papel)).toEqual(["comprador", "vendedora"]);
    expect(avisos).toEqual([]);
  });
});

describe("a conferência antes de chamar a API", () => {
  const pessoa = (nome: string, email: string, papel: "comprador" | "conjuge" = "comprador") => ({
    email,
    nome,
    papel,
  });

  it("aceita a lista boa", () => {
    expect(
      conferirSignatarios([
        pessoa("Henrique Sales do Vale", "henrique@x.com"),
        pessoa("Patrícia Sales do Vale", "patricia@x.com", "conjuge"),
      ]),
    ).toEqual({ ok: true });
  });

  // ⚠️ A ARMADILHA CONHECIDA: o cônjuge que compartilha a caixa do titular. Deixá-la falhar na API
  // deixaria um envelope criado com metade dos signatários dentro.
  it("recusa e-mail repetido ANTES da API, e diz QUEM repete", () => {
    const veredito = conferirSignatarios([
      pessoa("Henrique Sales do Vale", "casal@x.com"),
      pessoa("Patrícia Sales do Vale", "casal@x.com", "conjuge"),
    ]);
    expect(veredito.ok).toBe(false);
    if (veredito.ok) return;
    expect(veredito.erro).toContain("Henrique Sales do Vale");
    expect(veredito.erro).toContain("Patrícia Sales do Vale");
    expect(veredito.erro).toContain("casal@x.com");
  });

  // ⚠️ OS DOIS PROVEDORES COMPARAM EM MINÚSCULAS E SEM ESPAÇO. Conferir letra a letra aqui deixaria
  // passar exatamente o caso que esta função existe para pegar.
  it("pega o e-mail repetido com maiúscula e espaço no fim", () => {
    const veredito = conferirSignatarios([
      pessoa("Henrique Sales do Vale", "Casal@X.com "),
      pessoa("Patrícia Sales do Vale", "casal@x.com", "conjuge"),
    ]);
    expect(veredito.ok).toBe(false);
  });

  it("recusa signatário sem e-mail, e diz quem falta", () => {
    const veredito = conferirSignatarios([
      pessoa("Henrique Sales do Vale", "henrique@x.com"),
      pessoa("Patrícia Sales do Vale", "", "conjuge"),
    ]);
    expect(veredito.ok).toBe(false);
    if (veredito.ok) return;
    expect(veredito.erro).toContain("Patrícia Sales do Vale");
    expect(veredito.erro).toContain("e-mail");
  });

  it("recusa a lista vazia", () => {
    expect(conferirSignatarios([]).ok).toBe(false);
  });

  // ⚠️ REGRA DA CLICKSIGN, não nossa: *"Informe ao menos um `Nome` e um `Sobrenome`"*, e o campo não
  // aceita numerais. Descobrir isso no meio do cadastro dos signatários deixaria o envelope criado
  // com os primeiros dentro.
  it("recusa nome sem sobrenome", () => {
    const veredito = conferirSignatarios([pessoa("Henrique", "h@x.com")]);
    expect(veredito.ok).toBe(false);
    if (veredito.ok) return;
    expect(veredito.erro).toContain("sobrenome");
  });

  it("recusa nome com número", () => {
    const veredito = conferirSignatarios([pessoa("Henrique Sales 2", "h@x.com")]);
    expect(veredito.ok).toBe(false);
    if (veredito.ok) return;
    expect(veredito.erro).toContain("número");
  });

  // ⚠️ A ORDEM DAS CHECAGENS É A ORDEM EM QUE ELAS AJUDAM. Quem está sem e-mail precisa saber disso
  // antes de ouvir que o nome está curto — senão corrige o nome e leva o segundo erro na sequência.
  it("cobra o e-mail que falta antes de reclamar do formato do nome", () => {
    const veredito = conferirSignatarios([pessoa("Henrique", "")]);
    expect(veredito.ok).toBe(false);
    if (veredito.ok) return;
    expect(veredito.erro).toContain("e-mail");
  });
});
