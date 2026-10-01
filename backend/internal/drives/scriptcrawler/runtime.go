package scriptcrawler

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var errOperationTimeout = errors.New("crawler operation timed out")

const defaultOperationTimeout = 5 * time.Minute

type sessionConfig struct {
	PythonPath, ScriptPath, WorkDir, JobPath, ProxyURL string
	OperationTimeout, StopGrace                        time.Duration
	MaxStdoutBytes, MaxStderrBytes                     int64
	Diagnostic                                         func(string)
}
type scriptOutput struct {
	line []byte
	err  error
}

// scriptSession owns a single process and permits one command in flight. It
// knows nothing about catalog identities, import policy, budgets or uploads.
type scriptSession struct {
	cfg        sessionConfig
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     io.ReadCloser
	output     <-chan scriptOutput
	wait       chan struct{}
	waitErr    error
	closed     chan struct{}
	closeOnce  sync.Once
	cancelRead context.CancelFunc
	mu         sync.Mutex
	sequence   int
	logs       *scriptLogTail
}

func startSession(ctx context.Context, cfg sessionConfig) (*scriptSession, error) {
	if cfg.PythonPath == "" {
		cfg.PythonPath = "python3"
	}
	if cfg.OperationTimeout <= 0 {
		cfg.OperationTimeout = defaultOperationTimeout
	}
	if cfg.StopGrace <= 0 {
		cfg.StopGrace = time.Second
	}
	if cfg.MaxStdoutBytes <= 0 {
		cfg.MaxStdoutBytes = defaultMaxStdoutBytes
	}
	cmd := exec.Command(cfg.PythonPath, cfg.ScriptPath, "--job", cfg.JobPath)
	setCrawlerProcAttr(cmd)
	cmd.Dir = cfg.WorkDir
	cmd.WaitDelay = cfg.StopGrace
	if cfg.ProxyURL != "" {
		cmd.Env = append(os.Environ(), "HTTP_PROXY="+cfg.ProxyURL, "HTTPS_PROXY="+cfg.ProxyURL, "http_proxy="+cfg.ProxyURL, "https_proxy="+cfg.ProxyURL, "NO_PROXY=", "no_proxy=")
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	// Use an owned pipe: cmd.Wait must not close stdout before the protocol
	// reader has consumed the final response and checked for extra messages.
	stdout, writer, err := os.Pipe()
	if err != nil {
		stdin.Close()
		return nil, err
	}
	logs := newScriptLogTail(cfg.MaxStderrBytes)
	logs.onLine = cfg.Diagnostic
	cmd.Stdout = writer
	cmd.Stderr = logs
	if err = cmd.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		writer.Close()
		return nil, err
	}
	writer.Close()
	readCtx, cancel := context.WithCancel(context.Background())
	s := &scriptSession{cfg: cfg, cmd: cmd, stdin: stdin, stdout: stdout, wait: make(chan struct{}), closed: make(chan struct{}), cancelRead: cancel, logs: logs}
	s.output = scanScriptOutput(readCtx, stdout, maxMessageBytes, cfg.MaxStdoutBytes)
	go func() { s.waitErr = cmd.Wait(); close(s.wait) }()
	go func() {
		select {
		case <-ctx.Done():
			s.Close()
		case <-s.closed:
		}
	}()
	return s, nil
}
func (s *scriptSession) Close() {
	s.closeOnce.Do(func() {
		_ = s.stdin.Close()
		select {
		case <-s.wait:
		default:
			_ = terminateCrawlerProcess(s.cmd)
			timer := time.NewTimer(s.cfg.StopGrace)
			select {
			case <-s.wait:
			case <-timer.C:
			}
			timer.Stop()
		}
		// Also reap descendants that kept pipes open after the parent exited.
		_ = killCrawlerProcess(s.cmd)
		_ = s.stdout.Close()
		s.cancelRead()
		<-s.wait
		close(s.closed)
	})
}
func (s *scriptSession) request(ctx context.Context, command map[string]any, expected string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	opCtx, cancel := context.WithTimeoutCause(ctx, s.cfg.OperationTimeout, errOperationTimeout)
	defer cancel()
	timeoutError := func() error {
		if !errors.Is(context.Cause(opCtx), errOperationTimeout) {
			return opCtx.Err()
		}
		return fmt.Errorf("%s: %w: %w", command["type"], errOperationTimeout, opCtx.Err())
	}
	if opCtx.Err() != nil {
		return nil, timeoutError()
	}
	s.sequence++
	id := fmt.Sprintf("request-%d", s.sequence)
	command["request_id"] = id
	deadline, _ := opCtx.Deadline()
	command["deadline_at"] = deadline.UTC().Format(time.RFC3339Nano)
	data, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	if len(data) > maxMessageBytes {
		return nil, protocolError("command too large")
	}
	wrote := make(chan error, 1)
	go func() { _, err := s.stdin.Write(append(data, '\n')); wrote <- err }()
	select {
	case err := <-wrote:
		if err != nil {
			if opCtx.Err() != nil {
				return nil, timeoutError()
			}
			return nil, protocolError("write command: %v", err)
		}
	case <-opCtx.Done():
		err := timeoutError()
		s.Close()
		return nil, err
	}
	for {
		select {
		case <-opCtx.Done():
			err := timeoutError()
			s.Close()
			return nil, err
		case out, ok := <-s.output:
			// Deadline cancellation also closes the process pipes. Preserve the
			// deadline's cause instead of reporting the resulting EOF as bad output.
			if opCtx.Err() != nil {
				err := timeoutError()
				s.Close()
				return nil, err
			}
			if !ok {
				return nil, protocolError("process exited without %s response", expected)
			}
			if out.err != nil {
				return nil, out.err
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(out.line, &fields); err != nil || fields == nil {
				return nil, protocolError("stdout must contain JSON objects")
			}
			var head envelope
			if err := json.Unmarshal(fields["type"], &head.Type); err != nil {
				return nil, protocolError("response type is required")
			}
			if err := json.Unmarshal(fields["request_id"], &head.RequestID); err != nil || head.RequestID != id {
				return nil, protocolError("request_id mismatch: expected %s", id)
			}
			switch head.Type {
			case "heartbeat":
				if err := strictDecode(out.line, &head); err != nil {
					return nil, err
				}
				continue
			case "error":
				var failure ScriptError
				if err := strictDecode(out.line, &failure); err != nil {
					return nil, err
				}
				if expected == "stopped" || (failure.Scope != "item" && failure.Scope != "source") || failure.Message == "" || len(failure.Message) > 8192 || failure.RetryAfterSeconds < 0 || failure.RetryAfterSeconds > 86400 || string(fields["retryable"]) == "null" || fields["retryable"] == nil {
					return nil, protocolError("invalid error response")
				}
				if command["type"] == "discover" && failure.Scope != "source" {
					return nil, protocolError("discover errors must have source scope")
				}
				switch failure.Code {
				case "not_found", "parse_failed", "auth_required", "rate_limited", "source_unavailable":
				default:
					return nil, protocolError("unknown error code %q", failure.Code)
				}
				return nil, &failure
			case expected:
				if expected == "page" && fields["next_cursor"] == nil {
					return nil, protocolError("page next_cursor is required")
				}
				return out.line, nil
			default:
				return nil, protocolError("expected %s, received %q", expected, head.Type)
			}
		}
	}
}
func (s *scriptSession) Discover(ctx context.Context, cursor *string, limit int) (*pageResponse, error) {
	data, err := s.request(ctx, map[string]any{"type": "discover", "cursor": cursor, "limit": limit}, "page")
	if err != nil {
		return nil, err
	}
	var page pageResponse
	if err := strictDecode(data, &page); err != nil {
		return nil, err
	}
	if page.Items == nil || len(page.Items) > limit {
		return nil, protocolError("page.items must be an array with at most %d candidates", limit)
	}
	if page.NextCursor != nil && (!validIdentity(*page.NextCursor) || len(*page.NextCursor) > 512) {
		return nil, protocolError("invalid next_cursor")
	}
	for _, candidate := range page.Items {
		if err := validateCandidate(candidate); err != nil {
			return nil, err
		}
	}
	return &page, nil
}
func (s *scriptSession) Resolve(ctx context.Context, candidate Candidate) (Item, error) {
	data, err := s.request(ctx, map[string]any{"type": "resolve", "candidate": candidate}, "item")
	if err != nil {
		return Item{}, err
	}
	var response itemResponse
	if err := strictDecode(data, &response); err != nil {
		return Item{}, err
	}
	if err := validateItem(response.Item, candidate); err != nil {
		return Item{}, err
	}
	return response.Item, nil
}
func (s *scriptSession) Stop(ctx context.Context, reason string) error {
	stopCtx, cancel := context.WithTimeout(ctx, s.cfg.StopGrace)
	defer cancel()
	data, err := s.request(stopCtx, map[string]any{"type": "stop", "reason": reason}, "stopped")
	if err != nil {
		return err
	}
	var response envelope
	if err := strictDecode(data, &response); err != nil {
		return err
	}
	_ = s.stdin.Close()
	for {
		select {
		case <-stopCtx.Done():
			return protocolError("process did not exit after stopped")
		case out, ok := <-s.output:
			if ok {
				if out.err != nil {
					return out.err
				}
				return protocolError("output after stopped response")
			}
			select {
			case <-s.wait:
				if s.waitErr != nil {
					return protocolError("process exit: %v", s.waitErr)
				}
				return nil
			case <-stopCtx.Done():
				return protocolError("process did not exit after stopped")
			}
		}
	}
}
func scanScriptOutput(ctx context.Context, r io.Reader, maxLine int, maxTotal int64) <-chan scriptOutput {
	out := make(chan scriptOutput, 1)
	go func() {
		defer close(out)
		reader := bufio.NewReaderSize(r, min(maxLine, 64*1024))
		var total int64
		send := func(value scriptOutput) bool {
			select {
			case out <- value:
				return true
			case <-ctx.Done():
				return false
			}
		}
		var line []byte
		for {
			fragment, err := reader.ReadSlice('\n')
			total += int64(len(fragment))
			if total > maxTotal {
				send(scriptOutput{err: protocolError("stdout exceeded %d bytes", maxTotal)})
				return
			}
			if len(line)+len(fragment) > maxLine {
				send(scriptOutput{err: protocolError("stdout line exceeds %d bytes", maxLine)})
				return
			}
			line = append(line, fragment...)
			if err == bufio.ErrBufferFull {
				continue
			}
			if len(line) > 0 {
				if line[len(line)-1] != '\n' {
					send(scriptOutput{err: protocolError("incomplete JSONL message")})
					return
				}
				if strings.TrimSpace(string(line)) == "" {
					send(scriptOutput{err: protocolError("empty stdout line")})
					return
				}
				if !send(scriptOutput{line: line}) {
					return
				}
				line = nil
			}
			if err != nil {
				if err != io.EOF {
					send(scriptOutput{err: protocolError("read stdout: %v", err)})
				}
				return
			}
		}
	}()
	return out
}
