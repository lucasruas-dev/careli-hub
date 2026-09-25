import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  clienteEmMemoria,
  type EstadoDoBanco,
  novoEstado,
} from "@/lib/temis/fixtures/supabase-em-memoria";

import type { DadosDoContrato } from "@/lib/temis/preencher-contrato";

import { assinantesDoQuadro, impedimentoDaVirada0191 } from "./quadro-db";
import { coordenadoraSemQuemAssine, signatariosDoContrato } from "./signatarios";

// QUEM O ENVELOPE CONVIDA PARA O PAPEL DA COORDENADORA: SÓ O QUE ESTÁ NO QUADRO.
//
// Lucas, 25/09/2026: *"o fabricio não aparece para assinar"*. No VOR (41) a Nívea gravou
// coordenadores nas linhas 2 e 3; a TELA mostrava o Fabricio herdado da ficha da Gurgel na linha 1,
// e o ENVIO, que só herdava com o papel vazio, mandava o contrato sem ele. No mesmo dia: *"todas
// assinaturas eu tenho que conseguir excluir e editar, esse cadeado esta errado"* e *"nao tem que ter
// mais sync com c2x referente a contrato"*.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA (ele travava, até 25/09/2026, a regra antiga: de QUAL coluna de
// `apolo_enterprise_settings` o papel herdava o representante legal. A função `empresasDoEmpreendimento`
// saiu junto com a herança):
//   • papel vazio no quadro é papel vazio no envelope, mesmo com a ficha da coordenadora tendo um
//     representante legal com e-mail;
//   • a leitura não toca a ficha (settings, vínculos, pessoas, contatos) nenhuma vez;
//   • a linha que a migration 0191 grava é a que vai, com o e-mail que o Lucas escolheu;
//   • o VOR sai como está gravado: linhas 2, 3 e 4, nessa ordem;
//   • enquanto a 0191 não está no banco, o envio com a coordenadora qualificada e ninguém por ela
//     TRAVA (`impedimentoDaVirada0191`); depois dela, volta a ser só aviso.

const EMPRESA_GURGEL = "9e860967-9ac3-59d3-b9a0-a6713f0c8b53";
const PESSOA_FABRICIO = "00000000-0000-4000-8000-00000000fab1";

/** A ficha como ela está em produção: a Gurgel com o Fabricio de representante legal. */
function comAFichaDaGurgel(temis_assinantes: Record<string, unknown>[] = []): EstadoDoBanco {
  const banco = novoEstado();
  banco.tabelas = {
    apolo_contacts: [
      { contact_type: "email", entity_id: PESSOA_FABRICIO, value: "diretoria@ficha.test" },
    ],
    apolo_enterprise_settings: [
      {
        coordenador_entity_id: null,
        coordenadora_entity_id: EMPRESA_GURGEL,
        enterprise_id: "35",
        vendedor_entity_id: null,
      },
    ],
    apolo_entities: [
      { display_name: "FABRICIO EXEMPLO GURGEL", document_masked: "529.982.247-25", id: PESSOA_FABRICIO },
    ],
    apolo_relationships: [
      {
        entity_id: EMPRESA_GURGEL,
        related_entity_id: PESSOA_FABRICIO,
        relationship_type: "representante_legal",
      },
    ],
    temis_assinantes,
  };
  return banco;
}

const coordenador = (enterpriseId: string, posicao: number, nome: string, email: string) => ({
  ativo: true,
  cpf: null,
  email,
  enterprise_id: enterpriseId,
  nome,
  ordem_assinatura: null,
  papel: "coordenador",
  posicao,
  telefone: null,
  workspace_id: "careli",
});

const ler = (banco: EstadoDoBanco, enterpriseId: string) =>
  assinantesDoQuadro(clienteEmMemoria(banco) as unknown as SupabaseClient, { enterpriseId });

const tabelasLidas = (banco: EstadoDoBanco) => [...new Set(banco.consultas.map((c) => c.tabela))];

