// Consulta de relatório de crédito no Serasa Experian.
//
// PF e PJ são SERVIÇOS DIFERENTES, com caminhos diferentes — não é o mesmo endpoint trocando o
// `reportName`. Por isso duas funções, e não uma genérica com um parâmetro de tipo:
//   PF: /credit-services/person-information-report/v1/creditreport
//   PJ: /credit-services/business-information-report/v1/reports
//
// O documento consultado vai em HEADER, nunca na query string. Isso é bom e casa com a regra
// do projeto de não pôr dado pessoal em URL (não vaza em log de proxy nem de CDN).
import { obterToken } from "@/lib/serasa/auth";
import { ambienteConfere, type ConfigSerasa } from "@/lib/serasa/config";

export type ConsultaSerasa = {
  documento: string;
  // Obrigatório em alguns relatórios PF. QUAIS exatamente não está na documentação — é uma
  // das perguntas em aberto com o Serasa (21/jul).
  federalUnit?: string | null;
  optionalFeatures?: string[];
  // Vira JSON e depois base64, como a documentação manda.
  reportParameters?: { name: string; value: string }[];
  reportName: string;
};

export type RespostaSerasa =
  | {
      corpo: unknown;
      httpStatus: number;
      ok: true;
      // A URL chamada, SEM o documento (ele vai em header). Serve para auditoria.
      url: string;
    }
  | { erro: string; httpStatus: number | null; ok: false; url: string };

function soDigitos(valor: string): string {
  return String(valor ?? "").replace(/\D/g, "");
}

// Detecta o 500 que na verdade é problema de AUTENTICAÇÃO.
//
// Medido contra a homologação em 21/jul: token inválido NÃO devolve 401. Devolve **500** com
// um fault do gateway deles ("Execution of Auth-Header-Validator failed... auth-header-validator.js").
// Tratar isso como "erro do Serasa" faria a integração desistir de um caso que se resolve
// renovando o token.
export function pareceTokenInvalido(status: number, corpo: string): boolean {
  if (status !== 500) return false;
  return /auth-header-validator|faultstring|Auth-Header/i.test(corpo);
}

// Mensagem por código, em português, dizendo o que fazer.
//
// ⚠️ Os textos abaixo foram calibrados contra o comportamento REAL da homologação, que difere
// do swagger em pontos importantes (ver docs/architecture/serasa-credito-integracao.md).
function explicar(status: number, corpo: string): string {
  const resumo = corpo.slice(0, 200);
  switch (status) {
    case 400:
      return `Requisicao invalida (400). Confira reportName e parametros. ${resumo}`;
    case 401:
      return `Nao autorizado (401). Token expirado ou credencial de outro ambiente. ${resumo}`;
    case 403:
      return `Sem permissao (403). O relatorio pode nao estar no contrato. ${resumo}`;
    case 404:
      // ⚠️ AMBÍGUO de propósito. Medido em 21/jul: reportName INEXISTENTE devolve o MESMO
      // "DOCUMENT_NOT_FOUND" de um CPF que não está na base. Dizer ao operador "este CPF não
      // existe" seria afirmar mais do que a API permite saber.
      return (
        `Nao encontrado (404). Pode ser o documento que nao esta na base OU o relatorio ` +
        `configurado nao estar ativo para a nossa credencial — a API devolve o mesmo erro ` +
        `para os dois casos. ${resumo}`
      );
    case 412:
      return `Pre-condicao nao atendida (412). Falta parametro obrigatorio. ${resumo}`;
    case 429:
      // Em homologação são 200/dia por IP, e estourar BLOQUEIA o IP.
      return `Limite de chamadas atingido (429). PARE as consultas. ${resumo}`;
    case 500:
      if (pareceTokenInvalido(status, corpo)) {
        return `Falha de autenticacao devolvida como 500 pelo gateway do Serasa. ${resumo}`;
      }
      return `Erro no Serasa (500). ${resumo}`;
    default:
      return `Resposta inesperada (${status}). ${resumo}`;
  }
}

