import { beforeEach, describe, expect, it, vi } from "vitest";

// A HABILITAÇÃO PELO CADASTRO INTERNO: auditoria + aviso ao coordenador (Lucas, 24/09/2026).
//
// O que se trava aqui:
//   • o vínculo que a ficha já tem habilitado não é gravado de novo nem avisado (a SANTA FE e a
//     VINICIUS JOHNNY já estavam no 43 quando o wizard gravou uma segunda linha em 24/09); o grupo
//     conta como as suas divisões;
//   • a auditoria é a mesma ação do Board e da página pública, com `automatico: false` e a origem;
//   • o coordenador é avisado pelo mesmo texto do credenciamento, com `primeiraVez` e o número REAL de
//     corretores da ficha, e coordenador não achado vira disparo falho com o motivo;
//   • a imobiliária NÃO recebe boas-vindas por aqui (não foi pedido);
//   • nada disso lança: o cadastro já está gravado.

const m = vi.hoisted(() => ({
  cadastro: vi.fn(),
  coordenadores: vi.fn(),
  enviar: vi.fn(),
}));

vi.mock("@/lib/apolo/disparo-credenciamento", () => ({
  coordenadoresDosEmpreendimentosPorId: m.coordenadores,
  enviarPeloRelacionamento: m.enviar,
}));
vi.mock("@/lib/hercules/cadastro", () => ({ carregarCadastroDeEmpreendimentos: m.cadastro }));

import {
  expandirPeloCadastro,
  expansorDeEmpreendimentos,
  habilitacaoPeloVinculo,
  registrarHabilitacaoPeloCadastro,
  separarVinculosNovos,
} from "./habilitacao-pelo-cadastro";

const vinculo = (enterpriseId: string, label = "PORTAL DO IBITURUNA") => ({
  entity_id: "imob",
  label,
  metadata: { enterpriseId, kind: "trabalho", role: "empreendimento", source: "apolo" },
  related_entity_id: null,
  relationship_type: "empreendimento",
  status: "verified",
});
const corretor = { entity_id: "imob", label: "JOAO", relationship_type: "corretor", status: "verified" };

