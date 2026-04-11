/**
 * Poll Manager — singleton that owns polling, caching, and request dedup
 * for all Proxmox servers. Buttons subscribe to endpoints via
 * `subscribe(serverId, endpointKey, handler)` and receive event-driven
 * updates as poll cycles complete.
 *
 * Architecture (see SPEC.md §7):
 *
 *   ┌──────────────────────────────────────┐
 *   │  PollManager (singleton)             │
 *   │    per-server client + timer         │
 *   │    shared TTL cache (by URL)         │
 *   │    subscriber index (by endpointKey) │
 *   └──────────────────────────────────────┘
 *             │
 *             ▼  emits { data, error, connection }
 *        subscribers (button instances)
 *
 * Endpoint keys are opaque strings, e.g. `nodes:PVE01`, `vm-status:PVE01:100`.
 * Each key is backed by a resolver function that knows how to call the client.
 */

import { EventEmitter } from 'node:events';
import streamDeck from '@elgato/streamdeck';
import { ProxmoxClient, ProxmoxError } from './proxmox-client.js';
import * as cache from '../utils/cache.js';
import * as settings from '../utils/settings.js';
import {
	BACKOFF_SCHEDULE_SECONDS,
	DEFAULT_STATS_POLL_SECONDS,
	DEFAULT_STATUS_POLL_SECONDS,
	FAILURE_THRESHOLD
} from '../utils/constants.js';

const TAG = '[PollManager]';

/**
 * Endpoint key helpers — stable strings so multiple subscribers collapse
 * onto a single backing poll.
 */
export const endpoints = {
	version:         (serverId) => `version:${serverId}`,
	clusterStatus:   (serverId) => `cluster-status:${serverId}`,
	clusterResources:(serverId) => `cluster-resources:${serverId}`,
	nodes:           (serverId) => `nodes:${serverId}`,
	nodeStatus:      (serverId, node) => `node-status:${serverId}:${node}`,
	vmList:          (serverId, node) => `vm-list:${serverId}:${node}`,
	vmStatus:        (serverId, node, vmid) => `vm-status:${serverId}:${node}:${vmid}`,
	ctList:          (serverId, node) => `ct-list:${serverId}:${node}`,
	ctStatus:        (serverId, node, vmid) => `ct-status:${serverId}:${node}:${vmid}`
};

/**
 * Known connection states for a server.
 *   connected    — last request succeeded
 *   degraded     — partial failure, still reachable
 *   reconnecting — failure threshold hit, backing off and retrying
 *   auth         — 401/403, polling halted until config changes
 */
export const ConnectionState = Object.freeze({
	CONNECTED: 'connected',
	RECONNECTING: 'reconnecting',
	AUTH_ERROR: 'auth',
	UNKNOWN: 'unknown'
});

class PollManager extends EventEmitter {
	constructor() {
		super();
		this.setMaxListeners(0);
		/** @type {Map<string, ServerContext>} keyed by serverId */
		this.servers = new Map();
	}

	/**
	 * Ensures a ServerContext exists for a serverId. Idempotent.
	 * If the server config changed, the existing context's client is updated.
	 */
	async ensureServer(serverId) {
		const config = await settings.getServer(serverId);
		if (!config) {
			streamDeck.logger.warn(`${TAG} ensureServer: unknown id ${serverId}`);
			return undefined;
		}
		let ctx = this.servers.get(serverId);
		if (!ctx) {
			ctx = new ServerContext(this, config);
			this.servers.set(serverId, ctx);
			streamDeck.logger.info(`${TAG} server ${config.name} (${serverId}) initialised`);
		} else {
			ctx.updateConfig(config);
		}
		return ctx;
	}

	/**
	 * Subscribe an action instance to an endpoint.
	 * `resolver` is an async fn (client) → data. If omitted, the endpoint
	 * key must start with a known prefix that maps to a built-in resolver.
	 * `handler(result)` is called with `{ data, error, connection }` on each poll cycle
	 * and immediately if there is a cached value.
	 *
	 * Returns an unsubscribe function.
	 */
	async subscribe(serverId, endpointKey, handler, { resolver, intervalSeconds } = {}) {
		const ctx = await this.ensureServer(serverId);
		if (!ctx) {
			handler({ data: undefined, error: new Error('Unknown server'), connection: ConnectionState.UNKNOWN });
			return () => {};
		}
		const sub = ctx.addSubscription(endpointKey, handler, {
			resolver: resolver ?? defaultResolverFor(endpointKey),
			intervalSeconds
		});
		return () => ctx.removeSubscription(endpointKey, sub);
	}

