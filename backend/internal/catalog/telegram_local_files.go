package catalog

import "context"

const TelegramLocalDriveID = "telegram-local"

// TelegramLocalFile identifies a file in the configured TG library. FileID is
// an opaque basename, independent of the host's storage location. This table
// is never included in portable backups.
type TelegramLocalFile struct {
	FileID string
	JobID  string
}

func (c *Catalog) TelegramLocalFile(ctx context.Context, fileID string) (TelegramLocalFile, error) {
	var f TelegramLocalFile
	err := c.db.QueryRowContext(ctx, `SELECT file_id,job_id FROM telegram_local_files WHERE file_id=?`, fileID).Scan(&f.FileID, &f.JobID)
	return f, err
}

// ReserveTelegramLocalFile records the destination before moving the bytes.
// Restarts and directory relocations reuse the same relative file identity.
func (c *Catalog) ReserveTelegramLocalFile(ctx context.Context, f TelegramLocalFile) (TelegramLocalFile, error) {
	_, err := c.db.ExecContext(ctx, `INSERT INTO telegram_local_files(file_id,job_id) VALUES(?,?) ON CONFLICT(file_id) DO NOTHING`, f.FileID, f.JobID)
	if err != nil {
		return TelegramLocalFile{}, err
	}
	return c.TelegramLocalFile(ctx, f.FileID)
}

func (c *Catalog) DeleteTelegramLocalFile(ctx context.Context, fileID string) error {
	_, err := c.db.ExecContext(ctx, `DELETE FROM telegram_local_files WHERE file_id=?`, fileID)
	return err
}

func (c *Catalog) AbandonedTelegramLocalFiles(ctx context.Context) ([]TelegramLocalFile, error) {
	rows, err := c.db.QueryContext(ctx, `SELECT f.file_id,f.job_id FROM telegram_local_files f
 LEFT JOIN remote_upload_jobs j ON j.id=f.job_id
 WHERE (j.id IS NULL OR j.state IN ('failed','canceled'))
 AND NOT EXISTS (SELECT 1 FROM telegram_upload_cleanups u WHERE u.source_drive_id='telegram-local' AND u.source_file_id=f.file_id)
 AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.drive_id='telegram-local' AND v.file_id=f.file_id)
 AND NOT EXISTS (SELECT 1 FROM deleted_videos v WHERE v.drive_id='telegram-local' AND v.file_id=f.file_id)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var files []TelegramLocalFile
	for rows.Next() {
		var f TelegramLocalFile
		if err := rows.Scan(&f.FileID, &f.JobID); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, rows.Err()
}

func (c *Catalog) TelegramLocalStorageSize(ctx context.Context) (int, int64, error) {
	var count int
	var size int64
	err := c.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(size_bytes),0) FROM videos WHERE drive_id='telegram-local'`).Scan(&count, &size)
	return count, size, err
}
