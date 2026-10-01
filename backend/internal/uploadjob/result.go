// Package uploadjob contains persisted crawler upload outcomes shared by the
// worker, catalog and admin API, without depending on any of those layers.
package uploadjob

import "time"

const MaxIssues = 100

type Issue struct {
	VideoID string `json:"videoId,omitempty"`
	Title   string `json:"title,omitempty"`
	Stage   string `json:"stage"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

type Result struct {
	ParentTaskID   string    `json:"parentTaskId,omitempty"`
	AcceptedAt     time.Time `json:"acceptedAt"`
	TaskID         string    `json:"taskId"`
	DriveID        string    `json:"driveId"`
	TargetDriveID  string    `json:"targetDriveId"`
	State          string    `json:"state"`
	StartedAt      time.Time `json:"startedAt"`
	FinishedAt     time.Time `json:"finishedAt"`
	CandidateCount int       `json:"candidateCount"`
	UploadedCount  int       `json:"uploadedCount"`
	ReusedCount    int       `json:"reusedCount"`
	BlockedCount   int       `json:"blockedCount"`
	FailedCount    int       `json:"failedCount"`
	RemainingCount int       `json:"remainingCount"`
	IssueCount     int       `json:"issueCount"`
	Issues         []Issue   `json:"issues,omitempty"`
	Message        string    `json:"message,omitempty"`
}

func (r *Result) AddIssue(issue Issue) {
	r.IssueCount++
	if len(r.Issues) < MaxIssues {
		r.Issues = append(r.Issues, issue)
	}
}

func (r *Result) ProcessedCount() int {
	return r.UploadedCount + r.ReusedCount + r.BlockedCount + r.FailedCount
}
