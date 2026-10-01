//go:build !windows

package scriptcrawler

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCrawlerTimeoutKillsChildProcessTree(t *testing.T) {
	pidFile := t.TempDir() + "/child.pid"
	body := fmt.Sprintf(`import subprocess
child=subprocess.Popen(["sleep","30"])
open(%q,"w").write(str(child.pid))
time.sleep(30)
`, pidFile)
	crawler := newRuntimeTestCrawler(t, body, ProtocolV3, func(cfg *CrawlerConfig) { cfg.OperationTimeout = 100 * time.Millisecond })
	_, err := crawler.RunOnce(context.Background(), 1)
	if err == nil {
		t.Fatal("expected operation timeout")
	}
	data, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatalf("read child pid: %v", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatalf("parse child pid: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for processIsRunning(pid) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if processIsRunning(pid) {
		t.Fatalf("child process %d survived crawler termination", pid)
	}
}

func processIsRunning(pid int) bool {
	if err := syscall.Kill(pid, 0); err != nil {
		return false
	}
	stat, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err == nil && strings.Contains(string(stat), ") Z ") {
		return false
	}
	return true
}
