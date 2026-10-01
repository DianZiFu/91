//go:build windows

package scriptcrawler

import (
	"os/exec"
	"strconv"
	"syscall"
)

func setCrawlerProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

func killCrawlerProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	// Windows has no Unix-style process-group signal. taskkill /T terminates the
	// whole descendant tree; fall back to the direct process if taskkill is not
	// available or the tree has already changed.
	if err := exec.Command("taskkill", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F").Run(); err == nil {
		return nil
	}
	// A failure here normally means the tree already exited. Report it instead
	// of swallowing it: callers use a successful termination to tell a
	// backend-initiated exit apart from a script that failed on its own, and
	// os.ErrProcessDone is the outcome cmd.Cancel is documented to expect.
	return cmd.Process.Kill()
}

func terminateCrawlerProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return exec.Command("taskkill", "/PID", strconv.Itoa(cmd.Process.Pid), "/T").Run()
}
