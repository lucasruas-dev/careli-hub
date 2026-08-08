// O QUE O BOARD AVISA SOBRE O C2X, EM UM LUGAR SÓ.
//
// O selo do card tinha um buraco: ele nascia da tabela `apolo_c2x_sync`, e essa tabela SÓ ganha
// linha na hora do envio (o upsert 'pendente' de c2x-write-server.ts). Quem parou ANTES do envio
// (faltou campo no diagnóstico, a ficha caiu em "conferir", ou o gancho de credenciar nem chegou a
// rodar) não gera linha nenhuma, então não acendia nada. Era silêncio total: em 05/08 havia 465
// CADs em "credenciado" e 97 delas sem uma única linha de sync.
//
// Aqui a decisão do aviso fica CENTRALIZADA, porque a tela mostra o selo em dois lugares (card do
// kanban e linha da tabela) e o servidor precisa decidir uma vez só.
//
// TRÊS AVISOS, TRÊS COISAS DIFERENTES:
//   erro            -> a API do C2X recusou; o motivo está na coluna `erro` da fila.
//   sem_confirmacao -> a API respondeu sucesso mas o cadastro não apareceu no banco do C2X
//                      (incidente 28/jul e 01/08, escrita indo para o ambiente de teste).
//   nunca_enviado   -> está CREDENCIADO no Apolo e nunca chegou a ser enviado. É o buraco novo.

export type AlertaC2x = "erro" | "nunca_enviado" | "sem_confirmacao";

type MetadataEntidade = {
  c2xSynced?: unknown;
  c2xUserId?: unknown;
  source?: unknown;
} | null;

// Já está no C2X? Duas provas independentes, e QUALQUER uma basta:
//   - `c2xSynced: true`  -> o envio carimbou a ficha (c2x-write-server.ts:505-521);
//   - `c2xUserId`        -> temos o id do usuário no legado, ou seja o cadastro existe lá.
// Falso alarme aqui é o pior desfecho possível (acusar quem está certo mata a confiança no selo),
// então na dúvida o aviso NÃO acende.
export function jaEstaNoC2x(metadata: MetadataEntidade): boolean {
  const synced = metadata?.c2xSynced;
  if (synced === true || synced === "true") return true;
  const uid = metadata?.c2xUserId;
  return uid != null && uid !== "" && uid !== false;
}

export function alertaC2xDaCad(input: {
  // Etapa da esteira (`apolo_esteira.etapa`). Só "credenciado" cobra presença no C2X: antes disso
  // é normal a ficha ainda não ter subido.
  etapa?: string | null;
  // Status da linha em `apolo_c2x_sync`, quando ela existe E é uma falha.
  falhaSync?: string | null;
  // A leitura da fila do C2X veio INTEIRA. Falso = bateu no teto da consulta, e aí não dá para
  // afirmar que alguém "nunca foi tentado" (a linha dele pode ter ficado de fora). Nesse caso
  // preferimos calar: o aviso de falha continua, o de "nunca enviado" não acende.
  listaSyncCompleta: boolean;
  metadata: MetadataEntidade;
  // A entidade tem ALGUMA linha em `apolo_c2x_sync` (qualquer status).
  temLinhaSync: boolean;
}): AlertaC2x | null {
  // Falha primeiro: é o aviso mais grave e o único que carrega motivo para o operador ler.
  if (input.falhaSync === "erro") return "erro";
  if (input.falhaSync === "sem_confirmacao") return "sem_confirmacao";

  if (!input.listaSyncCompleta) return null;
  if (input.etapa !== "credenciado") return null;
  // Ficha que NASCEU no C2X (veio pelo sync) já existe lá e não tem o que subir. São 90 das 97 sem
  // linha de sync, e sem este corte o aviso viraria um mar de falso alarme. É o mesmo recorte que
  // o lote de envio usa (c2x-write-server.ts: metadata->>source = 'apolo').
  if (input.metadata?.source !== "apolo") return null;
  if (jaEstaNoC2x(input.metadata)) return null;
  if (input.temLinhaSync) return null;

  return "nunca_enviado";
}
