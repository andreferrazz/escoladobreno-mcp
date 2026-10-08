// Prints the ADMIN_PASSWORD_HASH for a password read from stdin (not echoed on a terminal).
import { createInterface } from 'node:readline';
import { hashPassword } from '../src/password.ts';

const tty = process.stdin.isTTY;
if (tty) {
	process.stderr.write('Password: ');
	process.stdin.setRawMode(true);
}

let password = '';
if (tty) {
	for await (const chunk of process.stdin) {
		const key = String(chunk);
		if (key === '\r' || key === '\n' || key === '\u0004') break;
		if (key === '\u0003') process.exit(130);
		password = key === '\u007f' ? password.slice(0, -1) : password + key;
	}
	process.stdin.setRawMode(false);
	process.stdin.pause();
	process.stderr.write('\n');
} else {
	for await (const line of createInterface({ input: process.stdin })) {
		password = line;
		break;
	}
}

if (password.length < 12) {
	console.error('Use at least 12 characters.');
	process.exit(1);
}
console.log(hashPassword(password));
