// ==========================================================================
// NextTerm — Diagnostic Knowledge Base & Fast Reference Definitions
// Provides verified client-side lookups for errors, locations, and opcodes.
// ==========================================================================

export const BRM_SAMPLE_QUERIES = [
  { label: "Check System Logs", text: "How do I check recent errors and warnings in system logs?" },
  { label: "Port Conflicts", text: "How to check which process is listening on or conflicting with a port?" },
  { label: "High Memory Usage", text: "Find processes consuming high memory or CPU" },
  { label: "SSH Connection Refused", text: "Why is SSH connection refused or timing out?" },
  { label: "Disk Space Full", text: "How to check disk usage and locate large log files?" },
  { label: "Service Failed to Start", text: "How to inspect and diagnose a failed service or daemon?" },
  { label: "Network Connectivity", text: "Test network route, DNS resolution, and TCP reachability" },
  { label: "Permission Denied", text: "Troubleshoot permission denied on file or directory" },
  { label: "Docker Container Crash", text: "How to inspect logs of an exited or crashing container?" },
  { label: "Database Connection", text: "How to verify database listener and client connectivity?" },
  { label: "Explain ORA-00001", text: "Why am I getting database unique constraint error ORA-00001?" },
  { label: "Explain Error Code", text: "Explain error PIN_ERR_BAD_OPCODE and how to resolve it" }
];

export const BRM_SOURCE_OPTIONS = [
  { key: "system_log", label: "System Logs", icon: "📄", desc: "Inspect /var/log/syslog, messages, or systemd journal" },
  { key: "service_log", label: "Service Logs", icon: "🗄️", desc: "Daemon, container, or application runtime logs" },
  { key: "config_file", label: "Config Files", icon: "⚙️", desc: "Inspect configuration files and environment definitions" },
  { key: "all", label: "All Relevant", icon: "🔍", desc: "Inspect available logs and configuration files simultaneously" }
];

export const BRM_ERROR_LOCATIONS = {
  "PIN_ERRLOC_APP": { code: 1, tier: "Client Application", cause: "Caller passed invalid data, nonexistent POID, or business policy validation failed." },
  "PIN_ERRLOC_PCP": { code: 2, tier: "Network Transport (PCP)", cause: "Network connection or socket failure between client and CM/DM." },
  "PIN_ERRLOC_PCM": { code: 3, tier: "Portal Context (PCM)", cause: "Context creation or connection pool failure." },
  "PIN_ERRLOC_CM": { code: 4, tier: "Connection Manager (CM)", cause: "CM opcode routing failure; missing fm_module in pin.conf or missing routing POID." },
  "PIN_ERRLOC_FM": { code: 5, tier: "Facility Module (FM)", cause: "Input flist structure violates opcode specification (missing mandatory field)." },
  "PIN_ERRLOC_FLIST": { code: 6, tier: "FList Manipulation", cause: "Type mismatch, NULL pointer, or memory exhaustion in flist operations." },
  "PIN_ERRLOC_POID": { code: 7, tier: "POID Parsing", cause: "Malformed POID, invalid database ID, or corrupted storable class." },
  "PIN_ERRLOC_DM": { code: 8, tier: "Data Manager (DM)", cause: "Database storage tier failure; check dm_oracle.pinlog for SQL/ORA- errors." }
};

export const BRM_OPCODES = {
  "PCM_OP_BILL_MAKE_BILL_NOW": {
    name: "PCM_OP_BILL_MAKE_BILL_NOW",
    category: "Billing",
    description: "Calculates total balance and generates immediate bill items outside regular scheduled billing cycle.",
    inputFlist: "PIN_FLD_POID (account), PIN_FLD_BILLINFO_OBJ, PIN_FLD_PROGRAM_NAME",
    outputFlist: "PIN_FLD_POID (bill), PIN_FLD_RESULTS (array of bill items)"
  },
  "PCM_OP_BILL_MAKE_BILL": {
    name: "PCM_OP_BILL_MAKE_BILL",
    category: "Billing",
    description: "Core scheduled billing run; closes bill items, calculates cycle fees, and produces final bill objects.",
    inputFlist: "PIN_FLD_POID (account), PIN_FLD_BILLINFO_OBJ, PIN_FLD_FLAGS",
    outputFlist: "PIN_FLD_POID (bill obj), PIN_FLD_RESULTS"
  },
  "PCM_OP_CUST_COMMIT_CUSTOMER": {
    name: "PCM_OP_CUST_COMMIT_CUSTOMER",
    category: "Customer Care",
    description: "Atomically commits new account, login credentials, services, balances, and profiles into BRM database.",
    inputFlist: "PIN_FLD_POID, PIN_FLD_NAMEINFO, PIN_FLD_SERVICES, PIN_FLD_BAL_INFO",
    outputFlist: "PIN_FLD_POID (account obj), PIN_FLD_RESULTS"
  },
  "PCM_OP_CUST_POL_PRE_COMMIT": {
    name: "PCM_OP_CUST_POL_PRE_COMMIT",
    category: "Customer Policy",
    description: "Policy hook before committing customer; validates custom business rules and fields.",
    inputFlist: "PIN_FLD_POID, PIN_FLD_NAMEINFO, PIN_FLD_SERVICES",
    outputFlist: "PIN_FLD_POID, PIN_FLD_STATUS"
  },
  "PCM_OP_PYMT_COLLECT": {
    name: "PCM_OP_PYMT_COLLECT",
    category: "Payments",
    description: "Executes payment collection against payment methods (credit card, direct debit) and settles open A/R items.",
    inputFlist: "PIN_FLD_POID (account), PIN_FLD_CHARGES, PIN_FLD_PAYINFO_OBJ",
    outputFlist: "PIN_FLD_POID (payment event), PIN_FLD_RESULTS"
  },
  "PCM_OP_ACT_USAGE": {
    name: "PCM_OP_ACT_USAGE",
    category: "Rating & Usage",
    description: "Rates and records network usage events (voice, data, messaging) against balance groups.",
    inputFlist: "PIN_FLD_POID (account), PIN_FLD_EVENT (sub-flist with timestamp, units)",
    outputFlist: "PIN_FLD_POID (event obj), PIN_FLD_RATED_AMOUNT, PIN_FLD_RESULTS"
  },
  "PCM_OP_SEARCH": {
    name: "PCM_OP_SEARCH",
    category: "Base Infrastructure",
    description: "Executes an SQL query through DM and returns flist result array for matching storable objects.",
    inputFlist: "PIN_FLD_POID, PIN_FLD_FLAGS, PIN_FLD_TEMPLATE, PIN_FLD_ARGS",
    outputFlist: "PIN_FLD_RESULTS (array of matching objects)"
  }
};
