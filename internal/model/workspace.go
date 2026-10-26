package model

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// Supported Workspace Layout Presets
const (
	LayoutSingle   = "single"      // 1x1 full single pane
	LayoutSplitV   = "split-v"     // 1x2 two vertical columns
	LayoutSplitH   = "split-h"     // 2x1 two horizontal rows
	Layout2Top1Bot = "2-top-1-bot" // 2 top terminals side-by-side + 1 bottom wide terminal
	Layout1Top2Bot = "1-top-2-bot" // 1 top wide terminal + 2 bottom terminals side-by-side
	LayoutGrid4    = "grid-4"      // 2x2 four quadrant grid
	Layout3Cols    = "3-cols"      // 3 equal vertical columns
)

// TabSession represents a live session tab hosted inside a Pane.
type TabSession struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Profile     SessionProfile `json:"profile"`
	IsConnected bool           `json:"isConnected"`
	IsLocal     bool           `json:"isLocal"`
	CreatedAt   string         `json:"createdAt"`
}

// Pane represents an independent terminal view window containing one or more tabs.
type Pane struct {
	ID          string        `json:"id"`
	Title       string        `json:"title,omitempty"`
	ActiveTabID string        `json:"activeTabId"`
	Tabs        []*TabSession `json:"tabs"`
	Row         int           `json:"row"`
	Col         int           `json:"col"`
	RowSpan     int           `json:"rowSpan"`
	ColSpan     int           `json:"colSpan"`
	Maximized   bool          `json:"maximized,omitempty"`
}

// Workspace represents the top-level workspace layout holding one or more panes.
type Workspace struct {
	mu           sync.RWMutex  `json:"-"`
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Layout       string        `json:"layout"`
	ActivePaneID string        `json:"activePaneId"`
	Panes        []*Pane       `json:"panes"`
}

// NewWorkspace initializes a fresh workspace with a single primary pane.
func NewWorkspace(id, name string) *Workspace {
	if id == "" {
		id = fmt.Sprintf("ws-%d", time.Now().UnixNano())
	}
	if name == "" {
		name = "Default Workspace"
	}

	initialPaneID := "pane-1"
	ws := &Workspace{
		ID:           id,
		Name:         name,
		Layout:       LayoutSingle,
		ActivePaneID: initialPaneID,
		Panes: []*Pane{
			{
				ID:          initialPaneID,
				Title:       "Terminal 1",
				ActiveTabID: "",
				Tabs:        make([]*TabSession, 0),
				Row:         1,
				Col:         1,
				RowSpan:     1,
				ColSpan:     1,
			},
		},
	}
	return ws
}

// GetState returns a snapshot of the workspace with thread-safety.
func (w *Workspace) GetState() Workspace {
	w.mu.RLock()
	defer w.mu.RUnlock()

	panesCopy := make([]*Pane, len(w.Panes))
	for i, p := range w.Panes {
		tabsCopy := make([]*TabSession, len(p.Tabs))
		copy(tabsCopy, p.Tabs)
		pCopy := *p
		pCopy.Tabs = tabsCopy
		panesCopy[i] = &pCopy
	}

	return Workspace{
		ID:           w.ID,
		Name:         w.Name,
		Layout:       w.Layout,
		ActivePaneID: w.ActivePaneID,
		Panes:        panesCopy,
	}
}

// SetLayout updates the workspace layout preset and re-calculates pane grid positions.
func (w *Workspace) SetLayout(layout string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	switch layout {
	case LayoutSingle, LayoutSplitV, LayoutSplitH, Layout2Top1Bot, Layout1Top2Bot, LayoutGrid4, Layout3Cols:
		w.Layout = layout
	default:
		return fmt.Errorf("unsupported layout preset: %s", layout)
	}

	w.ensureRequiredPanesForLayout()
	w.recalculateGridPositions()
	return nil
}

// ensureRequiredPanesForLayout creates additional panes if the chosen layout requires more than currently exist.
func (w *Workspace) ensureRequiredPanesForLayout() {
	requiredCount := 1
	switch w.Layout {
	case LayoutSingle:
		requiredCount = 1
	case LayoutSplitV, LayoutSplitH:
		requiredCount = 2
	case Layout2Top1Bot, Layout1Top2Bot, Layout3Cols:
		requiredCount = 3
	case LayoutGrid4:
		requiredCount = 4
	}

	for len(w.Panes) < requiredCount {
		newPaneID := w.nextPaneIDLocked()
		w.Panes = append(w.Panes, &Pane{
			ID:          newPaneID,
			Title:       fmt.Sprintf("Terminal %d", len(w.Panes)+1),
			ActiveTabID: "",
			Tabs:        make([]*TabSession, 0),
		})
	}

	// Validate active pane ID
	if !w.hasPane(w.ActivePaneID) && len(w.Panes) > 0 {
		w.ActivePaneID = w.Panes[0].ID
	}
}

