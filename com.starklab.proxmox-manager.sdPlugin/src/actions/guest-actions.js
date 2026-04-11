/**
 * Shared implementations for VM/CT overview, stats, and lifecycle action
 * buttons. Each concrete action class composes one of these and supplies
 * its Proxmox "kind" ('vm' or 'ct') and manifest id.
 *
 * This keeps 12 of the 16 action classes tiny — they become thin
 * subclasses that set `kind` and `manifestId` only.
 */

import {
	BaseSingletonAction,
	MarqueeDriver,
	attachSubscription,
	connectionOverride,
	safeSetImage,
	vmStateFromStatus,
	LongPressTimer
} from './base.js';
import { endpoints, pollManager } from '../api/poll-manager.js';
import { buildVmOverviewIcon, buildCtOverviewIcon, buildUnconfiguredIcon, buildAuthErrorIcon } from '../icons/status-icons.js';
import { buildPercentGauge, buildValueCard, buildOfflineGauge, buildUnconfiguredGauge } from '../icons/gauge-icons.js';
import { buildActionIcon } from '../icons/action-icons.js';
import {
	fractionToPct,
	ratioToPct,
	uptimeShort,
	bytesPerSecToMbps,
	bytesPerSecToMBs
} from '../utils/format.js';
import { ERROR_FLASH_MS } from '../utils/constants.js';
import streamDeck from '@elgato/streamdeck';

export const GUEST_STATS_PARAMS = [
	{ key: 'cpu', label: 'CPU', type: 'percent' },
	{ key: 'ram', label: 'RAM', type: 'percent' },
	{ key: 'disk-read', label: 'D READ', type: 'rate-mbs' },
	{ key: 'disk-write', label: 'D WRITE', type: 'rate-mbs' },
	{ key: 'net-in', label: 'NET IN', type: 'rate-mbps' },
	{ key: 'net-out', label: 'NET OUT', type: 'rate-mbps' },
	{ key: 'uptime', label: 'UPTIME', type: 'value' },
	{ key: 'disk', label: 'DISK', type: 'percent' }
];

/** Returns the correct endpoint + icon builder for the given guest kind. */
function endpointFor(kind, serverId, node, vmid) {
	return kind === 'vm'
		? endpoints.vmStatus(serverId, node, vmid)
		: endpoints.ctStatus(serverId, node, vmid);
}

function overviewIcon(kind, opts) {
	return kind === 'vm' ? buildVmOverviewIcon(opts) : buildCtOverviewIcon(opts);
}

// ---- Guest Overview -------------------------------------------------------

export class GuestOverviewAction extends BaseSingletonAction {
	constructor(kind) {
		super();
		this.kind = kind; // 'vm' | 'ct'
	}