// O cadastro do Panteon do jeito que `idsDoC2xDoPedido` lê: o Lagoa Bonita (LAB) é o pai das três glebas.
const CADASTRO = [
  { c2xEnterpriseId: "31", codigo: "LAB", id: "h-lab", nome: "Lagoa Bonita", paiId: null },
  { c2xEnterpriseId: "33", codigo: "LBF", id: "h-lbf", nome: "Lagoa Bonita · LBF", paiId: "h-lab" },
  { c2xEnterpriseId: "27", codigo: "LBR", id: "h-lbr", nome: "Lagoa Bonita · LBR", paiId: "h-lab" },
  { c2xEnterpriseId: "32", codigo: "LBP", id: "h-lbp", nome: "Lagoa Bonita · LBP", paiId: "h-lab" },
  { c2xEnterpriseId: "43", codigo: "PDI", id: "h-pdi", nome: "Portal do Ibituruna", paiId: null },
  // O Vale do Ouro como está no banco (medido em 25/09/2026): o VLO (35) é o pai com espelho de VOC,
  // VOL e VOR.
  { c2xEnterpriseId: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", paiId: null },
  { c2xEnterpriseId: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", paiId: "h-vlo" },
  { c2xEnterpriseId: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", paiId: "h-vlo" },
  { c2xEnterpriseId: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", paiId: "h-vlo" },
];

beforeEach(() => {
  m.cadastro.mockReset();
  m.cadastro.mockResolvedValue(CADASTRO);
});

describe("separarVinculosNovos", () => {
  it("⚠️ a SANTA FE já habilitada no 43: a linha repetida sai e não há nada novo", () => {
    const r = separarVinculosNovos([vinculo("43"), corretor], ["43", "35"]);
    expect(r.novos).toEqual([]);
    expect(r.relacionamentos).toEqual([corretor]);
  });

  it("empreendimento que ela não tinha é novo e continua nas linhas", () => {
    const r = separarVinculosNovos([vinculo("43"), vinculo("29", "VISTA ALEGRE")], ["29"]);
    expect(r.novos).toEqual([{ enterpriseId: "43", label: "PORTAL DO IBITURUNA" }]);
    expect(r.relacionamentos).toEqual([vinculo("43")]);
  });

  it("o mesmo empreendimento duas vezes na mesma gravação vira um só", () => {
    const r = separarVinculosNovos([vinculo("43"), vinculo(" 43 ")], []);
    expect(r.novos).toEqual([{ enterpriseId: "43", label: "PORTAL DO IBITURUNA" }]);
    expect(r.relacionamentos).toHaveLength(1);
  });

  it("o grupo conta como as divisões: com as três glebas habilitadas, o `group:` não é novo", async () => {
    const expandir = await expansorDeEmpreendimentos(["33", "27", "32", "group:Lagoa Bonita"]);
    const r = separarVinculosNovos([vinculo("group:Lagoa Bonita", "LAGOA BONITA")], ["33", "27", "32"], expandir);
    expect(r.novos).toEqual([]);
    // E ao contrário: com o grupo habilitado, a gleba também já está.
    const inverso = separarVinculosNovos([vinculo("33", "LAGOA BONITA")], ["group:Lagoa Bonita"], expandir);
    expect(inverso.novos).toEqual([]);
  });

  it("com só uma gleba habilitada, o grupo ainda é novo", async () => {
    const expandir = await expansorDeEmpreendimentos(["33", "group:Lagoa Bonita"]);
    const r = separarVinculosNovos([vinculo("group:Lagoa Bonita", "LAGOA BONITA")], ["33"], expandir);
    expect(r.novos).toEqual([{ enterpriseId: "group:Lagoa Bonita", label: "LAGOA BONITA" }]);
  });

  it("⚠️ a PALHARES (36, 37 e 41 pela página pública) e o wizard com o Vale do Ouro (35): nada novo", async () => {
    const expandir = await expansorDeEmpreendimentos(["36", "37", "41", "35"]);
    const r = separarVinculosNovos([vinculo("35", "VALE DO OURO"), corretor], ["36", "37", "41"], expandir);
    expect(r.novos).toEqual([]);
    expect(r.relacionamentos).toEqual([corretor]);
    // E ao contrário: com o 35 habilitado, a divisão também já está.
    const inverso = separarVinculosNovos([vinculo("36", "VALE DO OURO")], ["35"], expandir);
    expect(inverso.novos).toEqual([]);
  });

  it("com só uma divisão do Vale do Ouro, o 35 ainda é novo (a mesma régua do grupo)", async () => {
    const expandir = await expansorDeEmpreendimentos(["36", "35"]);
    const r = separarVinculosNovos([vinculo("35", "VALE DO OURO")], ["36"], expandir);
    expect(r.novos).toEqual([{ enterpriseId: "35", label: "VALE DO OURO" }]);
  });
});

describe("expandirPeloCadastro", () => {
  it("o pai com divisões vira as divisões; o grupo, as divisões do pai de mesmo nome; o resto, ele mesmo", () => {
    expect(expandirPeloCadastro("35", CADASTRO)).toEqual(["37", "36", "41"]);
    expect(expandirPeloCadastro("group:Vale do Ouro", CADASTRO)).toEqual(["37", "36", "41"]);
    expect(expandirPeloCadastro("group:Lagoa Bonita", CADASTRO)).toEqual(["33", "27", "32"]);
    expect(expandirPeloCadastro(" 43 ", CADASTRO)).toEqual(["43"]);
    expect(expandirPeloCadastro("36", CADASTRO)).toEqual(["36"]);
    expect(expandirPeloCadastro("", CADASTRO)).toEqual([]);
  });
});

describe("expansorDeEmpreendimentos", () => {
  it("lê o cadastro uma vez (só ele diz quem é pai) e expande o pai", async () => {
    const expandir = await expansorDeEmpreendimentos(["43", "35"]);
    expect(m.cadastro).toHaveBeenCalledTimes(1);
    expect(expandir("43")).toEqual(["43"]);
    expect(expandir("35")).toEqual(["37", "36", "41"]);
  });

  it("sem id nenhum, nem lê o cadastro", async () => {
    const expandir = await expansorDeEmpreendimentos(["", "  "]);
    expect(m.cadastro).not.toHaveBeenCalled();
    expect(expandir("43")).toEqual(["43"]);
  });

  it("leitura do cadastro que falha cai na identidade, sem lançar", async () => {
    m.cadastro.mockRejectedValue(new Error("fora do ar"));
    const expandir = await expansorDeEmpreendimentos(["group:Lagoa Bonita"]);
    expect(expandir("group:Lagoa Bonita")).toEqual(["group:Lagoa Bonita"]);
  });
});

// ── O registro: auditoria e aviso ───────────────────────────────────────────────────────────────────

function clienteFalso(opcoes: { corretores?: number; falharAuditoria?: boolean } = {}) {
  const auditorias: unknown[] = [];
  const client = {
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq"]) q[metodo] = () => q;
      q.insert = async (linha: unknown) => {
        if (tabela !== "apolo_audit_events") return { error: null };
        auditorias.push(linha);
        return { error: opcoes.falharAuditoria ? { message: "fora do ar" } : null };
      };
      q.then = (resolver: (r: unknown) => unknown) =>
        Promise.resolve({ count: opcoes.corretores ?? 0, data: null, error: null }).then(resolver);
      return q;
    },
  };
  return { auditorias, client: client as never };
}

const ENTRADA = {
  autorUserId: "766e2df4-c404-472e-9c33-bd65cbf150d8",
  cnpj: "12.345.678/0001-90",
  empreendimentos: [{ enterpriseId: "43", label: "PORTAL DO IBITURUNA" }],
  entityId: "ent-vida",
  imobiliaria: "VIDA IMOVEIS LTDA",
  primeiraVez: false,
};

describe("registrarHabilitacaoPeloCadastro", () => {
  beforeEach(() => {
    m.coordenadores.mockReset();
    m.coordenadores.mockResolvedValue([
      { empreendimentos: [{ label: "PORTAL DO IBITURUNA" }], nome: "LUNA NEGOCIOS IMOBILIARIOS", telefone: "33988887777" },
    ]);
    m.enviar.mockReset();
    m.enviar.mockResolvedValue({ ok: true, para: "5533988887777" });
  });

  it("⚠️ audita como o Board e a página pública, com automatico:false e a origem", async () => {
    const { auditorias, client } = clienteFalso();
    const r = await registrarHabilitacaoPeloCadastro(client, ENTRADA);
    expect(r.auditou).toBe(true);
    expect(auditorias).toEqual([
      {
        action: "credenciamento_habilitado",
        actor_user_id: ENTRADA.autorUserId,
        entity_id: "ent-vida",
        field_name: "credenciamento",
        metadata: { automatico: false, empreendimentos: 1, origem: "cadastro-interno" },
        status: "mapped",
      },
    ]);
  });

  it("⚠️ avisa a LUNA pelo id, com primeiraVez e o número REAL de corretores da ficha", async () => {
    const { client } = clienteFalso({ corretores: 3 });
    const r = await registrarHabilitacaoPeloCadastro(client, ENTRADA);

    expect(m.coordenadores).toHaveBeenCalledWith(client, ENTRADA.empreendimentos);
    expect(m.enviar).toHaveBeenCalledTimes(1);
    const envio = m.enviar.mock.calls[0]?.[1] as Record<string, string>;
    expect(envio).toMatchObject({
      destinatario: "coordenador:LUNA NEGOCIOS IMOBILIARIOS",
      entityId: "ent-vida",
      telefone: "33988887777",
      tipo: "credenciamento_coordenador",
    });
    expect(envio.texto).toContain("*Imobiliária habilitada no seu empreendimento*");
    expect(envio.texto).toContain("VIDA IMOVEIS LTDA");
    expect(envio.texto).toContain("CNPJ 12.345.678/0001-90");
    expect(envio.texto).toContain("PORTAL DO IBITURUNA");
    expect(envio.texto).toContain("3 corretores cadastrados.");
    expect(envio.texto).toContain("Ela já trabalha com a gente");
    expect(r.coordenadores).toEqual({ avisados: 1, falharam: 0 });
  });

  it("primeira vez: o texto de imobiliária credenciada", async () => {
    const { client } = clienteFalso();
    await registrarHabilitacaoPeloCadastro(client, { ...ENTRADA, primeiraVez: true });
    const envio = m.enviar.mock.calls[0]?.[1] as Record<string, string>;
    expect(envio.texto).toContain("*Imobiliária credenciada*");
    expect(envio.texto).not.toContain("Ela já trabalha com a gente");
  });

  it("⚠️ só o coordenador: a imobiliária não recebe boas-vindas por aqui", async () => {
    const { client } = clienteFalso();
    await registrarHabilitacaoPeloCadastro(client, ENTRADA);
    for (const chamada of m.enviar.mock.calls) {
      expect((chamada[1] as { destinatario: string }).destinatario).toMatch(/^coordenador:/);
    }
  });

  it("coordenador não achado vira disparo falho com o motivo (impedimento), não silêncio", async () => {
    m.coordenadores.mockResolvedValue([
      {
        empreendimentos: [{ label: "PORTAL DO IBITURUNA" }],
        motivo: "PORTAL DO IBITURUNA: Empreendimento sem coordenador de vendas no Panteon nem no C2X.",
        nome: "não encontrado",
        telefone: null,
      },
    ]);
    m.enviar.mockResolvedValue({ erro: "sem coordenador", ok: false });
    const { client } = clienteFalso();
    const r = await registrarHabilitacaoPeloCadastro(client, ENTRADA);
    expect(m.enviar.mock.calls[0]?.[1]).toMatchObject({
      impedimento: "PORTAL DO IBITURUNA: Empreendimento sem coordenador de vendas no Panteon nem no C2X.",
    });
    expect(r.coordenadores).toEqual({ avisados: 0, falharam: 1 });
  });

  it("nada lança: auditoria recusada e busca de coordenador que explode não derrubam", async () => {
    m.coordenadores.mockRejectedValue(new Error("C2X fora do ar"));
    const { client } = clienteFalso({ falharAuditoria: true });
    await expect(registrarHabilitacaoPeloCadastro(client, ENTRADA)).resolves.toEqual({
      auditou: false,
      coordenadores: { avisados: 0, falharam: 0 },
    });
  });

  it("sem empreendimento novo, não audita nem avisa", async () => {
    const { auditorias, client } = clienteFalso();
    await registrarHabilitacaoPeloCadastro(client, { ...ENTRADA, empreendimentos: [] });
    expect(auditorias).toEqual([]);
    expect(m.coordenadores).not.toHaveBeenCalled();
  });
});

// ── O modal de relacionamento da ficha (revisão de 24/09/2026) ──────────────────────────────────────

function fichaFalsa(opcoes: {
  erroNoPapel?: boolean;
  erroNosVinculos?: boolean;
  ficha?: Record<string, unknown> | null;
  jaHabilitados?: string[];
  papel?: null | string;
}) {
  const client = {
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "limit"]) q[metodo] = () => q;
      const resposta = () => {
        if (tabela === "apolo_entity_profiles") {
          return opcoes.erroNoPapel
            ? { data: null, error: { message: "timeout" } }
            : { data: opcoes.papel ? { status: opcoes.papel } : null, error: null };
        }
        if (tabela === "apolo_relationships") {
          return opcoes.erroNosVinculos
            ? { data: null, error: { message: "timeout" } }
            : { data: (opcoes.jaHabilitados ?? []).map((enterpriseId) => ({ metadata: { enterpriseId } })), error: null };
        }
        if (tabela === "apolo_entities") {
          return {
            data:
              opcoes.ficha === undefined
                ? { display_name: "CONECTTA IMOVEIS", document_masked: "37.716.144/0001-59", entity_kind: "pj", legal_name: "CONECTTA LTDA" }
                : opcoes.ficha,
            error: null,
          };
        }
        return { data: null, error: null };
      };
      q.maybeSingle = async () => resposta();
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve(resposta()).then(ok);
      return q;
    },
  };
  return client as never;
}

