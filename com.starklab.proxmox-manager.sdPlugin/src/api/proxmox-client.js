/**
 * Proxmox VE REST client.
 *
 * Handles: API token auth, per-server SSL toggle (homelabs use self-signed
 * certs), request timeout, and error classification. Actions never touch
 * HTTP directly — they go through this client via the poll manager.
 *
 * Error classification (see SPEC.md §8.4):
 *   - 'auth'    → 401 / 403, stop polling that server
 *   - 'notfound'→ 404, resource gone
 *   - 'server'  → 5xx
 *   - 'network' → fetch failed / DNS / refused
 *   - 'timeout' → request exceeded REQUEST_TIMEOUT_MS
 */

import { Agent, request as undiciRequest } from 'undici';
import streamDeck from '@elgato/streamdeck';
import { REQUEST_TIMEOUT_MS } from '../utils/constants.js';

const TAG = '[ProxmoxClient]';

/** Error with a `.kind` string matching the classification above. */
export class ProxmoxError extends Error {
	constructor(kind, message, { status, endpoint, cause } = {}) {
		super(message);
		this.name = 'ProxmoxError';
		this.kind = kind;
		this.status = status;
		this.endpoint = endpoint;
		if (cause) this.cause = cause;
	}
}

/**
 * Per-server client. One instance per configured server; the poll manager
 * owns the lifecycle.
 */
export class ProxmoxClient {
	/**
	 * @param {object} config Server config from global settings.
	 */
	constructor(config) {
		this.config = config;
		this.baseUrl = normalizeHost(config.host);
		this.dispatcher = buildDispatcher(config);
		streamDeck.logger.info(`${TAG} client for ${config.name} host=${this.baseUrl} verifySSL=${Boolean(config.verifySSL)}`);
	}

	/** Update the config and rebuild the dispatcher if TLS settings changed. */
	updateConfig(config) {
		const sslChanged = this.config.verifySSL !== config.verifySSL;
		const hostChanged = this.config.host !== config.host;
		this.config = config;
		this.baseUrl = normalizeHost(config.host);
		if (sslChanged || hostChanged) {
			this.dispatcher.close().catch(() => {});
			this.dispatcher = buildDispatcher(config);
			streamDeck.logger.info(`${TAG} rebuilt dispatcher for ${config.name} verifySSL=${Boolean(config.verifySSL)}`);
		}
	}

	/** Dispose — closes the dispatcher. */
	async dispose() {
		try {
			await this.dispatcher.close();
		} catch (_) {
			// ignore
		}
	}

	/** GET /api2/json/<path> returning the .data field. */
	async get(path) {
		return this.#request('GET', path);
	}

	/** POST /api2/json/<path> returning the .data field. */
	async post(path, body) {
		return this.#request('POST', path, body);
	}

	// ---- endpoint helpers --------------------------------------------------

	version() {
		return this.get('/version');
	}

	clusterStatus() {
		return this.get('/cluster/status');
	}

	clusterResources(type) {
		const q = type ? `?type=${encodeURIComponent(type)}` : '';
		return this.get(`/cluster/resources${q}`);
	}

	nodes() {
		return this.get('/nodes');
	}

	nodeStatus(node) {
		return this.get(`/nodes/${encodeURIComponent(node)}/status`);
	}

	vmList(node) {
		return this.get(`/nodes/${encodeURIComponent(node)}/qemu`);
	}

	vmStatus(node, vmid) {
		return this.get(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/current`);
	}

	ctList(node) {
		return this.get(`/nodes/${encodeURIComponent(node)}/lxc`);
	}

	ctStatus(node, vmid) {
		return this.get(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/current`);
	}