	async onWillAppear(ev) { await this.#mount(ev); }
	async onWillDisappear(ev) { this.#unmount(ev); }
	async onDidReceiveSettings(ev) { this.#unmount(ev); await this.#mount(ev); }

	async #mount(ev) {
		const { serverId, node, vmid, label } = ev.payload?.settings ?? {};
		if (!serverId || !node || !vmid) {
			await safeSetImage(ev.action, buildUnconfiguredIcon(this.kind));
			return;
		}
		const entry = {
			dispose: () => {},
			vmid,
			fallbackLabel: label,
			latest: undefined,
			marquee: undefined
		};
		entry.marquee = new MarqueeDriver((frame) => this.#render(ev.action, entry, frame));
		this.instances.set(ev.action.id, entry);
		entry.dispose = await attachSubscription(
			serverId,
			endpointFor(this.kind, serverId, node, vmid),
			(result) => {
				entry.latest = result;
				const name = result.data?.name ?? entry.fallbackLabel ?? `${this.kind.toUpperCase()} ${entry.vmid}`;
				entry.marquee.setLabels([name]);
				this.#render(ev.action, entry, entry.marquee.current());
			}
		);
	}

	#unmount(ev) {
		const entry = this.instances.get(ev.action.id);
		if (entry) {
			entry.marquee?.stop();
			entry.dispose();
			this.instances.delete(ev.action.id);
		}
	}

	async #render(action, entry, frame) {
		const { vmid, fallbackLabel, latest } = entry;
		if (!latest) return;
		const override = connectionOverride(latest.connection);
		if (override === 'auth') {
			await safeSetImage(action, buildAuthErrorIcon(this.kind));
			return;
		}
		if (override === 'reconnecting') {
			await safeSetImage(action, overviewIcon(this.kind, { state: 'reconnecting', name: fallbackLabel, vmid, frame }));
			return;
		}
		if (latest.error && !latest.data) {
			await safeSetImage(action, overviewIcon(this.kind, { state: 'offline', name: fallbackLabel, vmid, frame }));
			return;
		}
		const data = latest.data ?? {};
		const state = vmStateFromStatus(data.status);
		const name = data.name ?? fallbackLabel ?? (vmid != null ? `${this.kind.toUpperCase()} ${vmid}` : this.kind.toUpperCase());
		await safeSetImage(action, overviewIcon(this.kind, { state, name, vmid, frame }));
	}
}

// ---- Guest Stats ----------------------------------------------------------

/**
 * Holds per-instance state needed for rate calculations (prev counters).
 */
class StatsRateTracker {
	constructor() {
		this.prev = undefined;
	}
	update(data) {
		const now = Date.now();
		let rates = { diskRead: 0, diskWrite: 0, netIn: 0, netOut: 0 };
		if (this.prev && data) {
			const dt = (now - this.prev.at) / 1000;
			if (dt > 0) {
				rates = {
					diskRead: Math.max(0, ((data.diskread ?? 0) - (this.prev.diskread ?? 0)) / dt),
					diskWrite: Math.max(0, ((data.diskwrite ?? 0) - (this.prev.diskwrite ?? 0)) / dt),
					netIn: Math.max(0, ((data.netin ?? 0) - (this.prev.netin ?? 0)) / dt),
					netOut: Math.max(0, ((data.netout ?? 0) - (this.prev.netout ?? 0)) / dt)
				};
			}
		}
		this.prev = {
			at: now,
			diskread: data?.diskread ?? 0,
			diskwrite: data?.diskwrite ?? 0,
			netin: data?.netin ?? 0,
			netout: data?.netout ?? 0
		};
		return rates;
	}
}

export class GuestStatsAction extends BaseSingletonAction {
	constructor(kind) {
		super();
		this.kind = kind;
	}

