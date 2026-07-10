// Backfill dos anexos legados do HelpDesk: base64 no Postgres -> Supabase Storage.
//
// Idempotente e conservador:
//  - so toca linhas com content_data_url preenchido e storage_path NULO;
//  - sobe o arquivo, so entao grava storage_path;
//  - NAO apaga content_data_url. A limpeza e um segundo passo (--purge),
//    rodado depois de conferir que tudo migrou.
//
// Uso (a partir da raiz do repo):
//   node scripts/backfill-helpdesk-attachments.mjs           # dry-run
//   node scripts/backfill-helpdesk-attachments.mjs --apply   # migra
//   node scripts/backfill-helpdesk-attachments.mjs --purge   # zera o base64 ja migrado

import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const BUCKET = "hub-it-ticket-attachments";
const ENV_FILE = path.join(process.cwd(), "apps", "hub", ".env.local");

function loadEnv() {
  const raw = readFileSync(ENV_FILE, "utf8");
  const env = {};

  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (match) {
      env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }

  return env;
}

function extensionFor(mimeType, fileName) {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(fileName ?? "")?.[1];

  if (fromName) {
    return `.${fromName.toLowerCase()}`;
  }

  const map = {
    "audio/webm": ".webm",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };

  return map[mimeType] ?? "";
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match) {
    return null;
  }

  return { bytes: Buffer.from(match[2], "base64"), mimeType: match[1] };
}

async function main() {
  const mode = process.argv.includes("--purge")
    ? "purge"
    : process.argv.includes("--apply")
      ? "apply"
      : "dry-run";
  const env = loadEnv();
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  if (mode === "purge") {
    const { count, error } = await client
      .from("hub_it_ticket_attachments")
      .update({ content_data_url: null }, { count: "exact" })
      .not("storage_path", "is", null)
      .not("content_data_url", "is", null);

    if (error) {
      throw error;
    }

    console.log(`[purge] base64 removido de ${count ?? 0} linha(s) ja migradas.`);
    return;
  }

  const { data: rows, error } = await client
    .from("hub_it_ticket_attachments")
    .select("id,ticket_id,file_name,mime_type,content_data_url")
    .is("storage_path", null)
    .not("content_data_url", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  console.log(`[${mode}] ${rows.length} anexo(s) legados a migrar.`);

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    const decoded = decodeDataUrl(row.content_data_url);

    if (!decoded) {
      console.warn(`  ! ${row.id}: data-URL invalido, pulando.`);
      skipped += 1;
      continue;
    }

    const storagePath = `legacy/${row.ticket_id}/${row.id}${extensionFor(
      row.mime_type,
      row.file_name,
    )}`;

    if (mode === "dry-run") {
      console.log(
        `  - ${row.file_name} (${(decoded.bytes.length / 1024).toFixed(0)} KB) -> ${storagePath}`,
      );
      continue;
    }

    const upload = await client.storage
      .from(BUCKET)
      .upload(storagePath, decoded.bytes, {
        contentType: row.mime_type || decoded.mimeType,
        upsert: true,
      });

    if (upload.error) {
      console.error(`  ! ${row.id}: upload falhou (${upload.error.message}).`);
      skipped += 1;
      continue;
    }

    // So agora a linha aponta pro Storage. content_data_url fica ate o --purge.
    const { error: updateError } = await client
      .from("hub_it_ticket_attachments")
      .update({ storage_path: storagePath })
      .eq("id", row.id);

    if (updateError) {
      console.error(`  ! ${row.id}: update falhou (${updateError.message}).`);
      skipped += 1;
      continue;
    }

    migrated += 1;
    console.log(`  ok ${row.file_name} -> ${storagePath}`);
  }

  if (mode === "apply") {
    console.log(`\nMigrados: ${migrated} | Pulados: ${skipped}`);
    console.log("Confira o app e depois rode com --purge pra liberar os 53MB.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