	/**
	 * Force-refresh a single endpoint now, bypassing the TTL cache.
	 * Used by "Test Connection" and manual refresh buttons in the PI.
	 */
	async refresh(serverId, endpointKey, { resolver } = {}) {
		const ctx = await this.ensureServer(serverId);
		if (!ctx) throw new Error('Unknown server');
		return ctx.forceRefresh(endpointKey, resolver ?? defaultResolverFor(endpointKey));
	}

	/**
	 * Execute a one-off mutating call (start/stop/etc). Does not cache.
	 * Returns the resolver's result or throws the original ProxmoxError.
	 */
	async execute(serverId, resolver) {
		const ctx = await this.ensureServer(serverId);
		if (!ctx) throw new Error('Unknown server');
		return ctx.execute(resolver);
	}

	/** Test an arbitrary client without registering a poll. */
	async testConnection(config) {
		const client = new ProxmoxClient(config);
		try {
			const data = await client.version();
			return { ok: true, data };
		} catch (err) {
			return { ok: false, error: err };
		} finally {
			client.dispose();
		}
	}

	/** Refresh and cache the full hierarchy for a server (nodes + VMs + CTs). */
	async refreshHierarchy(serverId) {
		const ctx = await this.ensureServer(serverId);
		if (!ctx) throw new Error('Unknown server');
		const client = ctx.client;
		const nodesResp = await client.nodes();
		const nodes = [];
		for (const n of nodesResp ?? []) {
			const [vms, cts] = await Promise.all([
				client.vmList(n.node).catch(() => []),
				client.ctList(n.node).catch(() => [])
			]);
			nodes.push({
				node: n.node,
				status: n.status,
				vms: (vms ?? []).map((v) => ({ vmid: v.vmid, name: v.name, status: v.status })),
				cts: (cts ?? []).map((c) => ({ vmid: c.vmid, name: c.name, status: c.status }))
			});
		}
		cache.setHierarchy(serverId, { nodes });
		return nodes;
	}

	/** Remove a server entirely (e.g. after delete from PI). */
	async removeServer(serverId) {
		const ctx = this.servers.get(serverId);
		if (!ctx) return;
		await ctx.dispose();
		this.servers.delete(serverId);
		cache.clearHierarchy(serverId);
		streamDeck.logger.info(`${TAG} server ${serverId} removed`);
	}

	/** Shut down everything. Used on plugin exit. */
	async shutdown() {
		for (const ctx of this.servers.values()) {
			await ctx.dispose();
		}
		this.servers.clear();
		cache.clearAll();
	}
}

/**
 * Holds per-server state: client, cache, subscriptions, connection tracking.
 */
class ServerContext {
	constructor(manager, config) {
		this.manager = manager;
		this.config = config;
		this.client = new ProxmoxClient(config);
		/** @type {Map<string, EndpointState>} */
		this.endpointStates = new Map();
		/** @type {Map<string, any>} cache keyed by endpointKey */
		this.cache = new Map();
		this.connectionState = ConnectionState.UNKNOWN;
		this.failureCount = 0;
		this.backoffIndex = 0;
		this.timer = undefined;
		this.reconnectTimer = undefined;
		this.currentIntervalSeconds = config.statusPollSeconds || DEFAULT_STATUS_POLL_SECONDS;
	}

	updateConfig(config) {
		this.config = config;
		this.client.updateConfig(config);
		// Restart timer with new interval.
		this.#scheduleNextTick();
	}

	addSubscription(endpointKey, handler, { resolver, intervalSeconds }) {
		let state = this.endpointStates.get(endpointKey);
		if (!state) {
			state = {
				resolver,
				subscribers: new Set(),
				// Use the tighter of the requested intervals among subscribers.
				intervalSeconds: intervalSeconds ?? this.#defaultIntervalFor(endpointKey)
			};
			this.endpointStates.set(endpointKey, state);
		} else if (intervalSeconds && intervalSeconds < state.intervalSeconds) {
			state.intervalSeconds = intervalSeconds;
		}
		state.subscribers.add(handler);

		// Emit cached value immediately if present.
		if (this.cache.has(endpointKey)) {
			const cached = this.cache.get(endpointKey);
			try { handler({ ...cached, connection: this.connectionState }); } catch (err) {
				streamDeck.logger.error(`${TAG} subscriber handler threw`, err);
			}
		} else {
			// Kick off an immediate fetch for this endpoint so the first render is fast.
			this.#fetchEndpoint(endpointKey).catch(() => {});
		}

		this.#scheduleNextTick();
		return handler;
	}

