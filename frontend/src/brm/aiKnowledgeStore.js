// ==========================================================================
// NexTerm — AI Knowledge Store (Uploaded Files & Grounding)
// Manages uploaded files (.pptx, .pdf, .json, .txt, .log, .docx), folders,
// 20-file quota limit, and query matching for AI grounding.
// ==========================================================================

const STORAGE_KEY = "nexterm_ai_knowledge_v1";
export const MAX_KNOWLEDGE_FILES = 20;

// Default pre-seeded BRM knowledge files
const DEFAULT_FOLDERS = ["General", "BRM Architecture", "Configuration", "Troubleshooting", "Opcodes & Billing"];

const DEFAULT_FILES = [
  {
    id: "kb_file_1",
    name: "BRM_Architecture_Overview.pptx",
    folder: "BRM Architecture",
    type: "pptx",
    size: "184.2 KB",
    sizeBytes: 188620,
    uploadedAt: "2026-09-20 10:30",
    isDefault: true,
    summary: "High-level architecture slides covering CM connection management, DM Oracle mapping, Opcodes, and real-time rating engine.",
    content: "Slide 1: Oracle BRM Architecture Overview. Slide 2: Connection Manager (CM) and thread dispatching. Slide 3: Data Manager (DM Oracle) SQL translations and transactions. Slide 4: Billing pipeline and rating engine. Slide 5: Common error locations (PIN_ERRLOC_APP through PIN_ERRLOC_DM)."
  },
  {
    id: "kb_file_2",
    name: "brm_locations_reference.json",
    folder: "Configuration",
    type: "json",
    size: "14.5 KB",
    sizeBytes: 14848,
    uploadedAt: "2026-09-21 14:15",
    isDefault: true,
    summary: "$PIN_HOME directory hierarchy, pin.conf locations for CM, DM, pin_billd, and infranet.properties.",
    content: '{"PIN_HOME": "/opt/portal", "sys_cm_pin_conf": "sys/cm/pin.conf", "sys_dm_pin_conf": "sys/dm_oracle/pin.conf", "infranet_properties": "sys/eai_js/infranet.properties", "pin_billd": "apps/pin_billd/pin.conf", "headers": "include/pcm.h, include/pin_errs.h"}'
  },
  {
    id: "kb_file_3",
    name: "brm_error_codes_guide.json",
    folder: "Troubleshooting",
    type: "json",
    size: "18.2 KB",
    sizeBytes: 18636,
    uploadedAt: "2026-09-22 09:00",
    isDefault: true,
    summary: "Error location constants (PIN_ERRLOC_APP to PIN_ERRLOC_DM) and codes (PIN_ERR_NOT_FOUND, PIN_ERR_STORAGE, PIN_ERR_NAP_CONNECT_FAILED).",
    content: '{"PIN_ERRLOC_APP": 1, "PIN_ERRLOC_POID": 2, "PIN_ERRLOC_FLIST": 3, "PIN_ERRLOC_PCM": 4, "PIN_ERRLOC_PCP": 5, "PIN_ERRLOC_CM": 6, "PIN_ERRLOC_DM": 8, "PIN_ERR_NOT_FOUND": 4, "PIN_ERR_NAP_CONNECT_FAILED": 31, "PIN_ERR_STORAGE": 10}'
  },
  {
    id: "kb_file_4",
    name: "brm_opcodes_flists.json",
    folder: "Opcodes & Billing",
    type: "json",
    size: "22.8 KB",
    sizeBytes: 23347,
    uploadedAt: "2026-09-22 11:45",
    isDefault: true,
    summary: "Core lifecycle opcodes (PCM_OP_CUST_COMMIT_CUSTOMER, PCM_OP_BILL_MAKE_BILL, PCM_OP_PYMT_COLLECT) and required flist fields.",
    content: '{"PCM_OP_CUST_COMMIT_CUSTOMER": 101, "PCM_OP_BILL_MAKE_BILL": 1301, "PCM_OP_PYMT_COLLECT": 1401, "PCM_OP_ACT_USAGE": 1201}'
  },
  {
    id: "kb_file_5",
    name: "pin_conf_tuning_guide.txt",
    folder: "Configuration",
    type: "txt",
    size: "8.4 KB",
    sizeBytes: 8601,
    uploadedAt: "2026-09-23 08:30",
    isDefault: true,
    summary: "Configuration reference for cm dm_pointer, max_children, loglevel (1-3), and socket buffer sizes.",
    content: "CM Configuration Reference:\n- cm dm_pointer 0.0.0.1 ip <dm_host> <port>\n- cm loglevel 1 (Error), 2 (Warning), 3 (Debug/Flist)\n- cm max_children 100\n- dm sm_chunk_size 2048"
  }
];

