import { access, readFile } from "node:fs/promises";
import path from "node:path";

export type PanteonAddressLevel = "city" | "district" | "house" | "street";

export type PanteonAddressRecord = {
  addressCode: string;
  addressId: string;
  allowedChangedPaths: string[];
  forbiddenMarkers: {
    includes?: string[];
    path: string;
  }[];
  houseType: string | null;
  level: PanteonAddressLevel;
  module: string;
  name: string;
  notes: string[];
  owner: string;
  parentAddressCode: string | null;
  paths: string[];
  protectedPaths: string[];
  releaseDomain: string;
  requiredMarkers: {
    includes?: string[];
    path: string;
  }[];
  rollbackReference: string;
  routes: string[];
  status: string;
  validationCommands: string[];
};

export type PanteonAddressRegistry = {
  addressFormat: {
    cityDigits: number;
    description: string;
    districtDigits: number;
    houseDigits: number;
    pattern: string;
    platformPrefix: string;
    reservedZeroCode: string;
    streetDigits: number;
  };
  addresses: PanteonAddressRecord[];
  cityBaseline: {
    addressCode: string;
    deploymentId: string;
    domain: string;
    notes: string[];
    technicalUrl: string;
    validatedAt: string;
    validatedBy: string;
  };
  generatedAt: string;
  owner: string;
  reservedDistrictCodes: {
    code: string;
    module: string;
    name: string;
  }[];
  schemaVersion: string;
  sourcePath: string;
  status: string;
  summary: PanteonAddressRegistrySummary;
  updatedAt: string;
};

export type PanteonAddressRegistrySummary = {
  activeAddresses: number;
  cityBaselineCode: string;
  districts: number;
  houses: number;
  modules: {
    count: number;
    module: string;
  }[];
  protectedAddresses: number;
  streets: number;
  totalAddresses: number;
};

const addressRegistryPath = path.join(
  "docs",
  "operations",
  "panteon-address-registry.json",
);

export async function loadPanteonAddressRegistry() {
  const resolvedPath = await resolveWorkspacePath(addressRegistryPath);

  if (!resolvedPath) {
    throw new Error("Registry de CEP operacional nao encontrado no workspace.");
  }

  const rawContent = await readFile(resolvedPath, "utf8");
  const registry = JSON.parse(rawContent) as Omit<
    PanteonAddressRegistry,
    "generatedAt" | "sourcePath" | "summary"
  >;
  const addresses = normalizeAddressRecords(registry.addresses ?? []);
  const summary = buildAddressRegistrySummary(
    addresses,
    registry.cityBaseline?.addressCode ?? "PNT-01-00-00-000",
  );

  return {
    ...registry,
    addresses,
    generatedAt: new Date().toISOString(),
    sourcePath: normalizePath(addressRegistryPath),
    summary,
  } satisfies PanteonAddressRegistry;
}

function normalizeAddressRecords(records: PanteonAddressRecord[]) {
  return records.map((record) => ({
    ...record,
    allowedChangedPaths: normalizeStringArray(record.allowedChangedPaths),
    forbiddenMarkers: Array.isArray(record.forbiddenMarkers)
      ? record.forbiddenMarkers
      : [],
    notes: normalizeStringArray(record.notes),
    paths: normalizeStringArray(record.paths),
    protectedPaths: normalizeStringArray(record.protectedPaths),
    requiredMarkers: Array.isArray(record.requiredMarkers)
      ? record.requiredMarkers
      : [],
    routes: normalizeStringArray(record.routes),
    validationCommands: normalizeStringArray(record.validationCommands),
  }));
}

function buildAddressRegistrySummary(
  addresses: PanteonAddressRecord[],
  cityBaselineCode: string,
) {
  const modules = new Map<string, number>();

  for (const address of addresses) {
    modules.set(address.module, (modules.get(address.module) ?? 0) + 1);
  }

  return {
    activeAddresses: addresses.filter((address) => address.status === "active")
      .length,
    cityBaselineCode,
    districts: addresses.filter((address) => address.level === "district")
      .length,
    houses: addresses.filter((address) => address.level === "house").length,
    modules: [...modules.entries()]
      .map(([module, count]) => ({ count, module }))
      .sort((firstModule, secondModule) =>
        firstModule.module.localeCompare(secondModule.module, "pt-BR", {
          sensitivity: "base",
        }),
      ),
    protectedAddresses: addresses.filter(
      (address) => address.status === "protected",
    ).length,
    streets: addresses.filter((address) => address.level === "street").length,
    totalAddresses: addresses.length,
  } satisfies PanteonAddressRegistrySummary;
}

async function resolveWorkspacePath(relativePath: string) {
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), relativePath),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "..", relativePath),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "..", relativePath),
    path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "..",
      "..",
      "..",
      relativePath,
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

function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
