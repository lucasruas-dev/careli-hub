import { describe, expect, it } from "vitest";

import {
  acharVariavel,
  classificarVariaveis,
  codigosPartidos,
  conferirBlocos,
  descreverFonte,
  extensosOrfaos,
  ORDEM_DOS_GRUPOS,
  rotuloDoGrupo,
  VARIAVEIS_DO_CONTRATO,
  posicaoDoAnexo,
  variaveisDoTexto,
  variaveisDeAnexo,
  variaveisPendentes,
} from "./variaveis";

// ⚠️ OS CASOS AQUI SAÍRAM DE MINUTAS REAIS e de um contrato que JÁ FOI ASSINADO com defeito.
// Não são hipóteses.

describe("o catálogo cobre o que as minutas realmente usam", () => {
  it("conhece as variáveis mais frequentes das 60 minutas medidas", () => {
    // As dez mais frequentes do levantamento (scripts/temis/variaveis-das-minutas.mjs).
    for (const nome of [
      "inicio_dados_conjuge",
      "fim_dados_conjuge",
      "fim_dados_cliente_pf_2",
      "inicio_dados_conjuge_2",
      "inicio_dados_cliente_2",
      "inicio_dados_cliente_pf",
      "nome_conjuge_2",
      "nome_cliente",
      "nome_fantasia_cliente_2",
      "email_cliente",
    ]) {
      expect(acharVariavel(nome), nome).toBeDefined();
    }
  });

  it("vai até o quinto comprador, com cônjuge", () => {
    expect(acharVariavel("nome_cliente_5")).toBeDefined();
    expect(acharVariavel("cpf_conjuge_5")).toBeDefined();
    expect(acharVariavel("cep_cliente_5")).toBeDefined();
    // E para no quinto: um sexto comprador não existe no legado.
    expect(acharVariavel("nome_cliente_6")).toBeUndefined();
  });

  it("o PRIMEIRO comprador não tem bloco condicional próprio", () => {
    // Ele sempre existe. O bloco é o que faz o trecho sumir quando a venda tem menos gente — e por
    // isso só nasce do segundo em diante. É como as minutas estão escritas.
    expect(acharVariavel("inicio_dados_cliente")).toBeUndefined();
    expect(acharVariavel("inicio_dados_cliente_2")).toBeDefined();
  });

  it("mas o par pessoa física / jurídica existe já no primeiro", () => {
    expect(acharVariavel("inicio_dados_cliente_pf")).toBeDefined();
    expect(acharVariavel("inicio_dados_cliente_pj")).toBeDefined();
  });

  it("os nomes de plano casam com os slots do cadastro", () => {
    // O slot do plano ("normal", "investidor", "curto") é o mesmo vocabulário da minuta. Se um dia
    // divergirem, o contrato imprime a linha do plano errado.
    expect(acharVariavel("plano_normal_valor_parcelas")).toBeDefined();
    expect(acharVariavel("plano_investidor_valor_sinal")).toBeDefined();
    expect(acharVariavel("plano_curto_quantidade_parcelas")).toBeDefined();
  });

  it("não tem nome repetido", () => {
    const nomes = VARIAVEIS_DO_CONTRATO.map((v) => v.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it("todo grupo tem rótulo e lugar no menu", () => {
    const grupos = new Set(VARIAVEIS_DO_CONTRATO.map((v) => v.grupo));
    for (const grupo of grupos) {
      expect(rotuloDoGrupo(grupo), grupo).toBeTruthy();
      expect(ORDEM_DOS_GRUPOS, grupo).toContain(grupo);
    }
  });
});

describe("toda variável nasce do Panteon — Lucas, 02/09/2026: 'esquece c2x como consulta'", () => {
  it("toda entrada diz de que tabela do Panteon o valor sai", () => {
    for (const v of VARIAVEIS_DO_CONTRATO) {
      expect(v.fonte, v.nome).toBeDefined();
      expect(typeof v.fonte.tabela, v.nome).toBe("string");
      expect(v.fonte.tabela.length, v.nome).toBeGreaterThan(0);
    }
  });

  it("nenhuma origem nem fonte cita o legado", () => {
    // O nome da variável continua o medido nas minutas (a minuta reconhece); a CASA do valor mudou.
    // Se alguém apontar uma variável para o C2X, este teste é o que reclama.
    for (const v of VARIAVEIS_DO_CONTRATO) {
      const texto = `${v.origem} ${v.fonte.tabela} ${v.fonte.campo ?? ""}`.toLowerCase();
      expect(texto, v.nome).not.toContain("c2x");
      expect(texto, v.nome).not.toContain("legado");
      expect(texto, v.nome).not.toContain("draft_contract");
    }
  });

  it("as fontes são só as tabelas do Panteon, o sistema ou 'pendente'", () => {
    const permitidas = new Set([
      "apolo_entities",
      "apolo_enterprise_settings",
      "apolo_esteira",
      "hercules_empreendimentos",
      "hercules_masterplans",
      "hercules_reservas",
      "hercules_unidades",
      "hercules_vendas",
      "pendente",
      "sistema",
      "temis_categorias",
      "temis_planos",
    ]);
    for (const v of VARIAVEIS_DO_CONTRATO) {
      expect(permitidas.has(v.fonte.tabela), `${v.nome}: ${v.fonte.tabela}`).toBe(true);
    }
  });

  it("o que o Panteon ainda não guarda está marcado como pendente — e é uma lista consciente", () => {
    // ⚠️ ESTA LISTA É O BACKLOG. Cada nome aqui é um dado que o contrato precisa e nenhuma tabela
    // do Panteon tem. Quando alguém criar a coluna, troca a fonte em `variaveis.ts` e tira daqui.
    // Nenhum deles vai buscar no legado — o valor sai vazio até existir.
    // As peças que não são texto (capa, os 8 anexos e os pares deles) também estão pendentes, mas
    // são GERADAS em laço e conferidas no bloco de baixo — listar as 26 aqui só encheria a lista de
    // ruído e esconderia o backlog de verdade.
    const pendentes = variaveisPendentes()
      .map((v) => v.nome)
      .filter((n) => posicaoDoAnexo(n) === null && n !== "capa_contrato" && n !== "anexos_do_contrato")
      .sort();
    expect(pendentes).toEqual(
      [
        // A VENDEDORA (incorporador/SPE). O cadastro existe como entidade PJ do Apolo; falta a
        // coluna que diz QUAL entidade vende cada categoria (`vendedor_entity_id`, migration
        // escrita e esperando o OK). Enquanto isso, o parágrafo das partes sai vazio.
        "vendedora_bairro",
        "vendedora_cep",
        "vendedora_cidade",
        "vendedora_cnpj",
        "vendedora_natureza_juridica",
        "vendedora_nome_fantasia",
        "vendedora_numero",
        "vendedora_razao_social",
        "vendedora_representante_cpf",
        "vendedora_representante_email",
        "vendedora_representante_endereco",
        "vendedora_representante_estado_civil",
        "vendedora_representante_nacionalidade",
        "vendedora_representante_nascimento",
        "vendedora_representante_nome",
        "vendedora_representante_profissao",
        "vendedora_representante_rg",
        "vendedora_representante_telefone",
        "vendedora_rua",
        "vendedora_uf",
        "bairro_coordenadora_vendas",
        "cep_coordenadora_vendas",
        "cidade_coordenadora_vendas",
        "cnpj_coordenadora_vendas",
        "email_coordenadora_vendas",
        "nome_fantasia_coordenadora_vendas",
        "numero_coordenadora_vendas",
        "rua_coordenadora_vendas",
        "telefone_coordenadora_vendas",
        // Novos em 08/09/2026, com o contrato de corretagem: o CRECI vinha DIGITADO tres vezes no
        // texto, e os percentuais do rateio (3% / 4%) tambem. A comissao ja varia por
        // empreendimento no legado (VAL 7,5%, VLO 6%), entao numero fixo na minuta sai errado no
        // empreendimento seguinte sem que nada acuse.
        "creci_coordenadora_vendas",
        "percentual_comissao_coordenadora_vendas",
        "percentual_comissao_vinculado",
        // ⚠️ O CUSTO TOTAL NAO E O PRECO: e preco + comissao. Sem variavel propria a minuta cai em
        // [preco_venda], que e o MESMO campo de [valor_imovel_venda], e o contrato imprime o custo
        // total igual ao preco do lote logo abaixo da frase que promete "a soma".
        "valor_custo_total_aquisicao",
        "valor_corretagem_menos_coordenadora_vendas",
        "valor_garantia_fiduciaria",
        "valor_pago_coordenadora_vendas",
        "valor_total_comissao",
      ].sort(),
    );
  });

  // ── OS ANEXOS SÃO POSIÇÃO, NÃO TIPO ───────────────────────────────────────
  // Lucas, 07/09/2026: *"não queria esses nomes já de uma vez, dei somente exemplos"* e *"podemos
  // ter já definido os campos anexo, 1,2,3 — se não vamos ter muitas variáveis se for buscar pelo
  // nome"*.
  // ⚠️ A QUANTIDADE VEM DO CADASTRO: *"não precisa deixar 20 campos, à medida que eu vou importando
  // os anexos vai fazendo essa conta"*. Nenhuma posição vive no catálogo estático.
  it("não fixa quantidade nenhuma de anexos no catálogo", () => {
    const noCatalogo = VARIAVEIS_DO_CONTRATO.filter((v) => posicaoDoAnexo(v.nome) !== null);
    expect(noCatalogo).toEqual([]);
  });

  it("gera uma trinca por anexo importado, com o nome do arquivo no rótulo", () => {
    const geradas = variaveisDeAnexo(["Convenção de condomínio", "Memorial descritivo"]);
    expect(geradas.map((v) => v.nome)).toEqual([
      "anexo_1",
      "anexo_1_nome",
      "inicio_tem_anexo_1",
      "fim_tem_anexo_1",
      "anexo_2",
      "anexo_2_nome",
      "inicio_tem_anexo_2",
      "fim_tem_anexo_2",
    ]);
    // "Anexo 3" numa lista de doze não diz nada a quem escreve a minuta, e escolher o anexo errado
    // é um defeito que só aparece no papel assinado.
    expect(geradas[0]?.rotulo).toBe("Anexo 1 — Convenção de condomínio");
    expect(geradas[1]?.tipo).toBe("texto");
    expect(geradas[1]?.exemplo).toBe("Convenção de condomínio");
  });

  it("nenhum anexo importado, nenhuma variável", () => {
    expect(variaveisDeAnexo([])).toEqual([]);
  });

  it("aguenta anexo sem nome, sem inventar rótulo", () => {
    const [arquivo] = variaveisDeAnexo(["  "]);
    expect(arquivo?.rotulo).toBe("Anexo 1");
  });

  // Mesmo fora do catálogo, quem audita a minuta precisa reconhecer o anexo — senão `[anexo_3]`
  // legítimo cai no aviso feito para pegar `[nome_clientes]` digitado errado.
  it("acharVariavel reconhece o anexo mesmo sem ele estar no catálogo", () => {
    for (const nome of ["anexo_3", "anexo_3_nome", "inicio_tem_anexo_3", "fim_tem_anexo_3"]) {
      expect(acharVariavel(nome), nome).toBeDefined();
    }
    expect(acharVariavel("anexo_3")?.tipo).toBe("anexo");
    expect(acharVariavel("anexo_3_nome")?.tipo).toBe("texto");
    expect(acharVariavel("anexo_100")).toBeUndefined();
  });

  it("não conhece tipo de anexo nenhum — planta e convenção vêm do cadastro", () => {
    for (const inventado of ["anexo_planta", "anexo_convencao", "anexo_memorial", "anexo_matricula"]) {
      expect(acharVariavel(inventado), inventado).toBeUndefined();
      expect(posicaoDoAnexo(inventado), inventado).toBeNull();
    }
  });

  it("lê a posição dos três formatos, e recusa o que está fora da faixa", () => {
    expect(posicaoDoAnexo("anexo_3")).toBe(3);
    expect(posicaoDoAnexo("inicio_tem_anexo_3")).toBe(3);
    expect(posicaoDoAnexo("fim_tem_anexo_3")).toBe(3);
    // ⚠️ Fora da faixa é nome inventado, e a tela precisa reclamar dele como reclama de
    // `[nome_clientes]` — senão o contrato sai com `[anexo_99]` impresso.
    expect(posicaoDoAnexo("anexo_20")).toBe(20);
    expect(posicaoDoAnexo("anexo_3_nome")).toBe(3);
    expect(posicaoDoAnexo("anexo_100")).toBeNull();
    expect(posicaoDoAnexo("anexo_0")).toBeNull();
    expect(posicaoDoAnexo("anexo_01")).toBeNull();
    expect(posicaoDoAnexo("anexos_do_contrato")).toBeNull();
    expect(posicaoDoAnexo("nome_cliente")).toBeNull();
  });

  it("todo anexo está pendente: não há tabela de anexo em lugar nenhum ainda", () => {
    const pendentes = new Set(variaveisPendentes().map((v) => v.nome));
    expect(pendentes.has("capa_contrato")).toBe(true);
    expect(pendentes.has("anexos_do_contrato")).toBe(true);
    // E as posições geradas também: não há tabela de anexo em unidade, categoria nem empreendimento.
    for (const v of variaveisDeAnexo(["Convenção", "Memorial"])) {
      expect(v.fonte.tabela, v.nome).toBe("pendente");
    }
  });

  it("o comprador vem do cadastro (apolo_entities + ficha da esteira)", () => {
    expect(acharVariavel("nome_cliente")?.fonte).toEqual({ campo: "display_name", tabela: "apolo_entities" });
    // Do 2º comprador em diante a fonte diz de qual participante da venda o valor sai.
    expect(acharVariavel("nome_cliente_2")?.fonte.tabela).toBe("apolo_entities");
    expect(acharVariavel("nome_cliente_2")?.fonte.campo).toContain("participante 2");
  });

  // ⚠️ ESTE TESTE GUARDAVA A CRENÇA ERRADA, e por isso ele existe agora ao contrário. Até
  // 08/09/2026 ele exigia que `cpf_cliente` viesse de `ficha.identificacao.cpf` — um caminho que
  // NÃO EXISTE. Medido no banco: das 577 fichas em produção, ZERO têm a chave `identificacao`, e
  // NENHUMA tem `cpf`. O shape aninhado é o DTO efêmero que a leitura do MOSTQI devolve ao wizard
  // (`app/api/apolo/cadastro/route.ts`) e que nunca é gravado.
  //
  // Ninguém percebeu porque o motor de contrato ainda não existe: hoje o `fonte` é o que a tela
  // mostra ao jurídico. No dia em que o motor lesse o catálogo ao pé da letra, TODAS as variáveis de
  // ficha sairiam vazias no contrato — sem erro nenhum, porque `undefined` vira string vazia.
  it("a ficha é PLANA, e o documento não está nela", () => {
    // O CPF e o CNPJ moram na coluna da entidade, que guarda o documento COMPLETO apesar do nome.
    expect(acharVariavel("cpf_cliente")?.fonte.tabela).toBe("apolo_entities");
    expect(acharVariavel("cpf_cliente")?.fonte.campo).toContain("document_masked");
    expect(acharVariavel("cnpj_cliente")?.fonte.tabela).toBe("apolo_entities");

    // As chaves da ficha são camelCase na RAIZ — nada de `identificacao.`, `perfil.`, `endereco.`.
    expect(acharVariavel("nome_conjuge")?.fonte.campo).toContain("ficha.conjugeNome");
    expect(acharVariavel("rua_cliente")?.fonte.campo).toContain("ficha.logradouro");
    expect(acharVariavel("nacionalidade_cliente")?.fonte.campo).toBe("ficha.nacionalidade");
  });

  it("nenhuma fonte de ficha promete um nível que o jsonb não tem", () => {
    const aninhados = ["identificacao.", "perfil.", "endereco.", "conjuge.", "empresa."];
    const mentirosas = VARIAVEIS_DO_CONTRATO.filter(
      (v) =>
        v.fonte.tabela === "apolo_esteira" &&
        aninhados.some((nivel) => (v.fonte.campo ?? "").includes(`ficha.${nivel}`)),
    );
    expect(mentirosas.map((v) => v.nome)).toEqual([]);
  });

  // ⚠️ O ENDEREÇO E O CONTATO NÃO SÃO SÓ DA FICHA. No cadastro pelo wizard eles nascem em
  // `apolo_addresses` e `apolo_contacts`; a ficha só recebe o que alguém editou depois, na tela de
  // validação. Um motor que lesse só a ficha perderia o endereço de quem nunca foi editado à mão —
  // e o comentário de `cadastro-cascata.ts` mede isso: só 10 das 343 CADs do lançamento têm linha
  // em `apolo_addresses`, o endereço das outras 314 está solto na ficha. As duas pontas existem.
  it("diz onde mais procurar o que a ficha pode não ter", () => {
    for (const nome of ["rua_cliente", "cep_cliente", "email_cliente", "telefone_cliente"]) {
      expect(acharVariavel(nome)?.fonte.campo, nome).toMatch(/apolo_(addresses|contacts)/);
    }
  });

  // ⚠️ O `*Id` É NÚMERO, E O CONTRATO PRECISA DO RÓTULO. `estadoCivilId: "2"` impresso no contrato
  // é um defeito que ninguém vê na tela e todo mundo vê no papel.
  it("avisa que os *Id precisam virar rótulo", () => {
    for (const nome of ["estado_civil_cliente", "regime_casamento_cliente", "profissao_cliente"]) {
      expect(acharVariavel(nome)?.fonte.campo, nome).toContain("→");
    }
  });

  it("a unidade vem do Hércules", () => {
    expect(acharVariavel("numero_quadra")?.fonte).toEqual({ campo: "quadra", tabela: "hercules_unidades" });
    expect(acharVariavel("numero_lote")?.fonte).toEqual({ campo: "lote", tabela: "hercules_unidades" });
    expect(acharVariavel("area_lote")?.fonte).toEqual({ campo: "area", tabela: "hercules_unidades" });
    expect(acharVariavel("numero_matricula")?.fonte).toEqual({ campo: "matricula", tabela: "hercules_unidades" });
    expect(acharVariavel("numero_ficha_matricula")?.fonte).toEqual({ campo: "matricula_livro", tabela: "hercules_unidades" });
    expect(acharVariavel("imagem_unidade")?.fonte.tabela).toBe("hercules_masterplans");
  });

  it("a venda vem de hercules_vendas e o plano de temis_planos", () => {
    expect(acharVariavel("valor_imovel_venda")?.fonte).toEqual({ campo: "valor_negociado", tabela: "hercules_vendas" });
    expect(acharVariavel("valor_divida_financiada")?.fonte.tabela).toBe("hercules_vendas");
    expect(acharVariavel("prazo_meses_amortizacao")?.fonte.tabela).toBe("hercules_vendas");
    expect(acharVariavel("plano_normal_quantidade_parcelas")?.fonte.tabela).toBe("temis_planos");
    expect(acharVariavel("plano_normal_quantidade_parcelas")?.fonte.campo).toContain('slot = "normal"');
    expect(acharVariavel("plano_normal_2_valor_tabela")?.fonte.campo).toContain('slot = "normal"');
  });

  it("extensos, datas, blocos e trechos gerados são do sistema", () => {
    expect(acharVariavel("area_lote_extenso")?.fonte.tabela).toBe("hercules_unidades");
    expect(acharVariavel("valor_imovel_venda_extenso")?.fonte.tabela).toBe("sistema");
    expect(acharVariavel("data_emissao_contrato")?.fonte.tabela).toBe("sistema");
    expect(acharVariavel("inicio_dados_cliente_pf")?.fonte.tabela).toBe("sistema");
    expect(acharVariavel("paragrafo_sinal")?.fonte.tabela).toBe("sistema");
  });

  it("o que o Panteon já guarda e o catálogo medido não tinha entrou com fonte preenchida", () => {
    for (const [nome, tabela, campo] of [
      ["empreendimento_nome", "hercules_empreendimentos", "nome"],
      ["empreendimento_codigo", "hercules_empreendimentos", "codigo"],
      ["empreendimento_cidade", "hercules_empreendimentos", "cidade"],
      ["empreendimento_uf", "hercules_empreendimentos", "uf"],
      ["empreendimento_taxa_cessao", "apolo_enterprise_settings", "taxa_cessao"],
      ["codigo_unidade", "hercules_unidades", "codigo"],
      ["preco_tabela_unidade", "hercules_unidades", "preco_tabela"],
      ["valor_entrada", "hercules_vendas", "valor_entrada"],
      ["valor_sinal", "hercules_vendas", "valor_sinal"],
      ["dia_vencimento", "hercules_vendas", "dia_vencimento"],
      ["data_venda", "hercules_vendas", "vendida_em"],
      ["rg_cliente", "apolo_esteira", "ficha.rg + orgaoEmissor"],
    ] as const) {
      const v = acharVariavel(nome);
      expect(v, nome).toBeDefined();
      expect(v?.fonte.tabela, nome).toBe(tabela);
      expect(v?.fonte.campo, nome).toBe(campo);
    }
    // Imobiliária e corretor, separados, cada um pelo seu vínculo na venda.
    // ⚠️ O CNPJ MUDOU DE CASA em 08/09/2026, junto com o CPF do comprador: o documento do titular
    // nunca esteve na ficha — ele mora em `apolo_entities.document_masked`, completo e com máscara.
    expect(acharVariavel("imobiliaria_nome")?.fonte.tabela).toBe("apolo_entities");
    expect(acharVariavel("imobiliaria_cnpj")?.fonte.tabela).toBe("apolo_entities");
    expect(acharVariavel("corretor_nome")?.fonte.tabela).toBe("apolo_entities");
    expect(acharVariavel("corretor_cpf")?.fonte.tabela).toBe("apolo_entities");
    // O CRECI continua na ficha — mas na da IMOBILIÁRIA, dentro do array `corretores`.
    expect(acharVariavel("corretor_creci")?.fonte.tabela).toBe("apolo_esteira");
    // E os novos com sufixo de comprador existem até o 5º.
    expect(acharVariavel("rg_cliente_5")).toBeDefined();
  });

  it("o novo extenso tem par", () => {
    for (const nome of [
      "preco_tabela_unidade_extenso",
      "valor_entrada_extenso",
      "valor_sinal_extenso",
      "dia_vencimento_extenso",
      "data_emissao_contrato_extenso",
    ]) {
      const v = acharVariavel(nome);
      expect(v?.extensoDe, nome).toBeDefined();
      expect(acharVariavel(v!.extensoDe!), nome).toBeDefined();
    }
  });

  it("a fonte vira uma linha legível para a tela", () => {
    expect(descreverFonte({ campo: "quadra", tabela: "hercules_unidades" })).toBe("hercules_unidades.quadra");
    expect(descreverFonte({ tabela: "pendente" })).toBe("pendente no Panteon");
    expect(descreverFonte({ campo: "x", tabela: "pendente" })).toBe("pendente no Panteon (x)");
    expect(descreverFonte({ campo: "hoje", tabela: "sistema" })).toBe("escrito pelo sistema (hoje)");
  });
});

describe("achar as variáveis no texto", () => {
  it("lê o formato das minutas, com colchetes", () => {
    const html = '<p>QUADRA <strong>[numero_quadra]</strong> - LOTE <strong>[numero_lote]</strong></p>';
    expect(variaveisDoTexto(html)).toEqual(["numero_quadra", "numero_lote"]);
  });

  it("ignora colchete com pontuação, que é texto e não variável", () => {
    // "[art. 26-A da Lei nº 6.766/1979]" aparece nas minutas: tem ponto, espaço e barra.
    expect(variaveisDoTexto("<p>[art. 26-A da Lei nº 6.766/1979]</p>")).toEqual([]);
  });

  it("mas uma palavra solta entre colchetes CONTA, e vira aviso", () => {
    // "[sic]" é português, não variável — e mesmo assim é apanhado. É deliberado: o preço de
    // avisar sobre um "[sic]" é uma linha a mais na tela; o preço de calar sobre um "[Nome]" é o
    // contrato sair com "[Nome]" impresso. Erra-se para o lado barato.
    const { conhecidas, desconhecidas } = classificarVariaveis("<p>ipsis litteris [sic]</p>");
    expect(conhecidas).toEqual([]);
    expect(desconhecidas.map((d) => d.nome)).toEqual(["sic"]);
  });

  it("conta as repetições", () => {
    const { conhecidas } = classificarVariaveis("[nome_cliente] e [nome_cliente] e [cpf_cliente]");
    expect(conhecidas[0]).toMatchObject({ nome: "nome_cliente", ocorrencias: 2 });
  });
});

describe("as variáveis que ninguém preenche", () => {
  it("separa [Nome] e [CPF], que saem impressas no papel", () => {
    // Existem de verdade em minutas antigas, seis ocorrências. Nenhum motor as conhece: o
    // contrato sai com "[Nome]" escrito. O aviso tem que aparecer antes da assinatura.
    const { conhecidas, desconhecidas } = classificarVariaveis("[nome_cliente] mas também [Nome] e [CPF]");
    expect(conhecidas.map((c) => c.nome)).toEqual(["nome_cliente"]);
    expect(desconhecidas.map((d) => d.nome).sort()).toEqual(["CPF", "Nome"]);
  });
});

describe("os blocos condicionais — o defeito que já chegou ao cliente", () => {
  it("aceita blocos bem fechados", () => {
    const texto = "[inicio_dados_cliente_pf] fulano [fim_dados_cliente_pf]";
    expect(conferirBlocos(texto)).toEqual([]);
  });

  it("aceita blocos aninhados", () => {
    const texto =
      "[inicio_dados_cliente_2][inicio_dados_cliente_pf_2]x[fim_dados_cliente_pf_2][fim_dados_cliente_2]";
    expect(conferirBlocos(texto)).toEqual([]);
  });

  it("acusa abertura sem fechamento — o caso do Villa Paris", () => {
    // No contrato real, o trecho de pessoa JURÍDICA saiu impresso num comprador pessoa FÍSICA.
    // Um bloco que abre e não fecha faz exatamente isso: o motor não sabe onde parar de esconder.
    const problemas = conferirBlocos("[inicio_dados_cliente_pj] razão social [fim_dados_cliente_pf]");
    expect(problemas).toHaveLength(2);
    expect(problemas.map((p) => p.problema).sort()).toEqual(["abre_sem_fechar", "fecha_sem_abrir"]);
  });

  it("acusa fechamento sem abertura", () => {
    const problemas = conferirBlocos("texto solto [fim_dados_conjuge]");
    expect(problemas).toEqual([
      {
        bloco: "dados_conjuge",
        problema: "fecha_sem_abrir",
        texto: "Existe [fim_dados_conjuge] sem o [inicio_dados_conjuge] correspondente.",
      },
    ]);
  });

  it("acusa blocos cruzados", () => {
    // Abre A, abre B, fecha A, fecha B: o motor decide sozinho onde cada trecho termina.
    const problemas = conferirBlocos(
      "[inicio_dados_cliente_2][inicio_dados_conjuge_2][fim_dados_cliente_2][fim_dados_conjuge_2]",
    );
    expect(problemas.some((p) => p.problema === "fora_de_ordem")).toBe(true);
  });

  it("uma minuta inteira com dezenas de blocos passa se estiver correta", () => {
    const blocos = ["dados_cliente_pf", "dados_conjuge", "dados_cliente_pj"];
    const texto = blocos.map((b) => `[inicio_${b}] conteudo [fim_${b}]`).join(" ");
    expect(conferirBlocos(texto)).toEqual([]);
  });
});

describe("o par valor / por extenso", () => {
  it("acusa o extenso que ficou sozinho", () => {
    // Sobra clássica de copiar e colar: o extenso de um valor que não está mais no texto.
    expect(extensosOrfaos("[valor_imovel_venda_extenso] sem o número")).toEqual([
      "valor_imovel_venda_extenso",
    ]);
  });

  it("não reclama quando os dois estão presentes", () => {
    expect(extensosOrfaos("[valor_imovel_venda] ([valor_imovel_venda_extenso])")).toEqual([]);
  });

  it("a área tem par, e é o caso que produziu o erro no contrato", () => {
    // "300,00 m² (trezentos metros quadrados metros quadrados)" — a unidade saiu duas vezes porque o
    // dado guardado já a trazia. O par existe; quem escreve a unidade é o por-extenso.ts, uma vez só.
    expect(acharVariavel("area_lote_extenso")?.extensoDe).toBe("area_lote");
  });
});

describe("o código partido por tag — o defeito que imprimiu [nome_cliente] no contrato", () => {
  it("acha o código quebrado no meio por uma tag", () => {
    // Copiado da minuta do JDG. Na tela lia-se "[nome_cliente]"; no HTML havia "[nome_cl" fechando
    // um span e "iente]" abrindo outro. O motor procura a string no HTML, não acha, e imprime o
    // marcador no contrato — foi o que saiu no primeiro teste do Jardim das Gerais.
    const html =
      '<strong>[nome_cl</strong></span><span style="font-family:Lucida"><strong>iente]</strong>, de nacionalidade <strong>[nacionalidade_cliente]</strong>';

    const partidos = codigosPartidos(html);
    expect(partidos).toHaveLength(1);
    expect(partidos[0]).toMatchObject({ nome: "nome_cliente", noHtml: 0, noTexto: 1 });
  });

  it("não acusa código inteiro, mesmo cercado de tags", () => {
    const html = '<p><span style="color:red"><strong>[nome_cliente]</strong></span></p>';
    expect(codigosPartidos(html)).toEqual([]);
  });

  it("acha quando SÓ UMA das ocorrências está partida", () => {
    // O caso real: o mesmo código aparecia duas vezes na minuta, inteiro na área de assinatura e
    // partido na qualificação. Contar só "existe no HTML" não pegaria.
    const html = "<p>[nome_cliente]</p><p><strong>[nome_cl</strong><em>iente]</em></p>";
    const partidos = codigosPartidos(html);
    expect(partidos).toHaveLength(1);
    expect(partidos[0]).toMatchObject({ noHtml: 1, noTexto: 2 });
  });

  it("texto sem código nenhum não acusa nada", () => {
    expect(codigosPartidos("<p>contrato sem variáveis</p>")).toEqual([]);
  });
});
