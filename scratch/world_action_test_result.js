'use strict';
const { executeLinkedActions } = require('../worlds/linked-world-actions');
// Legacy effect suites ask whether every requested action applied. Production
// `ok` only says that the turn was processed; blocked actions can coexist with it.
// Preserve both facts explicitly instead of interpreting an accepted turn as a
// successful item transfer or creation.
function executeFullyAppliedActions(...args) {
    const result = executeLinkedActions(...args);
    return { ...result, transactionAccepted: result.ok,
        ok: result.ok && !(args[0]?.actions || []).some(action =>
            action.status === 'resolved' && ['blocked', 'failed', 'rejected']
                .includes(result.outcomes?.get(action.action_id))) };
}
module.exports = { executeFullyAppliedActions };