	vmStart(node, vmid)    { return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`); }
	vmShutdown(node, vmid) { return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/shutdown`); }
	vmStop(node, vmid)     { return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`); }
	vmReboot(node, vmid)   { return this.post(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/reboot`); }

	ctStart(node, vmid)    { return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/start`); }
	ctShutdown(node, vmid) { return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/shutdown`); }
	ctStop(node, vmid)     { return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/stop`); }
	ctReboot(node, vmid)   { return this.post(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/reboot`); }

	// ---- internals ---------------------------------------------------------

	async #request(method, path, body) {
		const endpoint = `${this.baseUrl}/api2/json${path}`;
		const headers = {
			Authorization: `PVEAPIToken=${this.config.tokenId}=${this.config.tokenSecret}`,
			Accept: 'application/json'
		};

		const opts = {
			method,
			headers,
			dispatcher: this.dispatcher,
			headersTimeout: REQUEST_TIMEOUT_MS,
			bodyTimeout: REQUEST_TIMEOUT_MS
		};
		if (body != null) {
			headers['Content-Type'] = 'application/json';
			opts.body = JSON.stringify(body);
		}

		// We use undici.request directly (not the global fetch) because Node's
		// built-in fetch uses its own internal undici copy, which rejects a
		// dispatcher from the bundled undici with UND_ERR_INVALID_ARG.
		let res;
		try {
			res = await undiciRequest(endpoint, opts);
		} catch (err) {
			if (err.name === 'AbortError' || err.code === 'UND_ERR_HEADERS_TIMEOUT' || err.code === 'UND_ERR_BODY_TIMEOUT') {
				throw new ProxmoxError('timeout', `Request timed out after ${REQUEST_TIMEOUT_MS}ms`, { endpoint, cause: err });
			}
			const reason = describeFetchFailure(err);
			streamDeck.logger.warn(`${TAG} request failed for ${endpoint}: ${reason}`);
			throw new ProxmoxError('network', `Network error: ${reason}`, { endpoint, cause: err });
		}

		const status = res.statusCode;
		if (status < 200 || status >= 300) {
			// Drain the body so the socket can be reused.
			await res.body.dump().catch(() => {});
			if (status === 401 || status === 403) {
				throw new ProxmoxError('auth', `Authentication failed (${status})`, { status, endpoint });
			}
			if (status === 404) {
				throw new ProxmoxError('notfound', `Resource not found (404)`, { status, endpoint });
			}
			if (status >= 500) {
				throw new ProxmoxError('server', `Proxmox server error (${status})`, { status, endpoint });
			}
			throw new ProxmoxError('server', `HTTP ${status}`, { status, endpoint });
		}

		// Proxmox responses wrap payloads as { data: ... }. Some POSTs return { data: "UPID:..." } (task id).
		let json;
		try {
			json = await res.body.json();
		} catch (err) {
			throw new ProxmoxError('server', `Invalid JSON response: ${err.message}`, { endpoint, cause: err });
		}
		return json?.data;
	}
}

/**
 * Build an undici Agent that honours the per-server SSL verify setting.
 * `connect.rejectUnauthorized = false` lets homelab self-signed certs pass.
 */
function buildDispatcher(config) {
	return new Agent({
		connect: {
			rejectUnauthorized: Boolean(config.verifySSL),
			timeout: REQUEST_TIMEOUT_MS
		},
		headersTimeout: REQUEST_TIMEOUT_MS,
		bodyTimeout: REQUEST_TIMEOUT_MS
	});
}

/** Ensures host starts with https:// (default) and has no trailing slash. */
function normalizeHost(host) {
	if (!host) return '';
	let h = host.trim();
	if (!/^https?:\/\//i.test(h)) h = 'https://' + h;
	return h.replace(/\/+$/, '');
}

/** Classify an arbitrary error into a ProxmoxError-compatible kind. */
export function classifyError(err) {
	if (err instanceof ProxmoxError) return err.kind;
	return 'network';
}

/**
 * Walk the cause chain to find the most specific reason fetch failed.
 * undici wraps the real error (DNS, ECONNREFUSED, self-signed cert, etc)
 * in `.cause`, sometimes nested multiple levels deep.
 */
function describeFetchFailure(err) {
	const parts = [];
	let cur = err;
	const seen = new Set();
	while (cur && !seen.has(cur)) {
		seen.add(cur);
		const code = cur.code ? `[${cur.code}] ` : '';
		const msg = cur.message || String(cur);
		if (msg && !parts.includes(`${code}${msg}`)) {
			parts.push(`${code}${msg}`);
		}
		cur = cur.cause;
	}
	return parts.join(' ← ') || 'unknown fetch failure';
}

export { TAG as PROXMOX_CLIENT_TAG };
