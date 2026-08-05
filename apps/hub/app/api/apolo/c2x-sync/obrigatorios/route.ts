import { NextResponse } from "next/server";

import { authorizeApoloAdmin } from "@/lib/apolo/auth";
import {
  CAMINHO_INTEGRACAO,
  configIntegracao,
  resolverHostSonda,
} from "@/lib/apolo/c2x-integracao";

// DESCOBRE OS CAMPOS OBRIGATÓRIOS do endpoint oficial — SEM CRIAR NINGUÉM.
//
// Como: manda payloads em camadas, do mais pobre ao mais rico, e anota o que a API reclama em cada
// um. Pelo contrato, erro de validação é 422 e "nada é criado".
//
// CADA camada carrega uma garantia de que NÃO vira cadastro:
//   1 a 4  -> vão sem `vinculed_by_id`/`enterprise_id`, que a API cobra sempre;
//   5 e 6  -> vão com `enterprise_id` INEXISTENTE (999999), que garante a recusa mesmo com o resto
//             completo. Elas existem para descobrir se o vínculo vai por DOCUMENTO ou por ID.
// O que interessa em todas é a LISTA de campos reclamados.
//
// Por que isso importa: o caminho antigo (endpoint genérico) exigia 17 campos, e por isso só 165
// das 431 fichas do lançamento estão "prontas". Se o endpoint dedicado exigir menos, o número de
// clientes que conseguimos cadastrar hoje sobe — e é isso que esta sonda mede, com a API dizendo,
// não com a gente supondo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// CPF sintaticamente válido, de teste — só para não travar a validação no dígito verificador e
// deixar a API seguir avaliando o resto. Sem `email`, nada é criado de qualquer forma.
const CPF_SONDA = "39053344705";

const CAMADAS: { nome: string; payload: Record<string, unknown> }[] = [
  {
    nome: "1. só o perfil",
    payload: { person_type: "fisica", profile: "cliente" },
  },
  {
    nome: "2. + nome e documento",
    payload: {
      cpf: CPF_SONDA,
      document_type_id: 2,
      identification_number: CPF_SONDA,
      name: "Teste Integracao Panteon",
      person_type: "fisica",
      profile: "cliente",
    },
  },
  {
    nome: "3. + nascimento, estado civil e sexo",
    payload: {
      birthday: "1985-04-12",
      civil_state_id: 1,
      cpf: CPF_SONDA,
      document_type_id: 2,
      identification_number: CPF_SONDA,
      name: "Teste Integracao Panteon",
      person_type: "fisica",
      profile: "cliente",
      sex_id: 1,
    },
  },
  {
    nome: "4. + escolaridade, renda, naturalidade, nacionalidade, mãe",
    payload: {
      birthday: "1985-04-12",
      civil_state_id: 1,
      cpf: CPF_SONDA,
      document_type_id: 2,
      identification_number: CPF_SONDA,
      mother_name: "Maria Teste",
      nacionality: "Brasileira",
      name: "Teste Integracao Panteon",
      naturalness: "Belo Horizonte",
      person_type: "fisica",
      profile: "cliente",
      salary_range_id: 2,
      schooling_id: 5,
      sex_id: 1,
    },
  },
  // ── As duas camadas abaixo respondem a UMA pergunta: o vínculo vai por DOCUMENTO (como o
  // contrato escrito diz) ou por ID (como a API está pedindo)? São coisas diferentes.
  //
  // Como testar sem criar ninguém: mandamos um `enterprise_id` PROPOSITALMENTE INEXISTENTE. A API
  // vai recusar por causa dele de qualquer jeito — e o que interessa é se ela CONTINUA cobrando
  // `vinculed_by_id`. Se parar de cobrar, é porque aceitou o documento.
  {
    nome: "5. vínculo por DOCUMENTO (o que o contrato diz)",
    payload: {
      birthday: "1985-04-12",
      civil_state_id: 1,
      cpf: CPF_SONDA,
      document_type_id: 2,
      enterprise_id: 999999, // inexistente de propósito: garante a recusa
      identification_number: CPF_SONDA,
      name: "Teste Integracao Panteon",
      person_type: "fisica",
      profile: "cliente",
      vinculed_by_document: "00000000000191",
    },
  },
  {
    nome: "6. vínculo por ID (o que a API pediu)",
    payload: {
      birthday: "1985-04-12",
      civil_state_id: 1,
      cpf: CPF_SONDA,
      document_type_id: 2,
      enterprise_id: 999999, // inexistente de propósito: garante a recusa
      identification_number: CPF_SONDA,
      name: "Teste Integracao Panteon",
      person_type: "fisica",
      profile: "cliente",
      vinculed_by_id: 1,
    },
  },
  // Camada final: empreendimento REAL (Vale do Ouro = 35) e vínculo por documento. Aqui a garantia
  // de não criar é o CPF inválido — a API recusa por ele e, de quebra, mostra se ainda cobra o
  // vínculo. Se NÃO cobrar, o documento foi aceito e o contrato está certo.
  {
    nome: "7. empreendimento REAL + vínculo por documento (CPF inválido trava a criação)",
    payload: {
      birthday: "1985-04-12",
      civil_state_id: 1,
      cpf: "11111111111", // inválido de propósito
      document_type_id: 2,
      enterprise_id: 35, // Vale do Ouro
      identification_number: "11111111111",
      name: "Teste Integracao Panteon",
      person_type: "fisica",
      profile: "cliente",
      vinculed_by_document: "00000000000191",
    },
  },
];

