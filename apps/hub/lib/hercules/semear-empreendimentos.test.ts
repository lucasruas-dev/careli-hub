import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  agruparPaisEFilhos,
  planejarSemeadura,
} from "../../../../scripts/hercules/semear-empreendimentos-plano.mjs";

// O SEMEADOR DE EMPREENDIMENTOS (scripts/hercules/semear-empreendimentos.mjs) FECHADO (24/09/2026).
//
// Lucas, depois de a Nívea renomear no C2X o 43 de RECANTO DO VALE/RDV para PORTAL DO IBITURUNA/PDI:
// *"Tivemos que mudar de nome"*; e *"pode"* para travar as portas por onde o C2X ainda mexe no
// Panteon. O semeador era a única carga do legado sem a trava de 21/09, e fazia UPSERT por código:
// rodado hoje, traria o nome do C2X por cima do cadastro e bateria no índice único do id do 43.
//
// O que estes testes cobram:
//   1. `--gravar` sem `--carga-do-legado-autorizada` é recusado ANTES de qualquer conexão;
//   2. o script não tem mais upsert nem update: só insert;
//   3. o plano só INSERE o que falta; o que existe (casado pelo ID do C2X) fica intocado, mesmo com
//      nome e sigla diferentes no legado;
//   4. filho novo é pendurado no pai que já existe, sem mexer no pai;
//   5. o aditivo 30 fica de fora pelo ID, qualquer que seja a sigla do dia (LAG, ADT, ACT);
//   6. produto de outro dono e código que já é de outro produto não são tocados.

const RAIZ = join(__dirname, "..", "..", "..", "..");
const SCRIPT = join(RAIZ, "scripts", "hercules", "semear-empreendimentos.mjs");
const TEXTO_DO_SCRIPT = readFileSync(SCRIPT, "utf8");

