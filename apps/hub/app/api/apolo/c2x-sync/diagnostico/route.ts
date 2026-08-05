import { NextResponse } from "next/server";

import { authorizeApoloAdmin } from "@/lib/apolo/auth";

// DIAGNÓSTICO da API de escrita do C2X — responde "o host está no ar?" e "a chave é aceita?"
// SEM CRIAR NADA no sistema deles.
//
// Como prova a chave sem sujar a base: manda um corpo VAZIO. Pelo contrato (item 1.3), erro de
// validação é 422 e "nada é criado"; sem chave válida é 401. Então:
//    401 -> a chave NÃO é aceita        422 -> a chave É aceita (passou da porta, travou na validação)
// Qualquer outro código a gente mostra cru, pra não interpretar errado.
//
// Testa os DOIS caminhos, porque eles convivem: o endpoint dedicado da integração
// (/api/v1/integrations/panteon/users, o do contrato de 22/jul) e o genérico (/api/v1/users, o que
// a nossa implementação usa hoje). É assim que se enxerga qual dos dois responde neste ambiente.
//
// Só ADMIN do Apolo. A chave NUNCA sai na resposta — nem mascarada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const CAMINHOS = [
  { nome: "integração (contrato)", path: "/api/v1/integrations/panteon/users" },
  { nome: "genérico (nosso código hoje)", path: "/api/v1/users" },
];

// Os DOIS ambientes, sempre — a configuração atual aponta para o de teste, que saiu do ar, e o que
// interessa saber agora é se a MESMA chave é aceita em produção. Hosts são públicos; a chave não.
const AMBIENTES = [
  { host: "https://sistema.careli.adm.br", nome: "produção" },
  { host: "https://teste.careli.adm.br", nome: "teste" },
];

type Sonda = {
  ambiente: string;
  caminho: string;
  detalhe: string;
  host: string;
  http: number | null;
  leitura: string;
  nome: string;
};

function ler(http: number | null, corpo: string): string {
  if (http === null) return "sem resposta (host fora do ar, DNS ou firewall)";
  if (http === 401) return "CHAVE RECUSADA (401)";
  if (http === 404) return "endpoint não existe aqui (404)";
  if (http === 422) return "CHAVE ACEITA — parou na validação, nada foi criado (422)";
  if (http === 201 || http === 200) {
    // O endpoint genérico responde 201 até em erro; o corpo é que diz.
    return /"status"\s*:\s*"success"/.test(corpo)
      ? `⚠️ CHAVE ACEITA e a resposta veio como SUCESSO (${http}) — pode ter criado registro`
      : `CHAVE ACEITA — resposta ${http} com falha de validação no corpo, nada criado`;
  }
  return `resposta ${http}`;
}

export async function GET(request: Request) {
  const auth = await authorizeApoloAdmin(request);
  if (!auth.ok) return auth.response;

  const base = process.env.C2X_WRITE_API_URL?.trim();
  const token = process.env.C2X_WRITE_API_TOKEN?.trim();

  // O host informado na URL é público (não é segredo); a CHAVE nunca é devolvida.
  let host = "não configurado";
  if (base) {
    try {
      host = new URL(base).host;
    } catch {
      host = "URL inválida na configuração";
    }
  }

  if (!base || !token) {
    return NextResponse.json({
      data: {
        host,
        pronto: false,
        sondas: [],
        temChave: Boolean(token),
        resumo: "Falta configurar a URL e/ou a chave da API de escrita.",
      },
    });
  }

  const sondas: Sonda[] = [];
  const alvos = AMBIENTES.flatMap((amb) =>
    CAMINHOS.map((c) => ({ ...c, ambiente: amb.nome, host: amb.host })),
  );

  for (const { ambiente, host, nome, path } of alvos) {
    const alvo = `${host}${path}`;
    try {
      const controle = new AbortController();
      const t = setTimeout(() => controle.abort(), 15_000);
      const resp = await fetch(alvo, {
        // Corpo VAZIO de propósito: queremos a validação reprovando, não um cadastro.
        body: JSON.stringify({}),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          // A devolutiva de 27/jul trocou `access_token` por `Authorization`. Mandamos os dois:
          // o que não for usado é ignorado, e assim a sonda funciona nas duas versões da API.
          access_token: token,
          Authorization: token,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controle.signal,
      }).finally(() => clearTimeout(t));

      const texto = (await resp.text()).slice(0, 400);
      sondas.push({
        ambiente,
        caminho: path,
        detalhe: texto,
        host,
        http: resp.status,
        leitura: ler(resp.status, texto),
        nome,
      });
    } catch (erro) {
      sondas.push({
        ambiente,
        caminho: path,
        detalhe: erro instanceof Error ? erro.message : String(erro),
        host,
        http: null,
        leitura: ler(null, ""),
        nome,
      });
    }
  }

  const aceitas = sondas.filter(
    (s) => s.http === 422 || s.http === 200 || s.http === 201,
  );
  const resumo = aceitas.length
    ? `A chave é aceita em: ${[...new Set(aceitas.map((s) => `${s.ambiente} (${s.caminho})`))].join(" · ")}`
    : sondas.some((s) => s.http === 401)
      ? "A chave NÃO foi aceita em nenhum caminho que respondeu (401)."
      : "Nenhum ambiente respondeu — veja o detalhe abaixo.";

  return NextResponse.json(
    {
      data: {
        host,
        pronto: true,
        resumo,
        sondas,
        temChave: true,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