const PELO_MODAL = { enterpriseId: "43", entityId: "conectta", label: "PORTAL DO IBITURUNA" };

describe("habilitacaoPeloVinculo: o modal da ficha também habilita por dentro", () => {
  it("⚠️ imobiliária credenciada ligada a um empreendimento novo: é habilitação, com o aviso pronto", async () => {
    const r = await habilitacaoPeloVinculo(fichaFalsa({ jaHabilitados: ["35"], papel: "active" }), PELO_MODAL);
    expect(r).toEqual({
      aviso: {
        cnpj: "37.716.144/0001-59",
        empreendimentos: [{ enterpriseId: "43", label: "PORTAL DO IBITURUNA" }],
        entityId: "conectta",
        imobiliaria: "CONECTTA IMOVEIS",
        primeiraVez: false,
      },
      tipo: "nova",
    });
  });

  it("⚠️ o que ela já tem (com o pai expandido) não é habilitação nova", async () => {
    const ja = await habilitacaoPeloVinculo(fichaFalsa({ jaHabilitados: ["43"], papel: "active" }), PELO_MODAL);
    expect(ja).toEqual({ tipo: "ja-habilitada" });
    const palhares = await habilitacaoPeloVinculo(
      fichaFalsa({ jaHabilitados: ["36", "37", "41"], papel: "active" }),
      { ...PELO_MODAL, enterpriseId: "35", label: "VALE DO OURO" },
    );
    expect(palhares).toEqual({ tipo: "ja-habilitada" });
  });

  it("prospect, cliente e imobiliária ainda em validação não são habilitação", async () => {
    for (const papel of [null, "review", "blocked"]) {
      expect(await habilitacaoPeloVinculo(fichaFalsa({ papel }), PELO_MODAL)).toEqual({ tipo: "nao-e-habilitacao" });
    }
  });

  it("papel ilegível não avisa; vínculos ilegíveis não calam o aviso", async () => {
    expect(await habilitacaoPeloVinculo(fichaFalsa({ erroNoPapel: true }), PELO_MODAL)).toEqual({
      tipo: "nao-e-habilitacao",
    });
    const r = await habilitacaoPeloVinculo(
      fichaFalsa({ erroNosVinculos: true, jaHabilitados: ["43"], papel: "active" }),
      PELO_MODAL,
    );
    expect(r.tipo).toBe("nova");
  });

  it("documento que não é CNPJ formatado não vai na mensagem", async () => {
    const r = await habilitacaoPeloVinculo(
      fichaFalsa({
        ficha: { display_name: "", document_masked: "Documento pendente", entity_kind: "pj", legal_name: "RAZAO SOCIAL" },
        papel: "active",
      }),
      PELO_MODAL,
    );
    expect(r).toMatchObject({ aviso: { cnpj: null, imobiliaria: "RAZAO SOCIAL" }, tipo: "nova" });
  });
});
