import { GuestLifecycleAction } from './guest-actions.js';

export class CtShutdownAction extends GuestLifecycleAction {
	constructor() {
		super({
			kind: 'ct',
			actionKind: 'shutdown',
			requireLongPress: true,
			readyStates: ['running', 'paused'],
			topText: 'SHUTDOWN',
			manifestId: 'com.starklab.proxmox-manager.ct-shutdown'
		});
	}
}
