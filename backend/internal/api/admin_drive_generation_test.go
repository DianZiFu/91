package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestDriveGenerationRoutesReportActualOutcomes(t *testing.T) {
	for _, kind := range []DriveGenerationKind{DriveGenerationThumbnails, DriveGenerationPreviews, DriveGenerationFingerprints} {
		for _, state := range []string{"started", "busy", "ready"} {
			t.Run(string(kind)+"/"+state, func(t *testing.T) {
				server, router := newDriveSnapshotServer(t)
				want := DriveGenerationResult{State: state, Message: "generation result"}
				server.OnDriveGenerationRequested = func(ctx context.Context, driveID string, gotKind DriveGenerationKind) (DriveGenerationResult, error) {
					if ctx == nil || driveID != "a" || gotKind != kind {
						t.Fatalf("request = %q/%q", driveID, gotKind)
					}
					return want, nil
				}
				req := httptest.NewRequest(http.MethodPost, "/admin/api/drives/a/"+string(kind)+"/generate", nil)
				req.AddCookie(&http.Cookie{Name: "vs_admin", Value: "admin-token"})
				response := httptest.NewRecorder()
				router.ServeHTTP(response, req)
				status := http.StatusOK
				if state == "started" {
					status = http.StatusAccepted
				}
				var got DriveGenerationResult
				if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil || response.Code != status || got != want {
					t.Fatalf("response = %d %s, err=%v", response.Code, response.Body.String(), err)
				}
			})
		}
	}
}

func TestDriveGenerationDoesNotAcknowledgeUnavailableOrFailedRequests(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		hook   bool
		status int
	}{
		{"unavailable", nil, false, http.StatusServiceUnavailable},
		{"missing drive", sql.ErrNoRows, true, http.StatusNotFound},
		{"failed preparation", errors.New("cannot prepare generation"), true, http.StatusInternalServerError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := &AdminServer{}
			if tc.hook {
				server.OnDriveGenerationRequested = func(context.Context, string, DriveGenerationKind) (DriveGenerationResult, error) {
					return DriveGenerationResult{}, tc.err
				}
			}
			router := chi.NewRouter()
			router.Post("/drives/{id}/thumbnails/generate", server.handleGenerateDriveThumbnails)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/drives/a/thumbnails/generate", nil))
			if response.Code != tc.status {
				t.Fatalf("response = %d %s", response.Code, response.Body.String())
			}
		})
	}
}
