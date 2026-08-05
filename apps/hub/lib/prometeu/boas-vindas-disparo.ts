// DISPARO da boas-vindas no check-in do Prometeu: manda o WhatsApp (template) com a posição na
// fila e o link da tela do cliente. BEST-EFFORT — nunca lança, nunca derruba o check-in; se não
// der pra enviar (sem template aprovado, sem telefone, envio desligado), devolve o motivo e segue.
//
// Roda FORA do caminho crítico do check-in (via after()), então não segura o organizador na porta
// enquanto a Meta responde. Por isso lê a fila FRESCA (listCredenciados) em vez do snapshot
// cacheado de 4s: precisamos da posição EXATA de quem acabou de bipar (o snapshot velho ainda o
// veria sem check-in). O custo dessa leitura é ~1 por check-in (centenas no dia) — irrisório perto
// do poll do cliente (que relê a cada 4s por horas), e agora sem impacto de latência.
//
// MODO TESTE (env PROMETEU_WELCOME_TEST_PHONE): quando setada, TODO check-in dispara pra esse
// número, ignorando o telefone do credenciado. É como o Lucas testa sem incomodar ninguém.
// Ver [[project_prometeu_tela_cliente]].
import { contatosDaFicha } from "@/lib/apolo/prevenda-fluxo";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import {
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";

import {
  NOME_TEMPLATE_BOAS_VINDAS,
  URL_LOGO_HEADER,
} from "./boas-vindas-template";
import { filaDaRecepcao, getEvento, listCredenciados } from "./data";
import { nomeDoLancamento } from "./lancamento";
import { linkDaFilaDoCliente } from "./link-da-fila";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const PHONE_4143 = "1167201739813897";

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome.trim() || "tudo bem";
}

function soDigitos(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

// E.164 do Brasil por COMPRIMENTO (não por prefixo): número nacional (DDD + celular = 10-11
// dígitos) ganha o 55; quem já vem com DDI (12-13) usa direto. Assim não colide com o DDD 55
// (Santa Maria/RS), que o `startsWith("55")` ingênuo tratava errado.
function paraE164BR(digitos: string): string {
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

export async function enviarBoasVindasDoCheckIn(input: {
  client: AdminClient;
  credenciadoId: string;
  eventoId: string;
}): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    const evento = await getEvento(input.client, input.eventoId);
    if (!evento) return { enviado: false, motivo: "evento não encontrado" };
    // Liga/desliga do Setup. Default true (o campo existe no config há tempos, agora passa a valer).
    if (evento.config?.senhaPorWhatsapp === false) {
      return { enviado: false, motivo: "envio desligado no Setup" };
    }

    const credenciados = await listCredenciados(input.client, input.eventoId);
    const cred = credenciados.find((c) => c.id === input.credenciadoId);
    if (!cred) return { enviado: false, motivo: "credenciado não encontrado" };

    // POSIÇÃO: a mesma que o cliente vê na tela (fonte única — filaDaRecepcao). Fallbacks
    // NÃO-VAZIOS: a Meta recusa o envio se algum parâmetro do template vier vazio.
    const fila = filaDaRecepcao(credenciados, evento.config?.checkinHabilitado ?? true);
    const indice = fila.findIndex((c) => c.id === input.credenciadoId);
    const posicao = String(indice >= 0 ? indice + 1 : fila.length + 1);
    const nome = primeiroNome(cred.nome);
    const lancamento = nomeDoLancamento(evento).trim() || "nosso lançamento";

    // TELEFONE: modo teste sobrescreve tudo; senão, o do cadastro (via Apolo).
    const testePhone = soDigitos(process.env.PROMETEU_WELCOME_TEST_PHONE);
    let telefone = testePhone;
    if (!telefone) {
      if (!cred.entityId) return { enviado: false, motivo: "sem entidade no Apolo" };
      const contatos = await contatosDaFicha(input.client, cred.entityId);
      telefone = soDigitos(contatos.telefone);
    }
    if (!telefone) return { enviado: false, motivo: "sem telefone" };
    const to = paraE164BR(telefone);

    // TOKEN do link (o {{1}} do botão URL do template).
    const url = linkDaFilaDoCliente({
      credenciadoId: input.credenciadoId,
      eventoId: input.eventoId,
    });
    const token = url ? (new URL(url).searchParams.get("t") ?? "") : "";
    if (!token) return { enviado: false, motivo: "não foi possível gerar o link" };

    const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };
    await sendMetaWhatsAppTemplateMessage({
      bodyParameters: [nome, lancamento, posicao],
      config,
      headerMedia: { link: URL_LOGO_HEADER, type: "image" },
      language: "pt_BR",
      name: NOME_TEMPLATE_BOAS_VINDAS,
      to,
      urlButtonParameter: token,
    });

    return { enviado: true };
  } catch (erro) {
    return { enviado: false, motivo: erro instanceof Error ? erro.message : String(erro) };
  }
}
