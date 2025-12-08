import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class Pop3ServerApi implements ICredentialType {
	name = 'pop3ServerApi';

	displayName = 'POP3 Server';

	properties: INodeProperties[] = [
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: '',
			placeholder: 'mail.example.com',
			description: 'POP3 server hostname',
			required: true,
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 995,
			description: 'POP3 server port',
		},
		{
			displayName: 'Use TLS',
			name: 'secure',
			type: 'boolean',
			default: true,
			description: 'Whether to use TLS for the connection',
		},
		{
			displayName: 'Allow Self-signed Certificates',
			name: 'allowUnauthorized',
			type: 'boolean',
			default: false,
			description: 'Disable TLS certificate validation. Use only if required by your server.',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
		},
	];
}