// recalculateGridPositions computes row/col and rowSpan/colSpan for each pane based on the active layout.
func (w *Workspace) recalculateGridPositions() {
	switch w.Layout {
	case LayoutSingle:
		for i, p := range w.Panes {
			if i == 0 {
				p.Row, p.Col, p.RowSpan, p.ColSpan = 1, 1, 1, 1
			} else {
				p.Row, p.Col, p.RowSpan, p.ColSpan = 0, 0, 0, 0
			}
		}

	case LayoutSplitV: // 1 row, 2 cols
		if len(w.Panes) >= 1 {
			w.Panes[0].Row, w.Panes[0].Col, w.Panes[0].RowSpan, w.Panes[0].ColSpan = 1, 1, 1, 1
		}
		if len(w.Panes) >= 2 {
			w.Panes[1].Row, w.Panes[1].Col, w.Panes[1].RowSpan, w.Panes[1].ColSpan = 1, 2, 1, 1
		}

	case LayoutSplitH: // 2 rows, 1 col
		if len(w.Panes) >= 1 {
			w.Panes[0].Row, w.Panes[0].Col, w.Panes[0].RowSpan, w.Panes[0].ColSpan = 1, 1, 1, 1
		}
		if len(w.Panes) >= 2 {
			w.Panes[1].Row, w.Panes[1].Col, w.Panes[1].RowSpan, w.Panes[1].ColSpan = 2, 1, 1, 1
		}

	case Layout2Top1Bot: // 2 rows, 2 cols: Top left (1,1), Top right (1,2), Bottom wide (2,1 span 2)
		if len(w.Panes) >= 1 {
			w.Panes[0].Row, w.Panes[0].Col, w.Panes[0].RowSpan, w.Panes[0].ColSpan = 1, 1, 1, 1
		}
		if len(w.Panes) >= 2 {
			w.Panes[1].Row, w.Panes[1].Col, w.Panes[1].RowSpan, w.Panes[1].ColSpan = 1, 2, 1, 1
		}
		if len(w.Panes) >= 3 {
			w.Panes[2].Row, w.Panes[2].Col, w.Panes[2].RowSpan, w.Panes[2].ColSpan = 2, 1, 1, 2
		}

	case Layout1Top2Bot: // 2 rows, 2 cols: Top wide (1,1 span 2), Bottom left (2,1), Bottom right (2,2)
		if len(w.Panes) >= 1 {
			w.Panes[0].Row, w.Panes[0].Col, w.Panes[0].RowSpan, w.Panes[0].ColSpan = 1, 1, 1, 2
		}
		if len(w.Panes) >= 2 {
			w.Panes[1].Row, w.Panes[1].Col, w.Panes[1].RowSpan, w.Panes[1].ColSpan = 2, 1, 1, 1
		}
		if len(w.Panes) >= 3 {
			w.Panes[2].Row, w.Panes[2].Col, w.Panes[2].RowSpan, w.Panes[2].ColSpan = 2, 2, 1, 1
		}

	case LayoutGrid4: // 2 rows, 2 cols (4 quadrants)
		if len(w.Panes) >= 1 {
			w.Panes[0].Row, w.Panes[0].Col, w.Panes[0].RowSpan, w.Panes[0].ColSpan = 1, 1, 1, 1
		}
		if len(w.Panes) >= 2 {
			w.Panes[1].Row, w.Panes[1].Col, w.Panes[1].RowSpan, w.Panes[1].ColSpan = 1, 2, 1, 1
		}
		if len(w.Panes) >= 3 {
			w.Panes[2].Row, w.Panes[2].Col, w.Panes[2].RowSpan, w.Panes[2].ColSpan = 2, 1, 1, 1
		}
		if len(w.Panes) >= 4 {
			w.Panes[3].Row, w.Panes[3].Col, w.Panes[3].RowSpan, w.Panes[3].ColSpan = 2, 2, 1, 1
		}

	case Layout3Cols: // 1 row, 3 cols
		if len(w.Panes) >= 1 {
			w.Panes[0].Row, w.Panes[0].Col, w.Panes[0].RowSpan, w.Panes[0].ColSpan = 1, 1, 1, 1
		}
		if len(w.Panes) >= 2 {
			w.Panes[1].Row, w.Panes[1].Col, w.Panes[1].RowSpan, w.Panes[1].ColSpan = 1, 2, 1, 1
		}
		if len(w.Panes) >= 3 {
			w.Panes[2].Row, w.Panes[2].Col, w.Panes[2].RowSpan, w.Panes[2].ColSpan = 1, 3, 1, 1
		}
	}
}

