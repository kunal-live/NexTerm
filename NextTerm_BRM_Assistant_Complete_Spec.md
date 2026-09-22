# NextTerm BRM Assistant — Complete Working & Architecture Specification

## 1. Purpose

The **BRM Assistant** is a built-in, read-only troubleshooting assistant inside NextTerm.

It helps BRM developers/operators:

- Find BRM-specific folders and files
- Identify BRM logs
- Read selected logs, configuration, and source files
- Explain BRM errors using actual evidence
- Suggest practical troubleshooting and resolution steps
- Open the relevant file, log, or folder directly in NextTerm

### Critical rule

The assistant is **READ-ONLY**. It must never:

- Modify files or logs
- Delete, rename, or move files
- Change configuration
- Restart services automatically
- Kill processes automatically
- Deploy code automatically
- Execute destructive commands

It only **reads, analyzes, explains, and guides**.

---

## 2. Main User Workflow

```text
User asks a BRM question
        |
        v
BRM Assistant understands the question
        |
        v
Determines required evidence
        |
        v
Asks user what source/component to inspect
        |
        +-------------------+
        |                   |
        v                   v
   User selects        User selects
   one source          All Relevant
        |                   |
        +---------+---------+
                  |
                  v
        Read-only collection
                  |
                  v
        BRM-specific analysis
                  |
                  v
       Evidence + diagnosis
                  |
                  v
      Troubleshooting steps
                  |
                  v
     Optional navigation actions
```

---

## 3. Example Interaction

### User

```text
Why is PCM_OP_BILL_MAKE_BILL_NOW failing?
```

### Assistant

```text
I need evidence to diagnose this.

Which source should I inspect?

[CM Log]
[DM Log]
[Opcode Source]
[pin.conf]
[All Relevant]
```

### After source selection

The assistant reads only the selected source, extracts relevant evidence, explains the likely cause, and provides troubleshooting steps.

---

## 4. Core Capabilities

### 4.1 BRM Folder Finder

Detect common BRM locations and return actual paths discovered in the environment.

```text
BRM Home
├── sys
├── source
├── include
├── bin
├── lib
├── log
├── pin.conf
├── pin_setup.values
├── PDC
├── ECE
└── Pipeline
```

Example:

```text
User: Where is my CM pin.conf?

Assistant:
Found:
C:\Oracle\BRM\sys\cm\pin.conf
```

Never invent a path; only report discovered paths.

---

## 5. BRM Installation Discovery

Perform a read-only discovery of likely BRM installations using signals such as:

- Known BRM directory names
- `pin.conf`
- `pin_setup.values`
- BRM binaries and libraries
- PDC/ECE/Pipeline directories
- Environment variables
- Configuration references

Example:

```text
BRM Installation Detected

Root:
C:\Oracle\BRM

Components:
├── CM
├── DM
├── EM
├── PDC
└── ECE
```

Store discovered paths in a local **BRM Workspace Context** for the current workspace/session.

---

## 6. Log Discovery

Identify logs from the selected BRM installation.

```text
CM Logs
DM Logs
EM Logs
BRM Application Logs
Pipeline Logs
ECE Logs
Custom Opcode Logs
```

Actual paths must come from the user's environment.

---

## 7. User-Selected Source Model

The assistant should ask before reading a source whenever the source is ambiguous.

```text
What should I inspect?

[CM Log]
[DM Log]
[EM Log]
[Opcode Source]
[pin.conf]
[Other File]
[All Relevant]
```

Rules:

- Read only the selected source
- `All Relevant` requires explicit user selection
- Explain what source is needed when the current source is insufficient
- Do not silently scan unrelated files

---

## 8. Log Analyzer

The analyzer performs read-only processing.

```text
Selected Log
     |
     v
Read file
     |
     v
Parse lines
     |
     v
Detect errors/warnings
     |
     v
Group related events
     |
     v
Extract context
     |
     v
Map to BRM concepts
     |
     v
Generate explanation
```

---

## 9. Error Detection

Support an extensible pattern library for entries such as:

```text
ERROR
WARN
ORA-
PIN_ERR_
PCM_OP
bad opcode
connection failed
connection refused
service unavailable
timeout
segmentation fault
permission denied
file not found
```

---

## 10. Error Grouping

Group repeated or related errors instead of showing hundreds of raw lines.

Example:

