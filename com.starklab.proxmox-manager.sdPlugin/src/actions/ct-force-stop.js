import { GuestLifecycleAction } from './guest-actions.js';

export class CtForceStopAction extends GuestLifecycleAction {
	constructor() {
		super({
			kind: 'ct',
			actionKind: 'stop',
			requireLongPress: true,
			readyStates: ['running', 'paused'],
			topText: 'FORCE',
			manifestId: 'com.starklab.proxmox-manager.ct-force-stop'
		});
	}
}
