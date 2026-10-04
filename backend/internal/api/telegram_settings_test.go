package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/video-site/backend/internal/config"
	"github.com/video-site/backend/internal/telegram"
)

func TestTelegramAvailabilityReadsSavedConfigWithoutRuntimeService(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("{}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	manager, err := config.NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	server := &AdminServer{ConfigManager: manager}
	for _, enabled := range []bool{true, false} {
		body := "telegram: {enabled: false}\n"
		if enabled {
			body = "telegram: {enabled: true, bot_token: '123:private_token'}\n"
		}
		if _, err := manager.ReplaceYAML([]byte(body), ""); err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		server.handleTelegramAvailability(response, httptest.NewRequest(http.MethodGet, "/admin/api/telegram/availability", nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("response = %d, headers=%v", response.Code, response.Header())
		}
		var availability map[string]bool
		if err := json.Unmarshal(response.Body.Bytes(), &availability); err != nil {
			t.Fatal(err)
		}
		if len(availability) != 1 || availability["enabled"] != enabled {
			t.Fatalf("availability = %v, want enabled=%v only", availability, enabled)
		}
	}
}

func TestTelegramSettingsUseSharedYAMLAPI(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("{}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	manager, err := config.NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	cat := openRemoteUploadAPICatalog(t)
	integration := telegram.NewIntegration(cat, manager, t.TempDir(), 1)
	server := &AdminServer{Catalog: cat, ConfigManager: manager, Telegram: integration}
	token := "123:private_token"
	body := "telegram:\n  enabled: true\n  bot_token: " + token + "\n"
	response := httptest.NewRecorder()
	server.handlePutConfigYAML(response, httptest.NewRequest("PUT", "/admin/api/config.yaml", strings.NewReader(body)))
	if response.Code != 200 || strings.Contains(response.Body.String(), `"restartRequired":true`) {
		t.Fatal("save failed", response.Code)
	}
	var saved config.SaveResult
	if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil || !saved.Settings.TelegramEnabled {
		t.Fatal("save response must expose the persisted enable flag", err)
	}
	response = httptest.NewRecorder()
	server.handleGetConfigYAML(response, httptest.NewRequest("GET", "/admin/api/config.yaml", nil))
	if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" || response.Body.String() != body {
		t.Fatal("YAML did not return saved values")
	}
	response = httptest.NewRecorder()
	server.handleTelegramStatus(response, httptest.NewRequest("GET", "/admin/api/telegram/status", nil))
	var status struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil || !status.Enabled {
		t.Fatal("navigation must follow saved config even before the integration connects", err)
	}
	for _, hidden := range []string{token, "apiFilesRoot", "localFilesRoot"} {
		if strings.Contains(response.Body.String(), hidden) {
			t.Fatal("status exposes credentials or storage paths")
		}
	}
	response = httptest.NewRecorder()
	server.handlePutConfigYAML(response, httptest.NewRequest("PUT", "/admin/api/config.yaml", strings.NewReader("telegram: { enabled: false }\n")))
	if response.Code != 200 {
		t.Fatal("disable failed", response.Code)
	}
	response = httptest.NewRecorder()
	server.handleTelegramStatus(response, httptest.NewRequest("GET", "/admin/api/telegram/status", nil))
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil || status.Enabled {
		t.Fatal("disabled Telegram must hide navigation", err)
	}
}
