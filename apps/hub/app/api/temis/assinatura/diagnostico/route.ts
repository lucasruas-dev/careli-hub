import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  conferirConfiguracao,
  pareceSandbox,
  sondarCabecalho,
} from "@/lib/assinatura/clicksign/cliente";

// DIAGNÓSTICO DA ASSINATURA — "as chaves chegaram, e o token funciona?"
//
// ⚠️ ESTA ROTA EXISTE POR CAUSA DE UM ESTRAGO CONHECIDO. Variável marcada como "Sensitive" na Vercel
// chega VAZIA na função, sem erro nenhum: aconteceu com cinco chaves do Asaas
// ([[reference_vercel_env_sensitive]]). O app se comporta como se a chave não existisse, e o
// sintoma aparece lá na frente — no meio de um envio de contrato. Aqui a pergunta é feita de
// propósito, num lugar barato, antes de haver contrato em jogo.
//
// ⚠️ NUNCA DEVOLVE VALOR DE CHAVE. Só diz quais NOMES estão presentes e quais faltam. A base URL sai
// inteira, e isso é o ponto: é como se enxerga, de fora, se a produção está apontando para o
// sandbox — um contrato assinado no ambiente errado não tem validade jurídica, e a API responde 200
// exatamente igual nos dois.
//
// ⚠️ E FAZ UMA CHAMADA DE VERDADE, porque "a variável existe" não é a mesma pergunta que "o token
// vale". Um token copiado com espaço no fim, ou do ambiente errado, passa no teste de presença e
// falha no primeiro envio. A chamada é a mais barata que existe (uma listagem com página 1) e é
// LEITURA — não cria nada na conta.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  // Mesma porta de leitura do resto do módulo: diagnóstico expõe configuração, e configuração de
  // integração de assinatura não é coisa para porta aberta.
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  const cfg = conferirConfiguracao();
  const sandbox = pareceSandbox(cfg.ambiente);

  if (cfg.faltando.includes("CLICKSIGN_API_BASE_URL") || cfg.faltando.includes("CLICKSIGN_TOKEN_API")) {
    return NextResponse.json({
      ambiente: cfg.ambiente,
      aviso:
        "Sem CLICKSIGN_API_BASE_URL ou CLICKSIGN_TOKEN_API não há como chamar a Clicksign. " +
        "⚠️ Confira se elas não estão marcadas como 'Sensitive' na Vercel: assim elas chegam VAZIAS, sem erro.",
      chaves: { faltando: cfg.faltando, presentes: cfg.presentes },
      configurada: false,
      tokenValido: null,
    });
  }

  // ⚠️ SONDA, EM VEZ DE UMA CHAMADA SÓ. Se o esquema do cabeçalho estiver errado, uma chamada única
  // voltaria 401 e este diagnóstico acusaria o token — mandando trocar uma chave certa. A sonda
  // tenta as combinações e diz QUAL funcionou; é essa resposta que vai fixada no cliente depois.
  const sonda = await sondarCabecalho();

  if (sonda.ok) {
    return NextResponse.json({
      ambiente: cfg.ambiente,
      aviso: sandbox
        ? "⚠️ A base URL aponta para SANDBOX. Contrato enviado daqui não tem validade jurídica."
        : null,
      cabecalho: {
        contentType: sonda.tipoDeConteudo === "jsonapi" ? "application/vnd.api+json" : "application/json",
        esquemaDoToken: sonda.esquema === "bearer" ? "Authorization: Bearer <token>" : "Authorization: <token> (cru)",
      },
      chaves: { faltando: cfg.faltando, presentes: cfg.presentes },
      configurada: true,
      detalhe: null,
      tokenValido: true,
      webhookConferivel: cfg.presentes.includes("CLICKSIGN_WEBHOOK_SECRET"),
    });
  }

  // ⚠️ FALHA NÃO É SINÔNIMO DE TOKEN INVÁLIDO. Rate limit (429), timeout, 5xx e queda de rede fazem a
  // sonda falhar com a chave perfeitamente certa. Dizer `tokenValido: false` aí mandaria alguém
  // girar uma credencial boa no meio de um envio — é a rota de diagnóstico mentindo sobre o
  // diagnóstico. Quando não deu para provar, a resposta é `null`: não sabemos.
  const naoDeuParaProvar =
    sonda.erroFinal.includes("não respondeu") ||
    sonda.erroFinal.includes("Falha de rede") ||
    sonda.erroFinal.includes("429") ||
    /\b5\d\d\b/.test(sonda.erroFinal);

  return NextResponse.json({
    ambiente: cfg.ambiente,
    aviso: sandbox
      ? "⚠️ A base URL aponta para SANDBOX. Contrato enviado daqui não tem validade jurídica."
      : null,
    chaves: { faltando: cfg.faltando, presentes: cfg.presentes },
    configurada: true,
    detalhe: naoDeuParaProvar
      ? `Não deu para provar o token agora (a Clicksign não respondeu ou recusou por excesso de chamadas): ${sonda.erroFinal}`
      : `A Clicksign recusou a autenticação em todas as combinações de cabeçalho testadas. Pode ser o valor do token, o ambiente, OU o formato do cabeçalho. Último erro: ${sonda.erroFinal}`,
    tokenValido: naoDeuParaProvar ? null : false,
    webhookConferivel: cfg.presentes.includes("CLICKSIGN_WEBHOOK_SECRET"),
  });
}
