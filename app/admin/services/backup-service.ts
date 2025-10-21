// Backup service placeholder
export class BackupService {
  static async listBackups() { return [] }
  static async createBackup() { return { id: 'backup-1', status: 'success' } }
  static async deleteBackup(id: string) { return { success: true, id } }
  static async downloadBackup(id: string) { return { url: '', id } }
  static async restoreBackup(id: string) { return { success: true, id } }
  static async scheduleBackup(schedule: any) { return { success: true, schedule } }
}
