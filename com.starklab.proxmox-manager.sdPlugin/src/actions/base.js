/**
 * Shared base helpers for all actions.
 *
 * Every action class follows the same shape:
 *   - constructor sets `manifestId`
 *   - onWillAppear creates a SubscriptionHandle for the visible action
 *   - onWillDisappear disposes the handle
 *   - onDidReceiveSettings re-creates the handle if settings changed
 *   - onSendToPlugin forwards PI messages to the shared handler
 *
 * Subscription handles abstract the poll-manager subscribe/unsubscribe
 * lifecycle and the per-instance render cadence.
 */

import streamDeck, { SingletonAction } from '@elgato/streamdeck';
import { pollManager, ConnectionState } from '../api/poll-manager.js';
import { LONG_PRESS_MS } from '../utils/constants.js';
import { handlePiMessage } from './pi-messages.js';
import { textOverflows } from '../icons/svg-generator.js';

/** Marquee tick interval in ms. ~12fps is smooth enough and light on CPU. */
const MARQUEE_TICK_MS = 80;

/**
 * Per-action-instance state keyed by Stream Deck context id. We avoid
 * putting state on the SingletonAction class itself since one singleton
 * handles all visible instances of a given action type.
 */
export class ContextRegistry {
	constructor() {
		/** @type {Map<string, any>} */
		this.map = new Map();
	}
	get(context) { return this.map.get(context); }
	set(context, value) { this.map.set(context, value); }
	delete(context) { this.map.delete(context); }
	values() { return this.map.values(); }
}

/**
 * Long-press detector. Each action instance that needs long-press behaviour
 * owns one of these.
 *
 * Usage: call `start()` on onKeyDown, call `stop()` on onKeyUp. `stop()`
 * returns 'short' or 'long' based on how long the key was held.
 */
export class LongPressTimer {
	constructor(thresholdMs = LONG_PRESS_MS) {
		this.thresholdMs = thresholdMs;
		this.startedAt = 0;
	}
	start() {
		this.startedAt = Date.now();
	}
	stop() {
		if (!this.startedAt) return 'none';
		const duration = Date.now() - this.startedAt;
		this.startedAt = 0;
		return duration >= this.thresholdMs ? 'long' : 'short';
	}
}

/**
 * Convenience wrapper for subscribing to an endpoint for the lifetime of a
 * visible action instance. Returns a disposer.
 */
export async function attachSubscription(serverId, endpointKey, handler, options) {
	return pollManager.subscribe(serverId, endpointKey, handler, options);
}

/**
 * Map a Proxmox VM/CT status string into the abstract status used by our
 * icon builders.
 */
export function vmStateFromStatus(statusStr) {
	switch (statusStr) {
		case 'running': return 'running';
		case 'paused':  return 'paused';
		case 'stopped':
		case 'suspended':
			return 'stopped';
		default: return 'unknown';
	}
}

/** Map connection state → status override for the overview icons. */
export function connectionOverride(connection) {
	if (connection === ConnectionState.AUTH_ERROR) return 'auth';
	if (connection === ConnectionState.RECONNECTING) return 'reconnecting';
	return null;
}

/**
 * Per-instance marquee ticker. Increments a frame counter on an interval
 * and invokes a render callback so the icon builder can scroll long labels.
 *
 * The driver auto-suspends when every label it is asked to display fits —
 * so static content doesn't keep a timer alive. Call `setLabels()` with the
 * labels that need checking whenever the data changes; call `stop()` on
 * unmount.
 */
export class MarqueeDriver {
	/**
	 * @param {(frame: number) => (void|Promise<void>)} render Called on each tick.
	 */
	constructor(render) {
		this.render = render;
		this.frame = 0;
		this.timer = undefined;
		this.needsScroll = false;
		this.forced = false;
	}

	/**
	 * Update the set of labels the driver needs to scroll. The driver starts
	 * its timer if any of them overflow (or `setForceTick(true)` has been
	 * called), and stops once neither condition holds.
	 */
	setLabels(labels, { fontSize = 18 } = {}) {
		this.needsScroll = labels.some((l) => l && textOverflows(l, fontSize));
		this.#evaluateTimer();
	}

	/**
	 * Force the driver to keep ticking even when no label overflows.
	 * Used by action buttons to drive their 'working' spinner animation
	 * at marquee cadence, which is much finer than the poll interval.
	 */
	setForceTick(enabled) {
		this.forced = Boolean(enabled);
		this.#evaluateTimer();
	}

	/** Current frame counter (0 when not scrolling). */
	current() {
		return this.frame;
	}

	/** Stop the ticker and release the timer. */
	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.needsScroll = false;
		this.forced = false;
		this.frame = 0;
	}

	#evaluateTimer() {
		const shouldTick = this.needsScroll || this.forced;
		if (shouldTick && !this.timer) {
			this.timer = setInterval(() => {
				this.frame = (this.frame + 1) | 0;
				try {
					const result = this.render(this.frame);
					if (result && typeof result.catch === 'function') {
						result.catch((err) => streamDeck.logger.error('[Marquee] render failed', err));
					}
				} catch (err) {
					streamDeck.logger.error('[Marquee] render threw', err);
				}
			}, MARQUEE_TICK_MS);
		} else if (!shouldTick && this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
			// Reset so the next scrollable label starts from the left.
			this.frame = 0;
		}
	}
}

/** Safe setImage — swallows errors so a single render failure can't crash. */
export async function safeSetImage(action, image) {
	try {
		await action.setImage(image);
	} catch (err) {
		streamDeck.logger.error('[Action] setImage failed', err);
	}
}

/**
 * Mixin that gives a SingletonAction subclass the common lifecycle and
 * PI message forwarding — avoids repeating `onSendToPlugin` in 16 files.
 * Subclasses should override `mount` / `unmount`. The base provides
 * `onWillAppear`, `onWillDisappear`, `onDidReceiveSettings`, `onSendToPlugin`.
 */
export class BaseSingletonAction extends SingletonAction {
	constructor() {
		super();
		this.instances = new ContextRegistry();
	}
	async onSendToPlugin(ev) {
		await handlePiMessage(ev);
	}
}

export { SingletonAction, streamDeck, pollManager, ConnectionState, handlePiMessage };
