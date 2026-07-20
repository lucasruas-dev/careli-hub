import { describe, expect, it } from "vitest";

import { extrairDaDescricao } from "./asana-descricao";

// Descrição REAL da CAD GCAD-7808 (Márcia), como o formulário "CAD - Vale do Ouro" gera.
// É a fonte mais rica e mais barata que temos — e a que estava sendo ignorada enquanto o
// plano era pagar enriquecimento para descobrir parte do mesmo.
const DESCRICAO_REAL = `Nome do Proponente / Empresa:
Márcia aparecida de paula souza

Perfil:
Pessoa Física

E-mail do Proponente:
marciasantos0958@gmail.com

Telefone do Proponente:
37998070958

Profissão do Proponente:
Comerciante

Renda do Proponente:
4500

Escolaridade do Proponente:
Não Informado

Estado Civil:
Casado(a)

Nome do Cônjuge:
Hélio Geraldo de souza

E-mail do Cônjuge:
heliogeraldos4545@gmail.com

Telefone do Cônjuge:
37996717549

Profissão do Cônjuge:
Pedreiro

Escolaridade do Cônjuge:
Não Informado

Renda do Cônjuge:
4700

Imobiliárias Credenciadas - Vale do Ouro:
RR Soluções Imobiliárias LTDA

Corretor Responsável:
Henrique

E-mail do Corretor:
henriquesantos9204@gmail.com

_______________________________

Esta tarefa foi enviada através de CAD - Vale do Ouro`;

describe("extrairDaDescricao", () => {
  const dados = extrairDaDescricao(DESCRICAO_REAL);

  it("lê os dados do proponente", () => {
    expect(dados.proponente.nome).toBe("Márcia aparecida de paula souza");
    expect(dados.proponente.email).toBe("marciasantos0958@gmail.com");
    expect(dados.proponente.telefone).toBe("37998070958");
    expect(dados.proponente.profissao).toBe("Comerciante");
    expect(dados.proponente.renda).toBe("4500");
    expect(dados.proponente.estadoCivil).toBe("Casado(a)");
  });

  it("lê o cônjuge inteiro", () => {
    expect(dados.conjuge.nome).toBe("Hélio Geraldo de souza");
    expect(dados.conjuge.email).toBe("heliogeraldos4545@gmail.com");
    expect(dados.conjuge.telefone).toBe("37996717549");
    expect(dados.conjuge.profissao).toBe("Pedreiro");
    expect(dados.conjuge.renda).toBe("4700");
  });

  // ⚠️ A armadilha central: a descrição tem TRÊS telefones/e-mails (proponente, cônjuge e
  // corretor). Confundi-los grava o contato do corretor como se fosse o do cliente — e aí a
  // cobrança e o atendimento vão para a pessoa errada.
  it("não confunde proponente, cônjuge e corretor", () => {
    expect(dados.proponente.telefone).not.toBe(dados.conjuge.telefone);
    expect(dados.proponente.email).not.toBe(dados.conjuge.email);
    expect(dados.proponente.email).not.toBe(dados.corretorEmail);
    expect(dados.corretor).toBe("Henrique");
    expect(dados.corretorEmail).toBe("henriquesantos9204@gmail.com");
  });

  it("trata 'Não Informado' como campo vazio, não como texto", () => {
    // Assim o campo continua editável pelo operador em vez de exibir texto inútil.
    expect(dados.proponente.escolaridade).toBeUndefined();
    expect(dados.conjuge.escolaridade).toBeUndefined();
  });

  it("lê a imobiliária mesmo com o empreendimento no rótulo", () => {
    expect(dados.imobiliaria).toBe("RR Soluções Imobiliárias LTDA");
  });

  it("aceita rótulo e valor na MESMA linha", () => {
    const dois = extrairDaDescricao(
      "Telefone do Proponente: 31999998888\nProfissão do Proponente: Pedreiro",
    );
    expect(dois.proponente.telefone).toBe("31999998888");
    expect(dois.proponente.profissao).toBe("Pedreiro");
  });

  it("não quebra com descrição vazia ou ausente", () => {
    expect(extrairDaDescricao(null).proponente.nome).toBeUndefined();
    expect(extrairDaDescricao("").conjuge.nome).toBeUndefined();
    expect(extrairDaDescricao("texto solto sem rótulo").proponente.email).toBeUndefined();
  });
});
