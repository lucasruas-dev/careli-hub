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

    // ⚠️ O NOME SAI EM CAIXA ALTA: ver `nomeDeSignatario`. As fontes são diferentes (o cadastro
    // guarda em maiúsculas, o usuário do hub não) e o documento é um só.
    expect(pessoas.map((p) => [p.papel, p.nome, p.email])).toEqual([
      ["comprador", "HENRIQUE SALES DO VALE", "henrique.vale@zzteste.careli.dev"],
      ["conjuge", "PATRÍCIA SALES DO VALE", "patricia.vale@zzteste.careli.dev"],
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
    expect(pessoas.map((p) => p.nome)).toEqual(["JOÃO SILVA", "ANA SILVA", "PEDRO SOUZA", "RITA SOUZA"]);
  });

  // ⚠️ MEDIDO EM 08/09/2026: dos 18 empreendimentos com settings, ZERO têm `vendedor_entity_id`, e
  // `dados-do-contrato.ts` não escreve nenhuma chave `vendedora_*`. A falta é AVISO e não recusa —
  // recusar travaria o primeiro teste do ZZ TESTE por um cadastro que ninguém preencheu ainda.
  it("avisa quando a vendedora não tem representante, sem impedir o envio", () => {
    const { avisos, pessoas } = signatariosDoContrato(
      contrato([comprador({ email_cliente: "a@b.com", nome_cliente: "João Silva" })]),
    );
    expect(pessoas.map((p) => p.papel)).toEqual(["comprador"]);
    expect(avisos.join(" ")).toContain("VENDEDORA");
  });

  // ⚠️ O QUADRO É O FIO QUE FALTAVA. Medido em 13/09/2026: os três envelopes de produção tinham
  // 2, 1 e 1 signatário — todos comprador ou cônjuge, zero vendedora; um deles fechou como
  // ASSINADO com um único signatário, uma compra e venda sem a parte vendedora.
  it("as pessoas do quadro do empreendimento entram no envelope", () => {
    const { avisos, pessoas } = signatariosDoContrato(
      contrato([comprador({ email_cliente: "a@b.com", nome_cliente: "João Silva" })]),
      [
        { email: "rep@spe.com.br", nome: "Marcos Andrade", papel: "vendedora" },
        { email: "mat@imob.com.br", nome: "Matheus Guedes", papel: "coordenadora" },
        { email: "t1@casa.com.br", nome: "Ana Testemunha", ordemPropria: 4, papel: "testemunha" },
      ],
    );

    expect(pessoas.map((p) => p.papel)).toEqual([
      "comprador",
      "vendedora",
      "coordenadora",
      "testemunha",
    ]);
    // Com vendedora e testemunha no quadro, não sobra aviso nenhum.
    expect(avisos).toEqual([]);
    expect(pessoas.find((p) => p.papel === "testemunha")?.ordemPropria).toBe(4);
  });

  // ⚠️ O QUADRO VENCE A VARIÁVEL DO CONTRATO, e isso precisa de teste: as duas vias podem existir
  // ao mesmo tempo, e mandar na que o operador ENXERGA é o único comportamento explicável.
  it("a vendedora do quadro vence a do contrato, sem duplicar", () => {
    const { pessoas } = signatariosDoContrato(
      contrato([comprador({ email_cliente: "a@b.com", nome_cliente: "João Silva" })], {
        vendedora_representante_email: "antigo@spe.com.br",
        vendedora_representante_nome: "Representante Antigo",
      }),
      [{ email: "novo@spe.com.br", nome: "Representante Novo", papel: "vendedora" }],
    );

    const vendedoras = pessoas.filter((p) => p.papel === "vendedora");
    expect(vendedoras).toHaveLength(1);
    expect(vendedoras[0]?.nome).toBe("REPRESENTANTE NOVO");
  });

  // ⚠️ CONTRATO COM LINHA DE TESTEMUNHA EM BRANCO VOLTA DO CARTÓRIO. O aviso é barato; descobrir
  // depois de assinado não é.
  it("avisa quando não há testemunha cadastrada", () => {
    const { avisos } = signatariosDoContrato(
      contrato([comprador({ email_cliente: "a@b.com", nome_cliente: "João Silva" })]),
      [{ email: "rep@spe.com.br", nome: "Marcos Andrade", papel: "vendedora" }],
    );
    expect(avisos.join(" ")).toContain("TESTEMUNHA");
  });

  it("inclui a vendedora quando o representante dela está cadastrado", () => {
    const { avisos, pessoas } = signatariosDoContrato(
      contrato([comprador({ email_cliente: "a@b.com", nome_cliente: "João Silva" })], {
        vendedora_representante_email: "diretor@spe.com.br",
        vendedora_representante_nome: "Carlos Gurgel Neto",
      }),
    );
    expect(pessoas.map((p) => p.papel)).toEqual(["comprador", "vendedora"]);
    // ⚠️ NÃO É MAIS "ZERO AVISOS": desde 13/09/2026 a falta de TESTEMUNHA também avisa, e este
    // contrato não tem nenhuma. O que este teste guarda é que o aviso da VENDEDORA sumiu.
    expect(avisos.join(" ")).not.toContain("VENDEDORA");
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

// ── A IMOBILIÁRIA VINCULADA ─────────────────────────────────────────────────
//
// ⚠️ ATÉ 23/09/2026 ELA NUNCA ERA CONVIDADA. O papel `corretor` existia no vocabulário e na tela do
// Setup — dava para numerá-lo na ordem, e o Villa Paris tem isso gravado —, mas nenhuma função do
// Panteon produzia um signatário com ele. Medido na venda da VITORIA, que TEM imobiliária
// vinculada: saíam 11 signatários e nenhum corretor. Nívea, no dia anterior: *"não está trazendo a
// imobiliária"*.
//
// ⚠️ E ELA VEM DA VENDA, NÃO DO QUADRO. O quadro guarda quem assina SEMPRE por aquele
// empreendimento; a imobiliária muda a cada venda, como o comprador. Por isso sai das mesmas chaves
// que o papel já imprime no item VIII.
//
// Quem assina é a PESSOA JURÍDICA, no e-mail dela (Lucas, 23/09/2026) — e é a via que tem dado:
// 4.929 das 4.947 propostas com imobiliária chegam com `email_vinculado`.
describe("a imobiliária vinculada assina", () => {
  const comImobiliaria = (extras: Record<string, string> = {}) =>
    contrato([comprador({ email_cliente: "c@x.com", nome_cliente: "Comprador" })], {
      cpf_cnpj_vinculado: "58.896.684/0001-31",
      email_vinculado: "contrato@flat.com.br",
      nome_vinculado: "FLAT NEGOCIOS IMOBILIARIOS LTDA",
      telefone_vinculado: "+55(31) 99999-0000",
      ...extras,
    });

  it("⚠️ entra como `corretor`, com o nome e o e-mail da empresa", () => {
    const { pessoas } = signatariosDoContrato(comImobiliaria());

    const dela = pessoas.find((p) => p.papel === "corretor");
    expect(dela?.nome).toBe("FLAT NEGOCIOS IMOBILIARIOS LTDA");
    expect(dela?.email).toBe("contrato@flat.com.br");
    expect(dela?.cpf).toBe("58.896.684/0001-31");
  });

  it("sem imobiliária vinculada na venda, ninguém é inventado", () => {
    const { pessoas } = signatariosDoContrato(
      contrato([comprador({ email_cliente: "c@x.com", nome_cliente: "Comprador" })]),
    );

    expect(pessoas.some((p) => p.papel === "corretor")).toBe(false);
  });

  it("⚠️ a MESMA empresa não assina duas vezes: a coordenadora costuma ser imobiliária também", () => {
    // No Vale do Ouro a coordenadora é a Gurgel, que já entra pelo quadro. Repetir o mesmo e-mail
    // faria `conferirSignatarios` recusar o envio por e-mail duplicado — a duplicata apareceria
    // como defeito, e não como o que é.
    const { pessoas } = signatariosDoContrato(
      comImobiliaria({ email_vinculado: "coord@gurgel.com.br" }),
      [{ cpf: null, email: "coord@gurgel.com.br", nome: "GURGEL", papel: "coordenadora", telefone: null }],
    );

    expect(pessoas.filter((p) => p.email === "coord@gurgel.com.br")).toHaveLength(1);
    expect(pessoas.some((p) => p.papel === "corretor")).toBe(false);
  });

  it("a comparação de e-mail ignora a caixa", () => {
    const { pessoas } = signatariosDoContrato(
      comImobiliaria({ email_vinculado: "Coord@Gurgel.com.BR" }),
      [{ cpf: null, email: "coord@gurgel.com.br", nome: "GURGEL", papel: "coordenadora", telefone: null }],
    );

    expect(pessoas.some((p) => p.papel === "corretor")).toBe(false);
  });

  it("imobiliária sem e-mail entra e a conferência RECUSA, nomeando ela", () => {
    // Entrar sem e-mail é melhor do que sumir: quem confere precisa saber que ela deveria assinar e
    // que falta cadastro. `conferirSignatarios` é quem barra, com a frase que diz o que fazer.
    const { pessoas } = signatariosDoContrato(comImobiliaria({ email_vinculado: "" }));

    expect(pessoas.some((p) => p.papel === "corretor")).toBe(true);

    const veredito = conferirSignatarios(pessoas);
    expect(veredito.ok).toBe(false);
    if (!veredito.ok) expect(veredito.erro).toContain("FLAT NEGOCIOS IMOBILIARIOS LTDA");
  });
});