```text
42 occurrences

Root Event
----------
DM connection lost

Related events
--------------
CM request failures
Billing operation failures
Database request errors
```

Correlation must not be presented as proven causation unless evidence supports it.

---

## 11. Context Extraction

When an error is detected, read a bounded number of lines around the match.

```text
16:02:11 ERROR DM connection failed
16:02:11 ERROR ORA-xxxxx
16:02:12 WARN  Retry attempt 1
16:02:14 ERROR Request failed
```

Use relevant context rather than loading an entire large log into memory.

---

## 12. BRM Knowledge Layer

Maintain versioned BRM-specific knowledge.

```text
BRM Architecture
├── CM
├── DM
├── EM
├── PCM
├── Opcodes
├── pin_flist
├── Storable Classes
├── PDC
├── ECE
├── Pipeline Manager
└── Custom Modules
```

Also maintain mappings for common errors, Oracle errors, configuration issues, library/deployment issues, and CM/DM communication failures.

Actual environment evidence always takes priority over generic knowledge.

---

## 13. Evidence-First Answering

Every diagnosis should use a consistent structure:

```text
Problem
Evidence
Component
Likely Cause
Checks
Resolution
```

Example:

```text
Problem
PCM_OP_BILL_MAKE_BILL_NOW is failing.

Evidence
CM log contains PIN_ERR_BAD_OPCODE.

Component
CM / Opcode registration

Likely Cause
The requested opcode is not available to the running CM.

Checks
1. Verify opcode implementation
2. Verify registration/configuration
3. Verify compiled library
4. Verify deployment
5. Verify CM configuration

Resolution
Correct the registration/deployment issue and verify the CM configuration.

Evidence Source
C:\Oracle\BRM\sys\cm\logs\cm.log
Lines 1542–1547
```

The assistant must clearly separate **confirmed evidence**, **likely cause**, and **recommended checks**.

---

## 14. Troubleshooting Guidance

Guide the user step by step without automatically making changes.

```text
Problem
   |
   v
Evidence
   |
   v
Component
   |
   v
Check
   |
   v
Expected Result
   |
   v
Next Check
   |
   v
Resolution
```

Example:

```text
1. Open CM log
2. Locate PIN_ERR_BAD_OPCODE
3. Check opcode registration
4. Check custom library
5. Check configuration
6. Verify the running CM uses the expected configuration
7. Re-check the log after the user performs the fix
```

---

## 15. File / Log Viewer Integration

Every important result should provide navigation actions.

```text
[Open Log]
[Open File]
[Open Folder]
[Show Config]
[Show Related Source]
```

Example:

```text
Error found in:
C:\Oracle\BRM\sys\cm\logs\cm.log

[Open at line 1542]
```

NextTerm should jump directly to the relevant location when possible.

---

## 16. BRM Component Mapping

The assistant should understand core BRM relationships.

```text
Client
  |
  v
CM
  |
  v
Opcode
  |
  v
PCM
  |
  v
DM
  |
  v
Oracle Database
```

And broader components:

```text
BRM
├── CM
├── DM
├── EM
├── PDC
├── ECE
└── Pipeline Manager
```

This helps identify which component is relevant to a given error.

---

## 17. Question Classification

Classify the user's request before collecting evidence.

```text
LOCATION
LOG_ANALYSIS
ERROR_EXPLANATION
CONFIGURATION
OPCODE
ARCHITECTURE
SERVICE_STATUS
GENERAL_BRM
```

Examples:

```text
Where is pin.conf?
→ LOCATION

Why is my CM failing?
→ LOG_ANALYSIS / ERROR_EXPLANATION

What does PCM_OP_BILL_MAKE_BILL_NOW do?
→ OPCODE / GENERAL_BRM
```

---

## 18. BRM Context Manager

Maintain temporary read-only context for the current diagnostic session.

```text
BRMContext
├── Installation Roots
├── Components
├── Selected Server
├── Selected Log
├── Selected File
├── Current Error
├── Relevant Evidence
└── Conversation Context
```

Example:

```json
{
  "installationRoot": "C:\\Oracle\\BRM",
  "selectedComponent": "CM",
  "selectedLog": "C:\\Oracle\\BRM\\sys\\cm\\logs\\cm.log",
  "currentError": "PIN_ERR_BAD_OPCODE"
}
```

---

## 19. High-Level Architecture

