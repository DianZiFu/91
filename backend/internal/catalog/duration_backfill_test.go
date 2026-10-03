package catalog

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestDurationBackfillCursorVisitsFailedCandidatesOncePerRound(t *testing.T) {
	ctx := context.Background()
	cat, err := Open(filepath.Join(t.TempDir(), "catalog.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer cat.Close()
	now := time.Now()
	for i := 0; i < 205; i++ {
		id := fmt.Sprintf("video-%03d", i)
		if err := cat.UpsertVideo(ctx, &Video{ID: id, DriveID: "drive", FileID: id, Title: id, Size: 100,
			ThumbnailURL: "/p/thumb/" + id, PublishedAt: now, CreatedAt: now, UpdatedAt: now}); err != nil {
			t.Fatal(err)
		}
	}
	for round := 0; round < 2; round++ {
		seen := make(map[string]bool)
		cursor := ""
		for {
			videos, err := cat.ListVideosNeedingDuration(ctx, "drive", cursor, 100)
			if err != nil {
				t.Fatal(err)
			}
			if len(videos) == 0 {
				break
			}
			for _, video := range videos {
				if seen[video.ID] {
					t.Fatalf("candidate retried within round: %s", video.ID)
				}
				seen[video.ID] = true
			}
			// Leave durations missing, exactly as a failed probe would.
			cursor = videos[len(videos)-1].ID
		}
		if len(seen) != 205 {
			t.Fatalf("round %d visited %d candidates", round, len(seen))
		}
	}
}

func TestDurationBackfillSelectionUsesCurrentMetadataAndCanonicalVisibility(t *testing.T) {
	ctx := context.Background()
	cat, err := Open(filepath.Join(t.TempDir(), "catalog.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer cat.Close()
	now := time.Now()
	for _, id := range []string{"pending", "known", "hidden", "duplicate", "other", "thumbnail-failed"} {
		video := &Video{ID: id, DriveID: "drive", FileID: id, Title: id, Size: 100, PublishedAt: now, CreatedAt: now, UpdatedAt: now}
		if id == "known" {
			video.DurationSeconds = 42
		}
		if id == "hidden" {
			video.Hidden = true
		}
		if id == "other" {
			video.DriveID = "other"
		}
		if err := cat.UpsertVideo(ctx, video); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := cat.db.ExecContext(ctx, `UPDATE videos SET is_canonical = 0 WHERE id = 'duplicate'`); err != nil {
		t.Fatal(err)
	}
	if err := cat.UpdateVideoMeta(ctx, "thumbnail-failed", VideoMetaPatch{ThumbnailStatus: "failed"}); err != nil {
		t.Fatal(err)
	}
	videos, err := cat.ListVideosNeedingDuration(ctx, "drive", "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(videos) != 2 || videos[0].ID != "pending" || videos[1].ID != "thumbnail-failed" {
		t.Fatalf("candidates = %+v", videos)
	}
	if err := cat.UpdateVideoMeta(ctx, "pending", VideoMetaPatch{DurationSeconds: 19}); err != nil {
		t.Fatal(err)
	}
	videos, err = cat.ListVideosNeedingDuration(ctx, "drive", "", 100)
	if err != nil || len(videos) != 1 || videos[0].ID != "thumbnail-failed" {
		t.Fatalf("completed candidate returned: %v, %v", videos, err)
	}
}

func TestLegacyDurationFailureMigrationKeepsExistingCoverReady(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "catalog.db")
	cat, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	video := &Video{ID: "legacy", DriveID: "drive", FileID: "legacy", Title: "Legacy", ThumbnailURL: "/p/thumb/legacy", PublishedAt: now, CreatedAt: now, UpdatedAt: now}
	if err := cat.UpsertVideo(ctx, video); err != nil {
		t.Fatal(err)
	}
	if _, err := cat.db.ExecContext(ctx, `UPDATE videos SET thumbnail_status = 'skipped' WHERE id = 'legacy'`); err != nil {
		t.Fatal(err)
	}
	if err := cat.SetSetting(ctx, "videos.duration_backfill.finish_round.v1", ""); err != nil {
		t.Fatal(err)
	}
	if err := cat.Close(); err != nil {
		t.Fatal(err)
	}
	cat, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer cat.Close()
	ready, err := cat.ListVideosByThumbnailStatus(ctx, "drive", "ready", 100)
	if err != nil || len(ready) != 1 {
		t.Fatalf("legacy cover not ready: %v, %v", ready, err)
	}
	missing, err := cat.ListVideosNeedingDuration(ctx, "drive", "", 100)
	if err != nil || len(missing) != 1 {
		t.Fatalf("legacy duration not eligible: %v, %v", missing, err)
	}
}
