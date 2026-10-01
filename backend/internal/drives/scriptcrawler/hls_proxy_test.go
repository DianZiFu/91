package scriptcrawler

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestHLSDownloadUsesConfiguredProxyForPlaylistsSegmentsAndKeys(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is required for the HLS download integration test")
	}
	fixture := filepath.Join(t.TempDir(), "segment.ts")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=size=32x32:rate=5", "-f", "lavfi", "-i", "sine=sample_rate=8000", "-t", "1", "-c:v", "mpeg2video", "-c:a", "aac", "-f", "mpegts", fixture).CombinedOutput()
	if err != nil {
		t.Fatalf("generate video fixture: %v: %s", err, output)
	}
	segment, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	key := []byte("0123456789abcdef")
	block, _ := aes.NewCipher(key)
	padding := aes.BlockSize - len(segment)%aes.BlockSize
	segment = append(segment, bytes.Repeat([]byte{byte(padding)}, padding)...)
	cipher.NewCBCEncrypter(block, make([]byte, aes.BlockSize)).CryptBlocks(segment, segment)
	// An unrelated process proxy must not capture FFmpeg's loopback requests.
	t.Setenv("http_proxy", "http://127.0.0.1:1")
	for _, scheme := range []string{"http", "https", "socks5", "socks5h"} {
		t.Run(scheme, func(t *testing.T) {
			var mu sync.Mutex
			seen := make(map[string]int)
			serve := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture-token" || r.Header.Get("Referer") != "https://source.example/detail" || r.UserAgent() != "HLSProxyTest/1" {
					t.Errorf("source request lost media headers: %v", r.Header)
					w.WriteHeader(http.StatusForbidden)
					return
				}
				mu.Lock()
				seen[r.URL.Path]++
				mu.Unlock()
				switch r.URL.Path {
				case "/entry.m3u8":
					http.Redirect(w, r, "/dir/master.m3u8", http.StatusFound)
				case "/dir/master.m3u8":
					_, _ = io.WriteString(w, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\nvariant.m3u8\n")
				case "/dir/variant.m3u8":
					_, _ = io.WriteString(w, "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key.bin?sig=key\",IV=0x00000000000000000000000000000000\n#EXTINF:1,\n../segment.ts?sig=segment\n#EXT-X-ENDLIST\n")
				case "/key.bin":
					if r.URL.Query().Get("sig") != "key" {
						t.Error("key query was lost")
					}
					_, _ = w.Write(key)
				case "/segment.ts":
					if r.URL.Query().Get("sig") != "segment" {
						t.Error("segment query was lost")
					}
					_, _ = w.Write(segment)
				default:
					http.NotFound(w, r)
				}
			})
			origin := httptest.NewServer(serve)
			defer origin.Close()
			var proxyURL string
			var tlsConfig *tls.Config
			host := "media.invalid:1"
			if scheme == "http" || scheme == "https" {
				proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					want := "Basic " + base64.StdEncoding.EncodeToString([]byte("user:password"))
					if r.Header.Get("Proxy-Authorization") != want {
						t.Error("proxy authentication was not supplied")
					}
					serve.ServeHTTP(w, r)
				})
				var proxyServer *httptest.Server
				if scheme == "https" {
					proxyServer = httptest.NewTLSServer(proxyHandler)
					tlsConfig = proxyServer.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
				} else {
					proxyServer = httptest.NewServer(proxyHandler)
				}
				defer proxyServer.Close()
				parsed, _ := url.Parse(proxyServer.URL)
				parsed.User = url.UserPassword("user", "password")
				proxyURL = parsed.String()
			} else {
				proxyURL = startHLSTestSOCKSProxy(t, origin.Listener.Addr().String(), scheme)
				if scheme == "socks5" {
					host = "localhost:1"
				}
			}
			crawler := NewCrawler(CrawlerConfig{ProxyURL: proxyURL, FFmpegPath: ffmpeg})
			transport := crawler.cfg.HTTPClient.Transport.(*http.Transport)
			transport.TLSClientConfig = tlsConfig
			defer transport.CloseIdleConnections()
			dst := filepath.Join(t.TempDir(), "download.mp4")
			downloadCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			size, err := crawler.downloadHLSAtomic(downloadCtx, MediaRef{Type: "url", URL: "http://" + host + "/entry.m3u8", Headers: map[string]string{"Authorization": "Bearer fixture-token", "Referer": "https://source.example/detail", "User-Agent": "HLSProxyTest/1"}}, dst)
			if err != nil || size <= 0 {
				t.Fatalf("download via %s: size=%d error=%v", scheme, size, err)
			}
			probe, err := exec.CommandContext(downloadCtx, ffmpeg, "-v", "error", "-i", dst, "-f", "null", "-").CombinedOutput()
			if err != nil {
				t.Fatalf("decode downloaded video: %v: %s", err, probe)
			}
			mu.Lock()
			defer mu.Unlock()
			for _, resource := range []string{"/entry.m3u8", "/dir/master.m3u8", "/dir/variant.m3u8", "/key.bin", "/segment.ts"} {
				if seen[resource] == 0 {
					t.Errorf("%s did not pass through the configured proxy", resource)
				}
			}
		})
	}
}

