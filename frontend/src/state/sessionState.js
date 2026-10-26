// ==========================================================================
// Nexterm — Session State Subsystem
// Manages the hierarchical session tree, current root folder node, and lookup helpers.
// ==========================================================================

export let rootNode = null;

export function setRootNode(node) {
  rootNode = node;
  return rootNode;
}

export function findNodeById(nodeId, current = rootNode) {
  if (!current) return null;
  if (current.id === nodeId) return current;
  if (current.children && Array.isArray(current.children)) {
    for (const child of current.children) {
      const found = findNodeById(nodeId, child);
      if (found) return found;
    }
  }
  return null;
}

export function isDescendantInTree(ancestorId, childId) {
  function searchSub(n) {
    if (!n) return false;
    if (n.id === childId) return true;
    if (n.children) {
      for (const c of n.children) {
        if (searchSub(c)) return true;
      }
    }
    return false;
  }

  function findAnc(n) {
    if (!n) return null;
    if (n.id === ancestorId) return n;
    if (n.children) {
      for (const c of n.children) {
        const found = findAnc(c);
        if (found) return found;
      }
    }
    return null;
  }

  const anc = findAnc(rootNode);
  return anc ? searchSub(anc) : false;
}

export function getAllSessions(current = rootNode, results = []) {
  if (!current) return results;
  if (!current.isFolder && current.session) {
    results.push(current.session);
  }
  if (current.children && Array.isArray(current.children)) {
    current.children.forEach(c => getAllSessions(c, results));
  }
  return results;
}