describe("a trava da carga encerrada", () => {
  it("--gravar sem a autorização sai com erro e explica o porquê", () => {
    // ⚠️ RODA NUM DIRETÓRIO VAZIO, de propósito: o script resolve o .env e os pacotes a partir do cwd.
    // Se a trava um dia sumir, aqui ele não acha nem o .env nem o driver, e cai sem conseguir
    // conectar em banco nenhum; o teste falha pela mensagem, nunca por ter gravado.
    const vazio = mkdtempSync(join(tmpdir(), "semear-"));
    try {
      const r = spawnSync(process.execPath, [SCRIPT, "--gravar"], { cwd: vazio, encoding: "utf8" });

      expect(r.status).toBe(1);
      expect(r.stderr).toContain("CARGA DO LEGADO ENCERRADA");
      expect(r.stderr).toContain("--gravar --carga-do-legado-autorizada");
      expect(r.stdout).not.toContain("C2X:");
    } finally {
      rmSync(vazio, { force: true, recursive: true });
    }
  });

  it("a trava vem antes do .env, do driver do C2X e do Supabase", () => {
    const trava = TEXTO_DO_SCRIPT.indexOf("if (GRAVAR && !CARGA_AUTORIZADA)");
    expect(trava).toBeGreaterThan(-1);
    for (const depois of ["createRequire(path.resolve", ".env.local", "mysql.createConnection", "createClient("]) {
      expect(TEXTO_DO_SCRIPT.indexOf(depois)).toBeGreaterThan(trava);
    }
  });

  it("não sobra escrita que reescreva: nem upsert, nem update, nem delete", () => {
    expect(TEXTO_DO_SCRIPT).not.toMatch(/\.upsert\(/);
    expect(TEXTO_DO_SCRIPT).not.toMatch(/\.update\(/);
    expect(TEXTO_DO_SCRIPT).not.toMatch(/\.delete\(/);
    expect(TEXTO_DO_SCRIPT).toMatch(/\.insert\(/);
  });
});

// O C2X de hoje (medido em 24/09/2026), no recorte que importa.
const C2X = [
  { cidade: "Governador Valadares", code: "PDI", estado: "Minas Gerais", id: 43, name: "PORTAL DO IBITURUNA" },
  { cidade: "Lagoa Santa", code: "VLO", estado: "Minas Gerais", id: 35, name: "VALE DO OURO - MASTERPLAN" },
  { cidade: "Lagoa Santa", code: "VOL", estado: "Minas Gerais", id: 36, name: "VALE DO OURO" },
  { cidade: "Lagoa Santa", code: "VOC", estado: "Minas Gerais", id: 37, name: "VALE DO OURO" },
  { cidade: "Pedras", code: "ACP", estado: "Minas Gerais", id: 42, name: "ALDEIA DA CACHOEIRA DAS PEDRAS" },
  // O aditivo: era LAG, virou ADT em 16/07 e ACT em 21/09.
  { cidade: "Pedras", code: "ACT", estado: "Minas Gerais", id: 30, name: "ALDEIA DA CACHOEIRA DAS PEDRAS - TERMO DE ADESAO E TRANSFERENCIA" },
];

// O Panteon de hoje: o 43 já é "Portal do Ibituruna"/PDI; a Aldeia tem outra grafia.
const PANTEON = [
  { c2x_enterprise_id: "43", codigo: "PDI", id: "u-pdi", nome: "Portal do Ibituruna", ordem: 5, pai_id: null, vendendo: false },
  { c2x_enterprise_id: "35", codigo: "VLO", id: "u-vlo", nome: "Vale do Ouro", ordem: 0, pai_id: null, vendendo: true },
  { c2x_enterprise_id: "36", codigo: "VOL", id: "u-vol", nome: "Vale do Ouro · VOL", ordem: 0, pai_id: "u-vlo", vendendo: true },
  { c2x_enterprise_id: "37", codigo: "VOC", id: "u-voc", nome: "Vale do Ouro · VOC", ordem: 1, pai_id: "u-vlo", vendendo: true },
  { c2x_enterprise_id: "42", codigo: "ACP", id: "u-acp", nome: "Aldeia das Cachoeiras das Pedras", ordem: 3, pai_id: null, vendendo: true },
];

type Item = ReturnType<typeof planejarSemeadura>[number];
const doPlano = (plano: Item[], codigo: string) => plano.find((p) => p.codigo === codigo);
const inserts = (plano: Item[]) =>
  plano.flatMap((p) => [
    ...(p.acao === "inserir" ? [p.codigo] : []),
    ...p.filhos.filter((f: { acao: string }) => f.acao === "inserir").map((f: { codigo: string }) => f.codigo),
  ]);

describe("o plano do semeador: só o que falta", () => {
  it("com o cadastro em dia, não há nada a inserir", () => {
    const plano = planejarSemeadura(agruparPaisEFilhos(C2X), PANTEON);
    expect(inserts(plano)).toEqual([]);
  });

  it("o 43 renomeado de novo no C2X: casa pelo ID e NADA muda (só aparece a divergência)", () => {
    const renomeado = C2X.map((l) => (l.id === 43 ? { ...l, code: "NNN", name: "NOME QUE A NIVEA POS" } : l));
    const plano = planejarSemeadura(agruparPaisEFilhos(renomeado), PANTEON);

    const item = doPlano(plano, "NNN");
    expect(item?.acao).toBe("existe");
    expect(item?.divergencias).toEqual([
      'nome no Panteon "Portal do Ibituruna", no C2X "Nome Que A Nivea Pos"',
      "código no Panteon PDI, no C2X NNN",
    ]);
    expect(inserts(plano)).toEqual([]);
  });

  it("a grafia da Aldeia no C2X não vira regravação", () => {
    const item = doPlano(planejarSemeadura(agruparPaisEFilhos(C2X), PANTEON), "ACP");
    expect(item?.acao).toBe("existe");
    expect(item?.divergencias?.[0]).toContain('no Panteon "Aldeia das Cachoeiras das Pedras"');
  });

  it("empreendimento novo no C2X entra como pai novo, sem id inventado", () => {
    const novo = [...C2X, { cidade: "Ipatinga", code: "NOV", estado: "Minas Gerais", id: 44, name: "RESIDENCIAL NOVO" }];
    const item = doPlano(planejarSemeadura(agruparPaisEFilhos(novo), PANTEON), "NOV");

    expect(item?.acao).toBe("inserir");
    expect(item?.linha).toMatchObject({
      c2x_enterprise_id: "44",
      cidade: "Ipatinga",
      codigo: "NOV",
      nome: "Residencial Novo",
      // Depois do maior `ordem` de pai que existe (5, o 43).
      ordem: 6,
      pai_id: null,
      uf: "MG",
      vendendo: false,
    });
  });

  it("divisão nova do Vale do Ouro é pendurada no VLO que existe, e o VLO não é tocado", () => {
    const comVor = [...C2X, { cidade: "Lagoa Santa", code: "VOR", estado: "Minas Gerais", id: 41, name: "VALE DO OURO" }];
    const vlo = doPlano(planejarSemeadura(agruparPaisEFilhos(comVor), PANTEON), "VLO");

    expect(vlo?.acao).toBe("existe");
    expect(vlo?.existenteId).toBe("u-vlo");
    expect(vlo?.linha).toBeUndefined();
    expect(vlo?.filhos.map((f: { acao: string; codigo: string }) => `${f.codigo}:${f.acao}`)).toEqual([
      "VOC:existe",
      "VOL:existe",
      "VOR:inserir",
    ]);
    const vor = vlo?.filhos.find((f: { codigo: string }) => f.codigo === "VOR");
    // Depois do maior `ordem` entre os filhos do VLO (1, o VOC).
    expect(vor?.linha).toMatchObject({ c2x_enterprise_id: "41", nome: "Vale do Ouro · VOR", ordem: 2 });
  });

  it("o aditivo 30 fica de fora pelo ID, com qualquer sigla", () => {
    for (const sigla of ["ACT", "ADT", "LAG", "XPTO"]) {
      const c2x = C2X.map((l) => (l.id === 30 ? { ...l, code: sigla } : l));
      const plano = planejarSemeadura(agruparPaisEFilhos(c2x), PANTEON);
      expect(plano.some((p) => p.codigo === sigla)).toBe(false);
    }
  });

  it("produto de outro dono não é tocado nem ganha filho do C2X", () => {
    const operado = PANTEON.map((l) => (l.codigo === "VLO" ? { ...l, operado_por: "inc-1" } : l));
    const comVor = [...C2X, { cidade: "Lagoa Santa", code: "VOR", estado: "Minas Gerais", id: 41, name: "VALE DO OURO" }];
    const plano = planejarSemeadura(agruparPaisEFilhos(comVor), operado);

    expect(doPlano(plano, "VLO")?.acao).toBe("pulado");
    expect(inserts(plano)).toEqual([]);
  });

  it("código que já é de OUTRO produto do Panteon: conflito, nada é gravado", () => {
    const panteon = [...PANTEON, { c2x_enterprise_id: "100001", codigo: "CEC", id: "u-cec", nome: "Prédio da Cecílio", ordem: 9, pai_id: null }];
    const c2x = [...C2X, { cidade: "BH", code: "CEC", estado: "Minas Gerais", id: 45, name: "CENTRO EMPRESARIAL" }];
    const plano = planejarSemeadura(agruparPaisEFilhos(c2x), panteon);

    expect(doPlano(plano, "CEC")?.acao).toBe("conflito");
    expect(inserts(plano)).toEqual([]);
  });

  it("nenhuma ação do plano atualiza linha", () => {
    const novo = [...C2X, { cidade: "Ipatinga", code: "NOV", estado: "Minas Gerais", id: 44, name: "RESIDENCIAL NOVO" }];
    const plano = planejarSemeadura(agruparPaisEFilhos(novo), PANTEON);
    const acoes = new Set(plano.flatMap((p) => [p.acao, ...p.filhos.map((f: { acao: string }) => f.acao)]));
    for (const acao of acoes) expect(["conflito", "existe", "inserir", "pulado"]).toContain(acao);
  });
});
