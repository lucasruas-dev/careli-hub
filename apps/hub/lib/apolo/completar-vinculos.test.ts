import { describe, expect, it } from "vitest";

import {
  camposPreenchidos,
  empreendimentoDoCampo,
  imobiliariaAncorada,
  normalizarNome,
} from "./asana-import";
import {
  agruparPorValor,
  classificarCampo,
  detectarConflitos,
  emBlocos,
  EMPREENDIMENTOS_AUTORIZADOS,
  mesclarMetadataEmail,
  noEscopo,
} from "./completar-vinculos";

// Estas regras decidem o que será GRAVADO em 392 linhas de produção. Como nada no sistema
// sobrescreve `apolo_esteira.corretor` depois (o upsert da importação é coalesce-preservador),
// valor errado gravado é permanente. Por isso a lógica é pura e travada por teste.

const campo = (name: string, display_value: string | null) => ({ display_value, name });

describe("noEscopo — a trava do Vale do Ouro", () => {
  it("aceita a grafia exata", () => {
    expect(noEscopo("Vale do Ouro")).toBe(true);
  });

  it("aceita variação de acento, caixa e espaço (é a mesma coisa digitada diferente)", () => {
    expect(noEscopo("VALE DO OURO")).toBe(true);
    expect(noEscopo("  vale  do   ouro ")).toBe(true);
    expect(noEscopo("Vale do Ouro")).toBe(true);
  });

  // ⚠️ O MOTIVO DE EXISTIR: o filtro do `escanearCads` é SUBSTRING, então "Vale do Ouro II"
  // passa por lá. Se esta guarda também fosse substring, uma fase inteira de outro
  // empreendimento entraria no backfill sem ninguém perceber.
  it("REJEITA fase/variante que começa igual", () => {
    expect(noEscopo("Vale do Ouro II")).toBe(false);
    expect(noEscopo("Residencial Vale do Ouro")).toBe(false);
    expect(noEscopo("Vale do Ouro - Fase 2")).toBe(false);
  });

  it("rejeita outro empreendimento e sigla solta", () => {
    expect(noEscopo("Lagoa Bonita")).toBe(false);
    expect(noEscopo("VOR")).toBe(false);
  });

  it("rejeita vazio e nulo em vez de deixar passar", () => {
    expect(noEscopo(null)).toBe(false);
    expect(noEscopo(undefined)).toBe(false);
    expect(noEscopo("")).toBe(false);
    expect(noEscopo("   ")).toBe(false);
  });

  it("a lista autorizada tem SÓ o Vale do Ouro", () => {
    expect(EMPREENDIMENTOS_AUTORIZADOS).toEqual(["Vale do Ouro"]);
  });
});

describe("classificarCampo — backfill nunca sobrescreve", () => {
  it("preenche quando o banco está vazio e o Asana tem o dado", () => {
    expect(classificarCampo(null, "Henrique")).toBe("completar");
    expect(classificarCampo("", "Henrique")).toBe("completar");
    expect(classificarCampo("   ", "Henrique")).toBe("completar");
  });

  // O que o operador digitou na validação SEMPRE ganha da importação.
  it("respeita o valor que já está no banco, mesmo divergindo do Asana", () => {
    expect(classificarCampo("Maria", "Henrique")).toBe("jaTemValor");
  });

  it("não inventa dado quando o Asana não tem nada", () => {
    expect(classificarCampo(null, null)).toBe("semDado");
    expect(classificarCampo(null, "")).toBe("semDado");
    expect(classificarCampo(null, "   ")).toBe("semDado");
  });
});

