package scriptcrawler

import (
	"fmt"
	"strings"
	"sync"
)

const scriptLogTailLines = 60

type scriptLogTail struct {
	mu         sync.Mutex
	lines      []string
	partial    string
	totalBytes int64
	suppressed int64
	maxBytes   int64
	onLine     func(string)
}

func newScriptLogTail(maxBytes int64) *scriptLogTail {
	if maxBytes <= 0 {
		maxBytes = defaultMaxStderrBytes
	}
	return &scriptLogTail{
		lines:    make([]string, 0, scriptLogTailLines),
		maxBytes: maxBytes,
	}
}

func (t *scriptLogTail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	originalLen := len(p)
	remaining := t.maxBytes - t.totalBytes
	if remaining <= 0 {
		t.suppressed += int64(originalLen)
		return originalLen, nil
	}
	accepted := p
	if int64(len(accepted)) > remaining {
		accepted = accepted[:remaining]
		t.suppressed += int64(originalLen - len(accepted))
	}
	t.totalBytes += int64(len(accepted))
	chunk := strings.ReplaceAll(string(accepted), "\r\n", "\n")
	parts := strings.Split(t.partial+chunk, "\n")
	t.partial = truncateScriptLogLine(parts[len(parts)-1])
	for _, line := range parts[:len(parts)-1] {
		t.appendLocked(line)
	}
	return originalLen, nil
}

func (t *scriptLogTail) snapshot() []string {
	t.mu.Lock()
	defer t.mu.Unlock()

	lines := append([]string{}, t.lines...)
	if partial := strings.TrimSpace(t.partial); partial != "" {
		lines = appendScriptLogLine(lines, partial)
	}
	if t.suppressed > 0 {
		lines = appendScriptLogLine(lines, fmt.Sprintf("[stderr truncated: %d bytes suppressed]", t.suppressed))
	}
	return lines
}

func (t *scriptLogTail) appendLocked(line string) {
	t.lines = appendScriptLogLine(t.lines, line)
	if t.onLine != nil {
		t.onLine(truncateScriptLogLine(line))
	}
}

func appendScriptLogLine(lines []string, line string) []string {
	line = truncateScriptLogLine(strings.TrimSpace(line))
	if line == "" {
		return lines
	}
	if len(lines) >= scriptLogTailLines {
		lines = lines[1:]
	}
	return append(lines, line)
}

func truncateScriptLogLine(line string) string {
	if len(line) <= maxStderrLineBytes {
		return line
	}
	return line[:maxStderrLineBytes] + "…"
}
