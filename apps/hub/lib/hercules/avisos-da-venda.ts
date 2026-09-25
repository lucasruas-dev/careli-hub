// QUEM RECEBE O AVISO DA VENDA, E COMO ELE SAI — corretor, imobiliária e coordenador.
//
// Lucas (03/09/2026), sobre a reserva: *"automaticamente vai ser encaminhada uma mensagem para o
// corretor, imobiliária e coordenador (...) vai sair do número do relacionamento"*. E, no dia
// seguinte, sobre a proposta: *"ao gerar, a proposta fica cadastrada e o PDF vai por WhatsApp para
// coordenador, imobiliária e corretor"* — os MESMOS três, o mesmo número, agora com anexo.
//
// ⚠️ ESTE ARQUIVO NASCEU DE DENTRO DA ROTA DE RESERVA, e nasceu porque a proposta ia copiá-lo.
// "Quem são os três e como se acha o telefone deles" é uma pergunta só: duplicada, a segunda cópia
// envelhece calada — o dia em que o coordenador passar a sair de outro lugar, um dos dois avisos
// continuaria mandando para o antigo, e ninguém descobre isso olhando a tela.
//
// ⚠️ NADA AQUI LANÇA. Quando estas funções rodam, a reserva (ou a proposta) JÁ ESTÁ GRAVADA: uma
// exceção viraria 503 numa operação que deu certo, e o coordenador tentaria de novo por cima do
// índice único. Cada destinatário volta com o seu resultado, e a tela diz quem ficou sem aviso.
//
// ⚠️ A RESOLUÇÃO DOS NOMES VEM ANTES DO ENVIO, em duas funções, e não numa só. A proposta precisa
// dos nomes ANTES de mandar: eles vão impressos no PDF ("Atendimento: Raiane Imobiliária · Nívea"),
// e o PDF é o anexo do próprio aviso. Uma função única que resolvesse e enviasse obrigaria a rota
// a buscar os mesmos nomes uma segunda vez só para imprimir.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  coordenadoresDosPedidos,
  MOTIVO_FALHA_DE_LEITURA,
  MOTIVO_SEM_COORDENADOR,
} from "@/lib/apolo/coordenador-do-empreendimento";
import { enviarPeloRelacionamento } from "@/lib/apolo/disparo-credenciamento";
import { portalConfeccionaContrato } from "@/lib/apolo/incorporador/perfis-de-portal";

import { coordenadoresDoPanteon } from "./quem-pode-vender";
import { MOTIVO_DO_AVISO_DESLIGADO } from "./reserva";
import {
  type ContatoDoAviso,
  telefonesPorEntidade,
  TIPOS_DE_CONTATO_DO_AVISO,
} from "./telefone-do-aviso";

/** Só o `from` e o `storage` não entram: aqui é leitura de entidade e contato, e o disparo. */
type Cliente = SupabaseClient;

export type PapelDoAviso = "coordenador" | "corretor" | "imobiliaria";

/**
 * O texto de UM destinatário.
 *
 * ⚠️ É O MESMO FORMATO de `AvisoDaReserva` e `AvisoDaProposta`, de propósito: quem envia não
 * precisa saber qual dos dois assuntos está mandando, e os dois tipos entram aqui sem conversão.
 */
export type AvisoDaVenda = { papel: PapelDoAviso; texto: string };

export type ResultadoDoAviso = { motivo?: string; ok: boolean; para: string };

export type PessoaDoAviso = { nome: string; telefone: null | string };

export type DestinatariosDaVenda = {
  /**
   * Por que NINGUÉM foi achado como coordenador, quando `coordenadores` está vazio. Presente = o
   * aviso ao coordenador é REGISTRADO como falho com este motivo, em vez de simplesmente não
   * existir (Lucas, 24/09/2026). Opcional para as rotas e os testes que montam o objeto à mão.
   */
  coordenadorAusente?: string;
  /**
   * Pode ser mais de um: o consolidado tem um coordenador por divisão e a casa pode ter mais de um
   * vínculo no Panteon. Todos recebem — perder o aviso porque escolhemos "o principal" errado é
   * pior do que duas pessoas lerem a mesma novidade.
   */
  coordenadores: PessoaDoAviso[];
  corretor: null | PessoaDoAviso;
  imobiliaria: PessoaDoAviso;
};