describe("camposPreenchidos — enxerga TODOS, não só o primeiro", () => {
  const task = {
    custom_fields: [
      campo("Imobiliárias Credenciadas - Lagoa Bonita", "IMOB LAGOA LTDA"),
      campo("Imobiliárias Credenciadas - Vale do Ouro", "IMOB OURO LTDA"),
      campo("Imobiliárias Credenciadas - Outro", null),
      campo("Nome do Proponente", "Fulano"),
    ],
  };

  it("devolve os dois campos de imobiliária preenchidos", () => {
    const achados = camposPreenchidos(task, ["imobiliar"]);
    expect(achados).toHaveLength(2);
    expect(achados.map((a) => a.valor)).toEqual(["IMOB LAGOA LTDA", "IMOB OURO LTDA"]);
  });

  it("ignora campo vazio — é o esquema 'um campo por empreendimento' em repouso", () => {
    expect(camposPreenchidos(task, ["imobiliar"]).map((a) => a.valor)).not.toContain(null);
  });

  it("devolve o nome já normalizado, para ancorar por substring com segurança", () => {
    const achados = camposPreenchidos(task, ["imobiliar"]);
    expect(achados[1]!.nome).toBe("imobiliarias credenciadas vale do ouro");
  });

  it("não quebra sem custom fields", () => {
    expect(camposPreenchidos({ custom_fields: null }, ["imobiliar"])).toEqual([]);
    expect(camposPreenchidos({}, ["imobiliar"])).toEqual([]);
  });
});

describe("imobiliariaAncorada — casar com o empreendimento CERTO", () => {
  const alvo = normalizarNome("Vale do Ouro");

  // O caso que o código antigo errava em silêncio: dois campos preenchidos, `valorDoCampo`
  // retornava o PRIMEIRO da ordem da API — que podia ser o de outro empreendimento.
  it("escolhe o campo do empreendimento alvo quando há dois preenchidos", () => {
    const r = imobiliariaAncorada(
      {
        custom_fields: [
          campo("Imobiliárias Credenciadas - Lagoa Bonita", "IMOB LAGOA LTDA"),
          campo("Imobiliárias Credenciadas - Vale do Ouro", "IMOB OURO LTDA"),
        ],
      },
      alvo,
    );
    expect(r.valor).toBe("IMOB OURO LTDA");
    expect(r.confianca).toBe("ancorado");
  });

  it("ancora mesmo quando o campo do alvo é o único preenchido", () => {
    const r = imobiliariaAncorada(
      {
        custom_fields: [
          campo("Imobiliárias Credenciadas - Vale do Ouro", "IMOB OURO LTDA"),
          campo("Imobiliárias Credenciadas - Lagoa Bonita", null),
        ],
      },
      alvo,
    );
    expect(r.confianca).toBe("ancorado");
    expect(r.valor).toBe("IMOB OURO LTDA");
  });

  // Compatibilidade com as 279 já gravadas: elas vieram deste acidente feliz (um campo só).
  it("aceita campo único mesmo sem o empreendimento no nome", () => {
    const r = imobiliariaAncorada(
      { custom_fields: [campo("Imobiliária Credenciada", "IMOB GENERICA LTDA")] },
      alvo,
    );
    expect(r.confianca).toBe("campo_unico");
    expect(r.valor).toBe("IMOB GENERICA LTDA");
  });

  // ⚠️ A regra que protege o dado: na dúvida NÃO grava.
  it("declara AMBÍGUO com dois campos preenchidos e nenhum do alvo", () => {
    const r = imobiliariaAncorada(
      {
        custom_fields: [
          campo("Imobiliárias Credenciadas - Lagoa Bonita", "IMOB LAGOA LTDA"),
          campo("Imobiliárias Credenciadas - Serra", "IMOB SERRA LTDA"),
        ],
      },
      alvo,
    );
    expect(r.confianca).toBe("ambiguo");
    expect(r.valor).toBeNull();
    expect(r.candidatos).toEqual(["IMOB LAGOA LTDA", "IMOB SERRA LTDA"]);
  });

  it("declara AMBÍGUO com dois campos do MESMO empreendimento (não há como escolher)", () => {
    const r = imobiliariaAncorada(
      {
        custom_fields: [
          campo("Imobiliárias Credenciadas - Vale do Ouro", "IMOB A"),
          campo("Imobiliárias Credenciadas 2 - Vale do Ouro", "IMOB B"),
        ],
      },
      alvo,
    );
    expect(r.confianca).toBe("ambiguo");
    expect(r.valor).toBeNull();
  });

  // ⚠️ O ACHADO MAIS GRAVE DA REVISÃO. A ancoragem era `nome.includes(alvo)`, e
  // "imobiliarias credenciadas vale do ouro ii".includes("vale do ouro") é `true`. Uma CAD do
  // Vale do Ouro recebia a imobiliária do Vale do Ouro II com confiança "ancorado" — sem passar
  // pela lista de ambíguos, e permanente, porque nada sobrescreve a coluna depois.
  it("NÃO casa 'Vale do Ouro II' com 'Vale do Ouro' (era substring)", () => {
    const r = imobiliariaAncorada(
      { custom_fields: [campo("Imobiliárias Credenciadas - Vale do Ouro II", "IMOB VALE II")] },
      alvo,
    );
    expect(r.valor).toBeNull();
    expect(r.confianca).toBe("ambiguo");
  });

  it("escolhe o Vale do Ouro mesmo com o Vale do Ouro II preenchido ao lado", () => {
    const r = imobiliariaAncorada(
      {
        custom_fields: [
          campo("Imobiliárias Credenciadas - Vale do Ouro II", "IMOB VALE II"),
          campo("Imobiliárias Credenciadas - Vale do Ouro", "IMOB OURO LTDA"),
        ],
      },
      alvo,
    );
    expect(r.confianca).toBe("ancorado");
    expect(r.valor).toBe("IMOB OURO LTDA");
  });

  // ⚠️ O fallback de campo único existe para o campo GENÉRICO. Aplicá-lo a um campo rotulado
  // para outro empreendimento gravaria a imobiliária do Alto da Boa Vista na CAD do Vale do Ouro.
  it("NÃO usa campo único quando ele é rotulado para OUTRO empreendimento", () => {
    const r = imobiliariaAncorada(
      {
        custom_fields: [campo("Imobiliárias Credenciadas - Alto da Boa Vista", "IMOB ABV LTDA")],
      },
      alvo,
    );
    expect(r.confianca).toBe("ambiguo");
    expect(r.valor).toBeNull();
    expect(r.candidatos).toEqual(["IMOB ABV LTDA"]);
  });

  it("separa rótulo de empreendimento em traço, travessão e dois-pontos", () => {
    expect(empreendimentoDoCampo("Imobiliárias Credenciadas - Vale do Ouro")).toEqual({
      empreendimento: "vale do ouro",
      rotulado: true,
    });
    expect(empreendimentoDoCampo("Imobiliárias Credenciadas — Vale do Ouro II")).toEqual({
      empreendimento: "vale do ouro ii",
      rotulado: true,
    });
    expect(empreendimentoDoCampo("Imobiliária Credenciada")).toEqual({
      empreendimento: "imobiliaria credenciada",
      rotulado: false,
    });
  });

  it("sem nenhum campo preenchido: sem valor e sem candidatos", () => {
    const r = imobiliariaAncorada(
      { custom_fields: [campo("Imobiliárias Credenciadas - Vale do Ouro", null)] },
      alvo,
    );
    expect(r.valor).toBeNull();
    expect(r.candidatos).toEqual([]);
  });

  it("ancora ignorando acento e caixa do nome do campo", () => {
    const r = imobiliariaAncorada(
      {
        custom_fields: [
          campo("IMOBILIÁRIAS CREDENCIADAS — VALE DO OURO", "IMOB OURO LTDA"),
          campo("Imobiliárias Credenciadas - Lagoa", "IMOB LAGOA LTDA"),
        ],
      },
      alvo,
    );
    expect(r.confianca).toBe("ancorado");
    expect(r.valor).toBe("IMOB OURO LTDA");
  });
});

