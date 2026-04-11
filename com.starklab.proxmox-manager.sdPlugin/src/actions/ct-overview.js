import { GuestOverviewAction } from './guest-actions.js';

export class CtOverviewAction extends GuestOverviewAction {
	manifestId = 'com.starklab.proxmox-manager.ct-overview';
	constructor() { super('ct'); }
}