/**
 * Os três, com nome e telefone, prontos para a mensagem e para o papel.
 *
 * ⚠️ O COORDENADOR É ACHADO PELO ID DO EMPREENDIMENTO, NUNCA PELA SIGLA (Lucas, 24/09/2026). Vale o
 * cadastrado no Panteon (`apolo_enterprise_settings.coordenador_entity_id`) e, sem ele, o do C2X
 * pelo id (lib/apolo/coordenador-do-empreendimento.ts). Pela sigla, um renome no C2X (o 43, RDV ->
 * PDI) deixava a venda sem coordenador avisado, sem aviso de que faltou.
 *
 * ⚠️ O VÍNCULO `coordenador` DO PANTEON CONTINUA COMO ÚLTIMA OPÇÃO, e só quando ninguém com
 * telefone foi achado: é o que atende o empreendimento que só existe aqui (o de teste, e qualquer
 * produto novo antes de ter coordenador cadastrado).
 *
 * ⚠️ NUNCA LANÇA: falha de leitura vira lista vazia e nome genérico. Ver o aviso do topo.
 */
export async function destinatariosDaVenda(
  admin: Cliente,
  dados: {
    corretorId: null | string;
    empreendimento: { c2xId: string; nome: string };
    imobiliariaId: string;
  },
): Promise<DestinatariosDaVenda> {
  const ids = [dados.imobiliariaId, dados.corretorId].filter(Boolean) as string[];

  try {
    const [{ data: entidades }, { data: contatos }] = await Promise.all([
      admin.from("apolo_entities").select("id, display_name, legal_name, trade_name").in("id", ids),
      // ⚠️ `whatsapp` VEM JUNTO, E ELE É A MAIORIA. Buscando só `contact_type = 'phone'`, o disparo
      // ficava cego para 3.941 das 5.745 entidades com contato — que têm o número cadastrado como
      // `whatsapp` e nenhum como `phone`. É a explicação dos 5 avisos de reserva que falharam com
      // "sem telefone" para a RAIANE IMOBILIARIA, 100% das tentativas: ela tem `whatsapp` e
      // `email`, nunca teve `phone`. E a ironia é que o canal do disparo É o WhatsApp.
      admin
        .from("apolo_contacts")
        .select("entity_id, value, is_primary, contact_type")
        .in("contact_type", [...TIPOS_DE_CONTATO_DO_AVISO])
        .in("entity_id", ids),
    ]);

    const nomePorId = new Map<string, string>();
    for (const e of (entidades ?? []) as Array<{
      display_name: null | string;
      id: string;
      legal_name: null | string;
      trade_name: null | string;
    }>) {
      nomePorId.set(e.id, (e.trade_name || e.display_name || e.legal_name || "").trim() || "—");
    }

    // A preferência (whatsapp > phone, primário desempata) vive em `telefone-do-aviso.ts`, com
    // teste: é a regra que estava errada e mandou cinco avisos de reserva para lugar nenhum.
    const telefonePorId = telefonesPorEntidade((contatos ?? []) as ContatoDoAviso[]);

    const c2xId = String(dados.empreendimento.c2xId ?? "").trim();
    const resposta = (await coordenadoresDosPedidos(admin, [c2xId])).get(c2xId);
    const achados: PessoaDoAviso[] = (resposta?.coordenadores ?? []).map((c) => ({
      nome: c.nome,
      telefone: c.telefone,
    }));

    // ⚠️ O COORDENADOR SEM TELEFONE CONTINUA NA LISTA, e isso é novo: antes ele sumia calado. Com
    // ele, o disparo registra "sem telefone" e a tela da venda diz a quem falta o número.
    let coordenadores = achados;
    if (!achados.some((c) => c.telefone)) {
      const vinculados = (await coordenadoresDoPanteon(admin, [c2xId])).map((c) => ({
        nome: c.nome,
        telefone: c.telefone,
      }));
      if (vinculados.length > 0) coordenadores = vinculados;
    }

    return {
      ...(coordenadores.length === 0
        ? { coordenadorAusente: resposta?.motivo ?? MOTIVO_SEM_COORDENADOR }
        : {}),
      coordenadores,
      corretor: dados.corretorId
        ? {
            nome: nomePorId.get(dados.corretorId) ?? "—",
            telefone: telefonePorId.get(dados.corretorId) ?? null,
          }
        : null,
      imobiliaria: {
        nome: nomePorId.get(dados.imobiliariaId) ?? "Imobiliária",
        telefone: telefonePorId.get(dados.imobiliariaId) ?? null,
      },
    };
  } catch (erro) {
    console.error("[hercules][avisos] falha ao resolver destinatários", erro);
    return {
      coordenadorAusente: MOTIVO_FALHA_DE_LEITURA,
      coordenadores: [],
      corretor: dados.corretorId ? { nome: "—", telefone: null } : null,
      imobiliaria: { nome: "Imobiliária", telefone: null },
    };
  }
}