describe("detectarConflitos — duas tasks na mesma ficha", () => {
  // O dedup por CPF reaproveita a entidade, e `apolo_source_links` é único por `source_id`, não
  // por `entity_id`. Sem esta trava, quem gravava era a ordem de iteração do Map.
  it("acusa a entidade quando as duas CADs discordam", () => {
    const conflitos = detectarConflitos([
      { entityId: "e1", nome: "CAD A", valor: "Henrique" },
      { entityId: "e1", nome: "CAD B", valor: "Mariana" },
    ]);
    expect(conflitos.size).toBe(1);
    expect(conflitos.get("e1")!.valores).toEqual(["Henrique", "Mariana"]);
    expect(conflitos.get("e1")!.nomes).toEqual(["CAD A", "CAD B"]);
  });

  it("valor repetido NÃO é conflito — gravar o mesmo dado duas vezes é inofensivo", () => {
    const conflitos = detectarConflitos([
      { entityId: "e1", nome: "CAD A", valor: "Henrique" },
      { entityId: "e1", nome: "CAD B", valor: "Henrique" },
    ]);
    expect(conflitos.size).toBe(0);
  });

  it("ignora vazio: ausência de dado não discorda de nada", () => {
    const conflitos = detectarConflitos([
      { entityId: "e1", nome: "CAD A", valor: "Henrique" },
      { entityId: "e1", nome: "CAD B", valor: null },
      { entityId: "e1", nome: "CAD C", valor: "   " },
    ]);
    expect(conflitos.size).toBe(0);
  });

  it("entidades distintas com valores distintos não são conflito", () => {
    const conflitos = detectarConflitos([
      { entityId: "e1", nome: "CAD A", valor: "Henrique" },
      { entityId: "e2", nome: "CAD B", valor: "Mariana" },
    ]);
    expect(conflitos.size).toBe(0);
  });
});

