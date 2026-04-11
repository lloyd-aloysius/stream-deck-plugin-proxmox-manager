import { GuestLifecycleAction } from './guest-actions.js';

export class CtStartAction extends GuestLifecycleAction {
	constructor() {
		super({
			kind: 'ct',
			actionKind: 'start',
			requireLongPress: false,
			readyStates: ['stopped'],
			topText: 'START',
			manifestId: 'com.starklab.proxmox-manager.ct-start'
		});
	}
}