```text
                         ┌─────────────────────┐
                         │     NextTerm UI     │
                         │                     │
                         │   BRM Assistant     │
                         │       Chat          │
                         └──────────┬──────────┘
                                    |
                                    v
                         ┌─────────────────────┐
                         │ Question Classifier │
                         └──────────┬──────────┘
                                    |
                                    v
                         ┌─────────────────────┐
                         │   Source Selector   │
                         │ CM / DM / EM / etc. │
                         └──────────┬──────────┘
                                    |
                                    v
                         ┌─────────────────────┐
                         │ Read-Only Collector │
                         ├─────────────────────┤
                         │ Filesystem Scanner  │
                         │ Log Reader          │
                         │ Config Reader       │
                         │ Source Reader       │
                         └──────────┬──────────┘
                                    |
                                    v
                         ┌─────────────────────┐
                         │  BRM Context Mgr    │
                         └──────────┬──────────┘
                                    |
                       ┌────────────┴────────────┐
                       v                         v
              ┌────────────────┐        ┌────────────────┐
              │ Error Analyzer │        │ BRM Knowledge  │
              └───────┬────────┘        └───────┬────────┘
                      |                         |
                      └───────────┬─────────────┘
                                  v
                       ┌─────────────────────┐
                       │ Diagnosis / Answer  │
                       │ Engine              │
                       └──────────┬──────────┘
                                  |
                                  v
                       ┌─────────────────────┐
                       │ NextTerm Response   │
                       ├─────────────────────┤
                       │ Evidence            │
                       │ Explanation         │
                       │ Troubleshooting     │
                       │ Navigation actions  │
                       └─────────────────────┘
```

---

## 20. Read-Only Safety Architecture

All filesystem/remote access should pass through a read-only adapter.

```text
                    BRM Assistant
                         |
                         v
                 ReadOnlyAdapter
                         |
          ┌──────────────┼──────────────┐
          v              v              v
      Read File      List Folder    Read Metadata
```

Expose only operations such as:

```text
readFile
listDirectory
getMetadata
searchFile
searchLog
readEnvironment
```

Do not expose mutation capabilities such as:

```text
write
 delete
 rename
 move
 chmod
 restart
 kill
 deploy
```

---

## 21. Remote SSH Architecture

NextTerm can inspect a remote BRM server over the existing SSH connection.

```text
NextTerm
   |
   | SSH connection
   v
Remote BRM Server
   |
   ├── Read BRM directories
   ├── Read selected logs
   ├── Read selected configs
   └── Read selected source
```

All operations remain read-only.

---

## 22. Local Architecture

The same assistant can inspect a local BRM installation.

```text
NextTerm
   |
   v
Local Machine
   |
   ├── BRM Home
   ├── Config
   ├── Logs
   └── Source
```

Use the same logical collector interface for local and remote environments.

---

## 23. Unified Collector Interface

Use one abstraction so analysis does not depend on where the data lives.

```text
ReadOnlyEnvironment
├── listDirectory(path)
├── readFile(path)
├── search(path, pattern)
├── getMetadata(path)
└── exists(path)
```

Implementations:

```text
LocalEnvironment
SSHEnvironment
```

---

## 24. Suggested Backend Structure

```text
brm-assistant/
│
├── classifier/
│   └── questionClassifier
│
├── discovery/
│   ├── brmDetector
│   ├── folderFinder
│   └── componentDetector
│
├── collectors/
│   ├── readOnlyEnvironment
│   ├── localCollector
│   └── sshCollector
│
├── logs/
│   ├── logDetector
│   ├── logParser
│   ├── errorDetector
│   ├── contextExtractor
│   └── errorGrouper
│
├── brm/
│   ├── componentMap
│   ├── opcodeKnowledge
│   ├── errorKnowledge
│   ├── configKnowledge
│   └── troubleshootingRules
│
├── analysis/
│   ├── evidenceMapper
│   ├── diagnosisEngine
│   └── resolutionEngine
│
├── context/
│   └── brmContext
│
└── ui/
    ├── assistantPanel
    ├── sourceSelector
    ├── evidenceViewer
    └── resultActions
```

---

## 25. Request / Response Model

### Request

```json
{
  "question": "Why is PCM_OP_BILL_MAKE_BILL_NOW failing?",
  "environment": "ssh",
  "selectedSource": {
    "type": "cm_log",
    "path": "/opt/brm/sys/cm/log/cm.log"
  }
}
```

### Response

