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

function parseDriveCredentials(raw) {
  if (!raw) {
    throw new Error('GOOGLE_DRIVE_CREDENTIALS environment variable not set');
  }

  const trimmed = raw.trim();

  // Attempt 1: raw JSON (most common — user pasted the file contents)
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      // Private keys often contain literal newlines that break JSON.parse
      // when pasted directly. Try escaping them inside string values.
      try {
        const escaped = trimmed.replace(/"([^"]*?)"/gs, (match, inner) =>
          '"' + inner.replace(/\r?\n/g, '\\n') + '"'
        );
        return JSON.parse(escaped);
      } catch (err2) {
        // Fall through to try base64
      }
    }
  }

  // Attempt 2: base64-encoded JSON
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.trim().startsWith('{')) {
      return JSON.parse(decoded);
    }
  } catch (err) {
    // Fall through
  }

  throw new Error(
    'GOOGLE_DRIVE_CREDENTIALS could not be parsed. Paste the raw service account JSON file contents, or a base64-encoded version of it.'
  );
}

function getDriveClient() {
  const creds = parseDriveCredentials(process.env.GOOGLE_DRIVE_CREDENTIALS);

  // Service account private keys must contain real newlines, not literal \n
  if (creds.private_key && creds.private_key.includes('\\n')) {
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  return google.drive({ version: 'v3', auth });
}

// ── Find or Create Drive Folder ───────────────────────────────────────

async function getOrCreateFolder(drive) {
  // Preferred: explicit folder ID via env var (most reliable)
  if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID.trim();
    try {
      const meta = await drive.files.get({
        fileId: folderId,
        fields: 'id, name, driveId',
        supportsAllDrives: true
      });
      console.log(`[backup] Using Drive folder by ID: ${meta.data.name} (${meta.data.id})`);
      return folderId;
    } catch (err) {
      console.error(`[backup] GOOGLE_DRIVE_FOLDER_ID set but folder not accessible: ${err.message}`);
      throw new Error(`Drive folder ${folderId} not accessible by service account. Make sure you shared the folder with the service account email as Editor.`);
    }
  }

  // Fallback: search by name (including shared drives)
  const res = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name, ownedByMe)',
    spaces: 'drive',
    corpora: 'allDrives',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  if (res.data.files && res.data.files.length > 0) {
    // Prefer folders NOT owned by the service account (i.e. shared in by user)
    const shared = res.data.files.find(f => f.ownedByMe === false) || res.data.files[0];
    console.log(`[backup] Found Drive folder by name: ${shared.name} (${shared.id})`);
    return shared.id;
  }

  // No folder found — refuse to create one silently in the service account's private drive
  throw new Error(
    `Drive folder "${FOLDER_NAME}" not found. Either (1) share a folder with that exact name with the service account email as Editor, or (2) set GOOGLE_DRIVE_FOLDER_ID to the folder's ID.`
  );
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
    fields: 'id, name, size, createdTime',
    supportsAllDrives: true
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
    pageSize: 50,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
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
