package catalog

import (
	"context"
	"time"
)

// ListVideosNeedingDuration uses a keyset cursor so failed probes cannot be
// selected again later in the same sweep. The next round starts with no cursor.
func (c *Catalog) ListVideosNeedingDuration(ctx context.Context, driveID, afterID string, limit int) ([]*Video, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := c.db.QueryContext(ctx, `SELECT `+allVideoCols+` FROM videos
        WHERE drive_id = ? AND id > ? AND COALESCE(duration_seconds, 0) <= 0
        AND COALESCE(hidden, 0) = 0 AND `+uniqueVideoWhereSQL+`
        ORDER BY id ASC LIMIT ?`, driveID, afterID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var videos []*Video
	for rows.Next() {
		video, err := scanVideo(rows)
		if err != nil {
			return nil, err
		}
		videos = append(videos, video)
	}
	return videos, rows.Err()
}

// Older duration-only failures were written into thumbnail_status. Repair that
// legacy state once; missing duration itself is sufficient to admit backfill.
func (c *Catalog) migrateLegacyDurationBackfill(ctx context.Context) error {
	const marker = "videos.duration_backfill.finish_round.v1"
	value, err := c.GetSetting(ctx, marker, "")
	if err != nil || value == "1" {
		return err
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE videos SET thumbnail_status = 'ready', thumbnail_failures = 0
        WHERE COALESCE(thumbnail_url, '') != '' AND thumbnail_status IN ('failed', 'skipped')`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO settings(key, value, updated_at) VALUES (?, '1', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, marker, time.Now().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}
