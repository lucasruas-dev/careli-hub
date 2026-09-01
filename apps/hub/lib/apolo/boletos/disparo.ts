import { explicarErroDoDisparo } from "@/lib/apolo/credenciamento-disparos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { sendEvolutionDirectText } from "@/lib/iris/evolution-api";
import {
  MetaWhatsAppSendError,
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";
import { fixLegacyBrazilianMobileNumber } from "@/lib/iris/phone-country";

import {
  type DadosDoDisparo,
  TEMPLATE_BOLETO,
  TEMPLATE_BOLETO_IDIOMA,
  parametrosDoBoleto,
  previaDaMensagem,
} from "./template-whatsapp";

// MANDAR O LINK DO BOLETO PELO WHATSAPP, por dois caminhos.
//
// Pedido do Lucas (01/09/2026): *"temos agora que gerar o template para gente enviar o link do
// boleto"*, e logo depois, para testar antes de a Meta aprovar: *"vamos disparar pelo 6065 que não
// precisa de template, só para ver se meu boleto vai ser gerado (...) depois fazemos esse
// template"*.
//
// ⚠️ OS DOIS CAMINHOS MANDAM O MESMO TEXTO. `previaDaMensagem` monta o corpo do template com os
// dados reais, e é isso que o Evolution envia como texto livre. Assim o teste de hoje mostra
// exatamente a mensagem que o template vai produzir quando aprovar — e não uma versão paralela que
// ninguém lembra de atualizar junto.
//
// ⚠️ O TEMPLATE É O CAMINHO DEFINITIVO PARA CLIENTE. O 6065 (Relacionamento, via Evolution) é
// gateway não oficial: ele fala fora da janela de 24h sem template porque não passa pela Meta, e é
// por isso que serve para testar hoje. A regra da casa é que CLIENTE recebe pelo Atendimento
// (4143), com template — ver [[project_apolo_disparo_por_central]].

// Número 4143 (Iris/atendimento) — a mesma WABA dos demais templates da casa.
const PHONE_4143 = "1167201739813897";

export type CanalDoDisparo = "relacionamento" | "template";

export type ResultadoDoDisparo = {
  canal: CanalDoDisparo;
  erro: null | string;
  messageId: null | string;
  ok: boolean;
  telefone: null | string;
  unidade: string;
};

/**
 * Telefone pronto para o gateway: só dígitos, com DDI e com o nono dígito.
 *
 * ⚠️ O NONO DÍGITO É OBRIGATÓRIO, e os contatos da CER não o têm. A devolutiva traz
 * "(37) 9911-4655": DDD mais OITO dígitos, o formato antigo. Sem `fixLegacyBrazilianMobileNumber` o
 * número vira `553799114655` e a Meta responde 131026 ("message undeliverable") — a pessoa não
 * recebe nada e o erro parece "número sem WhatsApp". O mesmo já mordeu a cobrança da pré-venda; o
 * comentário está em `cobranca-prevenda.ts`.
 *
 * ⚠️ RECUSA E-MAIL EM VEZ DE CONVERTER. A coluna `contato` guarda telefone na maioria das linhas e
 * e-mail em algumas (as empresas da devolutiva trouxeram e-mail ali). Um e-mail passado por
 * `replace(/\D/g)` vira uma sequência de dígitos plausível, e o disparo iria para um número que
 * existe e não é da pessoa.
 */
export function telefoneParaODisparo(bruto: null | string | undefined): null | string {
  const valor = String(bruto ?? "").trim();
  if (!valor || valor.includes("@")) return null;

  const digitos = valor.replace(/\D/g, "");
  if (digitos.length < 10) return null;

  const comDdi =
    digitos.startsWith("55") && digitos.length >= 12
      ? digitos
      : digitos.length === 10 || digitos.length === 11
        ? `55${digitos}`
        : digitos;

  return fixLegacyBrazilianMobileNumber(comDdi);
}

/**
 * Dispara UM boleto.
 *
 * ⚠️ NÃO LANÇA. Um lote de onze não pode parar no terceiro: cada linha devolve o próprio resultado,
 * e a tela mostra quem recebeu e quem não. Um `throw` aqui deixaria os oito seguintes sem tentativa
 * e sem registro.
 */
export async function dispararBoleto(
  dados: DadosDoDisparo & {
    canal?: CanalDoDisparo;
    contato: null | string;
    unidade: string;
  },
): Promise<ResultadoDoDisparo> {
  const canal = dados.canal ?? "template";
  const base = {
    canal,
    erro: null,
    messageId: null,
    ok: false,
    telefone: null,
    unidade: dados.unidade,
  } satisfies ResultadoDoDisparo;

  const telefone = telefoneParaODisparo(dados.contato);
  if (!telefone) {
    const motivo = String(dados.contato ?? "").includes("@")
      ? "o cadastro tem e-mail no lugar do telefone"
      : "sem telefone no cadastro";
    return { ...base, erro: motivo };
  }

  // ⚠️ OS PARÂMETROS SÃO CONFERIDOS ANTES DA CHAMADA, nos DOIS caminhos. A Meta recusa a mensagem
  // inteira quando um deles chega vazio, e o texto livre ficaria com um buraco no meio da frase.
  // Ver [[reference_meta_template_parametros]].
  const parametros = parametrosDoBoleto(dados);
  if (!parametros) {
    return { ...base, erro: "faltou dado para montar a mensagem", telefone };
  }

  if (canal === "relacionamento") {
    // O 6065, via Evolution: texto livre, com o MESMO conteúdo do template.
    const r = await sendEvolutionDirectText({
      telefone,
      text: previaDaMensagem(parametros),
    });
    // ⚠️ O EVOLUTION CHAMA DE `providerMessageId`; a Meta chama de `messageId`. Nomes diferentes
    // para a mesma coisa, e ler o campo errado devolveria `undefined` num envio que deu certo.
    return r.ok
      ? { ...base, messageId: r.providerMessageId ?? null, ok: true, telefone }
      : { ...base, erro: explicarErroDoDisparo(r.error ?? null) ?? "falha no envio", telefone };
  }

  try {
    const r = await sendMetaWhatsAppTemplateMessage({
      bodyParameters: parametros,
      config: { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 },
      language: TEMPLATE_BOLETO_IDIOMA,
      name: TEMPLATE_BOLETO,
      to: telefone,
    });
    return { ...base, messageId: r.messageId ?? null, ok: true, telefone };
  } catch (error) {
    const cru =
      error instanceof MetaWhatsAppSendError || error instanceof Error
        ? error.message
        : "falha no envio";
    // `explicarErroDoDisparo` traduz os códigos que mais aparecem aqui: 132001 (template não
    // aprovado), 132000 (parâmetros não batem) e 131026 (número sem WhatsApp).
    return { ...base, erro: explicarErroDoDisparo(cru) ?? cru, telefone };
  }
}

/** A prévia do texto, para a tela mostrar antes de qualquer envio. */
export function previaDoBoleto(dados: DadosDoDisparo): null | string {
  const parametros = parametrosDoBoleto(dados);
  return parametros ? previaDaMensagem(parametros) : null;
}

/**
 * Guarda o resultado na parcela, para a tela saber quem já recebeu.
 *
 * ⚠️ NÃO É CRÍTICO. Se a gravação falhar, a mensagem JÁ foi enviada: derrubar o disparo por causa do
 * registro faria o operador reenviar e o cliente receber duas vezes.
 */
export async function registrarDisparo(input: {
  competencia: string;
  empreendimento: string;
  erro: null | string;
  unidade: string;
}): Promise<void> {
  try {
    const supabase = createApoloAdminClient();
    if (!supabase) return;
    const agora = new Date().toISOString();
    await supabase
      .from("boletos_parcelas")
      .update({
        atualizado_em: agora,
        whatsapp_enviado_em: input.erro ? null : agora,
        whatsapp_erro: input.erro,
      })
      .eq("workspace_id", "careli")
      .eq("empreendimento", input.empreendimento)
      .eq("unidade", input.unidade)
      .eq("competencia", input.competencia);
  } catch {
    // Ver a nota acima: registro é conveniência, a mensagem já saiu.
  }
}
