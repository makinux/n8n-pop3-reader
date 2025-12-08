import net from 'node:net';
import tls from 'node:tls';

import type {
	ITriggerFunctions,
	ITriggerResponse,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type Pop3MessageRef = {
	index: number;
	uid: string;
};

type Pop3ClientOptions = {
	host: string;
	port: number;
	secure: boolean;
	allowUnauthorized: boolean;
	username: string;
	password: string;
	timeout: number;
};

class Pop3Client {
	private buffer = '';

	private socket: net.Socket | tls.TLSSocket | null = null;

	constructor(private readonly options: Pop3ClientOptions) {}

	private buildSocket() {
		const { host, port, secure, allowUnauthorized, timeout } = this.options;

		const baseOptions = { host, port, timeout };

		if (secure) {
			return tls.connect({
				...baseOptions,
				rejectUnauthorized: !allowUnauthorized,
			});
		}

		return net.createConnection(baseOptions);
	}

	private readResponse(multiline: boolean): Promise<string> {
		return new Promise((resolve, reject) => {
			if (!this.socket) {
				reject(new Error('Socket not connected'));
				return;
			}

			const terminator = multiline ? '\r\n.\r\n' : '\r\n';

			const cleanup = () => {
				this.socket?.off('data', onData);
				this.socket?.off('error', onError);
				this.socket?.off('timeout', onTimeout);
			};

			const onTimeout = () => {
				cleanup();
				reject(new Error('POP3 command timed out'));
			};

			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};

			const onData = (chunk: Buffer) => {
				this.buffer += chunk.toString();

				if (!this.buffer.includes(terminator)) return;

				cleanup();

				const response = this.buffer;
				this.buffer = '';

				const firstLineEnd = response.indexOf('\r\n');
				const status = firstLineEnd === -1 ? response : response.slice(0, firstLineEnd);

				if (!status.startsWith('+OK')) {
					reject(new Error(status.replace('-ERR', '').trim() || 'POP3 command failed'));
					return;
				}

				const bodyStart = firstLineEnd === -1 ? response.length : firstLineEnd + 2;
				let body = response.slice(bodyStart);

				if (multiline) {
					const terminatorIndex = body.lastIndexOf('\r\n.\r\n');
					if (terminatorIndex !== -1) {
						body = body.slice(0, terminatorIndex);
					}
				}

				resolve(body);
			};

			this.socket.on('data', onData);
			this.socket.once('error', onError);
			this.socket.once('timeout', onTimeout);
		});
	}

	private sendCommand(command: string, multiline = false) {
		if (!this.socket) {
			throw new Error('Socket not connected');
		}

		this.buffer = '';
		this.socket.write(`${command}\r\n`);

		return this.readResponse(multiline);
	}

	async connect() {
		return new Promise<void>((resolve, reject) => {
			this.socket = this.buildSocket();
			this.socket.setEncoding('utf8');
			this.socket.setTimeout(this.options.timeout);

			const cleanup = () => {
				this.socket?.off('data', onData);
				this.socket?.off('error', onError);
				this.socket?.off('timeout', onTimeout);
			};

			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};

			const onTimeout = () => {
				cleanup();
				reject(new Error('POP3 connection timed out'));
			};

			const onData = (chunk: Buffer) => {
				this.buffer += chunk.toString();
				if (!this.buffer.includes('\r\n')) return;

				cleanup();

				const statusLine = this.buffer.slice(0, this.buffer.indexOf('\r\n'));
				this.buffer = '';

				if (!statusLine.startsWith('+OK')) {
					reject(new Error('POP3 server rejected connection'));
					return;
				}

				resolve();
			};

			this.socket.on('data', onData);
			this.socket.once('error', onError);
			this.socket.once('timeout', onTimeout);
		});
	}

	async login() {
		await this.sendCommand(`USER ${this.options.username}`);
		await this.sendCommand(`PASS ${this.options.password}`);
	}

	async listUids(): Promise<Pop3MessageRef[]> {
		const body = await this.sendCommand('UIDL', true);

		return body
			.split('\r\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [index, uid] = line.split(' ');
				return { index: Number.parseInt(index, 10), uid };
			})
			.filter((entry) => !Number.isNaN(entry.index) && entry.uid);
	}

	async retrieve(index: number) {
		return this.sendCommand(`RETR ${index}`, true);
	}

	async delete(index: number) {
		await this.sendCommand(`DELE ${index}`);
	}

	async quit() {
		if (!this.socket) return;

		try {
			await this.sendCommand('QUIT');
		} catch {
			// Ignore, we are closing anyway.
		} finally {
			this.socket.end();
			this.socket.destroy();
			this.socket = null;
		}
	}
}

