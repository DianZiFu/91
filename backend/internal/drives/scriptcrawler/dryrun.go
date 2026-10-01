package scriptcrawler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DryRun 在不入库的前提下试跑一个爬虫脚本：临时目录里生成 job.json，
// 启动脚本进程，拿到第一条（或前 MaxItems 条）item 事件后立即停止，
// 再对视频直链做一次小范围探测，验证脚本"能不能爬取到视频"。
// 用于后台导入脚本后的"测试脚本"按钮。

const (
	defaultDryRunTimeout  = 5 * time.Minute
	dryRunMediaProbeLimit = 20 * time.Second
)

type DryRunConfig struct {
	PythonPath string
	ScriptPath string
	ProxyURL   string
	ConfigJSON string
	FeedID     string
	// MaxItems 收到多少条 item 后停止脚本，默认 1。
	MaxItems int
	// Timeout 整个试跑的硬上限，默认 5 分钟。
	Timeout time.Duration
	// SkipMediaProbe 跳过视频直链可达性探测（单测注入用）。
	SkipMediaProbe   bool
	OperationTimeout time.Duration
	StopGrace        time.Duration
	HTTPClient       *http.Client
	MaxStdoutBytes   int64
	MaxStderrBytes   int64
}

type DryRunItem struct {
	Title        string `json:"title"`
	SourceID     string `json:"sourceId,omitempty"`
	MediaURL     string `json:"mediaUrl,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	DetailURL    string `json:"detailUrl,omitempty"`
}

type DryRunMediaCheck struct {
	OK            bool   `json:"ok"`
	Status        int    `json:"status,omitempty"`
	ContentType   string `json:"contentType,omitempty"`
	ContentLength int64  `json:"contentLengthBytes,omitempty"`
	Error         string `json:"error,omitempty"`
}

type DryRunResult struct {
	OK         bool              `json:"ok"`
	Validated  []string          `json:"validated"`
	Protocol   string            `json:"protocol,omitempty"`
	FeedID     string            `json:"feedId,omitempty"`
	FeedLabel  string            `json:"feedLabel,omitempty"`
	Items      []DryRunItem      `json:"items"`
	MediaCheck *DryRunMediaCheck `json:"mediaCheck,omitempty"`
	Error      string            `json:"error,omitempty"`
	Log        []string          `json:"log,omitempty"`
	DurationMs int64             `json:"durationMs"`
}

// DryRun uses exactly the production session and validators, in an isolated
// directory. Its result describes protocol and media checks, never an import.
func DryRun(ctx context.Context, cfg DryRunConfig) *DryRunResult {
	started := time.Now()
	result := &DryRunResult{Items: []DryRunItem{}, Validated: []string{}}
	defer func() { result.DurationMs = time.Since(started).Milliseconds() }()
	source, err := os.ReadFile(cfg.ScriptPath)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	meta, err := ExtractMetadata(string(source))
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Protocol = meta.Protocol
	feed, err := meta.ResolveFeed(cfg.FeedID)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.FeedID, result.FeedLabel = feed.ID, feed.Label
	dir, err := os.MkdirTemp("", "crawler-dryrun-")
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer os.RemoveAll(dir)
	workDir := filepath.Join(dir, "work")
	if err = os.Mkdir(workDir, 0o700); err != nil {
		result.Error = err.Error()
		return result
	}
	scriptPath := filepath.Join(dir, "crawler.py")
	if err = os.WriteFile(scriptPath, source, 0o600); err != nil {
		result.Error = err.Error()
		return result
	}
	config := json.RawMessage(cfg.ConfigJSON)
	if len(config) == 0 {
		config = json.RawMessage(`{}`)
	}
	if !json.Valid(config) || !strings.HasPrefix(strings.TrimSpace(string(config)), "{") {
		result.Error = "config_json must be a JSON object"
		return result
	}
	job := Job{Protocol: ProtocolV3, TaskID: "dryrun", CrawlerID: "dryrun", FeedID: feed.ID, WorkDir: workDir, Config: config, Network: JobNetwork{ProxyURL: cfg.ProxyURL}}
	data, err := json.Marshal(job)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	jobPath := filepath.Join(dir, "job.json")
	if err = os.WriteFile(jobPath, data, 0o600); err != nil {
		result.Error = err.Error()
		return result
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = defaultDryRunTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	session, err := startSession(runCtx, sessionConfig{PythonPath: cfg.PythonPath, ScriptPath: scriptPath, WorkDir: filepath.Dir(cfg.ScriptPath), JobPath: jobPath, ProxyURL: cfg.ProxyURL, OperationTimeout: cfg.OperationTimeout, StopGrace: cfg.StopGrace, MaxStdoutBytes: cfg.MaxStdoutBytes, MaxStderrBytes: cfg.MaxStderrBytes})
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer func() { session.Close(); result.Log = session.logs.snapshot() }()
	if cfg.MaxItems <= 0 {
		cfg.MaxItems = 1
	}
	if cfg.MaxItems > 100 {
		cfg.MaxItems = 100
	}
	var cursor *string
	seen := map[string]bool{}
	keys := map[string]bool{}
	var items []Item
	for pageCount := 0; pageCount < 10 && len(items) < cfg.MaxItems; pageCount++ {
		page, err := session.Discover(runCtx, cursor, min(24, cfg.MaxItems-len(items)))
		if err != nil {
			result.Error = err.Error()
			return result
		}
		if page.NextCursor != nil {
			if seen[*page.NextCursor] {
				result.Error = protocolError("repeated next_cursor").Error()
				return result
			}
			seen[*page.NextCursor] = true
		}
		for _, candidate := range page.Items {
			if keys[candidate.DiscoveryKey] {
				result.Error = protocolError("repeated discovery candidate").Error()
				return result
			}
			keys[candidate.DiscoveryKey] = true
			item, err := session.Resolve(runCtx, candidate)
			if err != nil {
				result.Error = err.Error()
				return result
			}
			thumb := ""
			if item.Thumbnail != nil {
				thumb = item.Thumbnail.URL
			}
			result.Items = append(result.Items, DryRunItem{Title: item.Title, SourceID: item.SourceID, MediaURL: item.Media.URL, ThumbnailURL: thumb, DetailURL: item.DetailURL})
			items = append(items, item)
		}
		if page.NextCursor == nil {
			break
		}
		cursor = page.NextCursor
	}
	// Probe while the script is idle, just as production imports before stop.
	defer func() {
		if err := session.Stop(runCtx, "dryrun_complete"); err != nil {
			result.Error = err.Error()
			result.OK = false
			return
		}
		if len(items) > 0 {
			result.Validated = append([]string{"protocol"}, result.Validated...)
		}
	}()
	if len(items) == 0 {
		result.Error = "未发现可解析的视频"
		return result
	}
	if cfg.SkipMediaProbe {
		result.OK = true
		return result
	}
	for i, item := range items {
		check := probeMediaURL(runCtx, cfg, result.Items[i], item.Media.Headers)
		result.MediaCheck = check
		if !check.OK {
			result.Error = check.Error
			return result
		}
	}
	result.Validated = append(result.Validated, "media_probe")
	result.OK = true
	return result
}

// probeMediaURL 对视频直链发一个 Range: bytes=0-0 的小请求，
// 验证直链可达（带上脚本给的防盗链 headers 和代理）。
func probeMediaURL(ctx context.Context, cfg DryRunConfig, item DryRunItem, mediaHeaders map[string]string) *DryRunMediaCheck {
	check := &DryRunMediaCheck{}
	if item.MediaURL == "" {
		check.Error = "item 没有视频直链"
		return check
	}

	client := cfg.HTTPClient
	if client == nil {
		transport := &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			ResponseHeaderTimeout: dryRunMediaProbeLimit,
		}
		if err := configureExplicitProxy(transport, cfg.ProxyURL); err != nil {
			check.Error = fmt.Sprintf("代理配置无效: %v", err)
			return check
		}
		client = &http.Client{Transport: transport}
	}

	probeCtx, cancel := context.WithTimeout(ctx, dryRunMediaProbeLimit)
	defer cancel()
	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, item.MediaURL, nil)
	if err != nil {
		check.Error = fmt.Sprintf("视频直链无效: %v", err)
		return check
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Range", "bytes=0-0")
	for k, v := range mediaHeaders {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		check.Error = fmt.Sprintf("视频直链请求失败: %v", err)
		return check
	}
	defer resp.Body.Close()

	check.Status = resp.StatusCode
	check.ContentType = resp.Header.Get("Content-Type")
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		// Content-Range: bytes 0-0/12345 → 取总大小
		if idx := strings.LastIndex(cr, "/"); idx >= 0 {
			var total int64
			if _, err := fmt.Sscanf(cr[idx+1:], "%d", &total); err == nil {
				check.ContentLength = total
			}
		}
	}
	if check.ContentLength == 0 && resp.StatusCode == http.StatusOK {
		check.ContentLength = resp.ContentLength
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		check.Error = fmt.Sprintf("视频直链返回 HTTP %d", resp.StatusCode)
		return check
	}
	check.OK = true
	return check
}