export async function POST(request: Request) {
  const auth = await authorizeApoloAdmin(request);
  if (!auth.ok) return auth.response;

  const cfg = configIntegracao();
  if (!cfg) {
    return NextResponse.json(
      { error: "C2X_WRITE_API_URL/C2X_WRITE_API_TOKEN não configuradas." },
      { status: 503 },
    );
  }

  // O host vem do corpo (opcional) porque a configuração atual aponta para o ambiente de teste,
  // que está fora do ar — e o que queremos sondar é produção.
  //
  // ⚠️ VAZAMENTO DE CREDENCIAL: o fetch abaixo leva o TOKEN DE ESCRITA do C2X nos headers, então o
  // destino NÃO pode ser um host livre vindo do corpo (era assim até 05/08/2026). Só a allowlist de
  // lib/apolo/c2x-integracao.ts decide para onde o token vai; qualquer outro host morre aqui, com
  // 400 e SEM nenhum fetch.
  const corpo = (await request.json().catch(() => ({}))) as { host?: string };
  const alvo = resolverHostSonda(corpo.host, cfg.base);
  if (!alvo.ok) return NextResponse.json({ error: alvo.erro }, { status: 400 });
  const base = alvo.base;
  const url = `${base}${CAMINHO_INTEGRACAO}`;

  const resultados: {
    camada: string;
    criou: boolean;
    http: number | null;
    ms: number;
    pediu: string[];
    resposta: string;
  }[] = [];

  for (const camada of CAMADAS) {
    const inicio = Date.now();
    try {
      const abort = new AbortController();
      const t = setTimeout(() => abort.abort(), 20_000);
      const resp = await fetch(url, {
        body: JSON.stringify(camada.payload),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          access_token: cfg.token,
          Authorization: cfg.token,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: abort.signal,
      }).finally(() => clearTimeout(t));

      const texto = await resp.text();
      const ms = Date.now() - inicio;
      let json: Record<string, unknown> = {};
      try {
        json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
      } catch {
        /* resposta não-JSON: fica só o texto cru */
      }
      const errs = (json.errors ?? {}) as Record<string, string[]>;

      resultados.push({
        camada: camada.nome,
        // Só seria criação se viesse 201 com sucesso — o que não deve acontecer.
        criou: resp.status === 201 && json.status === "success",
        http: resp.status,
        ms,
        // O NOME do campo não basta: "não pode ficar em branco" (campo ausente) e "não existe"
        // (valor inválido) apontam para o mesmo campo e pedem correções opostas. Guardamos a
        // mensagem junto.
        pediu: Object.entries(errs).map(
          ([campo, msgs]) => `${campo}: ${(Array.isArray(msgs) ? msgs : [String(msgs)]).join("; ")}`,
        ),
        resposta: texto.slice(0, 300),
      });
    } catch (erro) {
      resultados.push({
        camada: camada.nome,
        criou: false,
        http: null,
        ms: Date.now() - inicio,
        pediu: [],
        resposta: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  // Campos que a API pediu na camada MAIS COMPLETA: é a lista final de obrigatórios que ainda
  // faltam (tirando `email`, que omitimos de propósito para nada ser criado).
  const ultima = resultados[resultados.length - 1];
  const aindaPede = ultima?.pediu ?? [];

  return NextResponse.json(
    {
      data: {
        aindaPede,
        host: new URL(base).host,
        // Nenhuma camada pode ter criado ninguém — se alguma criou, é um alerta.
        nenhumCriado: resultados.every((r) => !r.criou),
        resultados,
        tempoMedioMs: Math.round(
          resultados.filter((r) => r.http).reduce((s, r) => s + r.ms, 0) /
            Math.max(1, resultados.filter((r) => r.http).length),
        ),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
