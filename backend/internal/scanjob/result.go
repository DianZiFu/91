// Package scanjob defines the compact scan outcome shared by orchestration,
// persistence, and the admin API. It contains no discovery or runtime state.
package scanjob

import "time"

type State string

const (
	Succeeded State = "succeeded"
	Partial   State = "partial"
	Failed    State = "failed"
	Canceled  State = "canceled"
	Skipped   State = "skipped"
)

type Issue struct {
	Stage   string `json:"stage"`
	Message string `json:"message"`
}

type Result struct {
	DriveID         string    `json:"driveId"`
	State           State     `json:"state"`
	StartedAt       time.Time `json:"startedAt"`
	FinishedAt      time.Time `json:"finishedAt"`
	ScannedCount    int       `json:"scannedCount"`
	AddedCount      int       `json:"addedCount"`
	UpdatedCount    int       `json:"updatedCount"`
	DuplicateCount  int       `json:"duplicateCount"`
	TombstonedCount int       `json:"tombstonedCount"`
	CleanedCount    int       `json:"cleanedCount"`
	ErrorCount      int       `json:"errorCount"`
	Message         string    `json:"message,omitempty"`
	Issues          []Issue   `json:"issues,omitempty"`
}

// AddIssue bounds retained details while preserving the complete error count.
func (r *Result) AddIssue(stage string, err error) {
	if err == nil {
		return
	}
	r.ErrorCount++
	if len(r.Issues) < 20 {
		r.Issues = append(r.Issues, Issue{Stage: stage, Message: err.Error()})
	}
}
