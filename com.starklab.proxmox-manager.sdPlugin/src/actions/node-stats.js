/**
 * Node Stats — single parameter from GET /nodes/{node}/status.
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

const TAG = '[NodeStats]';

export const NODE_PARAMS = [
	{ key: 'cpu', label: 'CPU', type: 'percent' },
	{ key: 'ram', label: 'RAM', type: 'percent' },
	{ key: 'rootfs', label: 'ROOT', type: 'percent' },
	{ key: 'uptime', label: 'UPTIME', type: 'value' }
];

export class NodeStatsAction extends BaseSingletonAction {
	manifestId = 'com.starklab.proxmox-manager.node-stats';

	async onWillAppear(ev) { await this.#mount(ev); }
	async onWillDisappear(ev) { this.#unmount(ev); }
	async onDidReceiveSettings(ev) { this.#unmount(ev); await this.#mount(ev); }

	async #mount(ev) {
		const { serverId, node, parameter = 'cpu' } = ev.payload?.settings ?? {};
		if (!serverId || !node) {
			await safeSetImage(ev.action, buildUnconfiguredGauge());
			return;
		}
		const entry = {
			dispose: () => {},
			node,
			parameter,
			latest: undefined,
			marquee: undefined
		};
		entry.marquee = new MarqueeDriver((frame) => this.#render(ev.action, entry, frame));
		this.instances.set(ev.action.id, entry);
		entry.dispose = await attachSubscription(
			serverId,
			endpoints.nodeStatus(serverId, node),
			(result) => {
				entry.latest = result;
				const paramDef = NODE_PARAMS.find((p) => p.key === entry.parameter) ?? NODE_PARAMS[0];
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
		const paramDef = NODE_PARAMS.find((p) => p.key === parameter) ?? NODE_PARAMS[0];
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
				await safeSetImage(action, buildPercentGauge({ pct: ratioToPct(data.memory?.used, data.memory?.total), label: paramDef.label, frame }));
				break;
			case 'rootfs':
				await safeSetImage(action, buildPercentGauge({ pct: ratioToPct(data.rootfs?.used, data.rootfs?.total), label: paramDef.label, frame }));
				break;
			case 'uptime':
				await safeSetImage(action, buildValueCard({ value: uptimeShort(data.uptime), label: paramDef.label, frame }));
				break;
		}
	}
}

export { TAG as NODE_STATS_TAG };
