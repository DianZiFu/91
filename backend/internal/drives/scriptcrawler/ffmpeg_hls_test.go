package scriptcrawler

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestParseFFmpegHLSCapabilities(t *testing.T) {
	tests := []struct {
		name string
		help string
		want ffmpegHLSCapabilities
	}{
		{
			name: "original 6.1",
			help: "  -allowed_extensions <string> .D.........\n",
		},
		{
			name: "extension picky backport",
			help: "  -allowed_extensions <string> .D.........\n  -extension_picky <boolean> .D.........\n",
			want: ffmpegHLSCapabilities{extensionPicky: true},
		},
		{
			name: "patched and current releases",
			help: "  -allowed_extensions <string> .D.........\n  -allowed_segment_extensions <string> .D.........\n  -extension_picky <boolean> .D.........\n",
			want: ffmpegHLSCapabilities{allowedSegmentExtensions: true, extensionPicky: true},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseFFmpegHLSCapabilities(tt.help); got != tt.want {
				t.Fatalf("capabilities = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestBuildFFmpegHLSInputOptionsUsesSupportedFlagsOnly(t *testing.T) {
	tests := []struct {
		name       string
		caps       ffmpegHLSCapabilities
		want       []string
		unexpected []string
	}{
		{
			name:       "legacy",
			want:       []string{"-protocol_whitelist", "-allowed_extensions"},
			unexpected: []string{"-allowed_segment_extensions", "-extension_picky"},
		},
		{
			name:       "extension picky only",
			caps:       ffmpegHLSCapabilities{extensionPicky: true},
			want:       []string{"-protocol_whitelist", "-allowed_extensions", "-extension_picky"},
			unexpected: []string{"-allowed_segment_extensions"},
		},
		{
			name: "modern",
			caps: ffmpegHLSCapabilities{allowedSegmentExtensions: true, extensionPicky: true},
			want: []string{"-protocol_whitelist", "-allowed_extensions", "-allowed_segment_extensions", "-extension_picky"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := buildFFmpegHLSInputOptions(tt.caps)
			for _, want := range tt.want {
				if !slices.Contains(args, want) {
					t.Fatalf("args = %#v, missing %q", args, want)
				}
			}
			for _, unexpected := range tt.unexpected {
				if slices.Contains(args, unexpected) {
					t.Fatalf("args = %#v, unexpectedly contains %q", args, unexpected)
				}
			}
		})
	}
}

func TestCrawlerFFmpegHLSInputOptionsCachesLegacyCapabilities(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("GO_SCRIPTCRAWLER_FFMPEG_HLS_HELP", "  -allowed_extensions <string> .D.........")
	c := NewCrawler(CrawlerConfig{FFmpegPath: writeScriptCrawlerFFmpegStub(t, tmp)})

	first := c.ffmpegHLSInputOptions(context.Background())
	if slices.Contains(first, "-allowed_segment_extensions") || slices.Contains(first, "-extension_picky") {
		t.Fatalf("legacy args = %#v, want no unsupported flags", first)
	}

	// A crawler is long-lived per drive. Changing the executable's reported
	// help must not trigger a subprocess for every imported HLS item.
	t.Setenv("GO_SCRIPTCRAWLER_FFMPEG_HLS_HELP", "  -allowed_segment_extensions <string> .D.........\n  -extension_picky <boolean> .D.........")
	second := c.ffmpegHLSInputOptions(context.Background())
	if slices.Contains(second, "-allowed_segment_extensions") || slices.Contains(second, "-extension_picky") {
		t.Fatalf("cached legacy args = %#v, want original capabilities", second)
	}
}

func TestCrawlerFFmpegHLSInputOptionsFallsBackWhenProbeFails(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("GO_SCRIPTCRAWLER_FFMPEG_HELP_FAIL", "1")
	c := NewCrawler(CrawlerConfig{FFmpegPath: writeScriptCrawlerFFmpegStub(t, tmp)})

	args := c.ffmpegHLSInputOptions(context.Background())
	if !slices.Contains(args, "-allowed_extensions") {
		t.Fatalf("fallback args = %#v, want baseline HLS option", args)
	}
	if slices.Contains(args, "-allowed_segment_extensions") || slices.Contains(args, "-extension_picky") {
		t.Fatalf("fallback args = %#v, want no unverified optional flags", args)
	}
}

func TestDownloadHLSAtomicUsesLegacyCompatibleFFmpegArgs(t *testing.T) {
	tmp := t.TempDir()
	argsFile := filepath.Join(tmp, "ffmpeg-args.txt")
	t.Setenv("GO_SCRIPTCRAWLER_FFMPEG_HLS_HELP", "  -allowed_extensions <string> .D.........")
	t.Setenv("GO_SCRIPTCRAWLER_FFMPEG_ARGS_FILE", argsFile)
	c := NewCrawler(CrawlerConfig{FFmpegPath: writeScriptCrawlerFFmpegStub(t, tmp)})

	dst := filepath.Join(tmp, "video.mp4")
	size, err := c.downloadHLSAtomic(context.Background(), MediaRef{Type: "url", URL: "https://example.com/video.m3u8"}, dst)
	if err != nil {
		t.Fatalf("download HLS: %v", err)
	}
	if size != int64(len("hls-video-bytes")) {
		t.Fatalf("download size = %d, want %d", size, len("hls-video-bytes"))
	}
	rawArgs, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read ffmpeg args: %v", err)
	}
	args := strings.Split(strings.TrimSpace(string(rawArgs)), "\n")
	if !slices.Contains(args, "-allowed_extensions") {
		t.Fatalf("legacy ffmpeg args = %#v, missing baseline option", args)
	}
	if slices.Contains(args, "-allowed_segment_extensions") || slices.Contains(args, "-extension_picky") {
		t.Fatalf("legacy ffmpeg args = %#v, contain unsupported options", args)
	}
}
