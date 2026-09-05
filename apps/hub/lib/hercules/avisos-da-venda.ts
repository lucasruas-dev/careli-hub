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
  coordenadoresDosEmpreendimentos,
  enviarPeloRelacionamento,
} from "@/lib/apolo/disparo-credenciamento";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";

import { coordenadoresDoPanteon } from "./quem-pode-vender";
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
   * Pode ser mais de um: o empreendimento tem um coordenador no C2X e a casa pode ter mais de um
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
 * ⚠️ O COORDENADOR VEM DO C2X, E CAI NO PANTEON QUANDO NÃO EXISTE LÁ. Empreendimento que só existe
 * aqui — o de teste, e qualquer produto novo antes de ser cadastrado no legado — ficaria sem
 * ninguém para avisar. O fallback nunca esconde o coordenador de verdade: só entra quando a
 * consulta ao legado volta vazia.
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

    const doC2x = await coordenadoresDosEmpreendimentos(
      admin,
      [{ enterpriseId: dados.empreendimento.c2xId, label: dados.empreendimento.nome }],
      loadApoloEnterpriseCadastro,
    );
    const coordenadores: PessoaDoAviso[] =
      doC2x.length > 0
        ? doC2x.map((c) => ({ nome: c.nome, telefone: c.telefone }))
        : (await coordenadoresDoPanteon(admin, [dados.empreendimento.c2xId])).map((c) => ({
            nome: c.nome,
            telefone: c.telefone,
          }));

    return {
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
      coordenadores: [],
      corretor: dados.corretorId ? { nome: "—", telefone: null } : null,
      imobiliaria: { nome: "Imobiliária", telefone: null },
    };
  }
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
    const destinos: Array<{ entityId: string; papel: PapelDoAviso; telefone: null | string }> = [];

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

    return await Promise.all(
      destinos.map(async (destino) => {
        const texto = dados.textos.find((t) => t.papel === destino.papel)?.texto;
        if (!texto) return { motivo: "sem texto", ok: false, para: destino.papel };

        const r = await enviarPeloRelacionamento(admin, {
          anexo: dados.anexo ?? null,
          destinatario: destino.papel,
          entityId: destino.entityId,
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
