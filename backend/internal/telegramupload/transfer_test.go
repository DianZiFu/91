package telegramupload

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/video-site/backend/internal/catalog"
	"github.com/video-site/backend/internal/drives"
)

type fakeCloud struct {
	files        map[string]drives.Entry
	uploads      int
	failUpload   bool
	failStat     bool
	failStream   bool
	wrongSize    bool
	directoryErr error
	listErr      error
	uploadErr    error
	statErr      error
	streamErr    error
	afterUpload  func()
}

func (d *fakeCloud) ID() string                 { return "cloud" }
func (d *fakeCloud) Kind() string               { return "webdav" }
func (d *fakeCloud) RootID() string             { return "root" }
func (d *fakeCloud) Init(context.Context) error { return nil }
func (d *fakeCloud) EnsureDir(context.Context, string) (string, error) {
	return "folder", d.directoryErr
}
func (d *fakeCloud) List(context.Context, string) ([]drives.Entry, error) {
	if d.listErr != nil {
		return nil, d.listErr
	}
	var entries []drives.Entry
	for _, e := range d.files {
		entries = append(entries, e)
	}
	return entries, nil
}
func (d *fakeCloud) Stat(_ context.Context, id string) (*drives.Entry, error) {
	if d.statErr != nil {
		return nil, d.statErr
	}
	if d.failStat {
		return nil, errors.New("not visible yet")
	}
	e, ok := d.files[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	if d.wrongSize {
		e.Size++
	}
	return &e, nil
}
func (d *fakeCloud) StreamURL(context.Context, string) (*drives.StreamLink, error) {
	if d.streamErr != nil {
		return nil, d.streamErr
	}
	if d.failStream {
		return nil, errors.New("no playback")
	}
	return &drives.StreamLink{URL: "https://example.com/video"}, nil
}
func (d *fakeCloud) Upload(_ context.Context, parent, name string, r io.Reader, size int64) (string, error) {
	d.uploads++
	if d.uploadErr != nil {
		return "", d.uploadErr
	}
	if d.failUpload {
		return "", errors.New("provider credential must not escape")
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	if int64(len(data)) != size {
		return "", errors.New("wrong bytes")
	}
	d.files[name] = drives.Entry{ID: name, Name: name, ParentID: parent, Size: size}
	if d.afterUpload != nil {
		d.afterUpload()
	}
	return name, nil
}

func fixture(t *testing.T) (Config, *catalog.Video, *fakeCloud) {
	t.Helper()
	ctx := context.Background()
	c, err := catalog.Open(filepath.Join(t.TempDir(), "catalog.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	if err := c.UpsertDrive(ctx, &catalog.Drive{ID: "cloud", Name: "Cloud Drive", Kind: "webdav", Status: "ok", RootID: "root"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.TelegramOffset(ctx, 123); err != nil {
		t.Fatal(err)
	}
	if err := c.AcceptTelegramUpdate(ctx, catalog.TelegramReceipt{BotID: 123, UpdateID: 1, MessageID: 1, ChatID: 42, SenderID: 42}, &catalog.TelegramSource{BotID: 123, SenderID: 42, FileID: "tg-file", UniqueID: "unique", Size: 5}, "job", "video", 100); err != nil {
		t.Fatal(err)
	}
	if err := c.TransitionRemoteUploadJob(ctx, "job", catalog.RemoteUploadQueued, catalog.RemoteUploadSaving); err != nil {
		t.Fatal(err)
	}
	v := &catalog.Video{ID: "video-tg", DriveID: "local-upload", FileID: "video.mp4", FileName: "video.mp4", Title: "video", Size: 5, Ext: "mp4"}
	if err := c.FinalizeRemoteUpload(ctx, "job", v, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := c.IncrementLike(ctx, v.ID); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, v.FileID), []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}
	d := &fakeCloud{files: map[string]drives.Entry{}}
	return Config{Catalog: c, Target: d, LocalDirectory: dir, TargetDirectory: "Telegram"}, v, d
}

func TestTransferChangesStorageAndPreservesIdentity(t *testing.T) {
	cfg, v, d := fixture(t)
	ctx := context.Background()
	// An ordinary upload, even manually tagged TG, is not a Telegram import.
	if err := cfg.Catalog.UpsertVideo(ctx, &catalog.Video{ID: "ordinary", DriveID: "local-upload", FileID: "ordinary.mp4", Title: "TG", Tags: []string{"TG"}, Size: 5}); err != nil {
		t.Fatal(err)
	}
	ordinaryPath := filepath.Join(cfg.LocalDirectory, "ordinary.mp4")
	if err := os.WriteFile(ordinaryPath, []byte("other"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Run(ctx, cfg); err != nil {
		t.Fatal(err)
	}
	saved, err := cfg.Catalog.GetVideo(ctx, v.ID)
	if err != nil || saved.DriveID != "cloud" || saved.FileID != destinationName(v) || saved.ParentID != "folder" || saved.Title != v.Title || saved.Likes != 1 || !slices.Contains(saved.Tags, "TG") {
		t.Fatalf("migration lost metadata: %+v %v", saved, err)
	}
	if _, err := os.Stat(filepath.Join(cfg.LocalDirectory, v.FileID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected local cleanup: %v", err)
	}
	ordinary, err := cfg.Catalog.GetVideo(ctx, "ordinary")
	if err != nil || ordinary.DriveID != "local-upload" {
		t.Fatal("ordinary upload was moved")
	}
	if data, err := os.ReadFile(ordinaryPath); err != nil || string(data) != "other" {
		t.Fatalf("ordinary upload file changed: %q %v", data, err)
	}
	if err := Run(ctx, cfg); err != nil || d.uploads != 1 {
		t.Fatalf("repeat uploaded again: %d %v", d.uploads, err)
	}
	mapped, err := cfg.Catalog.TelegramVideoID(ctx, 123, "unique")
	if err != nil || mapped != v.ID {
		t.Fatal("Telegram deduplication mapping changed")
	}
}

func TestFailedTransfersRemainLocalAndReconcileRemoteWrite(t *testing.T) {
	for _, failure := range []string{"upload", "stat", "size", "stream"} {
		t.Run(failure, func(t *testing.T) {
			cfg, v, d := fixture(t)
			d.failUpload = failure == "upload"
			d.failStat = failure == "stat"
			d.wrongSize = failure == "size"
			d.failStream = failure == "stream"
			ctx := context.Background()
			if err := Run(ctx, cfg); err == nil || strings.Contains(err.Error(), "credential") {
				t.Fatalf("expected sanitized failure: %v", err)
			}
			saved, err := cfg.Catalog.GetVideo(ctx, v.ID)
			if err != nil || saved.DriveID != "local-upload" {
				t.Fatal("failed upload changed storage")
			}
			if _, err := os.Stat(filepath.Join(cfg.LocalDirectory, v.FileID)); err != nil {
				t.Fatal("failed upload removed local file")
			}
			d.failUpload = false
			d.failStat = false
			d.wrongSize = false
			d.failStream = false
			if err := Run(ctx, cfg); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(cfg.LocalDirectory, v.FileID)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("successful retry did not remove local video: %v", err)
			}
			want := 1
			if failure == "upload" {
				want = 2
			}
			if d.uploads != want {
				t.Fatalf("remote-write recovery uploaded duplicate: %d", d.uploads)
			}
		})
	}
}

func TestTransferRejectsDestinationConflictsAndSymlinks(t *testing.T) {
	for _, invalid := range []string{"conflict", "symlink"} {
		t.Run(invalid, func(t *testing.T) {
			cfg, v, d := fixture(t)
			if invalid == "conflict" {
				name := destinationName(v)
				d.files[name] = drives.Entry{ID: name, Name: name, Size: 99}
			} else {
				p := filepath.Join(cfg.LocalDirectory, v.FileID)
				if err := os.Remove(p); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(filepath.Join(t.TempDir(), "outside"), p); err != nil {
					t.Skip(err)
				}
			}
			if err := Run(context.Background(), cfg); err == nil || d.uploads != 0 {
				t.Fatalf("unsafe upload: %d %v", d.uploads, err)
			}
		})
	}
}

func TestTransferCancellationAndConcurrentStorageChangePreserveLocalFile(t *testing.T) {
	for _, mode := range []string{"cancel", "migrate"} {
		t.Run(mode, func(t *testing.T) {
			cfg, v, d := fixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			d.afterUpload = func() {
				if mode == "cancel" {
					cancel()
					return
				}
				if err := cfg.Catalog.MigrateVideoToDrive(ctx, v.ID, catalog.VideoDriveMigration{DriveID: "other-cloud", FileID: "other-file"}); err != nil {
					t.Fatal(err)
				}
			}
			if err := Run(ctx, cfg); err == nil {
				t.Fatal("expected interruption")
			}
			if _, err := os.Stat(filepath.Join(cfg.LocalDirectory, v.FileID)); err != nil {
				t.Fatal("interrupted migration deleted source")
			}
			saved, err := cfg.Catalog.GetVideo(context.Background(), v.ID)
			if err != nil || saved.DriveID == "cloud" {
				t.Fatal("stale migration overwrote changed source")
			}
		})
	}
}

func TestDestinationNamesSeparateSameTitleImports(t *testing.T) {
	a := &catalog.Video{ID: "a", FileID: strings.Repeat("视", 75) + ".mp4"}
	b := *a
	b.ID = "b"
	name := destinationName(a)
	if name == destinationName(&b) || len(name) > 240 || !strings.HasSuffix(name, ".mp4") {
		t.Fatal("unstable or oversized destination names")
	}
	stem := strings.TrimSuffix(name, ".mp4")
	suffix := stem[strings.LastIndexByte(stem, '-')+1:]
	if len(suffix) != 16 || strings.Trim(suffix, "0123456789abcdef") != "" {
		t.Fatalf("destination hash suffix = %q, want 16 lowercase hexadecimal characters", suffix)
	}
}

func TestTransferReadsSharedLibraryAndReleasesOnlyAfterSuccess(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "failure"}[fail], func(t *testing.T) {
			cfg, v, cloud := fixture(t)
			ctx := context.Background()
			root := filepath.Join(t.TempDir(), "library")
			if err := os.Mkdir(root, 0750); err != nil {
				t.Fatal(err)
			}
			old := filepath.Join(cfg.LocalDirectory, v.FileID)
			id := "tg-shared.media"
			path := filepath.Join(root, id)
			if err := os.Rename(old, path); err != nil {
				t.Fatal(err)
			}
			if _, err := cfg.Catalog.ReserveTelegramLocalFile(ctx, catalog.TelegramLocalFile{FileID: id, JobID: "job"}); err != nil {
				t.Fatal(err)
			}
			v.DriveID = catalog.TelegramLocalDriveID
			v.FileID = id
			if err := cfg.Catalog.MigrateVideoToDrive(ctx, v.ID, catalog.VideoDriveMigration{DriveID: v.DriveID, FileID: v.FileID, FileName: v.FileName}); err != nil {
				t.Fatal(err)
			}
			relocated := filepath.Join(t.TempDir(), "relocated")
			if err := os.Rename(filepath.Dir(root), relocated); err != nil {
				t.Fatal(err)
			}
			cfg.TelegramDirectory = relocated
			path = filepath.Join(relocated, "library", id)
			cloud.failStat = fail
			err := Run(ctx, cfg)
			if (err != nil) != fail {
				t.Fatalf("transfer error: %v", err)
			}
			saved, e := cfg.Catalog.GetVideo(ctx, v.ID)
			if e != nil {
				t.Fatal(e)
			}
			if fail {
				if saved.DriveID != catalog.TelegramLocalDriveID {
					t.Fatal("failed transfer changed source")
				}
				if _, e := os.Stat(path); e != nil {
					t.Fatal("failed transfer removed source")
				}
			} else {
				if saved.DriveID != "cloud" || !strings.HasSuffix(saved.FileID, ".mp4") {
					t.Fatalf("wrong cloud source: %+v", saved)
				}
				if _, e := os.Stat(path); !os.IsNotExist(e) {
					t.Fatal("transfer retained local file")
				}
			}
		})
	}
}