describe("o papel da coordenadora vem só do quadro", () => {
  it("⚠️ papel vazio no quadro não herda o representante da ficha", async () => {
    const banco = comAFichaDaGurgel();

    const pessoas = await ler(banco, "35");

    expect(pessoas.filter((p) => p.papel === "coordenadora")).toEqual([]);
    expect(pessoas.map((p) => p.email)).not.toContain("diretoria@ficha.test");
  });

  it("a leitura não toca a ficha: uma consulta, só no quadro", async () => {
    const banco = comAFichaDaGurgel();

    await ler(banco, "35");

    expect(tabelasLidas(banco)).toEqual(["temis_assinantes"]);
    expect(banco.consultas).toHaveLength(1);
  });

  it("a linha gravada pela 0191 é quem assina, com o e-mail da empresa", async () => {
    const banco = comAFichaDaGurgel([
      {
        ...coordenador("35", 1, "FABRICIO EXEMPLO GURGEL", "contrato@fgurgel.com.br"),
        origem: "backfill_heranca_0191",
      },
    ]);

    const pessoas = await ler(banco, "35");

    expect(pessoas.filter((p) => p.papel === "coordenadora").map((p) => [p.nome, p.email])).toEqual([
      ["FABRICIO EXEMPLO GURGEL", "contrato@fgurgel.com.br"],
    ]);
  });

  // O VOR como estava em 25/09/2026 depois de a Nívea regravar o Fabricio na linha 4: a tela antiga
  // mostrava ALÉM disso o Fabricio herdado na linha 1 (duplicado); o envio levava os três. Agora as
  // duas pontas leem a mesma coisa.
  it("o VOR sai como está gravado: linhas 2, 3 e 4, sem ninguém a mais", async () => {
    const banco = comAFichaDaGurgel([
      coordenador("41", 4, "FABRICIO EXEMPLO GURGEL", "contrato@fgurgel.com.br"),
      coordenador("41", 2, "NIVEA EXEMPLO", "nivea@careli.test"),
      coordenador("41", 3, "HUBER EXEMPLO", "huber@gurgel.test"),
    ]);
    banco.tabelas.apolo_enterprise_settings?.push({
      coordenador_entity_id: null,
      coordenadora_entity_id: EMPRESA_GURGEL,
      enterprise_id: "41",
      vendedor_entity_id: null,
    });

    const pessoas = await ler(banco, "41");
    const coordenadoras = pessoas.filter((p) => p.papel === "coordenadora");

    expect(coordenadoras).toHaveLength(3);
    expect(coordenadoras.map((p) => p.email)).not.toContain("diretoria@ficha.test");
    expect(coordenadoras.map((p) => p.email).sort()).toEqual(
      ["contrato@fgurgel.com.br", "huber@gurgel.test", "nivea@careli.test"].sort(),
    );
  });
});

// ── A TRAVA DA VIRADA (revisão de 25/09/2026) ────────────────────────────────────────────────────
//
// ⚠️ NADA OBRIGAVA A 0191 A ENTRAR ANTES DO DEPLOY, e push na main é produção. Com o código sem
// herança no ar e a migration pendente, os 13 empreendimentos que herdavam o Fabricio mandariam
// contrato sem a coordenadora que o papel qualifica. `impedimentoDaVirada0191` trava só esse envio, e
// só enquanto a coluna da 0191 não existe. A mesma sequência de `prepararEnvio`: quadro, montagem,
// `coordenadoraSemQuemAssine`, a trava.

const COLUNA_DA_0191_AUSENTE = {
  code: "42703",
  message: "column temis_assinantes.atualizado_por_nome does not exist",
};

const CONTRATO_COM_A_GURGEL: DadosDoContrato = {
  compradores: [
    {
      ehPessoaFisica: true,
      temConjuge: false,
      valores: { email_cliente: "comprador@exemplo.test", nome_cliente: "COMPRADOR EXEMPLO SILVA" },
    },
  ],
  gerais: { razao_social_coordenadora_vendas: "GURGEL EXEMPLO NEGOCIOS IMOBILIARIOS LTDA" },
};