type DestinoDoAviso = {
  entityId: string;
  /** Por que este destino já nasce falho (o coordenador que não foi achado). Vira o `erro` do disparo. */
  impedimento?: string;
  papel: PapelDoAviso;
  telefone: null | string;
};

/**
 * Quem recebe, um por linha: corretor (se houver), imobiliária e cada coordenador.
 *
 * ⚠️ UMA LISTA SÓ PARA OS DOIS CAMINHOS, o que envia e o que registra que não enviou. Duplicada, a
 * lista do registro envelheceria calada: o dia em que um quarto destinatário entrasse no envio, o
 * histórico do portal continuaria dizendo que só três ficaram sem aviso.
 */
function destinosDoAviso(dados: {
  corretorId: null | string;
  destinatarios: DestinatariosDaVenda;
  imobiliariaId: string;
}): DestinoDoAviso[] {
  const destinos: DestinoDoAviso[] = [];

  if (dados.corretorId && dados.destinatarios.corretor) {
    destinos.push({
      entityId: dados.corretorId,
      papel: "corretor",
      telefone: dados.destinatarios.corretor.telefone,
    });
  }
  destinos.push({
    entityId: dados.imobiliariaId,
    papel: "imobiliaria",
    telefone: dados.destinatarios.imobiliaria.telefone,
  });
  for (const coordenador of dados.destinatarios.coordenadores) {
    destinos.push({
      entityId: dados.imobiliariaId,
      papel: "coordenador",
      telefone: coordenador.telefone,
    });
  }
  // ⚠️ NINGUÉM ACHADO AINDA É UM DESTINO, com o motivo (Lucas, 24/09/2026). Sem esta linha, a venda
  // de um empreendimento sem coordenador saía com dois avisos e nenhum registro do terceiro, e a
  // tela dizia "aviso enviado" como se o coordenador estivesse sabendo.
  if (dados.destinatarios.coordenadores.length === 0 && dados.destinatarios.coordenadorAusente) {
    destinos.push({
      entityId: dados.imobiliariaId,
      impedimento: dados.destinatarios.coordenadorAusente,
      papel: "coordenador",
      telefone: null,
    });
  }
  return destinos;
}

/**
 * A venda feita por esta sessão avisa por WhatsApp?
 *
 * Decisão do Lucas (16/09/2026): reserva, proposta e cancelamento feitos pelo portal que confecciona
 * (hoje só o `cecilio-rocha`) NÃO avisam ninguém por enquanto. As vendas da Gurgel (comercial)
 * continuam avisando corretor, imobiliária e coordenador exatamente como antes.
 *
 * ⚠️ A RÉGUA É A MESMA QUE ABRE A CONFECÇÃO (`portalConfeccionaContrato`), e não uma lista nova: o
 * portal que passa a operar sozinho é o mesmo que para de disparar em nome da Careli. Duas listas
 * discordariam no dia em que um segundo incorporador entrasse em uma e não na outra.
 */
export function vendaAvisaPeloWhatsapp(sessao: {
  slug: null | string | undefined;
  tipo: null | string | undefined;
}): boolean {
  return !portalConfeccionaContrato(sessao.slug, sessao.tipo);
}

/** A frase gravada em `apolo_disparos.erro` quando o aviso não sai por decisão. */
export const AVISO_NAO_ENVIADO_POR_DECISAO =
  "Aviso não enviado: venda feita pelo time do incorporador (decisão de 16/09/2026).";