function loadStore() {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.files) && Array.isArray(data.folders)) {
          return data;
        }
      }
    }
  } catch (e) {
    console.warn("Error reading AI Knowledge Store:", e);
  }

  // Fallback to initial defaults
  const initial = {
    folders: [...DEFAULT_FOLDERS],
    files: [...DEFAULT_FILES]
  };
  saveStore(initial);
  return initial;
}

function saveStore(data) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch (e) {
    console.error("Failed to save AI Knowledge Store:", e);
  }
}

/**
 * Returns all uploaded knowledge files
 */
export function getKnowledgeFiles() {
  return loadStore().files || [];
}

/**
 * Returns all custom folders
 */
export function getKnowledgeFolders() {
  return loadStore().folders || [];
}

/**
 * Returns quota summary
 */
export function getKnowledgeSummary() {
  const files = getKnowledgeFiles();
  return {
    total: files.length,
    max: MAX_KNOWLEDGE_FILES,
    remaining: Math.max(0, MAX_KNOWLEDGE_FILES - files.length),
    isFull: files.length >= MAX_KNOWLEDGE_FILES,
    folders: getKnowledgeFolders()
  };
}

/**
 * Add a new folder
 */
export function addFolder(folderName) {
  const name = (folderName || "").trim();
  if (!name) throw new Error("Folder name cannot be empty");
  
  const data = loadStore();
  if (data.folders.includes(name)) {
    throw new Error(`Folder "${name}" already exists`);
  }
  data.folders.push(name);
  saveStore(data);
  return data.folders;
}

/**
 * Delete a folder (moves its files to 'General')
 */
export function deleteFolder(folderName) {
  const data = loadStore();
  if (folderName === "General") {
    throw new Error("Cannot delete the default 'General' folder");
  }
  data.folders = data.folders.filter(f => f !== folderName);
  data.files = data.files.map(f => {
    if (f.folder === folderName) {
      return { ...f, folder: "General" };
    }
    return f;
  });
  saveStore(data);
  return data;
}

/**
 * Add an uploaded file (enforces 20 file limit)
 */
export function addKnowledgeFile({ name, folder, type, size, sizeBytes, content, summary }) {
  const data = loadStore();
  if (data.files.length >= MAX_KNOWLEDGE_FILES) {
    throw new Error(`Upload limit reached. Maximum ${MAX_KNOWLEDGE_FILES} files allowed.`);
  }

  const ext = (name.split('.').pop() || "txt").toLowerCase();
  const fileType = type || ext;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 16).replace("T", " ");

  const newFile = {
    id: "kb_file_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    name: name.trim(),
    folder: folder && data.folders.includes(folder) ? folder : "General",
    type: fileType,
    size: size || formatFileSize(sizeBytes || (content ? content.length : 1024)),
    sizeBytes: sizeBytes || (content ? content.length : 1024),
    uploadedAt: dateStr,
    isDefault: false,
    summary: summary || generateSummary(name, fileType, content),
    content: content || ""
  };

  data.files.unshift(newFile);
  saveStore(data);
  return newFile;
}

/**
 * Update an existing uploaded file (replace content, metadata, or move folder)
 */
export function updateKnowledgeFile(fileId, updates = {}) {
  const data = loadStore();
  const idx = data.files.findIndex(f => f.id === fileId);
  if (idx === -1) {
    throw new Error("File not found in knowledge store");
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 16).replace("T", " ");

  const existing = data.files[idx];
  const updated = {
    ...existing,
    ...updates,
    uploadedAt: dateStr // update modified timestamp
  };

  if (updates.name && !updates.type) {
    updated.type = (updates.name.split('.').pop() || "txt").toLowerCase();
  }
  if (updates.content && !updates.summary) {
    updated.summary = generateSummary(updated.name, updated.type, updates.content);
  }

  data.files[idx] = updated;
  saveStore(data);
  return updated;
}

/**
 * Delete an uploaded file
 */
export function deleteKnowledgeFile(fileId) {
  const data = loadStore();
  const file = data.files.find(f => f.id === fileId);
  data.files = data.files.filter(f => f.id !== fileId);
  saveStore(data);
  return file;
}

/**
 * Search and ground knowledge files based on user query
 */
