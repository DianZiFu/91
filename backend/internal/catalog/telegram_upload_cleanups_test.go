package catalog

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestTelegramMigrationAndCleanupCommitTogether(t *testing.T) {
	for _, mode := range []string{"success", "stale-source", "cleanup-write-failure"} {
		t.Run(mode, func(t *testing.T) {
			cat := telegramTestCatalog(t)
			ctx := context.Background()
			v := &Video{ID: "video", DriveID: "local-upload", FileID: "video.mp4", FileName: "video.mp4", Title: "Original", Size: 5}
			if err := cat.UpsertVideo(ctx, v); err != nil {
				t.Fatal(err)
			}
			cleanup := TelegramUploadCleanup{
				VideoID: v.ID, SourceDriveID: v.DriveID, SourceFileID: v.FileID,
				Size: v.Size, ModTimeNS: 123, FileIdentity: "unix:1:2",
			}
			target := VideoDriveMigration{
				SourceDriveID: v.DriveID, SourceFileID: v.FileID,
				DriveID: "cloud", FileID: "remote", ParentID: "folder", FileName: "remote.mp4",
			}
			if mode == "stale-source" {
				cleanup.SourceFileID, target.SourceFileID = "stale.mp4", "stale.mp4"
			}
			if mode == "cleanup-write-failure" {
				if _, err := cat.db.Exec(`CREATE TRIGGER reject_cleanup BEFORE INSERT ON telegram_upload_cleanups BEGIN SELECT RAISE(FAIL,'injected cleanup write failure'); END`); err != nil {
					t.Fatal(err)
				}
			}
			err := cat.MigrateTelegramVideoToDrive(ctx, v.ID, target, cleanup)
			if mode == "success" && err != nil || mode != "success" && err == nil {
				t.Fatalf("migration result: %v", err)
			}
			if mode == "stale-source" && !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("source guard error discarded: %v", err)
			}
			saved, err := cat.GetVideo(ctx, v.ID)
			if err != nil {
				t.Fatal(err)
			}
			jobs, err := cat.ListTelegramUploadCleanups(ctx, "", 100)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "success" {
				if saved.DriveID != "cloud" || saved.FileID != "remote" || saved.Title != v.Title || len(jobs) != 1 || jobs[0] != cleanup {
					t.Fatalf("incomplete migration: video=%+v cleanup=%+v", saved, jobs)
				}
			} else if saved.DriveID != v.DriveID || saved.FileID != v.FileID || len(jobs) != 0 {
				t.Fatalf("partial commit survived: video=%+v cleanup=%+v", saved, jobs)
			}
		})
	}
}

func TestPendingTelegramCleanupIsNotAbandonedImport(t *testing.T) {
	cat := telegramTestCatalog(t)
	ctx := context.Background()
	file := TelegramLocalFile{FileID: "old.media", JobID: "missing-job"}
	if _, err := cat.ReserveTelegramLocalFile(ctx, file); err != nil {
		t.Fatal(err)
	}
	v := &Video{ID: "video", DriveID: TelegramLocalDriveID, FileID: file.FileID, Title: "video", Size: 5}
	if err := cat.UpsertVideo(ctx, v); err != nil {
		t.Fatal(err)
	}
	cleanup := TelegramUploadCleanup{VideoID: v.ID, SourceDriveID: v.DriveID, SourceFileID: v.FileID, Size: 5, ModTimeNS: 123, FileIdentity: "unix:1:2"}
	if err := cat.MigrateTelegramVideoToDrive(ctx, v.ID, VideoDriveMigration{
		SourceDriveID: v.DriveID, SourceFileID: v.FileID, DriveID: "cloud", FileID: "remote",
	}, cleanup); err != nil {
		t.Fatal(err)
	}
	files, err := cat.AbandonedTelegramLocalFiles(ctx)
	if err != nil || len(files) != 0 {
		t.Fatalf("import cleanup bypassed transfer ownership: %+v %v", files, err)
	}
}