// nextPaneIDLocked returns an unused "pane-N" ID. Deriving N from the pane count
// alone collides after a pane in the middle has been closed.
func (w *Workspace) nextPaneIDLocked() string {
	for n := len(w.Panes) + 1; ; n++ {
		id := fmt.Sprintf("pane-%d", n)
		if !w.hasPane(id) {
			return id
		}
	}
}

// hasPane checks if a pane exists by ID. Must be called under lock or internal context.
func (w *Workspace) hasPane(paneID string) bool {
	for _, p := range w.Panes {
		if p.ID == paneID {
			return true
		}
	}
	return false
}

// FindPaneByTabID locates the pane containing a specific tabID.
func (w *Workspace) FindPaneByTabID(tabID string) *Pane {
	w.mu.RLock()
	defer w.mu.RUnlock()

	for _, p := range w.Panes {
		for _, t := range p.Tabs {
			if t.ID == tabID {
				return p
			}
		}
	}
	return nil
}

// AddTabToPane adds a new tab to the target pane (or the active pane if targetPaneID is empty).
func (w *Workspace) AddTabToPane(targetPaneID string, tab *TabSession) (*Pane, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if len(w.Panes) == 0 {
		return nil, errors.New("workspace has no panes")
	}

	var targetPane *Pane
	if targetPaneID != "" {
		for _, p := range w.Panes {
			if p.ID == targetPaneID {
				targetPane = p
				break
			}
		}
	}

	if targetPane == nil {
		for _, p := range w.Panes {
			if p.ID == w.ActivePaneID {
				targetPane = p
				break
			}
		}
		if targetPane == nil {
			targetPane = w.Panes[0]
		}
	}

	targetPane.Tabs = append(targetPane.Tabs, tab)
	targetPane.ActiveTabID = tab.ID
	w.ActivePaneID = targetPane.ID

	return targetPane, nil
}

// RemoveTab removes a tab by ID from whichever pane it belongs to.
func (w *Workspace) RemoveTab(tabID string) (*Pane, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	for _, p := range w.Panes {
		for i, t := range p.Tabs {
			if t.ID == tabID {
				p.Tabs = append(p.Tabs[:i], p.Tabs[i+1:]...)
				if p.ActiveTabID == tabID {
					if len(p.Tabs) > 0 {
						p.ActiveTabID = p.Tabs[len(p.Tabs)-1].ID
					} else {
						p.ActiveTabID = ""
					}
				}
				return p, nil
			}
		}
	}

	return nil, fmt.Errorf("tab %s not found in workspace", tabID)
}

// MoveTab moves a tab from its current pane to targetPaneID at targetIndex.
func (w *Workspace) MoveTab(tabID, targetPaneID string, targetIndex int) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	var sourcePane *Pane
	var tabToMove *TabSession
	var sourceIndex = -1

	for _, p := range w.Panes {
		for i, t := range p.Tabs {
			if t.ID == tabID {
				sourcePane = p
				tabToMove = t
				sourceIndex = i
				break
			}
		}
		if sourcePane != nil {
			break
		}
	}

	if sourcePane == nil || tabToMove == nil {
		return fmt.Errorf("tab %s not found", tabID)
	}

	var targetPane *Pane
	for _, p := range w.Panes {
		if p.ID == targetPaneID {
			targetPane = p
			break
		}
	}

	if targetPane == nil {
		return fmt.Errorf("target pane %s not found", targetPaneID)
	}

	// Remove from source pane
	sourcePane.Tabs = append(sourcePane.Tabs[:sourceIndex], sourcePane.Tabs[sourceIndex+1:]...)
	if sourcePane.ActiveTabID == tabID {
		if len(sourcePane.Tabs) > 0 {
			sourcePane.ActiveTabID = sourcePane.Tabs[len(sourcePane.Tabs)-1].ID
		} else {
			sourcePane.ActiveTabID = ""
		}
	}

	// Insert into target pane
	if targetIndex < 0 || targetIndex > len(targetPane.Tabs) {
		targetPane.Tabs = append(targetPane.Tabs, tabToMove)
	} else {
		targetPane.Tabs = append(targetPane.Tabs[:targetIndex], append([]*TabSession{tabToMove}, targetPane.Tabs[targetIndex:]...)...)
	}

	targetPane.ActiveTabID = tabID
	w.ActivePaneID = targetPane.ID
	return nil
}