/**
 * Registra, destinatário por destinatário, que o aviso NÃO foi enviado, e por quê.
 *
 * ⚠️ NENHUM WHATSAPP SAI DAQUI. Não chama o gateway, não chama `enviarPeloRelacionamento`: é só a
 * linha em `apolo_disparos`, com `status = 'nao_enviado'` (a coluna é texto livre, sem CHECK desde a
 * 0064), para o histórico responder "por que a imobiliária não soube desta reserva?" sem ninguém
 * precisar lembrar da decisão.
 *
 * ⚠️ O TELEFONE NÃO É GRAVADO: não houve envio para número nenhum, e guardar o contato de quem não
 * recebeu nada seria dado a mais numa tabela de entrega.
 *
 * ⚠️ NUNCA LANÇA, pelo mesmo motivo de `avisarSobreAVenda`: a venda já está gravada quando isto
 * roda. Falha ao registrar vira log; a resposta continua dizendo que o aviso não saiu.
 */
export async function registrarAvisoNaoEnviado(
  admin: Cliente,
  dados: {
    corretorId: null | string;
    destinatarios: DestinatariosDaVenda;
    imobiliariaId: string;
    /** O mesmo `origem` que o envio usaria (`reserva:whatsapp`, `proposta:cancelamento`...). */
    origem: string;
    /** O mesmo `tipo` que o envio usaria (`hercules_reserva`, `hercules_proposta`). */
    tipo: string;
  },
): Promise<ResultadoDoAviso[]> {
  const destinos = destinosDoAviso(dados);
  const resultados: ResultadoDoAviso[] = destinos.map((destino) => ({
    motivo: MOTIVO_DO_AVISO_DESLIGADO,
    ok: false,
    para: destino.papel,
  }));

  try {
    const { error } = await admin.from("apolo_disparos").insert(
      destinos.map((destino) => ({
        destinatario: destino.papel,
        entity_id: destino.entityId,
        erro: AVISO_NAO_ENVIADO_POR_DECISAO,
        origem: dados.origem,
        status: "nao_enviado",
        telefone: null,
        tipo: dados.tipo,
      })),
    );
    if (error) console.error("[hercules][avisos] falha ao registrar aviso não enviado", error);
  } catch (erro) {
    console.error("[hercules][avisos] falha ao registrar aviso não enviado", erro);
  }

  return resultados;
}

/**
 * Manda cada texto para o seu destinatário, pelo número do Relacionamento.
 *
 * ⚠️ O `entityId` DO COORDENADOR É O DA IMOBILIÁRIA, e não é descuido: `apolo_disparos.entity_id`
 * é a ficha onde o registro fica pendurado, e o coordenador do C2X não tem entidade no Apolo. É o
 * mesmo que o disparo de credenciamento já faz.
 *
 * ⚠️ O ANEXO É OPCIONAL E O TEXTO VAI JUNTO COMO LEGENDA — é o caminho que a CAD já usa em
 * produção (`lib/apolo/esteira-avisos.ts`). Quem não tem anexo manda texto puro, pelo mesmo
 * gateway.
 */
export async function avisarSobreAVenda(
  admin: Cliente,
  dados: {
    /** O PDF, já no storage e com URL assinada. Ausente = mensagem de texto. */
    anexo?: null | { fileName: string; url: string };
    corretorId: null | string;
    destinatarios: DestinatariosDaVenda;
    imobiliariaId: string;
    /** `reserva:whatsapp`, `proposta:whatsapp` — de onde partiu, para separar na tela de status. */
    origem: string;
    textos: AvisoDaVenda[];
    /** `hercules_reserva`, `hercules_proposta` — o assunto, em `apolo_disparos.tipo`. */
    tipo: string;
  },
): Promise<ResultadoDoAviso[]> {
  try {
    const destinos = destinosDoAviso(dados);

    return await Promise.all(
      destinos.map(async (destino) => {
        const texto = dados.textos.find((t) => t.papel === destino.papel)?.texto;
        if (!texto) return { motivo: "sem texto", ok: false, para: destino.papel };

        const r = await enviarPeloRelacionamento(admin, {
          anexo: dados.anexo ?? null,
          destinatario: destino.papel,
          entityId: destino.entityId,
          impedimento: destino.impedimento,
          origem: dados.origem,
          telefone: destino.telefone,
          texto,
          tipo: dados.tipo,
        });
        return { motivo: r.erro, ok: r.ok, para: destino.papel };
      }),
    );
  } catch (erro) {
    console.error("[hercules][avisos] falha ao avisar", erro);
    return [];
  }
}
