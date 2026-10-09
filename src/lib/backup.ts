import { api } from "../api";

export async function downloadBackup(): Promise<void> {
  const backup = await api.backup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `haushalt-backup-${backup.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function restoreBackupFile(file: File): Promise<void> {
  await api.restoreBackup(await file.text());
}
