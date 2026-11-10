import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { CatalogStore, StoredCatalog } from "./types.ts";

export function defaultCatalogPath(home = homedir()): string {
  return join(home, ".cache", "commandcode", "catalog.json");
}

export class FileCatalogStore implements CatalogStore {
  readonly path: string;

  constructor(path = defaultCatalogPath()) {
    this.path = path;
  }

  async read(): Promise<StoredCatalog | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!parsed || typeof parsed !== "object") return undefined;
      const catalog = parsed as Partial<StoredCatalog>;
      if (
        catalog.schemaVersion !== 1 ||
        typeof catalog.catalogVersion !== "string" ||
        typeof catalog.refreshAfterSeconds !== "number" ||
        typeof catalog.fetchedAt !== "number" ||
        !Array.isArray(catalog.models)
      ) {
        return undefined;
      }
      return catalog as StoredCatalog;
    } catch {
      return undefined;
    }
  }

  async write(value: StoredCatalog): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}
