package scriptcrawler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeDryRunScript(t *testing.T, body string) string {
	t.Helper()
	script := filepath.Join(t.TempDir(), "crawler.py")
	if err := os.WriteFile(script, []byte("CRAWLER_NAME = 'Dry run'\nCRAWLER_PROTOCOL = 'crawler.v3'\n"+pythonSessionPrelude+body), 0o600); err != nil {
		t.Fatal(err)
	}
	return script
}
func dryRunURLScript(url string) string {
	return fmt.Sprintf(`c=read(); send(c,"page",items=[dict(discovery_key="one",source_id="123",locator={})],next_cursor=None)
c=read(); send(c,"item",discovery_key="one",source_id="123",title="Test Video",media=dict(type="url",url=%q,headers={"X-Test":"media"}))
print("diagnostic",file=sys.stderr,flush=True)
stop()
`, url)
}
func TestDryRunUsesProductionSessionAndMediaProbe(t *testing.T) {
	for _, status := range []int{200, 403} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Range") != "bytes=0-0" || r.Header.Get("X-Test") != "media" {
					t.Error("missing media headers")
				}
				w.Header().Set("Content-Type", "video/mp4")
				w.WriteHeader(status)
			}))
			defer server.Close()
			result := DryRun(context.Background(), DryRunConfig{ScriptPath: writeDryRunScript(t, dryRunURLScript(server.URL)), HTTPClient: server.Client()})
			if result.OK != (status == 200) || len(result.Items) != 1 || result.MediaCheck == nil || result.MediaCheck.Status != status || len(result.Log) == 0 {
				t.Fatalf("%+v", result)
			}
			if status == 200 && strings.Join(result.Validated, ",") != "protocol,media_probe" {
				t.Fatalf("scope: %v", result.Validated)
			}
		})
	}
}
func TestDryRunDoesNotClearErrorsAfterReceivingItem(t *testing.T) {
	script := writeDryRunScript(t, strings.Replace(dryRunURLScript("https://example.com/video"), "stop()", "stop(); print('bad output',flush=True)", 1))
	result := DryRun(context.Background(), DryRunConfig{ScriptPath: script, SkipMediaProbe: true})
	if result.OK || len(result.Items) != 1 || !strings.Contains(result.Error, "after stopped") {
		t.Fatalf("%+v", result)
	}
}
func TestDryRunAndProductionRejectSameInvalidItem(t *testing.T) {
	body := `c=read(); send(c,"page",items=[dict(discovery_key="one",source_id="123",locator={})],next_cursor=None)
c=read(); send(c,"item",discovery_key="one",source_id="other",title="Changed",media=dict(type="url",url="https://example.com/video"))`
	dry := DryRun(context.Background(), DryRunConfig{ScriptPath: writeDryRunScript(t, body), SkipMediaProbe: true})
	crawler := newRuntimeTestCrawler(t, body, ProtocolV3, nil)
	_, err := crawler.RunOnce(context.Background(), 1)
	if err == nil || dry.OK || dry.Error != err.Error() {
		t.Fatalf("dry=%+v production=%v", dry, err)
	}
}
func TestDryRunAndProductionRejectFileMedia(t *testing.T) {
	for _, fields := range []string{
		`media=dict(type="file",path="/tmp/video.mp4")`,
		`media=dict(type="file",url="https://example.com/video.mp4")`,
		`media=dict(type="url",url="https://example.com/video.mp4",path="/tmp/video.mp4")`,
		`media=dict(type="url",url="https://example.com/video.mp4"),thumbnail=dict(type="file",path="/tmp/thumb.jpg")`,
	} {
		t.Run(fields, func(t *testing.T) {
			body := `c=read();send(c,"page",items=[dict(discovery_key="one",locator={})],next_cursor=None)
c=read();send(c,"item",discovery_key="one",source_id="one",title="Removed mode",` + fields + `)
`
			dry := DryRun(context.Background(), DryRunConfig{ScriptPath: writeDryRunScript(t, body), SkipMediaProbe: true})
			crawler := newRuntimeTestCrawler(t, body, ProtocolV3, nil)
			result, err := crawler.RunOnce(context.Background(), 1)
			if err == nil || dry.OK || dry.Error != err.Error() || result.StopReason != "protocol_error" {
				t.Fatalf("dry=%+v production=%+v error=%v", dry, result, err)
			}
		})
	}
}
func TestDryRunTimeoutAndOutputBound(t *testing.T) {
	for _, cfg := range []DryRunConfig{{ScriptPath: writeDryRunScript(t, `time.sleep(30)`), Timeout: 60 * time.Millisecond, StopGrace: time.Millisecond}, {ScriptPath: writeDryRunScript(t, `read(); print("x"*1000,flush=True)`), MaxStdoutBytes: 128}} {
		r := DryRun(context.Background(), cfg)
		if r.OK || r.Error == "" {
			t.Fatalf("%+v", r)
		}
	}
}

func TestMediaHeadersAreIndependentAndDoNotInheritDetailURL(t *testing.T) {
	received := make(chan http.Header, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received <- r.Header.Clone()
		_, _ = w.Write([]byte("media"))
	}))
	defer server.Close()
	cfg := DryRunConfig{HTTPClient: server.Client()}
	item := DryRunItem{MediaURL: server.URL, DetailURL: "https://example.com/detail"}
	if check := probeMediaURL(context.Background(), cfg, item, map[string]string{"X-Video": "video"}); !check.OK {
		t.Fatal(check)
	}
	c := NewCrawler(CrawlerConfig{HTTPClient: server.Client()})
	if _, err := c.downloadAtomic(context.Background(), MediaRef{Type: "url", URL: server.URL, Headers: map[string]string{"X-Thumbnail": "thumbnail"}}, filepath.Join(t.TempDir(), "thumb.jpg")); err != nil {
		t.Fatal(err)
	}
	video, thumbnail := <-received, <-received
	if video.Get("Referer") != "" || thumbnail.Get("Referer") != "" || video.Get("X-Thumbnail") != "" || thumbnail.Get("X-Video") != "" {
		t.Fatalf("headers leaked: video=%v thumbnail=%v", video, thumbnail)
	}
}

func TestDryRunProbesBeforeStoppingSession(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "stopped")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(marker); !os.IsNotExist(err) {
			t.Errorf("script stopped before media probe: %v", err)
		}
		w.Header().Set("Content-Type", "video/mp4")
		fmt.Fprint(w, "video")
	}))
	defer server.Close()
	script := writeDryRunScript(t, fmt.Sprintf(`c=read();send(c,"page",items=[dict(discovery_key="one",locator={})],next_cursor=None)
c=read();send(c,"item",discovery_key="one",source_id="one",title="Video",media=dict(type="url",url=%q))
stop();open(%q,"w").write("stopped")
`, server.URL, marker))
	result := DryRun(context.Background(), DryRunConfig{ScriptPath: script})
	if !result.OK {
		t.Fatalf("media probe failed: %+v", result)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("script did not stop: %v", err)
	}
}
