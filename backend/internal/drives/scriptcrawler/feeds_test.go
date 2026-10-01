package scriptcrawler

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
)

const testFeedsDeclaration = `CRAWLER_FEEDS = '[{"id":"latest","label":"最新","default":true},{"id":"hot","label":"最热"}]'
`

func TestMetadataFeedsAndSelection(t *testing.T) {
	const header = "CRAWLER_NAME = 'Feeds'\nCRAWLER_PROTOCOL = 'crawler.v3'\n"
	meta, err := ExtractMetadata(header + testFeedsDeclaration + "raise RuntimeError('must not execute metadata')\n")
	if err != nil || len(meta.Feeds) != 2 {
		t.Fatalf("metadata=%+v err=%v", meta, err)
	}
	for selected, expected := range map[string]string{"": "latest", "latest": "latest", "hot": "hot"} {
		feed, err := meta.ResolveFeed(selected)
		if err != nil || feed.ID != expected {
			t.Fatalf("selection=%q feed=%+v err=%v", selected, feed, err)
		}
	}
	if _, err := meta.ResolveFeed("removed"); err == nil {
		t.Fatal("unknown selection silently used the default")
	}
	meta, err = ExtractMetadata(header + "def nested():\n    " + testFeedsDeclaration)
	if err != nil || len(meta.Feeds) != 1 || meta.Feeds[0].ID != "default" || !meta.Feeds[0].Default {
		t.Fatalf("implicit default=%+v err=%v", meta, err)
	}
	for _, source := range []string{
		header + testFeedsDeclaration + testFeedsDeclaration,
		header + strings.Repeat("# filler\n", maxMetadataPreambleLines) + testFeedsDeclaration,
		header + "CRAWLER_FEEDS = make_feeds()\n",
	} {
		if _, err := ExtractMetadata(source); err == nil || !strings.Contains(err.Error(), "CRAWLER_FEEDS") {
			t.Fatalf("accepted invalid declaration: %v", err)
		}
	}
}

func TestMetadataRejectsInvalidFeeds(t *testing.T) {
	for _, raw := range []string{
		`[]`, `null`, `{}`, `[null]`,
		`[{"id":"latest","label":"最新"}]`,
		`[{"id":"latest","label":"最新","default":true},{"id":"hot","label":"最热","default":true}]`,
		`[{"id":"latest","label":"最新","default":true},{"id":"latest","label":"另一个"}]`,
		`[{"id":"with spaces","label":"最新","default":true}]`,
		`[{"id":"最新","label":"最新","default":true}]`,
		`[{"id":"latest","label":" ","default":true}]`,
		`[{"id":"latest","label":"最新\n","default":true}]`,
		`[{"id":"latest","label":"最新","default":"true"}]`,
		`[{"id":"latest","label":"最新","default":null}]`,
		`[{"id":"latest","label":"最新","default":true,"extra":1}]`,
		`[{"id":"latest","id":"hot","label":"最新","default":true}]`,
		`[{"id":"` + strings.Repeat("a", 65) + `","label":"最新","default":true}]`,
		`[{"id":"latest","label":"` + strings.Repeat("新", 81) + `","default":true}]`,
		strings.Repeat(" ", 64*1024+1),
	} {
		if _, err := parseFeeds(raw); err == nil {
			t.Fatalf("accepted invalid feeds: %.200s", raw)
		}
	}
}

func TestCrawlerFeedSnapshotAndSharedIdentity(t *testing.T) {
	mediaURL := serveScriptCrawlerMedia(t, "video")
	body := testFeedsDeclaration + fmt.Sprintf(`c=read()
send(c,"page",items=[dict(discovery_key="one",source_id="one",locator={})],next_cursor=None)
c=read()
if c["type"] == "resolve":
    send(c,"item",discovery_key="one",source_id="one",title=job["feed_id"],media=dict(type="url",url=%q))
    stop()
else:
    assert c["type"] == "stop"
    send(c,"stopped")
`, mediaURL)
	c := newRuntimeTestCrawler(t, body, ProtocolV3, func(cfg *CrawlerConfig) { cfg.FeedID = "hot" })
	source, err := os.ReadFile(c.cfg.ScriptPath)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	task, err := c.Prepare(ctx, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	c.cfg.FeedID = "latest"
	if err := os.WriteFile(c.cfg.ScriptPath, []byte("raise RuntimeError('replaced script')\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := c.RunTask(ctx, task, nil)
	if err != nil || result.NewVideos != 1 || result.FeedID != "hot" || result.FeedLabel != "最热" {
		t.Fatalf("snapshot result=%+v err=%v", result, err)
	}
	video, err := c.cfg.Catalog.GetVideo(ctx, importVideoID(c.cfg.Driver.ID(), "one"))
	if err != nil || video.Title != "hot" {
		t.Fatalf("script did not receive snapshot feed: %+v %v", video, err)
	}
	stored, err := c.cfg.Catalog.GetCrawlerTask(ctx, c.cfg.Driver.ID(), result.TaskID)
	if err != nil || stored.FeedID != "hot" || stored.FeedLabel != "最热" {
		t.Fatalf("stored feed=%+v err=%v", stored, err)
	}
	if err := os.WriteFile(c.cfg.ScriptPath, source, 0o600); err != nil {
		t.Fatal(err)
	}
	result, err = c.RunOnce(ctx, 1)
	if err != nil || result.FeedID != "latest" || result.NewVideos != 0 || result.Known != 1 || result.ResolveCalls != 0 {
		t.Fatalf("identity changed across feeds: %+v %v", result, err)
	}
}

func TestCrawlerAndDryRunRejectRemovedFeedBeforeExecution(t *testing.T) {
	c := newRuntimeTestCrawler(t, testFeedsDeclaration+"raise RuntimeError('must not run')", ProtocolV3, func(cfg *CrawlerConfig) { cfg.FeedID = "removed" })
	if _, err := c.Prepare(context.Background(), 1, ""); err == nil || !strings.Contains(err.Error(), "不支持抓取栏目") {
		t.Fatalf("prepare accepted removed feed: %v", err)
	}
	result := DryRun(context.Background(), DryRunConfig{ScriptPath: c.cfg.ScriptPath, FeedID: "removed"})
	if result.OK || !strings.Contains(result.Error, "不支持抓取栏目") {
		t.Fatalf("dry run accepted removed feed: %+v", result)
	}
}

func TestDryRunReceivesSelectedOrDefaultFeed(t *testing.T) {
	body := testFeedsDeclaration + `c=read();send(c,"page",items=[dict(discovery_key="one",locator={})],next_cursor=None)
c=read();send(c,"item",discovery_key="one",source_id="one",title=job["feed_id"],media=dict(type="url",url="https://example.com/video.mp4"))
stop()
`
	for selected, expected := range map[string]string{"hot": "hot", "": "latest"} {
		result := DryRun(context.Background(), DryRunConfig{ScriptPath: writeDryRunScript(t, body), FeedID: selected, SkipMediaProbe: true})
		if !result.OK || result.FeedID != expected || len(result.Items) != 1 || result.Items[0].Title != expected {
			t.Fatalf("selection=%q result=%+v", selected, result)
		}
	}
}