describe("agruparPorValor — poucas dezenas de UPDATEs em vez de ~800", () => {
  it("junta as entidades que recebem o mesmo valor", () => {
    const grupos = agruparPorValor([
      { entityId: "a", valor: "IMOB OURO" },
      { entityId: "b", valor: "IMOB LAGOA" },
      { entityId: "c", valor: "IMOB OURO" },
    ]);
    expect(grupos.get("IMOB OURO")).toEqual(["a", "c"]);
    expect(grupos.get("IMOB LAGOA")).toEqual(["b"]);
  });

  it("descarta valor vazio — nunca gravar string vazia por cima de NULL", () => {
    const grupos = agruparPorValor([
      { entityId: "a", valor: null },
      { entityId: "b", valor: "   " },
      { entityId: "c", valor: "" },
    ]);
    expect(grupos.size).toBe(0);
  });

  it("apara as pontas para 'IMOB ' e 'IMOB' não virarem dois grupos", () => {
    const grupos = agruparPorValor([
      { entityId: "a", valor: " IMOB OURO " },
      { entityId: "b", valor: "IMOB OURO" },
    ]);
    expect(grupos.size).toBe(1);
    expect(grupos.get("IMOB OURO")).toEqual(["a", "b"]);
  });
});

describe("emBlocos", () => {
  it("quebra no tamanho pedido e não perde item", () => {
    const blocos = emBlocos([1, 2, 3, 4, 5], 2);
    expect(blocos).toEqual([[1, 2], [3, 4], [5]]);
    expect(blocos.flat()).toHaveLength(5);
  });

  it("lista vazia não gera bloco", () => {
    expect(emBlocos([], 100)).toEqual([]);
  });

  it("lista menor que o bloco vira um bloco só", () => {
    expect(emBlocos([1, 2], 100)).toEqual([[1, 2]]);
  });
});

describe("mesclarMetadataEmail — merge, nunca replace cego", () => {
  // ⚠️ Replace cego apagaria `importadoEm` e `secao`: o registro de quando e de onde a CAD veio.
  it("PRESERVA as chaves que já existiam", () => {
    const { metadata, mudou } = mesclarMetadataEmail(
      { importadoEm: "2026-07-20T00:00:00Z", secao: "Finalizado" },
      "henrique@imob.com.br",
    );
    expect(mudou).toBe(true);
    expect(metadata).toEqual({
      corretorEmail: "henrique@imob.com.br",
      importadoEm: "2026-07-20T00:00:00Z",
      secao: "Finalizado",
    });
  });

  it("não sobrescreve e-mail já gravado", () => {
    const { metadata, mudou } = mesclarMetadataEmail(
      { corretorEmail: "antigo@imob.com.br", secao: "Finalizado" },
      "novo@imob.com.br",
    );
    expect(mudou).toBe(false);
    expect(metadata.corretorEmail).toBe("antigo@imob.com.br");
  });

  it("trata metadata nulo/vazio sem quebrar", () => {
    expect(mesclarMetadataEmail(null, "a@b.com").metadata).toEqual({ corretorEmail: "a@b.com" });
    expect(mesclarMetadataEmail({}, "a@b.com").mudou).toBe(true);
  });

  it("e-mail em branco gravado antes não bloqueia o preenchimento", () => {
    const { mudou } = mesclarMetadataEmail({ corretorEmail: "  " }, "a@b.com");
    expect(mudou).toBe(true);
  });
});