export function searchKnowledge(query = "") {
  const files = getKnowledgeFiles();
  if (!query || !query.trim()) {
    return {
      allFiles: files,
      matchedFiles: files.slice(0, 3),
      groundingText: files.map(f => f.name).join(", ")
    };
  }

  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(t => t.length > 2);

  const scored = files.map(f => {
    let score = 0;
    const nameL = f.name.toLowerCase();
    const folderL = (f.folder || "").toLowerCase();
    const sumL = (f.summary || "").toLowerCase();
    const contL = (f.content || "").toLowerCase();

    terms.forEach(term => {
      if (nameL.includes(term)) score += 10;
      if (folderL.includes(term)) score += 5;
      if (sumL.includes(term)) score += 4;
      if (contL.includes(term)) score += 2;
    });

    return { file: f, score };
  });

  const matches = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.file);

  return {
    allFiles: files,
    matchedFiles: matches,
    groundingText: matches.map(f => f.name).join(", ")
  };
}

/**
 * Intelligently searches content inside uploaded files and extracts the best matching answer section.
 */
export function extractBestAnswerFromFiles(query, files) {
  if (!query || !files || files.length === 0) return null;
  const q = query.trim();
  const ql = q.toLowerCase();

  const stopWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "what", "where",
    "how", "why", "which", "are", "is", "was", "can", "file", "files",
    "does", "tell", "show", "give", "about", "please", "would", "of", "in", "to", "on"
  ]);

  const rawTerms = ql.split(/[^a-z0-9_.-]+/).filter(t => t.length > 1);
  const terms = rawTerms.filter(t => !stopWords.has(t));
  const effectiveTerms = terms.length > 0 ? terms : rawTerms;
  if (effectiveTerms.length === 0) return null;

  let bestMatch = null;
  let highestScore = 0;

  for (const file of files) {
    const content = file.content || "";
    if (!content || typeof content !== "string") continue;

    // Break into logical sections (by markdown headings or double newlines)
    const rawBlocks = content.split(/(?=\n#{1,4}\s+)|\n\s*\n/).map(b => b.trim()).filter(b => b.length > 20);

    for (const block of rawBlocks) {
      const blockL = block.toLowerCase();
      let score = 0;

      // Exact phrase match bonus
      if (blockL.includes(ql)) {
        score += 60;
      }

      // Check term matches
      let matchedCount = 0;
      for (const term of effectiveTerms) {
        if (blockL.includes(term)) {
          score += 15;
          matchedCount++;
        }
      }

      // Proximity / completeness bonus
      if (matchedCount === effectiveTerms.length && effectiveTerms.length > 1) {
        score += 35;
      }

      // Penalize pure top-level document titles / banners
      if ((block.startsWith("# ") && blockL.includes("knowledge base")) || (blockL.includes("master knowledge base") && block.length < 150)) {
        score -= 40;
      }

      if (score > highestScore && score >= 25) {
        highestScore = score;
        bestMatch = {
          file: file,
          block: block,
          score: score
        };
      }
    }
  }

  if (!bestMatch) return null;

  // Extract clean text from the matching block
  const lines = bestMatch.block.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("---") && !l.startsWith("<!--"));

  // Format headings into bold subtitles
  const cleanLines = lines.map(line => {
    if (line.startsWith("#")) {
      return `**${line.replace(/^#+\s*/, "")}**:`;
    }
    return line;
  });

  const snippet = cleanLines.slice(0, 10).join("\n");
  const directAnswer = snippet.length > 450 ? snippet.slice(0, 447) + "..." : snippet;

  return {
    status: "answered",
    component: bestMatch.file.name.replace(/\.[^.]+$/, "").replace(/_/g, " "),
    directAnswer: directAnswer,
    knowledgeFilesUsed: [bestMatch.file.name],
    actions: [
      { type: "open_config", label: "Manage in Settings", target: "settings-ai", line: 1 }
    ]
  };
}

/**
 * Format file size in readable format
 */
export function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return "1 KB";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Generate a direct, grounded answer from uploaded knowledge files
 */
