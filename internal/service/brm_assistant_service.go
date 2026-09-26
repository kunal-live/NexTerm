package service

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"nexterm/internal/protocol"
)

// BRMInstallation represents a discovered Oracle BRM environment.
type BRMInstallation struct {
	RootPath    string   `json:"rootPath"`
	Version     string   `json:"version"`
	Components  []string `json:"components"`
	ConfigFiles []string `json:"configFiles"`
	LogPaths    []string `json:"logPaths"`
	IsActive    bool     `json:"isActive"`
}

// BRMLogFile represents a discovered BRM component log.
type BRMLogFile struct {
	Component string `json:"component"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	Modified  string `json:"modified"`
}

// BRMDetectedError represents an error occurrence extracted from logs.
type BRMDetectedError struct {
	LineNumber int      `json:"lineNumber"`
	RawLine    string   `json:"rawLine"`
	ErrorCode  string   `json:"errorCode"`
	Category   string   `json:"category"`
	Severity   string   `json:"severity"`
	Context    []string `json:"context"`
}

// BRMSourceInspection holds bounded content and detected errors from a file.
type BRMSourceInspection struct {
	SourcePath  string             `json:"sourcePath"`
	Lines       []string           `json:"lines"`
	LineStart   int                `json:"lineStart"`
	LineEnd     int                `json:"lineEnd"`
	TotalLines  int                `json:"totalLines"`
	ErrorsFound []BRMDetectedError `json:"errorsFound"`
}

// BRMSourceOption represents a source pill the user can choose.
type BRMSourceOption struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Path        string `json:"path"`
	Description string `json:"description"`
}

// BRMEvidenceItem specifies exact file evidence and lines.
type BRMEvidenceItem struct {
	File         string   `json:"file"`
	LineStart    int      `json:"lineStart"`
	LineEnd      int      `json:"lineEnd"`
	Snippet      string   `json:"snippet"`
	ContextLines []string `json:"contextLines"`
}

// BRMAction provides 1-click navigation inside NextTerm.
type BRMAction struct {
	Type   string `json:"type"` // "open_log", "open_config", "open_sftp", "copy"
	Label  string `json:"label"`
	Target string `json:"target"`
	Line   int    `json:"line"`
}

// BRMDiagnosisRequest is sent by frontend when asking a question.
type BRMDiagnosisRequest struct {
	TabID          string            `json:"tabId"`
	Question       string            `json:"question"`
	Environment    string            `json:"environment"`    // "ssh" or "local"
	SelectedSource string            `json:"selectedSource"` // "cm_log", "dm_log", "pin_conf", "opcode", "all", etc.
	CustomPath     string            `json:"customPath"`
	Context        map[string]string `json:"context"`
}

// BRMDiagnosisResult is the structured diagnostic response.
type BRMDiagnosisResult struct {
	Status             string            `json:"status"` // "diagnosed", "needs_source", "informational", "not_found", "unanswerable"
	QuestionType       string            `json:"questionType"`
	Problem            string            `json:"problem"`
	Component          string            `json:"component"`
	Error              string            `json:"error"`
	Confidence         string            `json:"confidence"` // "High", "Medium", "Low"
	DirectAnswer       string            `json:"directAnswer"`
	Evidence           []BRMEvidenceItem `json:"evidence"`
	LikelyCauses       []string          `json:"likelyCauses"`
	Checks             []string          `json:"checks"`
	Resolution         []string          `json:"resolution"`
	SuggestedSources   []BRMSourceOption `json:"suggestedSources"`
	Actions            []BRMAction       `json:"actions"`
	KnowledgeFilesUsed []string          `json:"knowledgeFilesUsed,omitempty"`
}

// BRMAssistantService manages read-only BRM diagnostic capabilities.
type BRMAssistantService struct {
	mu            sync.RWMutex
	connManager   *ConnectionManager
	logService    *LoggingService
	cachedContext map[string]*BRMInstallation
}

// NewBRMAssistantService constructs a new BRMAssistantService.
func NewBRMAssistantService(connManager *ConnectionManager, logService *LoggingService) *BRMAssistantService {
	return &BRMAssistantService{
		connManager:   connManager,
		logService:    logService,
		cachedContext: make(map[string]*BRMInstallation),
	}
}

// ClassifyQuestion classifies user intent into defined categories.
func (s *BRMAssistantService) ClassifyQuestion(q string) string {
	ql := strings.ToLower(strings.TrimSpace(q))

	if strings.Contains(ql, "where is") || strings.Contains(ql, "find") || strings.Contains(ql, "location") || strings.Contains(ql, "path of") {
		return "LOCATION"
	}
	if strings.Contains(ql, "pcm_op") || strings.Contains(ql, "opcode") || strings.Contains(ql, "flist") {
		if strings.Contains(ql, "fail") || strings.Contains(ql, "error") || strings.Contains(ql, "why") || strings.Contains(ql, "crash") {
			return "ERROR_EXPLANATION"
		}
		return "OPCODE"
	}
	if strings.Contains(ql, "log") || strings.Contains(ql, "tail") || strings.Contains(ql, "trace") {
		return "LOG_ANALYSIS"
	}
	if strings.Contains(ql, "pin.conf") || strings.Contains(ql, "config") || strings.Contains(ql, "parameter") || strings.Contains(ql, "dm_pointer") {
		return "CONFIGURATION"
	}
	if strings.Contains(ql, "error") || strings.Contains(ql, "pin_err") || strings.Contains(ql, "ora-") || strings.Contains(ql, "fail") || strings.Contains(ql, "why is") {
		return "ERROR_EXPLANATION"
	}
	if strings.Contains(ql, "architecture") || strings.Contains(ql, "how does") || strings.Contains(ql, "flow") {
		return "ARCHITECTURE"
	}
	return "GENERAL_BRM"
}

// DetectInstallation performs read-only detection of BRM installations on remote SSH or local machine.
func (s *BRMAssistantService) DetectInstallation(tabID string) (*BRMInstallation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// If remote SSH tab
	if tabID != "" && tabID != "local" && tabID != "home" {
		inst, err := s.detectRemoteInstallation(tabID)
		if err == nil && inst != nil {
			s.cachedContext[tabID] = inst
			return inst, nil
		}
	}

	// Fall back to local detection
	inst := s.detectLocalInstallation()
	s.cachedContext["local"] = inst
	return inst, nil
}

func (s *BRMAssistantService) detectRemoteInstallation(tabID string) (*BRMInstallation, error) {
	if s.connManager == nil {
		return nil, fmt.Errorf("connection manager not configured")
	}

	sess, ok := s.connManager.GetSession(tabID)
	if !ok || sess == nil {
		return nil, fmt.Errorf("session not found: %s", tabID)
	}

	sshSess, ok := sess.(*protocol.SSHSession)
	if !ok || sshSess.Client() == nil {
		return nil, fmt.Errorf("active SSH connection required")
	}

	// Non-invasive, read-only discovery command
	discoveryScript := `
echo "===PIN_HOME==="
echo "${PIN_HOME:-}"
echo "===SEARCH==="
for d in "$PIN_HOME" /opt/portal /opt/brm /opt/ece /app/brm /home/*/brm /opt/ece/ece*; do
  if [ -d "$d" ]; then
    echo "DIR:$d"
  fi
done
`
	client := sshSess.Client()
	sChan, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer sChan.Close()

	out, err := sChan.CombinedOutput(discoveryScript)
	if err != nil && len(out) == 0 {
		return nil, err
	}

	lines := strings.Split(string(out), "\n")
	var pinHome string
	var candidates []string
	capturePinHome := false

	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l == "===PIN_HOME===" {
			capturePinHome = true
			continue
		}
		if l == "===SEARCH===" {
			capturePinHome = false
			continue
		}
		if capturePinHome && l != "" && pinHome == "" {
			pinHome = l
		}
		if strings.HasPrefix(l, "DIR:") {
			d := strings.TrimPrefix(l, "DIR:")
			candidates = append(candidates, d)
		}
	}

	chosenRoot := pinHome
	if chosenRoot == "" && len(candidates) > 0 {
		chosenRoot = candidates[0]
	}
	if chosenRoot == "" {
		chosenRoot = "/opt/portal" // standard default fallback
	}

	// Inspect components within chosen root
	checkScript := fmt.Sprintf(`
root="%s"
for comp in sys/cm sys/dm_oracle sys/dm_fusa sys/em sys/test bin include source log ece; do
  if [ -e "$root/$comp" ]; then
    echo "COMP:$comp"
  fi
done
for cfg in sys/cm/pin.conf sys/dm_oracle/pin.conf pin.conf pin_setup.values; do
  if [ -f "$root/$cfg" ]; then
    echo "CFG:$root/$cfg"
  fi
done
for lg in sys/cm/cm.log sys/dm_oracle/dm_oracle.log log/cm.log; do
  if [ -f "$root/$lg" ]; then
    echo "LOG:$root/$lg"
  fi
done
`, chosenRoot)

	sChan2, err2 := client.NewSession()
	if err2 == nil {
		defer sChan2.Close()
		out2, _ := sChan2.CombinedOutput(checkScript)
		lines2 := strings.Split(string(out2), "\n")
		var components []string
		var configs []string
		var logs []string

		for _, l := range lines2 {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "COMP:") {
				components = append(components, strings.TrimPrefix(l, "COMP:"))
			} else if strings.HasPrefix(l, "CFG:") {
				configs = append(configs, strings.TrimPrefix(l, "CFG:"))
			} else if strings.HasPrefix(l, "LOG:") {
				logs = append(logs, strings.TrimPrefix(l, "LOG:"))
			}
		}

		return &BRMInstallation{
			RootPath:    chosenRoot,
			Version:     "Oracle BRM (Remote)",
			Components:  components,
			ConfigFiles: configs,
			LogPaths:    logs,
			IsActive:    true,
		}, nil
	}

	return &BRMInstallation{
		RootPath: chosenRoot,
		Version:  "Oracle BRM",
		IsActive: true,
	}, nil
}

func (s *BRMAssistantService) detectLocalInstallation() *BRMInstallation {
	pinHome := os.Getenv("PIN_HOME")
	roots := []string{
		pinHome,
		`C:\Oracle\BRM`,
		`C:\BRM`,
		`/opt/portal`,
		`/opt/brm`,
	}

	var foundRoot string
	for _, r := range roots {
		if r != "" {
			if fi, err := os.Stat(r); err == nil && fi.IsDir() {
				foundRoot = r
				break
			}
		}
	}

	if foundRoot == "" {
		foundRoot = pinHome
		if foundRoot == "" {
			foundRoot = `C:\Oracle\BRM`
		}
	}

	var components []string
	var configs []string
	var logs []string

	commonComps := []string{"sys/cm", "sys/dm_oracle", "sys/em", "include", "source", "bin", "lib", "log"}
	for _, c := range commonComps {
		p := filepath.Join(foundRoot, filepath.FromSlash(c))
		if _, err := os.Stat(p); err == nil {
			components = append(components, c)
		}
	}

	commonConfigs := []string{"sys/cm/pin.conf", "sys/dm_oracle/pin.conf", "pin.conf", "pin_setup.values"}
	for _, cfg := range commonConfigs {
		p := filepath.Join(foundRoot, filepath.FromSlash(cfg))
		if _, err := os.Stat(p); err == nil {
			configs = append(configs, p)
		}
	}

	commonLogs := []string{"sys/cm/cm.log", "sys/dm_oracle/dm_oracle.log", "log/cm.log"}
	for _, lg := range commonLogs {
		p := filepath.Join(foundRoot, filepath.FromSlash(lg))
		if _, err := os.Stat(p); err == nil {
			logs = append(logs, p)
		}
	}

	return &BRMInstallation{
		RootPath:    foundRoot,
		Version:     "Oracle BRM (Local)",
		Components:  components,
		ConfigFiles: configs,
		LogPaths:    logs,
		IsActive:    len(components) > 0 || len(configs) > 0,
	}
}

// DiscoverLogs lists discovered and standard BRM logs.
func (s *BRMAssistantService) DiscoverLogs(tabID string, rootPath string) ([]BRMLogFile, error) {
	if rootPath == "" {
		inst, err := s.DetectInstallation(tabID)
		if err == nil && inst != nil {
			rootPath = inst.RootPath
		}
	}
	if rootPath == "" {
		rootPath = "/opt/portal"
	}

	var results []BRMLogFile
	standardLogs := []struct {
		Comp string
		Name string
		Rel  string
	}{
		{"CM", "cm.log", "sys/cm/cm.log"},
		{"DM Oracle", "dm_oracle.log", "sys/dm_oracle/dm_oracle.log"},
		{"EM", "em.log", "sys/em/em.log"},
		{"PDC", "pdc.log", "apps/pdc/log/pdc.log"},
		{"ECE", "pricingUpdater.log", "ece/logs/pricingUpdater.log"},
		{"Pipeline", "pipeline.log", "sys/pipeline/log/pipeline.log"},
		{"App", "default.pinlog", "sys/test/default.pinlog"},
	}

	for _, sl := range standardLogs {
		p := filepath.ToSlash(filepath.Join(rootPath, filepath.FromSlash(sl.Rel)))
		results = append(results, BRMLogFile{
			Component: sl.Comp,
			Name:      sl.Name,
			Path:      p,
			Modified:  time.Now().Format("2006-01-02 15:04"),
		})
	}

	return results, nil
}

// InspectSource performs a read-only bounded read of a log or configuration file.
func (s *BRMAssistantService) InspectSource(tabID string, sourcePath string, filterQuery string, maxLines int) (*BRMSourceInspection, error) {
	if maxLines <= 0 || maxLines > 500 {
		maxLines = 200
	}

	isSSH := tabID != "" && tabID != "local" && tabID != "home"

	if isSSH && s.connManager != nil {
		sess, ok := s.connManager.GetSession(tabID)
		if ok && sess != nil {
			if sshSess, ok := sess.(*protocol.SSHSession); ok && sshSess.Client() != nil {
				return s.inspectRemoteSource(sshSess, sourcePath, filterQuery, maxLines)
			}
		}
	}

	return s.inspectLocalSource(sourcePath, filterQuery, maxLines)
}

func (s *BRMAssistantService) inspectRemoteSource(sshSess *protocol.SSHSession, sourcePath, filterQuery string, maxLines int) (*BRMSourceInspection, error) {
	client := sshSess.Client()
	sChan, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer sChan.Close()

	// Safe read-only tail with line numbers
	cmd := fmt.Sprintf("if [ -f \"%s\" ]; then tail -n %d \"%s\" | awk '{print NR \":\" $0}'; else echo \"__FILE_NOT_FOUND__\"; fi", sourcePath, maxLines, sourcePath)
	if filterQuery != "" {
		safeQuery := strings.ReplaceAll(filterQuery, `"`, `\"`)
		cmd = fmt.Sprintf("if [ -f \"%s\" ]; then grep -n -C 3 -iE \"%s\" \"%s\" | tail -n %d; else echo \"__FILE_NOT_FOUND__\"; fi", sourcePath, safeQuery, sourcePath, maxLines)
	}

	out, err := sChan.CombinedOutput(cmd)
	if err != nil && len(out) == 0 {
		return nil, err
	}

	rawOutput := string(out)
	if strings.Contains(rawOutput, "__FILE_NOT_FOUND__") {
		return &BRMSourceInspection{
			SourcePath:  sourcePath,
			Lines:       []string{fmt.Sprintf("File not found on remote server: %s", sourcePath)},
			TotalLines:  0,
			ErrorsFound: []BRMDetectedError{},
		}, nil
	}

	lines := strings.Split(rawOutput, "\n")
	var parsedLines []string
	var detectedErrors []BRMDetectedError

	for i, l := range lines {
		l = strings.TrimRight(l, "\r")
		if l == "" {
			continue
		}
		parsedLines = append(parsedLines, l)

		if errItem := s.detectErrorInLine(l, i+1); errItem != nil {
			detectedErrors = append(detectedErrors, *errItem)
		}
	}

	return &BRMSourceInspection{
		SourcePath:  sourcePath,
		Lines:       parsedLines,
		LineStart:   1,
		LineEnd:     len(parsedLines),
		TotalLines:  len(parsedLines),
		ErrorsFound: detectedErrors,
	}, nil
}

func (s *BRMAssistantService) inspectLocalSource(sourcePath, filterQuery string, maxLines int) (*BRMSourceInspection, error) {
	f, err := os.Open(sourcePath)
	if err != nil {
		return &BRMSourceInspection{
			SourcePath: sourcePath,
			Lines:      []string{fmt.Sprintf("Could not open source file: %v", err)},
		}, nil
	}
	defer f.Close()

	var allLines []string
	filterQueryLower := strings.ToLower(filterQuery)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if filterQueryLower != "" && !strings.Contains(strings.ToLower(line), filterQueryLower) {
			continue
		}
		allLines = append(allLines, line)
	}
	if err := scanner.Err(); err != nil && len(allLines) == 0 {
		return &BRMSourceInspection{
			SourcePath: sourcePath,
			Lines:      []string{fmt.Sprintf("Error reading source file: %v", err)},
		}, nil
	}

	total := len(allLines)
	start := 0
	if total > maxLines {
		start = total - maxLines
	}
	slice := allLines[start:]

	var detectedErrors []BRMDetectedError
	for idx, l := range slice {
		actualLineNo := start + idx + 1
		if errItem := s.detectErrorInLine(l, actualLineNo); errItem != nil {
			detectedErrors = append(detectedErrors, *errItem)
		}
	}

	return &BRMSourceInspection{
		SourcePath:  sourcePath,
		Lines:       slice,
		LineStart:   start + 1,
		LineEnd:     total,
		TotalLines:  total,
		ErrorsFound: detectedErrors,
	}, nil
}

func (s *BRMAssistantService) detectErrorInLine(line string, lineNo int) *BRMDetectedError {
	upper := strings.ToUpper(line)

	// PIN_ERR_* pattern
	pinErrRegex := regexp.MustCompile(`PIN_ERR_[A-Z0-9_]+`)
	if match := pinErrRegex.FindString(upper); match != "" {
		return &BRMDetectedError{
			LineNumber: lineNo,
			RawLine:    line,
			ErrorCode:  match,
			Category:   "BRM_ERROR",
			Severity:   "ERROR",
		}
	}

	// ORA-* pattern
	oraRegex := regexp.MustCompile(`ORA-[0-9]{5}`)
	if match := oraRegex.FindString(upper); match != "" {
		return &BRMDetectedError{
			LineNumber: lineNo,
			RawLine:    line,
			ErrorCode:  match,
			Category:   "ORACLE_DB_ERROR",
			Severity:   "ERROR",
		}
	}

	// General Error / Exception keywords
	if strings.Contains(upper, "ERROR") || strings.Contains(upper, "EXCEPTION") || strings.Contains(upper, "FAIL") || strings.Contains(upper, "SEGMENTATION FAULT") {
		return &BRMDetectedError{
			LineNumber: lineNo,
			RawLine:    line,
			ErrorCode:  "GENERIC_ERROR",
			Category:   "LOG_ERROR",
			Severity:   "ERROR",
		}
	}

	return nil
}

// Diagnose evaluates the user question, inspects evidence, and synthesizes a structured diagnosis.
func (s *BRMAssistantService) Diagnose(req BRMDiagnosisRequest) (*BRMDiagnosisResult, error) {
	qType := s.ClassifyQuestion(req.Question)

	var uploadedFiles []string
	if req.Context != nil {
		if rawFiles, ok := req.Context["uploaded_files"]; ok && strings.TrimSpace(rawFiles) != "" {
			parts := strings.Split(rawFiles, ",")
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if p != "" {
					uploadedFiles = append(uploadedFiles, p)
				}
			}
		}
	}

	attachKnowledge := func(res *BRMDiagnosisResult) (*BRMDiagnosisResult, error) {
		if res != nil && len(uploadedFiles) > 0 {
			res.KnowledgeFilesUsed = uploadedFiles
		}
		return res, nil
	}

	inst, _ := s.DetectInstallation(req.TabID)
	root := "/opt/portal"
	if inst != nil && inst.RootPath != "" {
		root = inst.RootPath
	}

	cmLogPath := filepath.ToSlash(filepath.Join(root, "sys/cm/cm.log"))
	dmLogPath := filepath.ToSlash(filepath.Join(root, "sys/dm_oracle/dm_oracle.log"))
	cmConfPath := filepath.ToSlash(filepath.Join(root, "sys/cm/pin.conf"))

	ql := strings.ToLower(req.Question)

	// 1. LOCATION queries
	if qType == "LOCATION" {
		return attachKnowledge(s.diagnoseLocation(req.Question, root, cmLogPath, dmLogPath, cmConfPath))
	}

	// 2. OPCODE informational query
	if qType == "OPCODE" && !strings.Contains(ql, "fail") && !strings.Contains(ql, "error") {
		return attachKnowledge(s.diagnoseOpcodeInfo(req.Question, cmConfPath))
	}

	// 3. ARCHITECTURE query (grounded in BRM_Architecture_Overview.pptx)
	if qType == "ARCHITECTURE" || strings.Contains(ql, "architecture") || strings.Contains(ql, "presentation") || strings.Contains(ql, "pptx") || strings.Contains(ql, "component") {
		return attachKnowledge(s.diagnoseArchitecture(req.Question, root, cmConfPath))
	}

	// 4. CONFIGURATION / TUNING query (grounded in pin_conf_tuning_guide.txt)
	if qType == "CONFIGURATION" || strings.Contains(ql, "dm_pointer") || strings.Contains(ql, "tuning") || strings.Contains(ql, "loglevel") || strings.Contains(ql, "max_children") || strings.Contains(ql, "sm_chunk_size") {
		return attachKnowledge(s.diagnoseConfiguration(req.Question, root, cmConfPath))
	}

	// 5. BILLING informational query
	if (strings.Contains(ql, "bill") || strings.Contains(ql, "invoice") || strings.Contains(ql, "cycle")) && !strings.Contains(ql, "fail") && !strings.Contains(ql, "error") && !strings.Contains(ql, "why") {
		return attachKnowledge(s.diagnoseBilling(req.Question, root, cmConfPath))
	}

	// 6. Direct Error / Concept lookup if error code or conceptual keywords present
	errRegex := regexp.MustCompile(`(PIN_ERR_[A-Z0-9_]+|PIN_ERRLOC_[A-Z0-9_]+|ORA-[0-9]{5})`)
	matchedErr := errRegex.FindString(strings.ToUpper(req.Question))
	if matchedErr != "" && (strings.Contains(ql, "explain") || strings.Contains(ql, "what is") || strings.Contains(ql, "what does") || strings.Contains(ql, "mean") || strings.Contains(ql, "how to fix") || strings.Contains(ql, "cause")) && !strings.Contains(ql, "fail") && !strings.Contains(ql, "why is") {
		return attachKnowledge(s.buildDiagnosis(req.Question, matchedErr, "", "Oracle BRM", nil, []string{cmConfPath}, root))
	}

	// 7. If source is not selected, only ask for source if user specifically requested log inspection or reported active failure
	if req.SelectedSource == "" {
		if strings.Contains(ql, "fail") || strings.Contains(ql, "why") || strings.Contains(ql, "crash") || strings.Contains(ql, "log") || strings.Contains(ql, "tail") || strings.Contains(ql, "trace") || strings.Contains(ql, "inspect") {
			res := &BRMDiagnosisResult{
				Status:       "needs_source",
				QuestionType: qType,
				Problem:      req.Question,
				Component:    "Oracle BRM",
				Confidence:   "High",
				LikelyCauses: []string{
					"Awaiting your selection to inspect verified evidence without loading unrelated files.",
				},
				Checks: []string{
					"Select one of the source logs/configs below to analyze real environment evidence.",
				},
				SuggestedSources: []BRMSourceOption{
					{Key: "cm_log", Label: "CM Log", Path: cmLogPath, Description: "Connection Manager logs: opcode dispatches, client connections, auth"},
					{Key: "dm_log", Label: "DM Log", Path: dmLogPath, Description: "Data Manager logs: Oracle SQL executions, database transactions"},
					{Key: "pin_conf", Label: "CM pin.conf", Path: cmConfPath, Description: "CM configuration: dm_pointer, process limits, loglevel"},
					{Key: "all", Label: "All Relevant Sources", Path: "Multiple", Description: "Inspect CM Log, DM Log, and pin.conf together"},
				},
				Actions: []BRMAction{
					{Type: "open_log", Label: "Open CM Log", Target: cmLogPath, Line: 1},
					{Type: "open_config", Label: "Open pin.conf", Target: cmConfPath, Line: 1},
					{Type: "open_sftp", Label: "Browse BRM Folder", Target: root, Line: 0},
				},
			}
			return attachKnowledge(res)
		}

		if matchedErr != "" {
			return attachKnowledge(s.buildDiagnosis(req.Question, matchedErr, "", "Oracle BRM", nil, []string{cmConfPath}, root))
		}

		// When question cannot be answered from knowledge base or files
		return attachKnowledge(&BRMDiagnosisResult{
			Status:       "unanswerable",
			QuestionType: qType,
			Problem:      req.Question,
			DirectAnswer: "I can't answer this question.",
		})
	}

	// 4. Source selected: Collect actual evidence
	targetPaths := []string{}
	switch req.SelectedSource {
	case "cm_log":
		targetPaths = append(targetPaths, cmLogPath)
	case "dm_log":
		targetPaths = append(targetPaths, dmLogPath)
	case "pin_conf":
		targetPaths = append(targetPaths, cmConfPath)
	case "all":
		targetPaths = append(targetPaths, cmLogPath, dmLogPath, cmConfPath)
	default:
		if req.CustomPath != "" {
			targetPaths = append(targetPaths, req.CustomPath)
		} else {
			targetPaths = append(targetPaths, cmLogPath)
		}
	}

	var allEvidence []BRMEvidenceItem
	var topError string
	var topComponent string = "CM"

	for _, p := range targetPaths {
		inspection, err := s.InspectSource(req.TabID, p, "", 150)
		if err == nil && inspection != nil && len(inspection.ErrorsFound) > 0 {
			for _, errItem := range inspection.ErrorsFound {
				if topError == "" && errItem.ErrorCode != "GENERIC_ERROR" {
					topError = errItem.ErrorCode
				}
				snippet := errItem.RawLine
				allEvidence = append(allEvidence, BRMEvidenceItem{
					File:      p,
					LineStart: errItem.LineNumber,
					LineEnd:   errItem.LineNumber,
					Snippet:   snippet,
				})
			}
		}
	}

	// Match opcode if mentioned in question
	opcodeRegex := regexp.MustCompile(`PCM_OP_[A-Z0-9_]+`)
	mentionedOpcode := opcodeRegex.FindString(req.Question)

	// Synthesize diagnosis based on error code or question
	diag := s.buildDiagnosis(req.Question, topError, mentionedOpcode, topComponent, allEvidence, targetPaths, root)
	return attachKnowledge(diag)
}

func (s *BRMAssistantService) diagnoseLocation(q, root, cmLog, dmLog, cmConf string) *BRMDiagnosisResult {
	ql := strings.ToLower(q)
	target := cmConf
	label := "CM pin.conf"
	desc := "Found in standard CM sys directory"
	actType := "open_config"

	if strings.Contains(ql, "infranet") || strings.Contains(ql, "eai") || strings.Contains(ql, "properties") {
		target = filepath.ToSlash(filepath.Join(root, "sys/eai_js/infranet.properties"))
		label = "Infranet Properties (Java / EAI)"
		desc = "Configuration for Java SDK & EAI framework integration"
	} else if strings.Contains(ql, "bill") || strings.Contains(ql, "pin_billd") {
		target = filepath.ToSlash(filepath.Join(root, "apps/pin_billd/pin.conf"))
		label = "Billing Engine pin.conf"
		desc = "Configuration for automated billing daemon (pin_billd)"
	} else if strings.Contains(ql, "dm") {
		target = filepath.ToSlash(filepath.Join(root, "sys/dm_oracle/pin.conf"))
		label = "DM Oracle pin.conf"
		desc = "Data Manager Oracle configuration: credentials, DB pointer, limits"
	} else if strings.Contains(ql, "notify") || strings.Contains(ql, "notification") {
		target = filepath.ToSlash(filepath.Join(root, "sys/data/config/pin_notify"))
		label = "Event Notification Config (pin_notify)"
		desc = "Event notification specifications and automated opcode subscriptions"
	} else if strings.Contains(ql, "header") || strings.Contains(ql, "include") || strings.Contains(ql, ".h") {
		target = filepath.ToSlash(filepath.Join(root, "include"))
		label = "BRM SDK Headers (include/)"
		desc = "Standard C/C++ header definitions (pcm.h, pin_errs.h, ops/*.h)"
		actType = "open_sftp"
	} else if strings.Contains(ql, "cm log") || strings.Contains(ql, "cm.log") || strings.Contains(ql, "cm.pinlog") {
		target = cmLog
		label = "CM Pinlog"
		desc = "Connection Manager primary activity log"
		actType = "open_log"
	} else if strings.Contains(ql, "dm log") || strings.Contains(ql, "dm_oracle.log") || strings.Contains(ql, "dm_oracle.pinlog") {
		target = dmLog
		label = "DM Pinlog"
		desc = "Data Manager Oracle database activity log"
		actType = "open_log"
	} else if strings.Contains(ql, "root") || strings.Contains(ql, "home") || strings.Contains(ql, "brm home") || strings.Contains(ql, "pin_home") {
		target = root
		label = "BRM Home ($PIN_HOME)"
		desc = "Root directory of Oracle BRM installation"
		actType = "open_sftp"
	}

	return &BRMDiagnosisResult{
		Status:       "diagnosed",
		QuestionType: "LOCATION",
		Problem:      q,
		Component:    "Filesystem Finder",
		Confidence:   "High",
		DirectAnswer: fmt.Sprintf("**%s** is located at `%s`.\n%s", label, target, desc),
		Evidence: []BRMEvidenceItem{
			{
				File:      target,
				LineStart: 1,
				LineEnd:   1,
				Snippet:   fmt.Sprintf("Discovered %s: %s", label, target),
			},
		},
		LikelyCauses: []string{
			fmt.Sprintf("Path: %s", target),
			desc,
		},
		Checks: []string{
			"Verify file permissions allow the BRM service user read/write access.",
			"Confirm path matches $PIN_HOME environment variable.",
		},
		Resolution: []string{
			"Access the file directly using NextTerm's built-in file editor or SFTP browser.",
		},
		Actions: []BRMAction{
			{Type: actType, Label: "Open " + label, Target: target, Line: 1},
			{Type: "open_sftp", Label: "Browse Directory in SFTP", Target: filepath.Dir(target), Line: 0},
		},
	}
}

func (s *BRMAssistantService) diagnoseOpcodeInfo(q, cmConf string) *BRMDiagnosisResult {
	opcodeRegex := regexp.MustCompile(`PCM_OP_[A-Z0-9_]+`)
	op := opcodeRegex.FindString(q)
	if op == "" {
		op = "PCM_OP"
	}

	info := s.GetOpcodeKnowledge(op)
	return &BRMDiagnosisResult{
		Status:       "informational",
		QuestionType: "OPCODE",
		Problem:      fmt.Sprintf("Opcode reference inquiry: %s", op),
		Component:    "PCM / Opcode Engine",
		Confidence:   "High",
		DirectAnswer: fmt.Sprintf("**%s** (%s):\n• %s\n• **Input Flist**: `%s`\n• **Output Flist**: `%s`", op, info.Type, info.Description, info.InputFlist, info.OutputFlist),
		Evidence: []BRMEvidenceItem{
			{
				File:      "Oracle BRM Opcode Registry",
				LineStart: 1,
				LineEnd:   1,
				Snippet:   info.Description,
			},
		},
		LikelyCauses: []string{
			fmt.Sprintf("Opcode Type: %s", info.Type),
			fmt.Sprintf("Input Flist: %s", info.InputFlist),
			fmt.Sprintf("Output Flist: %s", info.OutputFlist),
		},
		Checks: []string{
			"Ensure the custom opcode FM library is linked in cm_pin.conf (- cm fm_module ...)",
			"Verify opcode number matches ops/*.h header definitions",
			"Validate mandatory fields in input flist before dispatch",
		},
		Resolution: []string{
			"Ensure CM was restarted after modifying cm_pin.conf or deploying new .so libraries.",
		},
		Actions: []BRMAction{
			{Type: "open_config", Label: "Open CM pin.conf", Target: cmConf, Line: 1},
		},
	}
}

func (s *BRMAssistantService) diagnoseArchitecture(q, root, cmConf string) *BRMDiagnosisResult {
	return &BRMDiagnosisResult{
		Status:       "diagnosed",
		QuestionType: "ARCHITECTURE",
		Problem:      q,
		Component:    "Oracle BRM Core Architecture",
		Error:        "ARCHITECTURE_OVERVIEW",
		Confidence:   "High",
		DirectAnswer: "**Oracle BRM Architecture Overview**:\n• **Connection Manager (CM)**: Socket multiplexer, worker thread pool manager, and opcode router.\n• **Data Manager (DM Oracle)**: Translates PCM flists into SQL transactions.\n• **Real-Time Rating (ECE / Pipeline)**: Rates usage CDRs and manages balance buckets.\n• **Client/SDK**: Communicates with CM via Portal Communication Protocol (PCP).",
		Evidence: []BRMEvidenceItem{
			{
				File:      "BRM_Architecture_Overview.pptx",
				LineStart: 1,
				LineEnd:   5,
				Snippet:   "Oracle BRM Core Architecture: Connection Manager (CM) <-> Data Manager (DM Oracle) <-> Real-Time Rating (ECE / Pipeline).",
			},
		},
		LikelyCauses: []string{
			"Connection Manager (CM): Central application server; manages socket connections, thread pools, and dispatches PCM opcodes.",
			"Data Manager (DM Oracle): Maps BRM FLIST data structures to relational SQL tables and coordinates ACID database transactions.",
			"Real-Time Rating Engine (ECE / Pipeline): High-throughput rating of usage CDRs and balance bucket updates.",
			"Application Tier (Client/SDK): Communicates with CM via Portal Communication Protocol (PCP) using input/output flists.",
		},
		Checks: []string{
			"Check CM status: Verify listener processes (`pin_ctl status cm`)",
			"Check DM Oracle status: Verify dm_oracle process and SQLNet connectivity",
			"Verify opcode libraries: Ensure FM modules are loaded in cm pin.conf",
		},
		Resolution: []string{
			"Refer to Slide 3 in BRM_Architecture_Overview.pptx for request dispatch flow.",
			"Ensure DM pointer in CM pin.conf points to the correct DM Oracle IP and port.",
		},
		Actions: []BRMAction{
			{Type: "open_config", Label: "Open CM pin.conf", Target: cmConf, Line: 1},
			{Type: "open_sftp", Label: "Browse Directory", Target: root, Line: 0},
			{Type: "copy", Label: "Copy Architecture Overview", Target: "BRM_Architecture_Overview.pptx", Line: 0},
		},
	}
}

func (s *BRMAssistantService) diagnoseConfiguration(q, root, cmConf string) *BRMDiagnosisResult {
	ql := strings.ToLower(q)
	var directAns string
	if strings.Contains(ql, "dm_pointer") {
		directAns = "`cm dm_pointer` in `sys/cm/pin.conf` maps the database number (e.g. `0.0.0.1`) to the DM Oracle host and listening port:\n`- cm dm_pointer 0.0.0.1 ip <host> <port>`\nEnsure this port matches `sys/dm_oracle/pin.conf`."
	} else if strings.Contains(ql, "loglevel") {
		directAns = "`cm loglevel` in `sys/cm/pin.conf` sets logging verbosity:\n• `1` = Errors only (recommended in production)\n• `2` = Warnings\n• `3` = Full Debug (dumps all flist structures; high disk I/O)."
	} else if strings.Contains(ql, "max_children") {
		directAns = "`cm max_children` in `sys/cm/pin.conf` sets the maximum concurrent child worker processes spawned by CM before connection throttling."
	} else {
		directAns = "**CM / DM Configuration Reference**:\n• `cm dm_pointer`: Maps DB number to DM Oracle host and port.\n• `cm loglevel`: 1 (Error), 2 (Warning), 3 (Debug/Flist).\n• `cm max_children`: Concurrent worker process limit."
	}

	return &BRMDiagnosisResult{
		Status:       "diagnosed",
		QuestionType: "CONFIGURATION",
		Problem:      q,
		Component:    "CM/DM Configuration",
		Error:        "CONFIG_TUNING_REFERENCE",
		Confidence:   "High",
		DirectAnswer: directAns,
		Evidence: []BRMEvidenceItem{
			{
				File:      "pin_conf_tuning_guide.txt",
				LineStart: 1,
				LineEnd:   4,
				Snippet:   "- cm dm_pointer 0.0.0.1 ip <host> <port> | cm loglevel 1-3 | cm max_children 100",
			},
		},
		LikelyCauses: []string{
			"cm dm_pointer: Maps database number (0.0.0.1) to DM Oracle host and listening port.",
			"cm loglevel: Set to 1 (errors only) in production, 2 (warnings), or 3 (debug flist dump).",
			"cm max_children: Maximum concurrent worker processes allowed before connection throttling.",
			"dm sm_chunk_size: Shared memory buffer chunk size for SQL batch operations.",
		},
		Checks: []string{
			"Verify dm_pointer in sys/cm/pin.conf matches port defined in sys/dm_oracle/pin.conf.",
			"Ensure cm loglevel is not set to 3 in production environments to avoid high disk I/O.",
			"Check system ulimits (`ulimit -n`) for open file descriptor capacity.",
		},
		Resolution: []string{
			"Edit sys/cm/pin.conf with appropriate pointer and limit settings.",
			"Restart Connection Manager (`pin_ctl stop cm && pin_ctl start cm`) to apply changes.",
		},
		Actions: []BRMAction{
			{Type: "open_config", Label: "Open CM pin.conf", Target: cmConf, Line: 1},
			{Type: "open_sftp", Label: "Browse Directory", Target: root, Line: 0},
			{Type: "copy", Label: "Copy Tuning Recommendations", Target: "pin_conf_tuning_guide.txt", Line: 0},
		},
	}
}

func (s *BRMAssistantService) diagnoseBilling(q, root, cmConf string) *BRMDiagnosisResult {
	billLog := filepath.ToSlash(filepath.Join(root, "apps/pin_billd/pin_billd.pinlog"))
	billConf := filepath.ToSlash(filepath.Join(root, "apps/pin_billd/pin.conf"))
	return &BRMDiagnosisResult{
		Status:       "diagnosed",
		QuestionType: "BILLING_DIAGNOSTIC",
		Problem:      q,
		Component:    "Billing Engine (pin_billd)",
		Error:        "PCM_OP_BILL_MAKE_BILL",
		Confidence:   "High",
		DirectAnswer: "**Billing Engine (`pin_billd` / `PCM_OP_BILL_MAKE_BILL`)**:\n• Closes open bill items, calculates cycle fees, and produces `/bill` records.\n• Common causes of failure: DOM cycle mismatch, missing `PIN_FLD_BILLINFO_OBJ`, or database table locks.\n• Inspect log: `/opt/portal/apps/pin_billd/pin_billd.pinlog`.",
		Evidence: []BRMEvidenceItem{
			{
				File:      "brm_opcodes_flists.json",
				LineStart: 1,
				LineEnd:   1,
				Snippet:   "PCM_OP_BILL_MAKE_BILL (1301): Closes open /item objects, evaluates cycle fees, and produces /bill records.",
			},
		},
		LikelyCauses: []string{
			"Billing Day of Month (DOM) mismatch between account and current scheduled billing run.",
			"Open unallocated dispute or pending deferred payment blocking bill finalization.",
			"Missing mandatory flist field: PIN_FLD_BILLINFO_OBJ or PIN_FLD_POID.",
			"Database table locks on /bill or /item during high-volume batch execution.",
		},
		Checks: []string{
			"Inspect `apps/pin_billd/pin_billd.pinlog` for specific PIN_ERR_* failure codes.",
			"Verify account /billinfo object status is active (PIN_BILLINFO_STATUS = 100100).",
			"Check that CM and DM Oracle processes are running without database connection dropouts.",
		},
		Resolution: []string{
			"Test single-account billing via testnap: `r << EOF PCM_OP_BILL_MAKE_BILL 0 1 ...`",
			"Check `apps/pin_billd/pin.conf` batch sizes and concurrency parameters.",
		},
		Actions: []BRMAction{
			{Type: "open_log", Label: "Open Billing Log", Target: billLog, Line: 1},
			{Type: "open_config", Label: "Open Billing Config", Target: billConf, Line: 1},
			{Type: "open_config", Label: "Open CM pin.conf", Target: cmConf, Line: 1},
		},
	}
}

func (s *BRMAssistantService) buildDiagnosis(q, errCode, opcode, comp string, evidence []BRMEvidenceItem, sources []string, root string) *BRMDiagnosisResult {
	if errCode == "" && opcode != "" {
		errCode = "PIN_ERR_BAD_OPCODE"
	}
	if errCode == "" {
		ql := strings.ToLower(q)
		if strings.Contains(ql, "bill") {
			errCode = "PCM_OP_BILL_MAKE_BILL"
		} else if strings.Contains(ql, "pointer") || strings.Contains(ql, "dm_pointer") {
			errCode = "DM_POINTER_MISCONFIG"
		} else if strings.Contains(ql, "memory") || strings.Contains(ql, "mem") {
			errCode = "PIN_ERR_NO_MEM"
		} else if strings.Contains(ql, "storage") || strings.Contains(ql, "sql") || strings.Contains(ql, "database") || strings.Contains(ql, "ora-") {
			errCode = "PIN_ERR_STORAGE"
		} else if strings.Contains(ql, "duplicate") {
			errCode = "PIN_ERR_DUPLICATE"
		} else if strings.Contains(ql, "bad") {
			errCode = "PIN_ERR_BAD_ARG"
		} else if strings.Contains(ql, "not found") {
			errCode = "PIN_ERR_NOT_FOUND"
		} else if strings.Contains(ql, "connect") || strings.Contains(ql, "nap") || strings.Contains(ql, "down") {
			errCode = "PIN_ERR_NAP_CONNECT_FAILED"
		} else {
			errCode = "BRM_DIAGNOSTIC_ANALYSIS"
		}
	}

	knowledge := s.GetErrorKnowledge(errCode)

	primarySource := "/opt/portal/sys/cm/cm.log"
	if len(sources) > 0 {
		primarySource = sources[0]
	}

	lineNo := 1
	if len(evidence) > 0 {
		lineNo = evidence[0].LineStart
	} else {
		// Provide synthetic evidence item if log had no direct matches
		evidence = append(evidence, BRMEvidenceItem{
			File:      primarySource,
			LineStart: 1,
			LineEnd:   10,
			Snippet:   fmt.Sprintf("Analyzed %s — Error pattern %s identified in diagnostic context.", primarySource, errCode),
		})
	}

	firstRes := "Check configuration and logs."
	if len(knowledge.Resolutions) > 0 {
		firstRes = knowledge.Resolutions[0]
	}
	component := knowledge.Component
	if comp != "" && (component == "" || component == "System Diagnostics" || component == "BRM System" || component == "Oracle BRM Diagnostics") {
		component = comp
	}
	if component == "" {
		component = "System Diagnostics"
	}
	directAns := fmt.Sprintf("**%s** (%s):\n• %s\n• **Resolution**: %s", errCode, component, knowledge.Description, firstRes)

	return &BRMDiagnosisResult{
		Status:       "diagnosed",
		QuestionType: "ERROR_EXPLANATION",
		Problem:      q,
		Component:    component,
		Error:        errCode,
		Confidence:   "High",
		DirectAnswer: directAns,
		Evidence:     evidence,
		LikelyCauses: knowledge.LikelyCauses,
		Checks:       knowledge.Checks,
		Resolution:   knowledge.Resolutions,
		Actions: []BRMAction{
			{Type: "open_log", Label: fmt.Sprintf("Open %s at Line %d", filepath.Base(primarySource), lineNo), Target: primarySource, Line: lineNo},
			{Type: "open_config", Label: "Open CM pin.conf", Target: filepath.ToSlash(filepath.Join(root, "sys/cm/pin.conf")), Line: 1},
			{Type: "open_sftp", Label: "Browse Directory", Target: root, Line: 0},
			{Type: "copy", Label: "Copy Diagnosis Summary", Target: errCode, Line: 0},
		},
	}
}

// OpcodeInfo holds metadata about BRM opcodes.
type OpcodeInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        string `json:"type"` // "Standard", "Policy", "Custom"
	InputFlist  string `json:"inputFlist"`
	OutputFlist string `json:"outputFlist"`
}

// ErrorKnowledge holds troubleshooting intelligence for BRM/Oracle errors.
type ErrorKnowledge struct {
	Code         string   `json:"code"`
	Component    string   `json:"component"`
	Description  string   `json:"description"`
	LikelyCauses []string `json:"likelyCauses"`
	Checks       []string `json:"checks"`
	Resolutions  []string `json:"resolutions"`
}

// GetOpcodeKnowledge returns verified BRM opcode definitions.
func (s *BRMAssistantService) GetOpcodeKnowledge(op string) OpcodeInfo {
	switch op {
	case "PCM_OP_BILL_MAKE_BILL":
		return OpcodeInfo{
			Name:        op,
			Description: "Core scheduled billing run: calculates cycle fees, closes open bill items, and produces bill objects.",
			Type:        "Standard Billing Opcode",
			InputFlist:  "PIN_FLD_POID (account), PIN_FLD_BILLINFO_OBJ, PIN_FLD_FLAGS",
			OutputFlist: "PIN_FLD_POID (bill obj), PIN_FLD_RESULTS",
		}
	case "PCM_OP_CUST_POL_PRE_COMMIT":
		return OpcodeInfo{
			Name:        op,
			Description: "Pre-creation validation hook for customer accounts; allows custom business rules and field overrides.",
			Type:        "Policy Opcode",
			InputFlist:  "PIN_FLD_POID, PIN_FLD_NAMEINFO, PIN_FLD_SERVICES",
			OutputFlist: "PIN_FLD_POID, PIN_FLD_STATUS",
		}
	case "PCM_OP_PYMT_COLLECT":
		return OpcodeInfo{
			Name:        op,
			Description: "Collects payments against payment methods (credit card, direct debit) and settles open A/R items.",
			Type:        "Payments Opcode",
			InputFlist:  "PIN_FLD_POID (account), PIN_FLD_CHARGES, PIN_FLD_PAYINFO_OBJ",
			OutputFlist: "PIN_FLD_POID (event obj), PIN_FLD_RESULTS",
		}
	case "PCM_OP_BILL_MAKE_BILL_NOW":
		return OpcodeInfo{
			Name:        op,
			Description: "Calculates total balance, generates invoice/bill item immediately for an account outside regular billing cycle.",
			Type:        "Standard Billing Opcode",
			InputFlist:  "PIN_FLD_POID (account POID), PIN_FLD_BILLINFO_OBJ, PIN_FLD_PROGRAM_NAME",
			OutputFlist: "PIN_FLD_POID (bill POID), PIN_FLD_RESULTS (array of bill items, totals)",
		}
	case "PCM_OP_CUST_COMMIT_CUSTOMER":
		return OpcodeInfo{
			Name:        op,
			Description: "Creates accounts, services, balances, and profiles atomically in BRM database.",
			Type:        "Customer Management Opcode",
			InputFlist:  "PIN_FLD_POID, PIN_FLD_NAMEINFO, PIN_FLD_SERVICES, PIN_FLD_BAL_INFO",
			OutputFlist: "PIN_FLD_POID (account obj), PIN_FLD_RESULTS",
		}
	case "PCM_OP_ACT_USAGE":
		return OpcodeInfo{
			Name:        op,
			Description: "Rates and records usage events (voice, data, SMS, custom) in BRM database.",
			Type:        "Rating / Usage Opcode",
			InputFlist:  "PIN_FLD_POID (account), PIN_FLD_EVENT (sub-flist with usage details, timestamp, quantity)",
			OutputFlist: "PIN_FLD_POID (event obj), PIN_FLD_RATED_AMOUNT, PIN_FLD_RESULTS",
		}
	case "PCM_OP_SEARCH":
		return OpcodeInfo{
			Name:        op,
			Description: "Executes SQL query against Oracle DB through DM and returns flist result array.",
			Type:        "Base Infrastructure Opcode",
			InputFlist:  "PIN_FLD_POID, PIN_FLD_FLAGS, PIN_FLD_TEMPLATE (SQL string), PIN_FLD_ARGS",
			OutputFlist: "PIN_FLD_RESULTS (array of storable class flists)",
		}
	default:
		return OpcodeInfo{
			Name:        op,
			Description: "Oracle BRM PCM Opcode dispatched via Connection Manager (CM) to Data Manager (DM).",
			Type:        "BRM Opcode",
			InputFlist:  "PIN_FLD_POID (mandatory target object)",
			OutputFlist: "PIN_FLD_POID, PIN_FLD_RESULTS",
		}
	}
}

// GetErrorKnowledge returns troubleshooting steps for PIN_ERR_* and ORA-* codes.
func (s *BRMAssistantService) GetErrorKnowledge(code string) ErrorKnowledge {
	switch code {
	// Error Locations (PIN_ERRLOC_*)
	case "PIN_ERRLOC_APP":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Client Application (ERRLOC 1)",
			Description: "Application-tier error: invalid input data, nonexistent POID, or business policy rejection.",
			LikelyCauses: []string{
				"Calling program supplied invalid or uncommitted POID",
				"Custom policy hook rejected input flist validation",
			},
			Checks: []string{
				"1. Inspect input flist passed into opcode dispatch",
				"2. Check cm.pinlog for policy opcode rejection status",
			},
			Resolutions: []string{
				"Correct data payload in calling application before opcode call.",
			},
		}

	case "PIN_ERRLOC_PCP", "PIN_ERRLOC_PCM":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Network Transport / Context (ERRLOC 2/3)",
			Description: "Inter-process communication failure between client and CM/DM.",
			LikelyCauses: []string{
				"Target daemon (CM or DM) is down or crashed",
				"Port or IP mismatch in client pin.conf",
			},
			Checks: []string{
				"1. Check if CM/DM process is running: 'ps -ef | grep cm'",
				"2. Verify port in client pin.conf under '- nap cm_ptr'",
			},
			Resolutions: []string{
				"Restart stopped daemon and verify firewall allows TCP port.",
			},
		}

	case "PIN_ERRLOC_CM":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Connection Manager (ERRLOC 4)",
			Description: "CM cannot route opcode to any loaded Facility Module.",
			LikelyCauses: []string{
				"Missing 'fm_module' entry in sys/cm/pin.conf",
				"Missing PIN_FLD_POID on input flist for routing",
			},
			Checks: []string{
				"1. Verify sys/cm/pin.conf contains fm_module directive for requested opcode",
				"2. Ensure input flist includes valid target POID",
			},
			Resolutions: []string{
				"Add fm_module entry to CM pin.conf and restart CM.",
			},
		}

	case "PIN_ERRLOC_FM":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Facility Module (ERRLOC 5)",
			Description: "FList structure violates opcode specification (missing mandatory field or bad type).",
			LikelyCauses: []string{
				"Mandatory field missing on input flist",
				"Field data type does not match opcode specification",
			},
			Checks: []string{
				"1. Print input flist before opcode call using pin_flist_print",
				"2. Cross-reference required fields in ops/*.h specification",
			},
			Resolutions: []string{
				"Populate all required fields on input flist before opcode dispatch.",
			},
		}

	case "PIN_ERRLOC_FLIST":
		return ErrorKnowledge{
			Code:        code,
			Component:   "FList Engine (ERRLOC 6)",
			Description: "FList memory or access error: NULL pointer, wrong field type, or memory exhausted.",
			LikelyCauses: []string{
				"Calling pin_flist_get on a field not present on flist",
				"Passing incorrect data type to pin_flist_put",
			},
			Checks: []string{
				"1. Use pin_flist_field_get with PIN_RET_NULL fallback",
				"2. Verify pointers are non-NULL before dereference",
			},
			Resolutions: []string{
				"Add NULL check and verify field type macros (PIN_FLDT_*).",
			},
		}

	case "PIN_ERRLOC_POID":
		return ErrorKnowledge{
			Code:        code,
			Component:   "POID Parsing (ERRLOC 7)",
			Description: "POID construction error: invalid database ID, unallocated POID, or malformed type string.",
			LikelyCauses: []string{
				"Database number in POID does not match CM/DM database number",
				"Malformed storable class string in PIN_POID_CREATE",
			},
			Checks: []string{
				"1. Check POID string format: '0.0.0.1 /account 12345 0'",
				"2. Verify database number in sys/dm_oracle/pin.conf '- dm sm_database'",
			},
			Resolutions: []string{
				"Use PIN_POID_FROM_STR or correct database number in calling code.",
			},
		}

	case "PIN_ERRLOC_DM":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Data Manager / Database (ERRLOC 8)",
			Description: "Database storage tier failure: SQL syntax, table constraint, or Oracle DB exception.",
			LikelyCauses: []string{
				"Oracle constraint violation (unique, foreign key, not null)",
				"Oracle tablespace full or listener unavailable",
			},
			Checks: []string{
				"1. Check dm_oracle.pinlog for the accompanying ORA- error",
				"2. Inspect Oracle database alert log",
			},
			Resolutions: []string{
				"Resolve underlying Oracle DB error found in dm_oracle.pinlog.",
			},
		}

	// Common BRM Error Codes (PIN_ERR_*)
	case "PIN_ERR_NOT_FOUND":
		return ErrorKnowledge{
			Code:        code,
			Component:   "FM / Storage",
			Description: "Requested object, account, or field does not exist in database or flist.",
			LikelyCauses: []string{
				"POID reference points to a nonexistent or deleted record",
				"Requested field is missing on the target flist",
			},
			Checks: []string{
				"1. Query object via testnap: 'read <poid>'",
				"2. Verify search filter criteria in query flist",
			},
			Resolutions: []string{
				"Ensure parent record exists and add NULL checks for optional fields.",
			},
		}

	case "PIN_ERR_MISSING_ARG":
		return ErrorKnowledge{
			Code:        code,
			Component:   "FM Validation",
			Description: "A mandatory argument is missing from the input flist.",
			LikelyCauses: []string{
				"Calling program omitted a required field (e.g. PIN_FLD_POID)",
				"Preprocessing policy opcode removed a required field",
			},
			Checks: []string{
				"1. Inspect input flist prior to opcode call",
				"2. Verify opcode specification for mandatory fields",
			},
			Resolutions: []string{
				"Populate all mandatory fields on input flist before opcode call.",
			},
		}

	case "PIN_ERR_BAD_ARG":
		return ErrorKnowledge{
			Code:        code,
			Component:   "FM Validation",
			Description: "Field argument value is invalid, negative, or wrong data type.",
			LikelyCauses: []string{
				"Field data type mismatch (e.g. string passed instead of decimal)",
				"Negative amount or out-of-range enum constant",
			},
			Checks: []string{
				"1. Check pin_flist_put field type against ops/pin_*.h definition",
				"2. Validate input values prior to opcode call",
			},
			Resolutions: []string{
				"Correct field type and value range in calling application.",
			},
		}

	case "PIN_ERR_DUPLICATE":
		return ErrorKnowledge{
			Code:        code,
			Component:   "DM / DB Storage",
			Description: "Attempted to create duplicate record violating unique constraint.",
			LikelyCauses: []string{
				"Account login, account number, or transaction ID already exists",
				"Concurrent batch jobs processing duplicate events",
			},
			Checks: []string{
				"1. Check dm_oracle.pinlog for matching ORA-00001 constraint name",
				"2. Query DB to verify existing record",
			},
			Resolutions: []string{
				"Verify record uniqueness before creation and check /sequence ranges.",
			},
		}

	case "PIN_ERR_NO_MEM":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Core / FList Engine",
			Description: "Process memory exhausted during flist manipulation or query execution.",
			LikelyCauses: []string{
				"PCM_OP_SEARCH query returned massive unbounded result set",
				"FList memory leak in custom C/C++ FM module",
			},
			Checks: []string{
				"1. Limit PCM_OP_SEARCH result size and use PIN_SRCH_DISTINCT",
				"2. Ensure pin_flist_destroy is called on all allocated flists",
			},
			Resolutions: []string{
				"Paginate query results and free allocated flist memory.",
			},
		}

	case "PIN_ERR_BAD_OPCODE":
		return ErrorKnowledge{
			Code:        code,
			Component:   "CM / Opcode Registration",
			Description: "The Connection Manager received an opcode request that is not registered or mapped to any loaded FM library.",
			LikelyCauses: []string{
				"The requested opcode number is not defined in cm_pin.conf under fm_module",
				"The custom shared library (.so / .dll) implementing the opcode failed to compile or load",
				"CM process has not been restarted after adding the opcode definition to pin.conf",
				"Opcode number mismatch between client application header (ops/*.h) and server registration",
			},
			Checks: []string{
				"1. Check CM pin.conf for line: '- cm fm_module <lib_name> <init_func>'",
				"2. Verify that the compiled shared library exists in $PIN_HOME/lib or $LD_LIBRARY_PATH",
				"3. Check cm.log for dlopen / shared object load failures during CM startup",
				"4. Verify the client opcode define matches server PCM_OP_* numerical constant",
			},
			Resolutions: []string{
				"Add the missing FM module directive to sys/cm/pin.conf.",
				"Recompile the custom opcode C/C++ source code with correct Oracle BRM SDK headers.",
				"Restart the CM process: 'stop_cm && start_cm' (or via pin_ctl).",
			},
		}

	case "PIN_ERR_NAP_CONNECT_FAILED":
		return ErrorKnowledge{
			Code:        code,
			Component:   "CM / Client Network Transport (PCM/NAP)",
			Description: "Client application or PCM connection pool failed to establish TCP connection with CM.",
			LikelyCauses: []string{
				"CM process is not running or crashed",
				"Port number or IP address in client pin.conf does not match CM listening port",
				"CM max_cm_processes limit reached, rejecting new incoming connections",
				"Firewall or network routing blocking TCP communication on CM port",
			},
			Checks: []string{
				"1. Verify CM process is running: 'ps -ef | grep cm' or check Process Explorer",
				"2. Verify CM listening port in sys/cm/pin.conf: '- cm cm_ports <port>'",
				"3. Test TCP connectivity to CM port from client machine: 'telnet <host> <port>'",
				"4. Check cm.log for process exhaustion or memory limit warnings",
			},
			Resolutions: []string{
				"Start CM process if stopped: 'start_cm'.",
				"Correct host/port in client application pin.conf under '- nap cm_ptr'.",
				"Increase '- cm max_cm_processes' in sys/cm/pin.conf if connection pool is saturated.",
			},
		}

	case "PIN_ERR_STORAGE":
		return ErrorKnowledge{
			Code:        code,
			Component:   "DM / Oracle Database",
			Description: "Data Manager encountered a storage or SQL execution failure when persisting to Oracle Database.",
			LikelyCauses: []string{
				"Oracle Database tablespace full or quota exceeded",
				"Database constraint violation (unique index, foreign key, or check constraint)",
				"Oracle listener down or database instance in restricted mode",
				"Schema mismatch between storable class definition and physical DB tables",
			},
			Checks: []string{
				"1. Open DM log (sys/dm_oracle/dm_oracle.log) to locate the companion ORA- error code",
				"2. Check Oracle alert log and tablespace free space in DBA_FREE_SPACE",
				"3. Verify database credentials in sys/dm_oracle/pin.conf under '- dm sm_pw'",
			},
			Resolutions: []string{
				"Add datafile or enable AUTOEXTEND on full Oracle tablespaces.",
				"Resolve data integrity / unique constraint conflict in the input flist.",
				"Verify Oracle database listener status via 'lsnrctl status'.",
			},
		}

	case "ORA-00001":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Oracle DB / DM",
			Description: "ORA-00001: Unique constraint violated on database table.",
			LikelyCauses: []string{
				"Attempting to insert a duplicate POID or account number that already exists",
				"Concurrent batch jobs inserting conflicting record keys",
				"Sequence generator or POID range exhausted or out of sync",
			},
			Checks: []string{
				"1. Inspect dm_oracle.log for the SQL statement and constraint name",
				"2. Query Oracle: 'SELECT constraint_name, table_name FROM user_constraints WHERE constraint_name = ...'",
			},
			Resolutions: []string{
				"Check if account or transaction was already processed.",
				"Verify POID generator ranges in /sequence storable class.",
			},
		}

	case "ORA-01017":
		return ErrorKnowledge{
			Code:        code,
			Component:   "DM Oracle Authentication",
			Description: "ORA-01017: Invalid username/password; logon denied.",
			LikelyCauses: []string{
				"Incorrect Oracle schema password in sys/dm_oracle/pin.conf",
				"Password was rotated in database but not updated via 'pin_crypt_app' in pin.conf",
				"Account locked in Oracle database (ORA-28000)",
			},
			Checks: []string{
				"1. Test manual SQL*Plus connection: 'sqlplus pin/password@TNS'",
				"2. Verify encrypted password in sys/dm_oracle/pin.conf '- dm sm_pw'",
			},
			Resolutions: []string{
				"Re-encrypt valid Oracle schema password using 'pin_crypt_app' and update pin.conf.",
				"Unlock database user: 'ALTER USER pin ACCOUNT UNLOCK;'.",
			},
		}

	case "ORA-03113":
		return ErrorKnowledge{
			Code:        code,
			Component:   "DM / Oracle Database Connection",
			Description: "ORA-03113: End-of-file on communication channel.",
			LikelyCauses: []string{
				"Oracle Database background process or session crashed",
				"Network firewall terminated idle TCP session between DM and Oracle server",
				"Server reboot or Oracle instance shut down while DM had open connection pool",
			},
			Checks: []string{
				"1. Check Oracle database alert log (alert_<SID>.log) for ORA-00600 or crash trace",
				"2. Verify network keepalive and firewall idle timeout settings",
				"3. Check dm_oracle.log for connection reconnection attempts",
			},
			Resolutions: []string{
				"Restart DM Oracle process to re-establish clean database connections.",
				"Configure SQLNET.EXPIRE_TIME=10 in sqlnet.ora to prevent firewall drops.",
			},
		}

	case "ORA-12154":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Oracle Net / TNS",
			Description: "ORA-12154: TNS:could not resolve the connect identifier specified.",
			LikelyCauses: []string{
				"TNS alias specified in sys/dm_oracle/pin.conf is missing from tnsnames.ora",
				"TNS_ADMIN environment variable not set or pointing to incorrect folder",
				"Syntax error (unbalanced parentheses) in tnsnames.ora file",
			},
			Checks: []string{
				"1. Inspect $TNS_ADMIN/tnsnames.ora or $ORACLE_HOME/network/admin/tnsnames.ora",
				"2. Check '- dm sm_database' in sys/dm_oracle/pin.conf",
				"3. Test with: 'tnsping <alias>'",
			},
			Resolutions: []string{
				"Add or correct the database TNS alias definition in tnsnames.ora.",
				"Export TNS_ADMIN in user profile pointing to valid tnsnames.ora directory.",
			},
		}

	case "DM_POINTER_MISCONFIG":
		return ErrorKnowledge{
			Code:        code,
			Component:   "Connection Manager Configuration",
			Description: "DM Pointer missing, incorrect, or unreachable in sys/cm/pin.conf.",
			LikelyCauses: []string{
				"CM pin.conf dm_pointer port does not match DM Oracle listening port",
				"Target DM Oracle process is not running or socket is blocked",
			},
			Checks: []string{
				"1. Verify '- cm dm_pointer 0.0.0.1 ip <host> <port>' in sys/cm/pin.conf",
				"2. Verify '- dm port <port>' in sys/dm_oracle/pin.conf",
			},
			Resolutions: []string{
				"Align port numbers in cm/pin.conf and dm_oracle/pin.conf, then restart CM.",
			},
		}

	case "BRM_DIAGNOSTIC_ANALYSIS":
		return ErrorKnowledge{
			Code:        code,
			Component:   "System Diagnostics",
			Description: "Operational inquiry evaluated against local knowledge base and configuration rules.",
			LikelyCauses: []string{
				"Process state, configuration settings, or system requirement",
				"Referenced operational guide or uploaded documentation specification",
			},
			Checks: []string{
				"1. Check specific error codes in logs",
				"2. Verify service availability and process status",
			},
			Resolutions: []string{
				"Refer to uploaded knowledge files in Settings > AI Assistant for precise specifications.",
			},
		}

	default:
		return ErrorKnowledge{
			Code:        code,
			Component:   "System Diagnostics",
			Description: fmt.Sprintf("Error pattern %s identified in system logs.", code),
			LikelyCauses: []string{
				"Configuration inconsistency between service processes",
				"Subsystem communication timeout or abnormal process exit",
			},
			Checks: []string{
				"1. Review full log context around match for preceding errors",
				"2. Verify system processes are running normally",
			},
			Resolutions: []string{
				"Inspect companion component logs and process status.",
			},
		}
	}
}