// This proxy tunnels to the fixture server while checking SOCKS authentication
// and whether the client resolved the target locally or delegated DNS.
func startHLSTestSOCKSProxy(t *testing.T, origin, scheme string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
				read := func(n int) ([]byte, error) {
					data := make([]byte, n)
					_, err := io.ReadFull(conn, data)
					return data, err
				}
				header, err := read(2)
				if err != nil || header[0] != 5 {
					return
				}
				if _, err := read(int(header[1])); err != nil {
					return
				}
				_, _ = conn.Write([]byte{5, 2})
				auth, err := read(2)
				if err != nil {
					return
				}
				username, err := read(int(auth[1]))
				if err != nil {
					return
				}
				length, err := read(1)
				if err != nil {
					return
				}
				password, err := read(int(length[0]))
				if err != nil || string(username) != "user" || string(password) != "password" {
					t.Error("SOCKS proxy authentication failed")
					return
				}
				_, _ = conn.Write([]byte{1, 0})
				request, err := read(4)
				if err != nil {
					return
				}
				switch request[3] {
				case 1:
					_, err = read(4)
					if scheme != "socks5" {
						t.Error("socks5h must delegate DNS to the proxy")
					}
				case 4:
					_, err = read(16)
				case 3:
					length, lengthErr := read(1)
					if lengthErr != nil {
						return
					}
					domain, domainErr := read(int(length[0]))
					err = domainErr
					if scheme != "socks5h" || string(domain) != "media.invalid" {
						t.Errorf("unexpected proxy DNS target %q for %s", domain, scheme)
					}
				default:
					return
				}
				if err != nil {
					return
				}
				if _, err := read(2); err != nil {
					return
				}
				upstream, err := net.DialTimeout("tcp", origin, time.Second)
				if err != nil {
					return
				}
				defer upstream.Close()
				_, _ = conn.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0})
				done := make(chan struct{})
				go func() { _, _ = io.Copy(conn, upstream); close(done) }()
				_, _ = io.Copy(upstream, conn)
				_ = upstream.Close()
				<-done
			}()
		}
	}()
	return fmt.Sprintf("%s://user:password@%s", scheme, listener.Addr())
}

func TestHLSRelayPreservesHTTPSByteRangesAndInitializationMaps(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept-Encoding") != "identity" {
			t.Error("HLS resources must use the uncompressed representation")
		}
		if r.URL.Path == "/manifest.m3u8" {
			_, _ = io.WriteString(w, "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\nsegment.m4s\n#EXT-X-ENDLIST\n")
			return
		}
		if r.Header.Get("Range") != "bytes=2-4" {
			t.Errorf("byte range = %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", "bytes 2-4/6")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = io.WriteString(w, "cde")
	}))
	defer server.Close()
	input, closeRelay, _, err := startHLSRelay(context.Background(), server.Client(), MediaRef{URL: server.URL + "/manifest.m3u8", Headers: map[string]string{"Accept-Encoding": "gzip"}})
	if err != nil {
		t.Fatal(err)
	}
	defer closeRelay()
	client := &http.Client{Transport: &http.Transport{}}
	defer client.CloseIdleConnections()
	response, err := client.Get(input)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	lines := strings.Split(string(body), "\n")
	_, attribute, ok := strings.Cut(lines[1], `URI="`)
	initializationMap, _, quoted := strings.Cut(attribute, `"`)
	if !ok || !quoted || strings.Contains(string(body), server.URL) {
		t.Fatalf("initialization map was not relayed: %s", body)
	}
	for _, resource := range []string{initializationMap, lines[3]} {
		req, _ := http.NewRequest(http.MethodGet, resource, nil)
		req.Header.Set("Range", "bytes=2-4")
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if response.StatusCode != http.StatusPartialContent || response.Header.Get("Content-Range") != "bytes 2-4/6" || string(data) != "cde" {
			t.Fatalf("range response: %d %v %q", response.StatusCode, response.Header, data)
		}
	}
}

func TestHLSDownloadProxyFailureDoesNotFallBackToDirect(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is required for the HLS download integration test")
	}
	var directRequests atomic.Int32
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		directRequests.Add(1)
		_, _ = io.WriteString(w, "#EXTM3U\n#EXT-X-ENDLIST\n")
	}))
	defer origin.Close()
	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	proxyURL := "http://" + proxyListener.Addr().String()
	_ = proxyListener.Close()
	crawler := NewCrawler(CrawlerConfig{ProxyURL: proxyURL, FFmpegPath: ffmpeg})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	dst := filepath.Join(t.TempDir(), "video.mp4")
	_, err = crawler.downloadHLSAtomic(ctx, MediaRef{URL: origin.URL + "/video.m3u8?token=hls-secret"}, dst)
	if err == nil || directRequests.Load() != 0 {
		t.Fatalf("proxy failure: error=%v direct requests=%d", err, directRequests.Load())
	}
	if strings.Contains(err.Error(), "hls-secret") {
		t.Fatal("download error exposed the signed source URL")
	}
	for _, filename := range []string{dst, dst + ".part"} {
		if _, err := os.Stat(filename); !os.IsNotExist(err) {
			t.Errorf("failed download left %s: %v", filename, err)
		}
	}
}

func TestHLSRelayCancellationStopsUpstreamAndClosesListener(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan struct{})
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(stopped)
	}))
	defer origin.Close()
	client := &http.Client{Transport: &http.Transport{}, Timeout: 3 * time.Second}
	defer client.CloseIdleConnections()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	input, closeRelay, _, err := startHLSRelay(ctx, client, MediaRef{URL: origin.URL + "/video.m3u8"})
	if err != nil {
		t.Fatal(err)
	}
	defer closeRelay()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		if response, err := client.Get(input); err == nil {
			_ = response.Body.Close()
		}
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("upstream request did not start")
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("cancellation did not reach the upstream request")
	}
	closeRelay()
	<-finished
	if response, err := client.Get(input); err == nil {
		_ = response.Body.Close()
		t.Fatal("relay listener remained open after closing")
	}
}
