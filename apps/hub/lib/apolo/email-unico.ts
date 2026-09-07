// UM E-MAIL, UMA PESSOA — a regra que o contrato eletrônico impõe ao cadastro.
//
// Lucas, 07/09/2026, ao ver o levantamento da API do D4Sign: *"temos que travar bem travado o
// e-mail, não podemos ter o mesmo e-mail para duas pessoas"*, e sobre onde: *"esse e-mail tem que
// ser validado lá na hora que eu estou subindo a cad"*.
//
// ⚠️ POR QUE ISTO É DURO, E NÃO UM AVISO. No D4Sign o signatário É o e-mail: não existe campo de
// nome nem de CPF no cadastro de signatário, o vínculo da rubrica é por e-mail e o webhook devolve
// o e-mail como única chave utilizável (`uuid` e `identification_number` vêm nulos para quem não tem
// conta lá — que é o caso de todo comprador nosso). Duas pessoas com o mesmo e-mail no mesmo
// contrato produzem um documento em que NÃO SE SABE QUEM ASSINOU. Isso não dá erro: dá contrato
// assinado com dúvida sobre a autoria.
//
// ⚠️ E O CASO REAL É PIOR QUE O CASAL. Medido em 07/09/2026: 26 e-mails repetidos, 54 pessoas. O
// pior caso são três — um corretor cujo e-mail está em duas fichas de CLIENTE. Se um contrato
// desses fosse para assinatura, o cliente nunca receberia o link e o corretor assinaria no lugar
// dele, sem que o sistema notasse.
//
// As funções de DECISÃO aqui são puras e testadas; só `conflitoDeEmailRepetido` toca o banco, no
// molde de `nucleo-familiar.ts`. A checagem mora no ponto de persistência que TODAS as portas de
// entrada de CAD atravessam (wizard interno, link público, imobiliária) — é o que o "bem travado"
// pede.
import { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** Uma pessoa que já usa o e-mail. Só o necessário para o operador entender o conflito. */
export type DonoDoEmail = {
  entityId: string;
  nome: string;
};

export type Conflito = {
  donos: DonoDoEmail[];
  email: string;
  mensagem: string;
};

/**
 * O e-mail em forma comparável, ou null quando não serve para assinar.
 *
 * ⚠️ RECUSA O QUE NÃO TEM `@`. A tabela `apolo_contacts` guarda, entre os `contact_type='email'`,
 * 18 valores que são HASH e não endereço (resíduo de um mascaramento antigo). Comparar hash com
 * hash acusaria conflito entre pessoas que não têm e-mail nenhum — e travaria a CAD por um dado que
 * ninguém consegue corrigir na tela.
 */
export function normalizarEmail(bruto: null | string | undefined): null | string {
  const limpo = (bruto ?? "").trim().toLowerCase();
  if (!limpo) return null;

  const arroba = limpo.indexOf("@");
  // Um `@`, com algo antes e um domínio com ponto depois. Não é validação de RFC — é o suficiente
  // para separar endereço de hash, de "sem email" e de texto colado por engano.
  if (arroba <= 0 || arroba !== limpo.lastIndexOf("@")) return null;
  const dominio = limpo.slice(arroba + 1);
  if (!dominio.includes(".") || dominio.startsWith(".") || dominio.endsWith(".")) return null;
  if (/\s/.test(limpo)) return null;

  return limpo;
}

/**
 * A frase que o operador lê quando o e-mail já é de outra pessoa.
 *
 * ⚠️ DIZ DE QUEM É. "E-mail já cadastrado" manda o operador adivinhar, e o caminho mais curto para
 * ele seria inventar um endereço para destravar a tela — que é exatamente o dado errado indo para o
 * contrato. Dizendo o nome, ele resolve: ou é a mesma pessoa (e a ficha certa já existe), ou é o
 * e-mail do corretor no lugar do cliente, e o que falta é perguntar o endereço ao cliente.
 */
export function mensagemDeConflito(email: string, donos: DonoDoEmail[]): string {
  const nomes = donos.map((d) => d.nome).filter(Boolean);
  const quem =
    nomes.length === 0
      ? "outro cadastro"
      : nomes.length === 1
        ? nomes[0]
        : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;

  return (
    `O e-mail ${email} já está em ${quem}. ` +
    "Cada pessoa do contrato precisa do seu próprio e-mail: é por ele que a assinatura eletrônica " +
    "identifica quem assinou. Peça o endereço da pessoa, ou use a ficha que já existe."
  );
}

/**
 * Decide o conflito a partir do que o banco devolveu.
 *
 * `donos` são as pessoas que já usam aquele e-mail. `entityIdPermitida` é a ficha que ESTA CAD vai
 * atualizar (o modo anexo do dedup por documento): reencontrar o próprio e-mail na própria ficha
 * não é conflito — seria a CAD se recusando a salvar por causa de si mesma.
 */
export function conferirEmailUnico({
  donos,
  email,
  entityIdPermitida,
}: {
  donos: DonoDoEmail[];
  email: null | string | undefined;
  entityIdPermitida?: null | string;
}): Conflito | null {
  const normalizado = normalizarEmail(email);
  if (!normalizado) return null;

  const outros = donos.filter((d) => d.entityId && d.entityId !== entityIdPermitida);
  if (outros.length === 0) return null;

  return { donos: outros, email: normalizado, mensagem: mensagemDeConflito(normalizado, outros) };
}

/**
 * Quem já usa este e-mail — a pergunta ao banco, no molde de `conflitoDeNucleoFamiliar`.
 *
 * ⚠️ COMPARA PELO `normalized_value`, com o `value` como rede. `apolo_contacts` guarda os dois, e o
 * normalizado nem sempre está preenchido nas linhas antigas vindas do sync — comparar só por ele
 * deixaria passar exatamente os cadastros mais velhos, que são os que têm mais repetição.
 *
 * ⚠️ CONTATO BLOQUEADO NÃO CONTA. `apolo_contacts.status` aceita `verified | pending | attention |
 * blocked` (0026) — e `blocked` é o endereço que alguém já tirou de circulação. Travar a CAD por
 * causa dele obrigaria o operador a inventar um endereço para passar, que é o dado errado indo para
 * o contrato. ⚠️ E hoje TODOS os 5.591 contatos de e-mail estão `pending`: na prática esta linha
 * ainda não exclui ninguém, e é isso mesmo — ela existe para o dia em que alguém bloquear um.
 */
export async function conflitoDeEmailRepetido(params: {
  adminClient: AdminClient;
  email: null | string | undefined;
  /** Fichas que esta CAD já vai atualizar — o próprio e-mail nelas não é conflito. */
  ignorarEntityIds?: string[];
}): Promise<Conflito | null> {
  const alvo = normalizarEmail(params.email);
  if (!alvo) return null;

  // ⚠️ O `.or()` é montado como string e o valor entra entre aspas — aspa no e-mail quebraria o
  // filtro (mesma família do `.or()` do PostgREST em outras telas). `normalizarEmail` já recusa
  // espaço; a aspa é o que sobra.
  const escapado = alvo.replaceAll('"', '\\"');
  const { data, error } = await params.adminClient
    .from("apolo_contacts")
    .select("entity_id,value,normalized_value,status")
    .eq("contact_type", "email")
    .or(`normalized_value.eq."${escapado}",value.ilike."${escapado}"`);

  if (error) return null; // best-effort: a trava não pode derrubar o cadastro por falha de leitura

  const ignorar = new Set(params.ignorarEntityIds ?? []);
  const ids = new Set<string>();
  for (const linha of (data ?? []) as {
    entity_id: null | string;
    normalized_value: null | string;
    status: null | string;
    value: null | string;
  }[]) {
    if (linha.status === "blocked") continue;
    const email = normalizarEmail(linha.normalized_value ?? linha.value);
    if (email !== alvo) continue;
    if (!linha.entity_id || ignorar.has(linha.entity_id)) continue;
    ids.add(linha.entity_id);
  }

  if (ids.size === 0) return null;

  // O nome de cada dono vem numa segunda leitura, e só quando há conflito: a mensagem precisa dizer
  // DE QUEM é o e-mail, mas a consulta de nome não pode pesar no caminho feliz de toda CAD.
  const nomes = await lerNomes(params.adminClient, [...ids]);
  const donos = [...ids].map((entityId) => ({ entityId, nome: nomes.get(entityId) ?? "" }));

  return { donos, email: alvo, mensagem: mensagemDeConflito(alvo, donos) };
}

async function lerNomes(adminClient: AdminClient, ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const { data } = await adminClient.from("apolo_entities").select("id,display_name").in("id", ids);
    for (const linha of (data ?? []) as { display_name: null | string; id: string }[]) {
      if (linha.display_name) mapa.set(linha.id, linha.display_name);
    }
  } catch {
    // Sem os nomes a mensagem fica genérica, mas a trava continua valendo.
  }
  return mapa;
}