// SetActiveTab updates the active tab in the given pane.
func (w *Workspace) SetActiveTab(paneID, tabID string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	for _, p := range w.Panes {
		if p.ID == paneID {
			for _, t := range p.Tabs {
				if t.ID == tabID {
					p.ActiveTabID = tabID
					w.ActivePaneID = paneID
					return nil
				}
			}
			return fmt.Errorf("tab %s not found in pane %s", tabID, paneID)
		}
	}
	return fmt.Errorf("pane %s not found", paneID)
}

// FocusPane sets the workspace's active pane.
func (w *Workspace) FocusPane(paneID string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	for _, p := range w.Panes {
		if p.ID == paneID {
			w.ActivePaneID = paneID
			return nil
		}
	}
	return fmt.Errorf("pane %s not found", paneID)
}

// SplitPane splits the specified pane into two panes (adding a new pane).
func (w *Workspace) SplitPane(sourcePaneID, direction string) (*Pane, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if len(w.Panes) >= 8 {
		return nil, errors.New("maximum number of split panes reached (8)")
	}

	newPaneID := w.nextPaneIDLocked()
	newPane := &Pane{
		ID:          newPaneID,
		Title:       fmt.Sprintf("Terminal %d", len(w.Panes)+1),
		ActiveTabID: "",
		Tabs:        make([]*TabSession, 0),
	}

	// Automatically adjust layout preset if applicable
	if w.Layout == LayoutSingle {
		if direction == "down" {
			w.Layout = LayoutSplitH
		} else {
			w.Layout = LayoutSplitV
		}
	} else if (w.Layout == LayoutSplitV || w.Layout == LayoutSplitH) && len(w.Panes) == 2 {
		if direction == "down" {
			w.Layout = Layout2Top1Bot
		} else {
			w.Layout = Layout3Cols
		}
	} else if len(w.Panes) == 3 {
		w.Layout = LayoutGrid4
	}

	w.Panes = append(w.Panes, newPane)
	w.ActivePaneID = newPaneID
	w.recalculateGridPositions()

	return newPane, nil
}

// ClosePane closes a pane and redistributes any hosted tabs to remaining panes.
func (w *Workspace) ClosePane(paneID string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if len(w.Panes) <= 1 {
		return errors.New("cannot close the only remaining pane in workspace")
	}

	var paneToClose *Pane
	var closeIdx = -1
	for i, p := range w.Panes {
		if p.ID == paneID {
			paneToClose = p
			closeIdx = i
			break
		}
	}

	if paneToClose == nil {
		return fmt.Errorf("pane %s not found", paneID)
	}

	// Remove from slice
	w.Panes = append(w.Panes[:closeIdx], w.Panes[closeIdx+1:]...)

	// Distribute any orphan tabs into the first available pane
	remainingPane := w.Panes[0]
	if len(paneToClose.Tabs) > 0 {
		remainingPane.Tabs = append(remainingPane.Tabs, paneToClose.Tabs...)
		if remainingPane.ActiveTabID == "" {
			remainingPane.ActiveTabID = remainingPane.Tabs[len(remainingPane.Tabs)-1].ID
		}
	}

	if w.ActivePaneID == paneID {
		w.ActivePaneID = remainingPane.ID
	}

	// Reset layout if needed: every 3+ pane preset leaves a hole with 2 panes.
	if len(w.Panes) == 1 {
		w.Layout = LayoutSingle
	} else if len(w.Panes) == 2 && w.Layout != LayoutSplitV && w.Layout != LayoutSplitH {
		w.Layout = LayoutSplitV
	} else if len(w.Panes) == 3 && w.Layout == LayoutGrid4 {
		w.Layout = Layout2Top1Bot
	}

	w.recalculateGridPositions()
	return nil
}
