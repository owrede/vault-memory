#!/usr/bin/env node
// Explicit neutral-v1 host bridge. No installation into host configuration.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const timeout=Number(process.env.VM_HOOK_TIMEOUT_MS??25000);
if(!process.argv[2]||!Number.isInteger(timeout)||timeout<100||timeout>25000){console.error('Expected an event JSON file and timeout 100..25000ms');process.exitCode=2;}
else{
 const cli=process.env.VM_HOOK_CLI??fileURLToPath(new URL('../../dist/cli.js',import.meta.url));
 const child=spawn(process.execPath,[cli,'session','hook','--input',process.argv[2],'--json'],{stdio:['ignore','pipe','pipe']});
 let out='',err='',timedOut=false;
 child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeout);
 child.on('error',error=>{err+=String(error);});
 child.on('close',code=>{clearTimeout(timer);if(timedOut){process.stdout.write(JSON.stringify({ok:false,reason:'hook_timeout'})+'\n');process.stderr.write('Session hook timed out; retry the same event ID.\n');process.exitCode=5;}else{process.stdout.write(out);process.stderr.write(err);process.exitCode=code??5;}});
}
