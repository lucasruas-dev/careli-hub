const HERMES_INLINE_ATTACHMENT_URL_MAX_LENGTH = 2_048;
const HERMES_STRIPPED_ATTACHMENT_MARKER = "hermes-inline-url-stripped";

type MetadataRecord = Record<string, unknown>;

export function compactHermesMessageMetadata(
  metadata: unknown,
): MetadataRecord | null {
  if (!isPlainRecord(metadata)) {
    return null;
  }

  const attachment = compactHermesAttachmentMetadata(metadata.attachment);

  return {
    ...metadata,
    ...(attachment ? { attachment } : {}),
  };
}

export function compactHermesMessageRows<
  TMessage extends { metadata?: MetadataRecord | null },
>(rows: readonly TMessage[]) {
  return rows.map(compactHermesMessageRow);
}

export function compactHermesMessageRow<
  TMessage extends { metadata?: MetadataRecord | null },
>(row: TMessage): TMessage {
  return {
    ...row,
    metadata: compactHermesMessageMetadata(row.metadata),
  };
}

function compactHermesAttachmentMetadata(value: unknown) {
  if (!isPlainRecord(value)) {
    return value;
  }

  const url = typeof value.url === "string" ? value.url.trim() : "";

  if (!shouldStripHermesAttachmentUrl(url)) {
    return value;
  }

  const metadataWithoutUrl = { ...value };

  delete metadataWithoutUrl.url;

  return {
    ...metadataWithoutUrl,
    externalized: true,
    storageMode: HERMES_STRIPPED_ATTACHMENT_MARKER,
  };
}

function shouldStripHermesAttachmentUrl(url: string) {
  if (!url) {
    return false;
  }

  return (
    url.length > HERMES_INLINE_ATTACHMENT_URL_MAX_LENGTH ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  );
}

function isPlainRecord(value: unknown): value is MetadataRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
