/*
 * Minimal Property Inspector runtime.
 *
 * Connects to the Stream Deck WebSocket via the standard
 * `connectElgatoStreamDeckSocket` entry point, exposes settings
 * helpers, and provides a `sendToPlugin` helper for PI → plugin RPC.
 *
 * Usage from each PI HTML file:
 *
 *   sdpi.ready((ctx) => {
 *     // ctx.settings, ctx.actionInfo
 *     // ctx.saveSettings(newSettings)
 *     // ctx.sendToPlugin({ type: 'list-servers' })
 *     // ctx.onMessage((payload) => ...)
 *   });
 */

(function () {
	let websocket;
	let uuid;
	let actionInfo;
	let settings = {};
	let pendingReady;
	let messageListeners = [];
	const onReady = [];

	window.connectElgatoStreamDeckSocket = function (port, pluginUUID, registerEvent, info, inActionInfo) {
		uuid = pluginUUID;
		actionInfo = JSON.parse(inActionInfo);
		settings = actionInfo.payload?.settings ?? {};

		websocket = new WebSocket('ws://127.0.0.1:' + port);

		websocket.onopen = () => {
			websocket.send(JSON.stringify({ event: registerEvent, uuid }));
			fireReady();
		};

		websocket.onmessage = (ev) => {
			let msg;
			try {
				msg = JSON.parse(ev.data);
			} catch (e) {
				console.error('[sdpi] bad message', ev.data);
				return;
			}
			if (msg.event === 'didReceiveSettings') {
				settings = msg.payload?.settings ?? {};
				for (const l of messageListeners) {
					if (l.type === 'settings') l.fn(settings);
				}
			} else if (msg.event === 'sendToPropertyInspector') {
				const payload = msg.payload ?? {};
				for (const l of messageListeners) {
					if (l.type === 'plugin') l.fn(payload);
				}
			}
		};

		websocket.onclose = () => console.log('[sdpi] socket closed');
		websocket.onerror = (e) => console.error('[sdpi] socket error', e);
	};

	function fireReady() {
		const ctx = {
			get settings() { return settings; },
			get actionInfo() { return actionInfo; },
			saveSettings(newSettings) {
				settings = { ...settings, ...newSettings };
				websocket.send(JSON.stringify({
					event: 'setSettings',
					context: uuid,
					payload: settings
				}));
			},
			sendToPlugin(payload) {
				websocket.send(JSON.stringify({
					action: actionInfo.action,
					event: 'sendToPlugin',
					context: uuid,
					payload
				}));
			},
			onMessage(fn) {
				messageListeners.push({ type: 'plugin', fn });
			},
			onSettingsChange(fn) {
				messageListeners.push({ type: 'settings', fn });
			}
		};
		for (const fn of onReady) fn(ctx);
	}

	window.sdpi = {
		ready(fn) {
			onReady.push(fn);
			if (websocket && websocket.readyState === WebSocket.OPEN) fireReady();
		}
	};
})();