export class Pop3Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'POP3 Trigger',
		name: 'pop3Trigger',
		icon: 'fa:envelope-open',
		group: ['trigger'],
		version: 1,
		description: 'Triggers when new emails are available over POP3',
		eventTriggerDescription: 'Waits for new messages via POP3',
		defaults: {
			name: 'POP3 Trigger',
		},
		credentials: [
			{
				name: 'pop3ServerApi',
				required: true,
			},
		],
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		polling: true,
		properties: [
			{
				displayName: 'Emit Existing Messages',
				name: 'emitOnStart',
				type: 'boolean',
				default: false,
				description: 'Whether to emit messages already in the mailbox on the first run',
			},
			{
				displayName: 'Delete After Emit',
				name: 'deleteAfterDownload',
				type: 'boolean',
				default: false,
				description: 'Delete messages after they have been emitted',
			},
			{
				displayName: 'Max Messages Per Poll',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 50,
				},
				default: 10,
				description: 'Maximum number of new messages to emit per polling cycle',
			},
			{
				displayName: 'Polling Interval (seconds)',
				name: 'pollingInterval',
				type: 'number',
				default: 60,
				typeOptions: {
					minValue: 10,
				},
				description: 'How often to check the mailbox for new messages',
			},
			{
				displayName: 'Command Timeout (seconds)',
				name: 'timeout',
				type: 'number',
				default: 30,
				typeOptions: {
					minValue: 5,
				},
				description: 'POP3 command timeout',
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const emitOnStart = this.getNodeParameter('emitOnStart', 0) as boolean;
		const deleteAfterDownload = this.getNodeParameter('deleteAfterDownload', 0) as boolean;
		const limit = this.getNodeParameter('limit', 0) as number;
		const pollingIntervalSeconds = this.getNodeParameter('pollingInterval', 0) as number;
		const timeoutSeconds = this.getNodeParameter('timeout', 0) as number;

		const credentials = (await this.getCredentials('pop3ServerApi')) as {
			host: string;
			port: number;
			secure: boolean;
			allowUnauthorized: boolean;
			username: string;
			password: string;
		};

		const staticData = this.getWorkflowStaticData('node');
		const knownUids = new Set<string>((staticData.knownUids as string[]) || []);
		const hasInitialized = Boolean(staticData.initialized);

		const pollMailbox = async () => {
			const client = new Pop3Client({
				host: credentials.host,
				port: credentials.port,
				secure: credentials.secure,
				allowUnauthorized: credentials.allowUnauthorized,
				username: credentials.username,
				password: credentials.password,
				timeout: timeoutSeconds * 1000,
			});

			const now = new Date().toISOString();
			const items: INodeExecutionData[] = [];

			try {
				await client.connect();
				await client.login();

				const messageRefs = await client.listUids();

				if (!hasInitialized && !emitOnStart) {
					messageRefs.forEach((ref) => knownUids.add(ref.uid));
					staticData.knownUids = Array.from(knownUids);
					staticData.initialized = true;
					return;
				}

				staticData.initialized = true;

				const newRefs = messageRefs.filter((ref) => !knownUids.has(ref.uid)).slice(0, limit);

				for (const ref of newRefs) {
					const rawMessage = await client.retrieve(ref.index);

					knownUids.add(ref.uid);

					items.push({
						json: {
							uid: ref.uid,
							index: ref.index,
							raw: rawMessage,
							retrievedAt: now,
						},
					});

					if (deleteAfterDownload) {
						await client.delete(ref.index);
					}
				}
			} catch (error) {
				throw new NodeOperationError(this.getNode(), error as Error);
			} finally {
				staticData.knownUids = Array.from(knownUids);
				await client.quit();
			}

			if (items.length) {
				this.emit([items]);
			}
		};

		let active = false;

		const executePoll = async () => {
			if (active) return;
			active = true;

			try {
				await pollMailbox();
			} finally {
				active = false;
			}
		};

		await executePoll();

		const interval = setInterval(() => {
			executePoll().catch((error) => {
				this.logger?.error('POP3 polling failed', { error });
			});
		}, pollingIntervalSeconds * 1000);

		return {
			closeFunction: async () => {
				clearInterval(interval);
			},
		};
	}
}