	async onWillAppear(ev) { await this.#mount(ev); }
	async onWillDisappear(ev) { this.#unmount(ev); }
	async onDidReceiveSettings(ev) { this.#unmount(ev); await this.#mount(ev); }

	async #mount(ev) {
		const { serverId, node, vmid, parameter = 'cpu', label } = ev.payload?.settings ?? {};
		if (!serverId || !node || !vmid) {
			await safeSetImage(ev.action, buildUnconfiguredGauge());
			return;
		}
		const entry = {
			dispose: () => {},
			vmid,
			fallbackLabel: label,
			parameter,
			tracker: new StatsRateTracker(),
			latest: undefined,
			latestRates: { diskRead: 0, diskWrite: 0, netIn: 0, netOut: 0 },
			marquee: undefined
		};
		entry.marquee = new MarqueeDriver((frame) => this.#render(ev.action, entry, frame));
		this.instances.set(ev.action.id, entry);
		entry.dispose = await attachSubscription(
			serverId,
			endpointFor(this.kind, serverId, node, vmid),
			(result) => {
				entry.latest = result;
				if (result.data) entry.latestRates = entry.tracker.update(result.data);
				const paramDef = GUEST_STATS_PARAMS.find((p) => p.key === entry.parameter) ?? GUEST_STATS_PARAMS[0];
				entry.marquee.setLabels([paramDef.label]);
				this.#render(ev.action, entry, entry.marquee.current());
			}
		);
	}

	#unmount(ev) {
		const entry = this.instances.get(ev.action.id);
		if (entry) {
			entry.marquee?.stop();
			entry.dispose();
			this.instances.delete(ev.action.id);
		}
	}

	async #render(action, entry, frame) {
		const { parameter, latest, latestRates } = entry;
		if (!latest) return;
		const paramDef = GUEST_STATS_PARAMS.find((p) => p.key === parameter) ?? GUEST_STATS_PARAMS[0];

		const override = connectionOverride(latest.connection);
		if (override || (latest.error && !latest.data)) {
			await safeSetImage(action, buildOfflineGauge({ label: paramDef.label, frame }));
			return;
		}
		const data = latest.data ?? {};

		switch (paramDef.key) {
			case 'cpu':
				await safeSetImage(action, buildPercentGauge({ pct: fractionToPct(data.cpu), label: paramDef.label, frame }));
				break;
			case 'ram':
				await safeSetImage(action, buildPercentGauge({ pct: ratioToPct(data.mem, data.maxmem), label: paramDef.label, frame }));
				break;
			case 'disk':
				await safeSetImage(action, buildPercentGauge({ pct: ratioToPct(data.disk, data.maxdisk), label: paramDef.label, frame }));
				break;
			case 'uptime':
				await safeSetImage(action, buildValueCard({ value: uptimeShort(data.uptime), label: paramDef.label, frame }));
				break;
			case 'disk-read':
				await safeSetImage(action, buildValueCard({ value: bytesPerSecToMBs(latestRates.diskRead), unit: 'M', label: paramDef.label, frame }));
				break;
			case 'disk-write':
				await safeSetImage(action, buildValueCard({ value: bytesPerSecToMBs(latestRates.diskWrite), unit: 'M', label: paramDef.label, frame }));
				break;
			case 'net-in':
				await safeSetImage(action, buildValueCard({ value: bytesPerSecToMbps(latestRates.netIn), unit: 'm', label: paramDef.label, frame }));
				break;
			case 'net-out':
				await safeSetImage(action, buildValueCard({ value: bytesPerSecToMbps(latestRates.netOut), unit: 'm', label: paramDef.label, frame }));
				break;
		}
	}
}

// ---- Guest Lifecycle Action Buttons ---------------------------------------

/**
 * Lifecycle action button shared by {vm,ct} × {start,shutdown,force-stop,reboot}.
 *
 * Config: { actionKind: 'start'|'shutdown'|'stop'|'reboot', requireLongPress: boolean, readyStates, topText }
 */
export class GuestLifecycleAction extends BaseSingletonAction {
	constructor({ kind, actionKind, requireLongPress, readyStates, topText, manifestId }) {
		super();
		this.kind = kind;
		this.actionKind = actionKind;
		this.requireLongPress = requireLongPress;
		this.readyStates = new Set(readyStates);
		this.topText = topText;
		this.manifestId = manifestId;
	}