```json
{
  "status": "diagnosed",
  "component": "CM",
  "error": "PIN_ERR_BAD_OPCODE",
  "confidence": "medium",
  "evidence": [
    {
      "file": "/opt/brm/sys/cm/log/cm.log",
      "lineStart": 1542,
      "lineEnd": 1547
    }
  ],
  "likelyCauses": [
    "Opcode registration issue",
    "Incorrect deployed library",
    "CM using unexpected configuration"
  ],
  "checks": [
    "Verify opcode registration",
    "Verify custom library",
    "Verify configuration"
  ]
}
```

---

## 26. UI Architecture

Add the assistant to the existing vertical navigation.

```text
Vertical Navigation
├── Sessions
├── SFTP
├── Macros
├── Tunneling
├── System Tools
├── Follow Terminal
├── Monitoring
└── BRM Assistant
```

### Assistant Panel

```text
┌──────────────────────────────────────────────┐
│ BRM Assistant                            ×   │
├──────────────────────────────────────────────┤
│ What do you want to investigate?             │
│                                              │
│ [ Ask your BRM question...               ]   │
│                                              │
│ Source Selection                             │
│ [CM Log] [DM Log] [EM Log]                  │
│ [Opcode] [pin.conf] [All Relevant]          │
│                                              │
│ Diagnosis                                    │
│ Error: PIN_ERR_BAD_OPCODE                    │
│                                              │
│ Evidence                                     │
│ cm.log : lines 1542–1547                     │
│                                              │
│ Likely Cause                                 │
│ ...                                          │
│                                              │
│ Resolution                                   │
│ 1. ...                                       │
│ 2. ...                                       │
│ 3. ...                                       │
│                                              │
│ [Open Log] [Open Config] [Open Source]       │
└──────────────────────────────────────────────┘
```

---

## 27. All Relevant Mode

`All Relevant` is still read-only, but it may inspect multiple related sources after explicit user selection.

```text
All Relevant
     |
     +── CM Log
     +── DM Log
     +── pin.conf
     +── Opcode Source
     +── Related Config
```

Before collection, show the planned sources when practical:

```text
I will inspect:
- CM log
- DM log
- pin.conf
- Related opcode source

Continue?
```

---

## 28. Search Strategy

Use targeted searches instead of unrestricted disk scanning.

Examples:

```text
PIN_ERR_BAD_OPCODE
PCM_OP_BILL_MAKE_BILL_NOW
ORA-
dm_oracle
pin.conf
opcode registration
```

Preferred order:

```text
Known BRM root
   ↓
Known component directory
   ↓
Known log/config directory
   ↓
Targeted file search
```

---

## 29. Large Log Handling

BRM logs can be large. Use:

```text
tail / bounded reads
time-window filtering
pattern filtering
bounded context windows
streamed reads
```

Preferred flow:

```text
Search
   ↓
Locate relevant lines
   ↓
Read context around matches
   ↓
Analyze relevant content only
```

Do not load multi-gigabyte logs entirely into memory.

---

## 30. Incremental Diagnostics

When evidence is insufficient, ask for the next relevant source rather than guessing.

Example:

```text
The CM log shows the error, but it does not establish why the opcode is unavailable.

Select the next source:

[Opcode Source]
[CM Configuration]
[Custom Library]
```

---

## 31. Confidence Model

Use simple evidence-based confidence levels.

```text
High
```

Direct evidence from log/config/source establishes the cause.

```text
Medium
```

Evidence strongly suggests a cause but does not prove it.

```text
Low
```

Several plausible causes remain.

Always expose uncertainty instead of hiding it.

---

## 32. Diagnostic History

Keep session-level diagnostic history.

```text
Diagnostic History

18:02
Question:
Why is billing failing?

Source:
CM Log

Error:
PIN_ERR_BAD_OPCODE

Result:
Opcode registration issue suspected
```

This is local/read-only history and does not alter BRM data.

---

## 33. Integration With Existing NextTerm Features

Connect the assistant with terminal, SFTP, logs, and monitoring.

```text
Terminal
   ↕
SFTP
   ↕
Logs
   ↕
Monitoring
   ↕
BRM Assistant
```

Examples:

```text
Assistant detects CM error
        ↓
[Open Log]
        ↓
NextTerm Log Explorer
```

```text
Assistant finds pin.conf
        ↓
[Open Config]
        ↓
NextTerm File/SFTP Viewer
```

