// Package crawljob defines the durable crawler lifecycle shared by the runner,
// catalog and API. Counts belong to the backend, never to the script.
package crawljob

import "time"

type Budget struct {
	Retries        int `json:"retries"`
	RuntimeSeconds int `json:"runtimeSeconds"`
}

type Issue struct {
	VideoID      string `json:"videoId,omitempty"`
	Stage        string `json:"stage"`
	DiscoveryKey string `json:"discoveryKey,omitempty"`
	Code         string `json:"code"`
	Message      string `json:"message"`
}

type Result struct {
	ImportedVideoIDs []string         `json:"importedVideoIds,omitempty"`
	TaskID           string           `json:"taskId"`
	ParentTaskID     string           `json:"parentTaskId,omitempty"`
	DriveID          string           `json:"driveId"`
	ScriptVersion    string           `json:"scriptVersion"`
	FeedID           string           `json:"feedId,omitempty"`
	FeedLabel        string           `json:"feedLabel,omitempty"`
	State            string           `json:"state"`
	Stage            string           `json:"stage"`
	StopReason       string           `json:"stopReason,omitempty"`
	StopRequested    bool             `json:"stopRequested,omitempty"`
	AcceptedAt       time.Time        `json:"acceptedAt"`
	StartedAt        time.Time        `json:"startedAt"`
	FinishedAt       time.Time        `json:"finishedAt"`
	StageMillis      map[string]int64 `json:"stageMillis"`
	TargetNew        int              `json:"targetNew"`
	TargetReached    bool             `json:"targetReached"`
	Budget           Budget           `json:"budget"`
	Pages            int              `json:"pages"`
	Checked          int              `json:"checked"`
	Repeated         int              `json:"repeated"`
	Known            int              `json:"known"`
	Resolved         int              `json:"resolved"`
	DiscoverCalls    int              `json:"discoverCalls"`
	ResolveCalls     int              `json:"resolveCalls"`
	Retries          int              `json:"retries"`
	NewVideos        int              `json:"newVideos"`
	Duplicates       int              `json:"duplicates"`
	Failed           int              `json:"failed"`
	Issues           []Issue          `json:"issues,omitempty"`
	Message          string           `json:"message,omitempty"`
}

func (r *Result) AddIssue(issue Issue) {
	r.Failed++
	if len(r.Issues) < 100 {
		r.Issues = append(r.Issues, issue)
	}
}
