import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { parseEngineeringOperationsMarkdown } from "./engineering-operations-parser";

const diaryRelativePath = path.join(
  "docs",
  "operations",
  "engineering-operations.md",
);

export async function loadEngineeringOperationsFromFile() {
  const diaryPath = await resolveEngineeringOperationsPath();

  if (!diaryPath) {
    return {
      data: null,
      error:
        "Arquivo docs/operations/engineering-operations.md não encontrado no workspace.",
    };
  }

  try {
    const content = await readFile(diaryPath, "utf8");

    return {
      data: parseEngineeringOperationsMarkdown(content, {
        sourcePath: diaryRelativePath.replace(/\\/g, "/"),
      }),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível ler o Engineering Operations.",
    };
  }
}

async function resolveEngineeringOperationsPath() {
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), diaryRelativePath),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "..", diaryRelativePath),
    path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "..",
      "..",
      diaryRelativePath,
    ),
    path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "..",
      "..",
      "..",
      diaryRelativePath,
    ),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}