export function generateAnswerFromKnowledge(query = "") {
  const q = (query || "").trim();
  if (!q) return null;
  const ql = q.toLowerCase();
  const files = getKnowledgeFiles();

  // 1. Inquiries about uploaded files list / summary
  if (
    ql.includes("what files") ||
    ql.includes("show files") ||
    ql.includes("list files") ||
    ql.includes("uploaded files") ||
    ql.includes("my files") ||
    ql.includes("what is uploaded") ||
    ql.includes("show knowledge") ||
    ql.includes("view files")
  ) {
    const fileList = files.map(f => `• **${f.name}** (${f.folder})`).join("\n");
    return {
      status: "answered",
      component: "Uploaded Knowledge Base",
      directAnswer: `Here are your ${files.length} active knowledge files:\n${fileList}\n\nYou can manage or upload more files in **Settings > AI Assistant** (Quota: ${files.length}/${MAX_KNOWLEDGE_FILES}).`,
      knowledgeFilesUsed: files.map(f => f.name),
      actions: [
        { type: "open_config", label: "Open AI Settings", target: "settings-ai", line: 1 }
      ]
    };
  }

  // 2. Pin.conf inquiries (e.g. "pin.conf file of cm", "cm pin.conf", "dm pin.conf", "pin.conf", etc.)
  if (ql.includes("pin.conf") || ql.includes("pin conf") || (ql.includes("config") && (ql.includes("cm") || ql.includes("dm") || ql.includes("bill")))) {
    if (ql.includes("cm") || ql.includes("connection manager")) {
      return {
        status: "answered",
        component: "CM pin.conf",
        directAnswer: "Connection Manager `pin.conf` is located at `/opt/portal/sys/cm/pin.conf` ($PIN_HOME/sys/cm/pin.conf).\nIt configures CM listener ports, `dm_pointer` routing to DM Oracle, worker concurrency limits (`cm max_children`), `loglevel`, and `fm_module` shared libraries.",
        knowledgeFilesUsed: ["brm_locations_reference.json", "pin_conf_tuning_guide.txt"],
        actions: [{ type: "open_config", label: "Open CM pin.conf", target: "/opt/portal/sys/cm/pin.conf", line: 1 }]
      };
    }
    if (ql.includes("dm") || ql.includes("data manager") || ql.includes("oracle")) {
      return {
        status: "answered",
        component: "DM Oracle pin.conf",
        directAnswer: "Data Manager Oracle `pin.conf` is located at `/opt/portal/sys/dm_oracle/pin.conf`.\nIt configures database connection credentials (`sm_pw`), max database connections, and shared memory chunk sizes (`sm_chunk_size`).",
        knowledgeFilesUsed: ["brm_locations_reference.json", "pin_conf_tuning_guide.txt"],
        actions: [{ type: "open_config", label: "Open DM pin.conf", target: "/opt/portal/sys/dm_oracle/pin.conf", line: 1 }]
      };
    }
    if (ql.includes("bill") || ql.includes("pin_billd")) {
      return {
        status: "answered",
        component: "Billing pin.conf",
        directAnswer: "Billing Engine `pin.conf` is located at `/opt/portal/apps/pin_billd/pin.conf`.\nIt configures automated billing run dates, batch sizes, and multi-threading partitions.",
        knowledgeFilesUsed: ["brm_locations_reference.json"],
        actions: [{ type: "open_config", label: "Open Billing pin.conf", target: "/opt/portal/apps/pin_billd/pin.conf", line: 1 }]
      };
    }
    return {
      status: "answered",
      component: "BRM pin.conf",
      directAnswer: "Primary Oracle BRM `pin.conf` locations:\n• **Connection Manager (CM)**: `/opt/portal/sys/cm/pin.conf` (opcode routing, dm_pointer, process limits)\n• **Data Manager (DM Oracle)**: `/opt/portal/sys/dm_oracle/pin.conf` (database credentials and connections)\n• **Billing Engine**: `/opt/portal/apps/pin_billd/pin.conf` (batch sizes and billing parameters)",
      knowledgeFilesUsed: ["brm_locations_reference.json"],
      actions: [{ type: "open_config", label: "Open CM pin.conf", target: "/opt/portal/sys/cm/pin.conf", line: 1 }]
    };
  }

  // 3. Specific file inquiry / Architecture (PPTX)
  if (
    ql.includes("pptx") ||
    ql.includes("presentation") ||
    ql.includes("architecture_overview") ||
    ql.includes("architecture slides") ||
    ql.includes("slide") ||
    ql.includes("architecture")
  ) {
    const pptxFile = files.find(f => f.type === "pptx" || f.name.toLowerCase().includes("architecture")) || files[0];
    return {
      status: "answered",
      component: "Oracle BRM Core Architecture",
      directAnswer: `**BRM_Architecture_Overview.pptx** specification:\n• **Connection Manager (CM)**: Central multiplexer managing client sockets, worker thread pools, and opcode routing.\n• **Data Manager (DM Oracle)**: Translates PCM opcodes to SQL and manages database transactions.\n• **Real-Time Rating Engine (ECE / Pipeline)**: High-throughput rating of usage CDRs and balance management.\n• **Error Handling**: Isolates failures across layers via \`PIN_ERRLOC_*\` (APP, CM, PCP, DM).`,
      knowledgeFilesUsed: [pptxFile.name],
      actions: [
        { type: "open_config", label: "Open pin.conf", target: "/opt/portal/sys/cm/pin.conf", line: 1 },
        { type: "copy", label: "Copy Architecture Summary", target: pptxFile.name, line: 0 }
      ]
    };
  }

  // 4. Other Location inquiries
  if (ql.includes("where is") || ql.includes("find ") || ql.includes("path of") || ql.includes("location of") || ql.startsWith("where ") || ql.includes("where can i find")) {
    if (ql.includes("dm log") || ql.includes("dm_oracle.log") || ql.includes("dm_oracle.pinlog")) {
      return {
        status: "answered",
        component: "DM Oracle Pinlog",
        directAnswer: "DM Oracle activity log is located at `/opt/portal/var/dm_oracle/dm_oracle.pinlog` (or `sys/dm_oracle/dm_oracle.log`).",
        knowledgeFilesUsed: ["brm_locations_reference.json"],
        actions: [{ type: "open_log", label: "Open DM Pinlog", target: "/opt/portal/sys/dm_oracle/dm_oracle.log", line: 1 }]
      };
    }
    if (ql.includes("cm log") || ql.includes("cm.log") || ql.includes("cm.pinlog")) {
      return {
        status: "answered",
        component: "CM Pinlog",
        directAnswer: "Connection Manager activity log is located at `/opt/portal/var/cm/cm.pinlog` (or `sys/cm/cm.log`).",
        knowledgeFilesUsed: ["brm_locations_reference.json"],
        actions: [{ type: "open_log", label: "Open CM Pinlog", target: "/opt/portal/sys/cm/cm.log", line: 1 }]
      };
    }
    if (ql.includes("infranet") || ql.includes("eai") || ql.includes("properties")) {
      return {
        status: "answered",
        component: "Infranet Properties",
        directAnswer: "Infranet properties for Java SDK & EAI framework is located at `/opt/portal/sys/eai_js/infranet.properties`.",
        knowledgeFilesUsed: ["brm_locations_reference.json"],
        actions: [{ type: "open_config", label: "Open infranet.properties", target: "/opt/portal/sys/eai_js/infranet.properties", line: 1 }]
      };
    }
    if (ql.includes("notify") || ql.includes("notification")) {
      return {
        status: "answered",
        component: "Event Notification Config",
        directAnswer: "Event notification specifications (`pin_notify`) is located at `/opt/portal/sys/data/config/pin_notify`.",
        knowledgeFilesUsed: ["brm_locations_reference.json"],
        actions: [{ type: "open_config", label: "Open pin_notify", target: "/opt/portal/sys/data/config/pin_notify", line: 1 }]
      };
    }
    if (ql.includes("header") || ql.includes("include") || ql.includes(".h")) {
      return {
        status: "answered",
        component: "BRM SDK Headers",
        directAnswer: "BRM C/C++ SDK headers (`pcm.h`, `pin_errs.h`, `ops/*.h`) are located in `/opt/portal/include/`.",
        knowledgeFilesUsed: ["brm_locations_reference.json"],
        actions: [{ type: "open_sftp", label: "Browse include/", target: "/opt/portal/include", line: 0 }]
      };
    }
    if (ql.includes("pin_home") || ql.includes("brm home") || ql.includes("home") || ql.includes("root")) {
      return {
        status: "answered",
        component: "BRM System Home",
        directAnswer: "Oracle BRM system root directory ($PIN_HOME) is `/opt/portal`.",
        knowledgeFilesUsed: ["brm_locations_reference.json"],
        actions: [{ type: "open_sftp", label: "Browse BRM Home", target: "/opt/portal", line: 0 }]
      };
    }
  }

  // 5. Configuration & Tuning parameters
  if (
    ql.includes("dm_pointer") ||
    ql.includes("max_children") ||
    ql.includes("loglevel") ||
    ql.includes("tuning") ||
    ql.includes("sm_chunk_size")
  ) {
    if (ql.includes("dm_pointer")) {
      return {
        status: "answered",
        component: "CM Configuration",
        directAnswer: "`cm dm_pointer` in `/opt/portal/sys/cm/pin.conf` maps the database number (e.g. `0.0.0.1`) to the DM Oracle host and listening port:\n`- cm dm_pointer 0.0.0.1 ip <host> <port>`\nEnsure this port matches `sys/dm_oracle/pin.conf`.",
        knowledgeFilesUsed: ["pin_conf_tuning_guide.txt"],
        actions: [{ type: "open_config", label: "Open CM pin.conf", target: "/opt/portal/sys/cm/pin.conf", line: 1 }]
      };
    }
    if (ql.includes("loglevel")) {
      return {
        status: "answered",
        component: "CM Configuration",
        directAnswer: "`cm loglevel` in `/opt/portal/sys/cm/pin.conf` configures CM logging verbosity:\n• `1` = Errors only (recommended in production)\n• `2` = Warnings\n• `3` = Full Debug (dumps all flist structures; generates heavy disk I/O).",
        knowledgeFilesUsed: ["pin_conf_tuning_guide.txt"],
        actions: [{ type: "open_config", label: "Open CM pin.conf", target: "/opt/portal/sys/cm/pin.conf", line: 1 }]
      };
    }
    if (ql.includes("max_children")) {
      return {
        status: "answered",
        component: "CM Configuration",
        directAnswer: "`cm max_children` in `/opt/portal/sys/cm/pin.conf` sets the maximum concurrent child worker processes spawned by CM before throttling client connections.",
        knowledgeFilesUsed: ["pin_conf_tuning_guide.txt"],
        actions: [{ type: "open_config", label: "Open CM pin.conf", target: "/opt/portal/sys/cm/pin.conf", line: 1 }]
      };
    }
    if (ql.includes("sm_chunk_size")) {
      return {
        status: "answered",
        component: "DM Oracle Configuration",
        directAnswer: "`dm sm_chunk_size` in `/opt/portal/sys/dm_oracle/pin.conf` defines the shared memory buffer chunk size for SQL statement batching.",
        knowledgeFilesUsed: ["pin_conf_tuning_guide.txt"],
        actions: [{ type: "open_config", label: "Open DM pin.conf", target: "/opt/portal/sys/dm_oracle/pin.conf", line: 1 }]
      };
    }
    return {
      status: "answered",
      component: "CM / DM Configuration",
      directAnswer: "Key configuration parameters in `/opt/portal/sys/cm/pin.conf`:\n• `cm dm_pointer 0.0.0.1 ip <host> <port>`: Route requests to DM Oracle\n• `cm loglevel 1`: Production error logging (avoid 3 in production)\n• `cm max_children 100`: Concurrent worker processes limit",
      knowledgeFilesUsed: ["pin_conf_tuning_guide.txt"],
      actions: [{ type: "open_config", label: "Open CM pin.conf", target: "/opt/portal/sys/cm/pin.conf", line: 1 }]
    };
  }

  // 6. Opcode inquiries (PCM_OP_*)
  if (ql.includes("pcm_op_") || ql.includes("opcode")) {
    if (ql.includes("pcm_op_cust_commit_customer")) {
      return {
        status: "answered",
        component: "Customer Management",
        directAnswer: "**PCM_OP_CUST_COMMIT_CUSTOMER** (101):\n• Atomically creates account, service, profile, balance group, and payinfo in BRM.\n• **Input Flist**: `PIN_FLD_POID`, `PIN_FLD_NAMEINFO`, `PIN_FLD_SERVICES`, `PIN_FLD_BAL_INFO`\n• **Output Flist**: `PIN_FLD_POID` (account obj), `PIN_FLD_RESULTS`",
        knowledgeFilesUsed: ["brm_opcodes_flists.json"]
      };
    }
    if (ql.includes("pcm_op_cust_pol_pre_commit")) {
      return {
        status: "answered",
        component: "Customer Policy",
        directAnswer: "**PCM_OP_CUST_POL_PRE_COMMIT**:\n• Pre-creation customer policy hook; allows custom field validation and business logic overrides before commit.",
        knowledgeFilesUsed: ["brm_opcodes_flists.json"]
      };
    }
    if (ql.includes("pcm_op_bill_make_bill_now")) {
      return {
        status: "answered",
        component: "Billing",
        directAnswer: "**PCM_OP_BILL_MAKE_BILL_NOW**:\n• Immediate on-demand billing execution for an account outside the normal scheduled billing cycle.",
        knowledgeFilesUsed: ["brm_opcodes_flists.json"]
      };
    }
    if (ql.includes("pcm_op_bill_make_bill")) {
      return {
        status: "answered",
        component: "Billing",
        directAnswer: "**PCM_OP_BILL_MAKE_BILL** (1301):\n• Core scheduled billing opcode. Closes bill items, calculates cycle fees, and produces final `/bill` objects.",
        knowledgeFilesUsed: ["brm_opcodes_flists.json"]
      };
    }
    if (ql.includes("pcm_op_pymt_collect")) {
      return {
        status: "answered",
        component: "Payments",
        directAnswer: "**PCM_OP_PYMT_COLLECT** (1401):\n• Charges payment instruments (credit card, direct debit) and applies payments to open A/R items.",
        knowledgeFilesUsed: ["brm_opcodes_flists.json"]
      };
    }
    if (ql.includes("pcm_op_act_usage")) {
      return {
        status: "answered",
        component: "Rating & Usage",
        directAnswer: "**PCM_OP_ACT_USAGE** (1201):\n• Rates and records usage events (voice, data, messaging) against subscriber balance groups.",
        knowledgeFilesUsed: ["brm_opcodes_flists.json"]
      };
    }
    if (ql.includes("pcm_op_search")) {
      return {
        status: "answered",
        component: "Base Infrastructure",
        directAnswer: "**PCM_OP_SEARCH**:\n• Executes SQL queries against Oracle database via DM and returns matching flist arrays.",
        knowledgeFilesUsed: ["brm_opcodes_flists.json"]
      };
    }
  }

  // 7. Error Codes and Locations (PIN_ERR_*, PIN_ERRLOC_*, ORA-*)
  if (ql.includes("pin_err_") || ql.includes("pin_errloc_") || ql.includes("ora-")) {
    if (ql.includes("pin_err_not_found")) {
      return {
        status: "answered",
        component: "Troubleshooting",
        directAnswer: "**PIN_ERR_NOT_FOUND** (code 4):\n• Requested object, record, or field was not found in the database or input flist.\n• **Fix**: Verify POID exists in DB and check `PIN_FLD_POID` routing.",
        knowledgeFilesUsed: ["brm_error_codes_guide.json"]
      };
    }
    if (ql.includes("pin_err_nap_connect_failed")) {
      return {
        status: "answered",
        component: "CM Connection",
        directAnswer: "**PIN_ERR_NAP_CONNECT_FAILED** (code 31):\n• Connection between client / testnap and Connection Manager (CM) failed.\n• **Fix**: Verify CM is running (`pin_ctl status cm`) and check port in `pin.conf`.",
        knowledgeFilesUsed: ["brm_error_codes_guide.json"],
        actions: [{ type: "open_config", label: "Open CM pin.conf", target: "/opt/portal/sys/cm/pin.conf", line: 1 }]
      };
    }
    if (ql.includes("pin_err_storage")) {
      return {
        status: "answered",
        component: "DM Oracle",
        directAnswer: "**PIN_ERR_STORAGE** (code 10):\n• Database persistence error encountered by DM Oracle.\n• **Fix**: Inspect `dm_oracle.pinlog` for companion `ORA-` error code.",
        knowledgeFilesUsed: ["brm_error_codes_guide.json"],
        actions: [{ type: "open_log", label: "Open DM Pinlog", target: "/opt/portal/sys/dm_oracle/dm_oracle.log", line: 1 }]
      };
    }
    if (ql.includes("pin_err_duplicate")) {
      return {
        status: "answered",
        component: "Database",
        directAnswer: "**PIN_ERR_DUPLICATE** (code 19):\n• Unique database constraint violation (duplicate login, account number, or POID ID).\n• **Fix**: Check input flist identifiers against existing database records.",
        knowledgeFilesUsed: ["brm_error_codes_guide.json"]
      };
    }
    if (ql.includes("pin_err_bad_arg")) {
      return {
        status: "answered",
        component: "FLIST Engine",
        directAnswer: "**PIN_ERR_BAD_ARG** (code 1):\n• Invalid or malformed argument passed in input flist.\n• **Fix**: Check flist field data types and mandatory fields.",
        knowledgeFilesUsed: ["brm_error_codes_guide.json"]
      };
    }
    if (ql.includes("pin_err_missing_arg")) {
      return {
        status: "answered",
        component: "FLIST Engine",
        directAnswer: "**PIN_ERR_MISSING_ARG** (code 2):\n• A required field was omitted from opcode input flist.\n• **Fix**: Check opcode flist specifications in `include/ops/*.h`.",
        knowledgeFilesUsed: ["brm_error_codes_guide.json"]
      };
    }
    if (ql.includes("pin_err_no_mem")) {
      return {
        status: "answered",
        component: "CM Memory",
        directAnswer: "**PIN_ERR_NO_MEM** (code 9):\n• Out of memory during flist creation or large query execution.\n• **Fix**: Limit batch query sizes and check system memory limits.",
        knowledgeFilesUsed: ["brm_error_codes_guide.json"]
      };
    }
    if (ql.includes("pin_errloc_app")) {
      return { status: "answered", component: "Error Location", directAnswer: "**PIN_ERRLOC_APP** (1): Client Application tier failure (invalid input data or business policy rejection).", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("pin_errloc_pcp")) {
      return { status: "answered", component: "Error Location", directAnswer: "**PIN_ERRLOC_PCP** (2): Network Transport tier failure (socket or connection timeout between client/CM/DM).", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("pin_errloc_pcm")) {
      return { status: "answered", component: "Error Location", directAnswer: "**PIN_ERRLOC_PCM** (3): Portal Context tier failure (context init or connection pool allocation failure).", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("pin_errloc_cm")) {
      return { status: "answered", component: "Error Location", directAnswer: "**PIN_ERRLOC_CM** (4): Connection Manager tier failure (opcode routing error or missing fm_module).", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("pin_errloc_fm")) {
      return { status: "answered", component: "Error Location", directAnswer: "**PIN_ERRLOC_FM** (5): Facility Module tier failure (flist structure violates opcode specification).", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("pin_errloc_flist")) {
      return { status: "answered", component: "Error Location", directAnswer: "**PIN_ERRLOC_FLIST** (6): FList Engine failure (data type mismatch or NULL pointer in pin_flist_get/put).", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("pin_errloc_poid")) {
      return { status: "answered", component: "Error Location", directAnswer: "**PIN_ERRLOC_POID** (7): POID Parsing tier failure (malformed POID string or invalid DB number).", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("pin_errloc_dm")) {
      return { status: "answered", component: "Error Location", directAnswer: "**PIN_ERRLOC_DM** (8): Data Manager tier failure (database persistence failure or SQL error).", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("ora-00001")) {
      return { status: "answered", component: "Oracle Database", directAnswer: "**ORA-00001**: Unique constraint violated. A record with this key already exists in Oracle database.", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("ora-01017")) {
      return { status: "answered", component: "Oracle Database", directAnswer: "**ORA-01017**: Invalid username/password. Check database credentials (`sm_pw`) in `sys/dm_oracle/pin.conf`.", knowledgeFilesUsed: ["brm_error_codes_guide.json"], actions: [{ type: "open_config", label: "Open DM pin.conf", target: "/opt/portal/sys/dm_oracle/pin.conf", line: 1 }] };
    }
    if (ql.includes("ora-03113")) {
      return { status: "answered", component: "Oracle Database", directAnswer: "**ORA-03113**: End-of-file on communication channel. Database connection was terminated unexpectedly.", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
    if (ql.includes("ora-12154")) {
      return { status: "answered", component: "Oracle Database", directAnswer: "**ORA-12154**: TNS could not resolve service name. Verify Oracle TNS alias in `tnsnames.ora`.", knowledgeFilesUsed: ["brm_error_codes_guide.json"] };
    }
  }

  // 8. Billing inquiries
  if (ql.includes("bill") || ql.includes("invoice") || ql.includes("cycle")) {
    return {
      status: "answered",
      component: "Billing Engine (pin_billd)",
      directAnswer: "**Billing Engine (`pin_billd` / `PCM_OP_BILL_MAKE_BILL`)**:\n• Closes open bill items, calculates cycle fees, and produces final `/bill` objects.\n• Common causes of failure: DOM cycle mismatch, missing `PIN_FLD_BILLINFO_OBJ`, or database table locks.\n• Inspect log: `/opt/portal/apps/pin_billd/pin_billd.pinlog`.",
      knowledgeFilesUsed: ["brm_opcodes_flists.json"],
      actions: [
        { type: "open_log", label: "Open Billing Log", target: "/opt/portal/apps/pin_billd/pin_billd.pinlog", line: 1 },
        { type: "open_config", label: "Open Billing Config", target: "/opt/portal/apps/pin_billd/pin.conf", line: 1 }
      ]
    };
  }

  // 9. Intelligent Content Search in User-Uploaded Files (RAG search)
  const customFiles = files.filter(f => !f.isDefault && f.content);
  if (customFiles.length > 0) {
    const extracted = extractBestAnswerFromFiles(q, customFiles);
    if (extracted) {
      return extracted;
    }
  }

  // 10. If query is about live logs inspection, let Go backend handle it
  if (ql.includes("log") || ql.includes("tail") || ql.includes("trace") || ql.includes("inspect")) {
    return null;
  }

  // 11. Fallback: If unable to answer from uploaded files or BRM knowledge
  return {
    status: "unanswerable",
    directAnswer: "I can't answer this question.",
    knowledgeFilesUsed: []
  };
}

function generateSummary(name, type, content = "") {
  if (type === "pptx") {
    return `PowerPoint presentation slides for ${name}.`;
  }
  if (type === "pdf") {
    return `PDF documentation specification for ${name}.`;
  }
  if (content && typeof content === "string") {
    const clean = content.replace(/\r?\n|\r/g, " ").trim();
    if (clean.length > 120) {
      return clean.slice(0, 117) + "...";
    }
    return clean || `Knowledge source for ${name}`;
  }
  return `Knowledge file for ${name}`;
}