	async onWillAppear(ev) { await this.#mount(ev); }
	async onWillDisappear(ev) { this.#unmount(ev); }
	async onDidReceiveSettings(ev) { this.#unmount(ev); await this.#mount(ev); }

	async onKeyDown(ev) {
		const entry = this.instances.get(ev.action.id);
		if (!entry) return;
		entry.longPress.start();
	}

	async onKeyUp(ev) {
		const entry = this.instances.get(ev.action.id);
		if (!entry) return;
		const press = entry.longPress.stop();
		if (this.requireLongPress && press !== 'long') {
			// Safety guard: require a deliberate long press for destructive actions.
			return;
		}
		if (!this.requireLongPress && press === 'none') return;
		await this.#invoke(ev.action, entry);
	}

	async #mount(ev) {
		const { serverId, node, vmid, label } = ev.payload?.settings ?? {};
		const entry = {
			dispose: () => {},
			longPress: new LongPressTimer(),
			latestStatus: undefined,
			overlayState: 'ready',
			overlayTimer: undefined,
			marquee: undefined,
			serverId, node, vmid, label
		};
		entry.marquee = new MarqueeDriver((frame) => this.#render(ev.action, entry, frame));
		this.instances.set(ev.action.id, entry);

		if (!serverId || !node || !vmid) {
			await safeSetImage(ev.action, buildActionIcon({ kind: this.actionKind, state: 'disabled', topText: this.topText }));
			return;
		}

		entry.dispose = await attachSubscription(
			serverId,
			endpointFor(this.kind, serverId, node, vmid),
			(result) => {
				// Only overwrite latestStatus when we have fresh data — preserve
				// the last known status on transient errors so the button stays
				// actionable rather than silently disabling.
				if (result.data?.status) entry.latestStatus = result.data.status;
				this.#updateMarquee(entry);
				this.#render(ev.action, entry, entry.marquee.current());
			}
		);
	}

	#unmount(ev) {
		const entry = this.instances.get(ev.action.id);
		if (entry) {
			entry.marquee?.stop();
			entry.dispose();
			if (entry.overlayTimer) clearTimeout(entry.overlayTimer);
			this.instances.delete(ev.action.id);
		}
	}

	/**
	 * Feed the marquee the current bottom label and force-tick it whenever
	 * we are rendering the 'working' spinner, so the spinner animates at
	 * the fast marquee cadence rather than the slow poll cadence.
	 */
	#updateMarquee(entry) {
		const label = entry.label ?? `${this.kind.toUpperCase()} ${entry.vmid}`;
		entry.marquee.setLabels([label]);
		entry.marquee.setForceTick(entry.overlayState === 'working');
	}

	async #invoke(action, entry) {
		const state = vmStateFromStatus(entry.latestStatus);
		if (!this.readyStates.has(state)) {
			streamDeck.logger.info(`[${this.topText}] blocked — current state '${state}' not in readyStates [${[...this.readyStates].join(',')}] (latestStatus=${entry.latestStatus})`);
			return;
		}

		// Optimistic overlay — show working immediately.
		entry.overlayState = 'working';
		this.#updateMarquee(entry);
		this.#render(action, entry, entry.marquee.current());

		try {
			await pollManager.execute(entry.serverId, (client) => this.#callClient(client, entry));
			entry.overlayState = 'ready';
			this.#updateMarquee(entry);
			// Force a refresh so the next render picks up the new status.
			await pollManager.refresh(entry.serverId, endpointFor(this.kind, entry.serverId, entry.node, entry.vmid)).catch(() => {});
		} catch (err) {
			streamDeck.logger.error(`[${this.topText}] action failed`, err);
			entry.overlayState = 'error';
			this.#updateMarquee(entry);
			this.#render(action, entry, entry.marquee.current());
			try { await action.showAlert(); } catch {}
			if (entry.overlayTimer) clearTimeout(entry.overlayTimer);
			entry.overlayTimer = setTimeout(() => {
				entry.overlayState = 'ready';
				this.#updateMarquee(entry);
				this.#render(action, entry, entry.marquee.current());
			}, ERROR_FLASH_MS);
		}
	}

	#callClient(client, entry) {
		const { node, vmid } = entry;
		if (this.kind === 'vm') {
			switch (this.actionKind) {
				case 'start':    return client.vmStart(node, vmid);
				case 'shutdown': return client.vmShutdown(node, vmid);
				case 'stop':     return client.vmStop(node, vmid);
				case 'reboot':   return client.vmReboot(node, vmid);
			}
		} else {
			switch (this.actionKind) {
				case 'start':    return client.ctStart(node, vmid);
				case 'shutdown': return client.ctShutdown(node, vmid);
				case 'stop':     return client.ctStop(node, vmid);
				case 'reboot':   return client.ctReboot(node, vmid);
			}
		}
		throw new Error(`unknown action ${this.kind}/${this.actionKind}`);
	}

	async #render(action, entry, frame) {
		const label = entry.label ?? `${this.kind.toUpperCase()} ${entry.vmid}`;
		if (entry.overlayState === 'working') {
			// Slow the spinner down relative to the marquee tick — one
			// spinner step every 3 frames so it reads as rotation rather
			// than flicker.
			const spinnerFrame = Math.floor((frame ?? 0) / 3);
			await safeSetImage(action, buildActionIcon({ kind: this.actionKind, state: 'working', label, topText: this.topText, frame: spinnerFrame }));
			return;
		}
		if (entry.overlayState === 'error') {
			await safeSetImage(action, buildActionIcon({ kind: this.actionKind, state: 'error', label, topText: this.topText, frame }));
			return;
		}
		const state = vmStateFromStatus(entry.latestStatus);
		const ready = this.readyStates.has(state);
		await safeSetImage(action, buildActionIcon({
			kind: this.actionKind,
			state: ready ? 'ready' : 'disabled',
			label,
			topText: this.topText,
			frame
		}));
	}
}