```text
Assistant identifies process
        ↓
[View Process]
        ↓
Process Explorer
```

---

## 34. Optional Archify Integration

Later, the BRM Assistant can generate a structured architecture for a troubleshooting scenario.

```text
BRM evidence
     ↓
Structured Architecture JSON
     ↓
Archify
     ↓
Interactive BRM architecture
```

Example:

```text
Client
  ↓
CM
  ↓
Billing Opcode
  ↓
DM
  ↓
Oracle DB
```

Archify should remain optional for basic troubleshooting.

---

## 35. Technology Recommendation

For the existing NextTerm/Wails architecture:

```text
Frontend
JavaScript / existing NextTerm UI

Backend
Go / Wails

Remote Access
Existing SSH layer

BRM Assistant
Go service/module

Knowledge
Versioned JSON/YAML knowledge files

LLM Layer
Optional local or external model

Storage
Local workspace/session state
```

Deterministic operations should not require an LLM:

```text
Where is pin.conf?
Find CM log
Search PIN_ERR_BAD_OPCODE
```

Use an LLM primarily for:

```text
Natural-language question understanding
Error explanation
Evidence synthesis
Troubleshooting guidance
```

---

## 36. Recommended Execution Flow

Use **deterministic collection first**.

```text
Question
   ↓
Classify
   ↓
Locate/confirm source
   ↓
Read source
   ↓
Extract evidence
   ↓
Apply BRM rules
   ↓
Generate structured diagnosis
   ↓
Use LLM where explanation is needed
```

This reduces hallucinated paths, errors, and diagnoses.

---

## 37. MVP

Build the first version with:

```text
├── BRM installation detection
├── Folder finder
├── Log detection
├── User source selection
├── Read-only log reader
├── Error pattern detection
├── BRM error knowledge
├── Evidence extraction
├── Troubleshooting response
└── Open-in-NextTerm actions
```

Do not start with an autonomous agent.

---

## 38. Phase 2

```text
├── Question classifier
├── Multiple-source diagnostics
├── Config relationship analysis
├── Opcode analysis
├── Process Explorer integration
├── Log Explorer integration
└── Diagnostic history
```

---

## 39. Phase 3

```text
├── BRM architecture visualization
├── Archify integration
├── Dependency tracing
├── Error correlation
├── Cross-component diagnostics
└── BRM project intelligence
```

---

## 40. Final Architecture

```text
                         NEXTTERM
                            |
        ┌───────────────────┼───────────────────┐
        |                   |                   |
     Terminal              SFTP             Monitoring
        |                   |                   |
        └───────────────────┼───────────────────┘
                            |
                     BRM ASSISTANT
                            |
                  ┌─────────┴─────────┐
                  |                   |
          Question Classifier    Source Selector
                  |                   |
                  └─────────┬─────────┘
                            |
                    READ-ONLY LAYER
                            |
             ┌──────────────┼──────────────┐
             |              |              |
         File Reader     Log Reader    Config Reader
             |              |              |
             └──────────────┼──────────────┘
                            |
                    BRM CONTEXT MANAGER
                            |
             ┌──────────────┼──────────────┐
             |                             |
       ERROR ANALYZER                 BRM KNOWLEDGE
             |                             |
             └──────────────┬──────────────┘
                            |
                    DIAGNOSIS ENGINE
                            |
                    ┌───────┴────────┐
                    |                |
                 Evidence       Resolution
                    |                |
                    └───────┬────────┘
                            |
                      ANSWER ENGINE
                            |
                            v
                    BRM ASSISTANT UI
                            |
             ┌──────────────┼──────────────┐
             |              |              |
          Open Log      Open Config    Open Source
             |              |              |
             └──────────────┼──────────────┘
                            |
                       NEXTTERM UI

Optional:
BRM Context → Architecture JSON → Archify → BRM Architecture View
```

---

## 41. Product Principle

The BRM Assistant should behave like a **BRM diagnostic engineer**, not an unrestricted chatbot:

```text
ASK
 ↓
SELECT SOURCE
 ↓
READ
 ↓
COLLECT EVIDENCE
 ↓
UNDERSTAND BRM CONTEXT
 ↓
EXPLAIN
 ↓
GUIDE
 ↓
OPEN RELEVANT LOCATION
```

Core priorities:

**Actual evidence > assumptions**

**Guidance > automatic modification**

**Read-only by design**
