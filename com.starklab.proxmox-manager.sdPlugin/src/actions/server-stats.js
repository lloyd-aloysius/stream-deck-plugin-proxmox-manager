/**
 * Server Stats — display button with a single aggregated parameter.
 * Uses GET /cluster/resources?type=node and aggregates across nodes.
 */

import {
	BaseSingletonAction,
	MarqueeDriver,
	attachSubscription,
	connectionOverride,
	safeSetImage
} from './base.js';
import { endpoints } from '../api/poll-manager.js';
import { buildPercentGauge, buildValueCard, buildOfflineGauge, buildUnconfiguredGauge } from '../icons/gauge-icons.js';
import { fractionToPct, ratioToPct, uptimeShort } from '../utils/format.js';

const TAG = '[ServerStats]';

// Available parameters — keep in sync with pi/server-stats.html.
export const SERVER_PARAMS = [
	{ key: 'cpu', label: 'CPU', type: 'percent' },
	{ key: 'ram', label: 'RAM', type: 'percent' },
	{ key: 'storage', label: 'DISK', type: 'percent' },
	{ key: 'uptime', label: 'UPTIME', type: 'value' },
	{ key: 'nodes', label: 'NODES', type: 'value' }
];

export class ServerStatsAction extends BaseSingletonAction {
	manifestId = 'com.starklab.proxmox-manager.server-stats';

	async onWillAppear(ev) { await this.#mount(ev); }
	async onWillDisappear(ev) { this.#unmount(ev); }
	async onDidReceiveSettings(ev) { this.#unmount(ev); await this.#mount(ev); }

	async #mount(ev) {
		const { serverId, parameter = 'cpu' } = ev.payload?.settings ?? {};
		if (!serverId) {
			await safeSetImage(ev.action, buildUnconfiguredGauge());
			return;
		}
		const entry = {
			dispose: () => {},
			parameter,
			latest: undefined,
			marquee: undefined
		};
		entry.marquee = new MarqueeDriver((frame) => this.#render(ev.action, entry, frame));
		this.instances.set(ev.action.id, entry);
		entry.dispose = await attachSubscription(
			serverId,
			endpoints.clusterResources(serverId),
			(result) => {
				entry.latest = result;
				const paramDef = SERVER_PARAMS.find((p) => p.key === entry.parameter) ?? SERVER_PARAMS[0];
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
		const { parameter, latest } = entry;
		if (!latest) return;
		const paramDef = SERVER_PARAMS.find((p) => p.key === parameter) ?? SERVER_PARAMS[0];
		const override = connectionOverride(latest.connection);
		if (override || (latest.error && !latest.data)) {
			await safeSetImage(action, buildOfflineGauge({ label: paramDef.label, frame }));
			return;
		}

		const rows = latest.data ?? [];
		const nodeRows = rows.filter((r) => r.type === 'node');
		const storageRows = rows.filter((r) => r.type === 'storage');

		switch (paramDef.key) {
			case 'cpu': {
				// Mean CPU usage fraction weighted by maxcpu
				let totalMax = 0; let weightedSum = 0;
				for (const n of nodeRows) {
					const max = n.maxcpu ?? 0;
					totalMax += max;
					weightedSum += (n.cpu ?? 0) * max;
				}
				const pct = totalMax > 0 ? fractionToPct(weightedSum / totalMax) : 0;
				await safeSetImage(action, buildPercentGauge({ pct, label: paramDef.label, frame }));
				break;
			}
			case 'ram': {
				let used = 0; let max = 0;
				for (const n of nodeRows) { used += n.mem ?? 0; max += n.maxmem ?? 0; }
				await safeSetImage(action, buildPercentGauge({ pct: ratioToPct(used, max), label: paramDef.label, frame }));
				break;
			}
			case 'storage': {
				let used = 0; let max = 0;
				for (const s of storageRows) { used += s.disk ?? 0; max += s.maxdisk ?? 0; }
				await safeSetImage(action, buildPercentGauge({ pct: ratioToPct(used, max), label: paramDef.label, frame }));
				break;
			}
			case 'uptime': {
				const longest = nodeRows.reduce((m, n) => Math.max(m, n.uptime ?? 0), 0);
				await safeSetImage(action, buildValueCard({ value: uptimeShort(longest), label: paramDef.label, frame }));
				break;
			}
			case 'nodes': {
				const online = nodeRows.filter((n) => n.status === 'online').length;
				await safeSetImage(action, buildValueCard({ value: `${online}/${nodeRows.length}`, label: paramDef.label, frame }));
				break;
			}
		}
	}
}

export { TAG as SERVER_STATS_TAG };
