// Package driveevents carries committed catalog changes and runtime transitions.
// Consumers decide how these facts affect their own projections.
package driveevents

import "sync"

type Kind uint8

const (
	DriveChanged Kind = iota
	DriveMetadataChanged
	ScanResultChanged
	MediaChanged
	GenerationChanged
	AssetPathsChanged
	ActivityChanged
)

type Change struct {
	Kinds map[Kind]bool // true requests prompt delivery
}

// Hub merges bursts without blocking catalog or worker updates. An empty drive
// ID denotes a change that can affect all drives, such as deduplication.
type Hub struct {
	mu          sync.Mutex
	sequence    uint64
	versions    map[string]map[Kind]uint64
	subscribers map[*Subscription]struct{}
}

type Subscription struct {
	hub     *Hub
	driveID string
	Wake    chan struct{}
	pending map[Kind]bool
}

func (h *Hub) Notify(driveID string, immediate bool, kinds ...Kind) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.versions == nil {
		h.versions = make(map[string]map[Kind]uint64)
	}
	if h.versions[driveID] == nil {
		h.versions[driveID] = make(map[Kind]uint64)
	}
	h.sequence++
	for _, kind := range kinds {
		h.versions[driveID][kind] = h.sequence
	}
	for sub := range h.subscribers {
		if driveID != "" && driveID != sub.driveID {
			continue
		}
		for _, kind := range kinds {
			sub.pending[kind] = sub.pending[kind] || immediate
		}
		select {
		case sub.Wake <- struct{}{}:
		default:
		}
	}
}

func (h *Hub) Version(driveID string, kinds ...Kind) uint64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	var version uint64
	for _, kind := range kinds {
		version = max(version, h.versions[driveID][kind], h.versions[""][kind])
	}
	return version
}

func (h *Hub) Subscribe(driveID string) *Subscription {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subscribers == nil {
		h.subscribers = make(map[*Subscription]struct{})
	}
	sub := &Subscription{hub: h, driveID: driveID, Wake: make(chan struct{}, 1), pending: make(map[Kind]bool)}
	h.subscribers[sub] = struct{}{}
	return sub
}

func (s *Subscription) Take() Change {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	change := Change{Kinds: s.pending}
	s.pending = make(map[Kind]bool)
	return change
}

func (s *Subscription) Close() {
	s.hub.mu.Lock()
	delete(s.hub.subscribers, s)
	s.hub.mu.Unlock()
}
