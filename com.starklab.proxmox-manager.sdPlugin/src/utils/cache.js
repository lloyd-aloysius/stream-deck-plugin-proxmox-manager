/**
 * In-memory per-server hierarchy cache: nodes → VMs/CTs.
 *
 * Populated by callers (typically the Property Inspector on refresh, or the
 * poll manager on demand). Stale data is preserved on connection failure so
 * that dropdowns in the PI remain populated.
 *
 * Shape:
 *   hierarchy[serverId] = {
 *     fetchedAt: epoch ms,
 *     nodes: [
 *       { node, status, vms: [{ vmid, name, status }], cts: [{ vmid, name, status }] }
 *     ]
 *   }
 */

const TAG = '[Cache]';
const hierarchy = new Map();

export function getHierarchy(serverId) {
	return hierarchy.get(serverId);
}

export function setHierarchy(serverId, data) {
	hierarchy.set(serverId, { ...data, fetchedAt: Date.now() });
}

export function clearHierarchy(serverId) {
	hierarchy.delete(serverId);
}

export function clearAll() {
	hierarchy.clear();
}

/**
 * Resolves a node name by server id. Returns undefined if not cached.
 */
export function findNode(serverId, nodeName) {
	const h = hierarchy.get(serverId);
	return h?.nodes.find((n) => n.node === nodeName);
}

/**
 * Resolves a VM by server / node / vmid from the cache.
 */
export function findVm(serverId, nodeName, vmid) {
	const vmidNum = Number(vmid);
	return findNode(serverId, nodeName)?.vms.find((v) => Number(v.vmid) === vmidNum);
}

/**
 * Resolves a CT by server / node / vmid from the cache.
 */
export function findCt(serverId, nodeName, vmid) {
	const vmidNum = Number(vmid);
	return findNode(serverId, nodeName)?.cts.find((c) => Number(c.vmid) === vmidNum);
}

export { TAG as CACHE_TAG };
