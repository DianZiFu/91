// Package telegramstorage serves library files on the Bot API shared volume.
// Only catalogued opaque IDs are accepted; callers cannot address Bot API files.
package telegramstorage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/video-site/backend/internal/catalog"
	"github.com/video-site/backend/internal/drives"
)

const DriveID = catalog.TelegramLocalDriveID

type Driver struct {
	cat  *catalog.Catalog
	root func() string
}

// root resolves the website's current shared directory even when receiving is
// disabled. Individual operations use one snapshot of this location.
func New(cat *catalog.Catalog, root func() string) *Driver { return &Driver{cat: cat, root: root} }
func (d *Driver) Kind() string                             { return DriveID }
func (d *Driver) ID() string                               { return DriveID }
func (d *Driver) RootID() string                           { return "" }
func (d *Driver) Init(context.Context) error               { return nil }
func (d *Driver) List(context.Context, string) ([]drives.Entry, error) {
	return nil, drives.ErrNotSupported
}

// RelativePath addresses only files within the library, never Bot API state.
func RelativePath(fileID string) (string, error) {
	if fileID == "" || filepath.Base(fileID) != fileID || strings.ContainsAny(fileID, "/\\\x00:") || fileID == "." || fileID == ".." {
		return "", errors.New("TG 视频路径无效")
	}
	return filepath.Join("library", fileID), nil
}

// Path resolves a library identity under the website's storage root. Missing files
// retain their valid path so deletion and interrupted acquisitions are idempotent.
func Path(root, fileID string) (string, error) {
	relative, err := RelativePath(fileID)
	if err != nil || !filepath.IsAbs(root) {
		return "", errors.New("TG 视频路径无效")
	}
	base, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("TG 视频存储目录不可用: %w", err)
	}
	library := filepath.Join(base, "library")
	resolved, err := filepath.EvalSymlinks(library)
	if err != nil {
		return "", fmt.Errorf("TG 视频存储目录不可用: %w", err)
	}
	if resolved != library {
		return "", errors.New("TG 视频存储目录不能包含符号链接")
	}
	path := filepath.Join(base, relative)
	info, err := os.Lstat(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("无法检查 TG 视频文件: %w", err)
	}
	if err == nil && !info.Mode().IsRegular() {
		return "", errors.New("TG 视频不是普通文件")
	}
	return path, nil
}
func (d *Driver) LocalPath(ctx context.Context, id string) (string, error) {
	f, err := d.cat.TelegramLocalFile(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("%w: %w", os.ErrNotExist, err)
	}
	if err != nil {
		return "", fmt.Errorf("无法读取 TG 视频位置: %w", err)
	}
	return Path(d.root(), f.FileID)
}
func (d *Driver) Stat(ctx context.Context, id string) (*drives.Entry, error) {
	path, err := d.LocalPath(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, os.ErrNotExist
	}
	return &drives.Entry{ID: id, Name: id, Size: info.Size(), ModTime: info.ModTime()}, nil
}
func (d *Driver) StreamURL(ctx context.Context, id string) (*drives.StreamLink, error) {
	path, err := d.LocalPath(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() == 0 {
		return nil, os.ErrNotExist
	}
	// A local lookup is cheap and its root can change through configuration.
	// Leave expiry unset so the playback proxy does not cache a physical path.
	return &drives.StreamLink{URL: path}, nil
}
func (d *Driver) Remove(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f, err := d.cat.TelegramLocalFile(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("无法读取 TG 视频位置: %w", err)
	}
	path, err := Path(d.root(), f.FileID)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("无法删除 TG 视频，请检查共享目录写入权限: %w", err)
	}
	return d.cat.DeleteTelegramLocalFile(ctx, id)
}
