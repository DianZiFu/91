package telegramupload

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func sourceFileIdentity(file *os.File) (string, error) {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &info); err != nil {
		return "", err
	}
	index := uint64(info.FileIndexHigh)<<32 | uint64(info.FileIndexLow)
	return fmt.Sprintf("windows:%x:%x", info.VolumeSerialNumber, index), nil
}