	removeSubscription(endpointKey, handler) {
		const state = this.endpointStates.get(endpointKey);
		if (!state) return;
		state.subscribers.delete(handler);
		if (state.subscribers.size === 0) {
			this.endpointStates.delete(endpointKey);
			this.cache.delete(endpointKey);
		}
		if (this.endpointStates.size === 0) {
			this.#stopTimer();
		}
	}

	async forceRefresh(endpointKey, resolver) {
		const state = this.endpointStates.get(endpointKey);
		if (state) state.resolver = resolver ?? state.resolver;
		return this.#fetchEndpoint(endpointKey, { force: true, resolver });
	}

	async execute(resolver) {
		try {
			const data = await resolver(this.client);
			this.#markSuccess();
			return data;
		} catch (err) {
			this.#markFailure(err);
			throw err;
		}
	}

	async dispose() {
		this.#stopTimer();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		await this.client.dispose();
		this.endpointStates.clear();
		this.cache.clear();
	}

	// ---- polling loop ------------------------------------------------------

	#defaultIntervalFor(endpointKey) {
		// Status-style endpoints poll at the status cadence; anything stats-ish
		// polls at the stats cadence. Poll cycles below tick at the tighter one.
		const status = this.config.statusPollSeconds || DEFAULT_STATUS_POLL_SECONDS;
		const stats = this.config.statsPollSeconds || DEFAULT_STATS_POLL_SECONDS;
		if (/^(cluster-status|nodes|node-status|vm-status|ct-status|version):/.test(endpointKey)) {
			return status;
		}
		if (/^(cluster-resources|vm-list|ct-list):/.test(endpointKey)) {
			return stats;
		}
		return Math.min(status, stats);
	}

	#scheduleNextTick() {
		if (this.endpointStates.size === 0) {
			this.#stopTimer();
			return;
		}
		if (this.connectionState === ConnectionState.AUTH_ERROR) {
			// Stop polling on auth error — user must re-configure the token.
			this.#stopTimer();
			return;
		}

		const tickSeconds =
			this.connectionState === ConnectionState.RECONNECTING
				? this.#currentBackoffSeconds()
				: this.#shortestSubscribedInterval();

		if (this.timer && this.currentIntervalSeconds === tickSeconds) return;
		this.currentIntervalSeconds = tickSeconds;
		this.#stopTimer();
		this.timer = setInterval(() => this.#tick(), tickSeconds * 1000);
	}

	#shortestSubscribedInterval() {
		let min = Infinity;
		for (const state of this.endpointStates.values()) {
			if (state.intervalSeconds < min) min = state.intervalSeconds;
		}
		return Number.isFinite(min) ? min : (this.config.statusPollSeconds || DEFAULT_STATUS_POLL_SECONDS);
	}

	#stopTimer() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	async #tick() {
		// Dedup: fetch each subscribed endpoint once per tick, respecting
		// its individual interval via lastFetchedAt.
		const now = Date.now();
		const toFetch = [];
		for (const [key, state] of this.endpointStates.entries()) {
			const cached = this.cache.get(key);
			const dueAt = (cached?.fetchedAt ?? 0) + state.intervalSeconds * 1000;
			if (now >= dueAt) toFetch.push(key);
		}
		await Promise.allSettled(toFetch.map((k) => this.#fetchEndpoint(k)));
	}

	async #fetchEndpoint(endpointKey, { force = false, resolver } = {}) {
		const state = this.endpointStates.get(endpointKey);
		const effectiveResolver = resolver ?? state?.resolver;
		if (!effectiveResolver) return;

		if (!force && state) {
			// TTL dedup — if another code path already updated the cache very
			// recently (within half the interval), reuse it.
			const cached = this.cache.get(endpointKey);
			const ttlMs = (state.intervalSeconds * 1000) / 2;
			if (cached && Date.now() - cached.fetchedAt < ttlMs) {
				this.#emit(endpointKey, cached);
				return cached;
			}
		}

		let payload;
		try {
			const data = await effectiveResolver(this.client);
			payload = { data, error: undefined, fetchedAt: Date.now() };
			this.#markSuccess();
		} catch (err) {
			payload = { data: this.cache.get(endpointKey)?.data, error: err, fetchedAt: Date.now() };
			this.#markFailure(err, endpointKey);
		}

		this.cache.set(endpointKey, payload);
		this.#emit(endpointKey, payload);
		return payload;
	}

	#emit(endpointKey, payload) {
		const state = this.endpointStates.get(endpointKey);
		if (!state) return;
		const enriched = { ...payload, connection: this.connectionState };
		for (const handler of state.subscribers) {
			try { handler(enriched); } catch (err) {
				streamDeck.logger.error(`${TAG} subscriber handler threw for ${endpointKey}`, err);
			}
		}
	}

	// ---- connection state tracking ----------------------------------------

	#markSuccess() {
		const wasDown = this.connectionState !== ConnectionState.CONNECTED;
		this.failureCount = 0;
		this.backoffIndex = 0;
		if (this.connectionState !== ConnectionState.CONNECTED) {
			this.connectionState = ConnectionState.CONNECTED;
			if (wasDown) {
				streamDeck.logger.info(`${TAG} ${this.config.name} connected`);
				this.#broadcastConnectionChange();
			}
		}
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		this.#scheduleNextTick();
	}

	#markFailure(err, endpointKey) {
		// Auth errors short-circuit everything — stop polling, surface error.
		if (err instanceof ProxmoxError && err.kind === 'auth') {
			this.connectionState = ConnectionState.AUTH_ERROR;
			this.#broadcastConnectionChange();
			this.#stopTimer();
			streamDeck.logger.error(`${TAG} ${this.config.name} auth failure — polling halted`);
			return;
		}
		// 404 means a specific resource is gone — clear it from our cache
		// but don't flag the whole server as down.
		if (err instanceof ProxmoxError && err.kind === 'notfound') {
			if (endpointKey) this.cache.delete(endpointKey);
			return;
		}

		this.failureCount++;
		if (this.failureCount >= FAILURE_THRESHOLD && this.connectionState !== ConnectionState.RECONNECTING) {
			this.connectionState = ConnectionState.RECONNECTING;
			this.#broadcastConnectionChange();
			streamDeck.logger.warn(`${TAG} ${this.config.name} marked reconnecting after ${this.failureCount} failures`);
			this.#scheduleNextTick();
		}
	}

	#currentBackoffSeconds() {
		const i = Math.min(this.backoffIndex, BACKOFF_SCHEDULE_SECONDS.length - 1);
		const value = BACKOFF_SCHEDULE_SECONDS[i];
		this.backoffIndex = Math.min(this.backoffIndex + 1, BACKOFF_SCHEDULE_SECONDS.length - 1);
		return value;
	}

	#broadcastConnectionChange() {
		// Emit current cached payloads with the new connection state so all
		// subscribers re-render promptly.
		for (const [endpointKey, payload] of this.cache.entries()) {
			this.#emit(endpointKey, payload);
		}
		// Also emit an empty payload for endpoints with no cache yet.
		for (const [endpointKey, state] of this.endpointStates.entries()) {
			if (!this.cache.has(endpointKey)) {
				this.#emit(endpointKey, { data: undefined, error: undefined, fetchedAt: Date.now() });
			}
		}
	}
}

/**
 * Built-in resolver lookup so callers can `subscribe(serverId, endpoints.vmStatus(...))`
 * without having to pass a resolver every time.
 */
function defaultResolverFor(endpointKey) {
	const [kind, , ...rest] = endpointKey.split(':');
	// NB: split discards the serverId (index 1) since the resolver receives
	// the client directly.
	switch (kind) {
		case 'version':          return (c) => c.version();
		case 'cluster-status':   return (c) => c.clusterStatus();
		case 'cluster-resources':return (c) => c.clusterResources();
		case 'nodes':            return (c) => c.nodes();
		case 'node-status':      return (c) => c.nodeStatus(rest[0]);
		case 'vm-list':          return (c) => c.vmList(rest[0]);
		case 'vm-status':        return (c) => c.vmStatus(rest[0], rest[1]);
		case 'ct-list':          return (c) => c.ctList(rest[0]);
		case 'ct-status':        return (c) => c.ctStatus(rest[0], rest[1]);
		default:
			return undefined;
	}
}

export const pollManager = new PollManager();
export { TAG as POLL_MANAGER_TAG };
