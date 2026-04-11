import { GuestStatsAction } from './guest-actions.js';

export class CtStatsAction extends GuestStatsAction {
	manifestId = 'com.starklab.proxmox-manager.ct-stats';
	constructor() { super('ct'); }
}
