// DISPARO do chamado por WhatsApp: quando o operador chama o cliente, manda um template "É a sua
// vez" com o destino e o link da tela. É o reforço CONFIÁVEL do alerta da tela — a tela só grita
// com a aba aberta; o WhatsApp grita em qualquer celular, tela bloqueada, app fechado.
//
// BEST-EFFORT — nunca lança, nunca segura a chamada. Roda FORA do caminho crítico (via after()),
// então não prende o operador enquanto a Meta responde. Lê a fila fresca (listCredenciados) só pra
// achar nome/telefone do chamado.
//
// MODO TESTE: reaproveita a env PROMETEU_WELCOME_TEST_PHONE (a mesma das boas-vindas). Quando
// setada, TODO chamado dispara pra esse número. Ver [[project_prometeu_tela_cliente]].
import { contatosDaFicha } from "@/lib/apolo/prevenda-fluxo";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import {
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";

import {
  descreverDestinoChamado,
  NOME_TEMPLATE_CHAMADO,
} from "./chamado-template";
import { getEvento, listCredenciados } from "./data";
import { linkDaFilaDoCliente } from "./link-da-fila";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const PHONE_4143 = "1167201739813897";

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome.trim() || "tudo bem";
}

function soDigitos(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

// E.164 do Brasil por COMPRIMENTO (não por prefixo): nacional (10-11 dígitos) ganha o 55; quem já
// vem com DDI (12-13) usa direto. Assim não colide com o DDD 55 (Santa Maria/RS).
function paraE164BR(digitos: string): string {
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

export async function enviarChamadoPorWhatsApp(input: {
  client: AdminClient;
  credenciadoId: string;
  eventoId: string;
  zona: string | null;
}): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    const evento = await getEvento(input.client, input.eventoId);
    if (!evento) return { enviado: false, motivo: "evento não encontrado" };
    // Liga/desliga do Setup. Default true (só desliga com o campo explicitamente false).
    if (evento.config?.avisarChamadoPorWhatsapp === false) {
      return { enviado: false, motivo: "aviso de chamado desligado no Setup" };
    }

    const credenciados = await listCredenciados(input.client, input.eventoId);
    const cred = credenciados.find((c) => c.id === input.credenciadoId);
    if (!cred) return { enviado: false, motivo: "credenciado não encontrado" };

    const nome = primeiroNome(cred.nome);
    const destino = descreverDestinoChamado(input.zona);

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
      bodyParameters: [nome, destino],
      config,
      language: "pt_BR",
      name: NOME_TEMPLATE_CHAMADO,
      to,
      urlButtonParameter: token,
    });

    return { enviado: true };
  } catch (erro) {
    return { enviado: false, motivo: erro instanceof Error ? erro.message : String(erro) };
  }
}