async function consultar(
  config: ConfigSerasa,
  base: string,
  entrada: ConsultaSerasa,
  tamanhoDocumento: number,
): Promise<RespostaSerasa> {
  // Trava de ambiente ANTES de qualquer chamada: em produção cada consulta é cobrada.
  const coerente = ambienteConfere(config);
  if (!coerente.ok) {
    return { erro: coerente.erro ?? "Ambiente incoerente.", httpStatus: null, ok: false, url: base };
  }

  const documento = soDigitos(entrada.documento);
  if (documento.length !== tamanhoDocumento) {
    return {
      erro: `Documento precisa ter ${tamanhoDocumento} digitos (recebido: ${documento.length}).`,
      httpStatus: null,
      ok: false,
      url: base,
    };
  }

  const token = await obterToken(config);
  if (!token.ok) {
    return { erro: token.erro, httpStatus: token.status ?? null, ok: false, url: base };
  }

  const url = new URL(base);
  url.searchParams.set("reportName", entrada.reportName);
  if (entrada.optionalFeatures?.length) {
    // Concatenadas por vírgula SEM espaço, como a documentação exige.
    url.searchParams.set("optionalFeatures", entrada.optionalFeatures.join(","));
  }
  if (entrada.reportParameters?.length) {
    const json = JSON.stringify({ reportParameters: entrada.reportParameters });
    url.searchParams.set("reportParameters", Buffer.from(json).toString("base64"));
  }
  if (entrada.federalUnit) url.searchParams.set("federalUnit", entrada.federalUnit);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.token}`,
    // Quem está sendo CONSULTADO.
    "X-Document-Id": documento,
    // Quem CONSULTA. Sem este header a documentação diz que a contabilização vai para o
    // "cliente distribuidor" — ou seja, nossa consulta seria cobrada de outra empresa.
    "X-Retailer-Document-Id": soDigitos(config.retailerDocumentId),
  };
  if (config.costCenter) headers["X-Cost-Center"] = config.costCenter;

  try {
    let resposta = await fetch(url.toString(), { cache: "no-store", headers, method: "GET" });

    if (!resposta.ok) {
      let corpo = await resposta.text().catch(() => "");

      // UMA retentativa, e só para token inválido disfarçado de 500. O token vale 60 minutos e
      // fica em cache: se expirar entre duas consultas, sem isto o operador veria "erro no
      // Serasa" e não teria o que fazer. Retentar UMA vez, nunca em laço — o teto de chamadas
      // é o que protege o IP de bloqueio.
      if (pareceTokenInvalido(resposta.status, corpo)) {
        const novo = await obterToken(config, { forcarNovo: true });
        if (novo.ok) {
          resposta = await fetch(url.toString(), {
            cache: "no-store",
            headers: { ...headers, Authorization: `Bearer ${novo.token}` },
            method: "GET",
          });
          if (resposta.ok) {
            const corpoOk = await resposta.json().catch(() => null);
            return { corpo: corpoOk, httpStatus: resposta.status, ok: true, url: url.toString() };
          }
          corpo = await resposta.text().catch(() => "");
        }
      }

      return {
        erro: explicar(resposta.status, corpo),
        httpStatus: resposta.status,
        ok: false,
        url: url.toString(),
      };
    }

    // Guardamos o corpo CRU. O schema da resposta não está documentado campo a campo, então
    // extrair só o que se acha que importa perderia o que ninguém previu.
    const corpo = await resposta.json().catch(() => null);
    return { corpo, httpStatus: resposta.status, ok: true, url: url.toString() };
  } catch (erro) {
    return {
      erro: `Falha de rede na consulta: ${(erro as Error).message}`,
      httpStatus: null,
      ok: false,
      url: url.toString(),
    };
  }
}

export function consultarPF(
  config: ConfigSerasa,
  entrada: ConsultaSerasa,
): Promise<RespostaSerasa> {
  return consultar(config, config.pfUrl, entrada, 11);
}

export function consultarPJ(
  config: ConfigSerasa,
  entrada: ConsultaSerasa,
): Promise<RespostaSerasa> {
  return consultar(config, config.pjUrl, entrada, 14);
}
