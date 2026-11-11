'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const bound of ['0', '1']) {
    const run = spawnSync(process.execPath, [path.join(__dirname, 'world_resolved_intent_browser_audit.js')], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 120000,
        env: { ...process.env, HORDE_GENERALIZED_INTENT: '1', HORDE_RESOLVED_BOUND: bound,
            HORDE_RESOLVED_LIVE_MODEL: '' }
    });
    if (run.status !== 0) {
        console.error(run.stdout, run.stderr, run.error || '');
        process.exitCode = 1;
    } else console.log(run.stdout.trim().split(/\r?\n/).at(-1));
}
