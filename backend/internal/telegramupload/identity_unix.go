//go:build !windows

package telegramupload

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

func sourceFileIdentity(file *os.File) (string, error) {
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", errors.New("filesystem does not expose file identity")
	}
	return fmt.Sprintf("unix:%x:%x", stat.Dev, stat.Ino), nil
}
