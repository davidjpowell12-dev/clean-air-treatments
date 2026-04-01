const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'clean-air.db');
const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(__dirname, '..', 'backups');
const MAX_LOCAL_BACKUPS = 30;
const MAX_DRIVE_DAYS = 30;
const FOLDER_NAME = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'Clean Air Backups';

// Track last backup time in memory
let lastBackupTime = null;
let lastBackupResult = null;

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function getTimestamp() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  return { now, dateStr, timeStr };
}

// ── Local Backup ──────────────────────────────────────────────────────

async function backupToLocal() {
  ensureBackupsDir();

  const { now, dateStr, timeStr } = getTimestamp();
  const filename = `clean-air-${dateStr}_${timeStr}.db`;
  const destPath = path.join(BACKUPS_DIR, filename);

  // Use file copy approach to avoid interfering with active DB operations
  const { getDb } = require('../db/database');
  const db = getDb();
  await db.backup(destPath);

  // Prune old local backups
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.db'))
    .sort()
    .reverse();

  if (files.length > MAX_LOCAL_BACKUPS) {
    const toDelete = files.slice(MAX_LOCAL_BACKUPS);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(BACKUPS_DIR, f));
    }
  }

  const stats = fs.statSync(destPath);
  return {
    filename,
    path: destPath,
    size: stats.size,
    timestamp: now.toISOString()
  };
}

// ── Google Drive Auth ─────────────────────────────────────────────────

function getDriveClient() {
  const credsBase64 = process.env.GOOGLE_DRIVE_CREDENTIALS;
  if (!credsBase64) {
    throw new Error('GOOGLE_DRIVE_CREDENTIALS environment variable not set');
  }

  const creds = JSON.parse(Buffer.from(credsBase64, 'base64').toString('utf8'));

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });

  return google.drive({ version: 'v3', auth });
}

// ── Find or Create Drive Folder ───────────────────────────────────────

async function getOrCreateFolder(drive) {
  // Search for existing folder
  const res = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive'
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    },
    fields: 'id'
  });

  return folder.data.id;
}

// ── Upload to Drive ───────────────────────────────────────────────────

async function backupToDrive() {
  const drive = getDriveClient();
  const folderId = await getOrCreateFolder(drive);

  // First create a local backup to upload
  const localBackup = await backupToLocal();

  const fileMetadata = {
    name: localBackup.filename,
    parents: [folderId]
  };

  const media = {
    mimeType: 'application/x-sqlite3',
    body: fs.createReadStream(localBackup.path)
  };

  const uploaded = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, size, createdTime'
  });

  // Clean up old Drive backups (older than 30 days)
  await pruneDriveBackups(drive, folderId);

  const result = {
    local: localBackup,
    drive: {
      id: uploaded.data.id,
      name: uploaded.data.name,
      size: uploaded.data.size,
      createdTime: uploaded.data.createdTime
    }
  };

  lastBackupTime = new Date().toISOString();
  lastBackupResult = result;

  return result;
}

// ── Prune Old Drive Backups ───────────────────────────────────────────

async function pruneDriveBackups(drive, folderId) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_DRIVE_DAYS);
    const cutoffISO = cutoffDate.toISOString();

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false and createdTime < '${cutoffISO}'`,
      fields: 'files(id, name, createdTime)',
      spaces: 'drive',
      orderBy: 'createdTime asc'
    });

    if (res.data.files && res.data.files.length > 0) {
      for (const file of res.data.files) {
        await drive.files.delete({ fileId: file.id });
        console.log(`[backup] Deleted old Drive backup: ${file.name}`);
      }
    }
  } catch (err) {
    console.error('[backup] Failed to prune Drive backups:', err.message);
  }
}

// ── List Drive Backups ────────────────────────────────────────────────

async function listDriveBackups() {
  const drive = getDriveClient();
  const folderId = await getOrCreateFolder(drive);

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, size, createdTime)',
    spaces: 'drive',
    orderBy: 'createdTime desc',
    pageSize: 50
  });

  return res.data.files || [];
}

// ── Full Backup (local + Drive) ───────────────────────────────────────

async function runFullBackup() {
  console.log('[backup] Starting full backup...');
  try {
    const result = await backupToDrive();
    console.log(`[backup] Full backup complete: ${result.local.filename} (${(result.local.size / 1024).toFixed(1)} KB)`);
    return result;
  } catch (err) {
    console.error('[backup] Full backup failed:', err.message);
    // If Drive fails, at least do a local backup
    try {
      const localResult = await backupToLocal();
      console.log(`[backup] Local-only backup saved: ${localResult.filename}`);
      lastBackupTime = new Date().toISOString();
      lastBackupResult = { local: localResult, drive: null, error: err.message };
      return lastBackupResult;
    } catch (localErr) {
      console.error('[backup] Local backup also failed:', localErr.message);
      throw localErr;
    }
  }
}

// ── Status ────────────────────────────────────────────────────────────

function getLastBackupInfo() {
  return {
    lastBackupTime,
    lastBackupResult
  };
}

module.exports = {
  backupToLocal,
  backupToDrive,
  runFullBackup,
  listDriveBackups,
  getLastBackupInfo,
  BACKUPS_DIR,
  DB_PATH
};
