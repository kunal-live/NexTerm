// ==========================================================================
// NextTerm — Oracle BRM Knowledge Base & Fast Reference Definitions
// Provides client-side opcode lookups, error descriptions, and sample queries.
// ==========================================================================

export const BRM_SAMPLE_QUERIES = [
  { label: "Billing Failure", text: "Why is PCM_OP_BILL_MAKE_BILL_NOW failing?" },
  { label: "Find pin.conf", text: "Where is my CM pin.conf located?" },
  { label: "Explain PIN_ERR_BAD_OPCODE", text: "Explain error PIN_ERR_BAD_OPCODE and how to fix it" },
  { label: "Explain ORA-00001", text: "Why am I getting ORA-00001 unique constraint violated?" },
  { label: "Customer Commit", text: "What does PCM_OP_CUST_COMMIT_CUSTOMER do?" },
  { label: "NAP Connect Error", text: "Why is client getting PIN_ERR_NAP_CONNECT_FAILED?" },
  { label: "CM Port Pointer", text: "How to configure dm_pointer in CM pin.conf?" }
];

export const BRM_SOURCE_OPTIONS = [
  { key: "cm_log", label: "CM Log", icon: "📄", desc: "Connection Manager logs: opcode execution, client sessions, auth" },
  { key: "dm_log", label: "DM Log", icon: "🗄️", desc: "Data Manager logs: Oracle SQL statements, DB transaction errors" },
  { key: "pin_conf", label: "CM pin.conf", icon: "⚙️", desc: "CM configuration: dm_pointer, process limits, loglevels" },
  { key: "all", label: "All Relevant", icon: "🔍", desc: "Inspect CM Log, DM Log, and pin.conf simultaneously" }
];

export const BRM_OPCODES = {
  "PCM_OP_BILL_MAKE_BILL_NOW": {
    name: "PCM_OP_BILL_MAKE_BILL_NOW",
    category: "Billing",
    description: "Calculates total balance and generates immediate bill items outside regular scheduled billing cycle.",
    inputFlist: "PIN_FLD_POID (account), PIN_FLD_BILLINFO_OBJ, PIN_FLD_PROGRAM_NAME",
    outputFlist: "PIN_FLD_POID (bill), PIN_FLD_RESULTS (array of bill items)"
  },
  "PCM_OP_CUST_COMMIT_CUSTOMER": {
    name: "PCM_OP_CUST_COMMIT_CUSTOMER",
    category: "Customer Care",
    description: "Atomically commits new account, login credentials, services, balances, and profiles into BRM database.",
    inputFlist: "PIN_FLD_POID, PIN_FLD_NAMEINFO, PIN_FLD_SERVICES, PIN_FLD_BAL_INFO",
    outputFlist: "PIN_FLD_POID (account obj), PIN_FLD_RESULTS"
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