/** A sequência de `prepararEnvio`, com a sonda da coluna respondendo como o banco mandar. */
async function impedimentoDoEnvio(banco: EstadoDoBanco, enterpriseId: string, sonda?: typeof COLUNA_DA_0191_AUSENTE) {
  const sb = clienteEmMemoria(banco) as unknown as SupabaseClient;
  const doQuadro = await assinantesDoQuadro(sb, { enterpriseId });
  const { pessoas } = signatariosDoContrato(CONTRATO_COM_A_GURGEL, doQuadro);
  // A leitura do quadro já foi feita; daqui em diante a tabela responde como a sonda mandar.
  if (sonda) banco.erros.temis_assinantes = sonda;
  const consultasAntes = banco.consultas.length;
  const impedimento = await impedimentoDaVirada0191(sb, coordenadoraSemQuemAssine(CONTRATO_COM_A_GURGEL, pessoas));
  return { consultasDaTrava: banco.consultas.length - consultasAntes, impedimento };
}

describe("a trava da virada da 0191", () => {
  it("⚠️ código novo, 0191 pendente, papel vazio: o envio TRAVA, e a frase diz as duas saídas", async () => {
    const { impedimento } = await impedimentoDoEnvio(comAFichaDaGurgel(), "35", COLUNA_DA_0191_AUSENTE);

    expect(impedimento).toContain("COORDENADORA DE VENDAS (GURGEL EXEMPLO NEGOCIOS IMOBILIARIOS LTDA)");
    expect(impedimento).toContain("migration 0191");
    expect(impedimento).toContain("bloco Coordenador de Vendas");
    expect(impedimento).not.toContain("—");
  });

  it("com a 0191 aplicada, papel vazio volta a ser só aviso: o Lucas pode excluir qualquer linha", async () => {
    const { impedimento } = await impedimentoDoEnvio(comAFichaDaGurgel(), "35");

    expect(impedimento).toBeNull();
  });

  it("0191 pendente, mas alguém cadastrado no bloco: não trava, e nem consulta a coluna", async () => {
    const banco = comAFichaDaGurgel([
      coordenador("35", 1, "FABRICIO EXEMPLO GURGEL", "contrato@fgurgel.com.br"),
    ]);

    const { consultasDaTrava, impedimento } = await impedimentoDoEnvio(banco, "35", COLUNA_DA_0191_AUSENTE);

    expect(impedimento).toBeNull();
    expect(consultasDaTrava).toBe(0);
  });

  it("contrato sem coordenadora qualificada: não trava e não consulta", async () => {
    const banco = comAFichaDaGurgel();
    banco.erros.temis_assinantes = COLUNA_DA_0191_AUSENTE;

    const impedimento = await impedimentoDaVirada0191(
      clienteEmMemoria(banco) as unknown as SupabaseClient,
      coordenadoraSemQuemAssine({ ...CONTRATO_COM_A_GURGEL, gerais: {} }, []),
    );

    expect(impedimento).toBeNull();
    expect(banco.consultas).toHaveLength(0);
  });

  // ⚠️ SÓ O "COLUNA NÃO EXISTE", PELO NOME DA COLUNA, É PROVA DE MIGRATION PENDENTE. Um timeout
  // travaria uma venda por um blip de rede, sobre um banco que pode estar certo.
  it("outra falha da consulta não trava", async () => {
    const timeout = { code: "57014", message: "canceling statement due to statement timeout" };
    const outraColuna = { code: "42703", message: "column temis_assinantes.outra_coluna does not exist" };

    expect((await impedimentoDoEnvio(comAFichaDaGurgel(), "35", timeout)).impedimento).toBeNull();
    expect((await impedimentoDoEnvio(comAFichaDaGurgel(), "35", outraColuna)).impedimento).toBeNull();
  });
});
