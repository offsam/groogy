/** Compare migration filenames with remote version ids. Name match is not a schema proof. */

export function compareMigrationNames(localFiles: string[], appliedVersions: string[]): {
  pending: string[];
  unknownRemote: string[];
  repairFiles: string[];
} {
  const versions = localFiles.map(versionOf);
  return {
    pending: versions.filter((version) => !appliedVersions.includes(version)),
    unknownRemote: appliedVersions.filter((version) => !versions.includes(version)),
    repairFiles: localFiles.filter((file) => file.toLowerCase().includes("repair")),
  };
}

export function versionOf(file: string): string {
  const base = file.split("/").pop()?.replace(/\.sql$/, "") ?? file;
  const prefix = base.split("_")[0];
  return prefix || base;
}
