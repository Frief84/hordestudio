/* One World clock calculation for turns, explicit advances and background time. */
(function (root) {
    'use strict';

    function getWorldTimeData(world, sess) {
        if (!sess.turnCount) sess.turnCount = 1;
        const timeStep = world.hudConfig?.timeStep !== undefined ? world.hudConfig.timeStep : 5;
        const startMinutes = (world.hudConfig?.startTimeHours !== undefined ? world.hudConfig.startTimeHours : 8) * 60
            + Math.max(0, Math.min(59, parseInt(world.hudConfig?.startTimeMinutes) || 0));
        const totalElapsedMinutes = (sess.turnCount - 1) * timeStep + (sess.bonusTimeMinutes || 0);
        const clock = sess.worldClock;
        const currentTotalMinutes = clock && Number.isFinite(clock.absoluteMinutes)
            && Number.isFinite(clock.turnCount) && Number.isFinite(clock.bonusTimeMinutes)
            ? Math.max(0, clock.absoluteMinutes + (sess.turnCount - clock.turnCount) * timeStep
                + (sess.bonusTimeMinutes || 0) - clock.bonusTimeMinutes)
            : Math.max(0, startMinutes + totalElapsedMinutes);
        sess.worldClock = {
            absoluteMinutes: currentTotalMinutes,
            turnCount: sess.turnCount,
            bonusTimeMinutes: sess.bonusTimeMinutes || 0
        };

        const days = Math.floor(currentTotalMinutes / (24 * 60)) + 1;
        const totalMinutesToday = ((currentTotalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
        const hours24 = Math.floor(totalMinutesToday / 60);
        const mins = totalMinutesToday % 60;

        return { days, hours24, mins, totalMinutesToday, currentTotalMinutes, timeStep, startMinutes };
    }

    function advanceMinutes(world, sess, minutes) {
        const before = getWorldTimeData(world, sess).currentTotalMinutes;
        const after = before + Math.max(0, Number.isFinite(Number(minutes)) ? Math.trunc(Number(minutes)) : 0);
        sess.worldClock.absoluteMinutes = after;
        return { before, after };
    }

    function setAbsoluteMinutes(world, sess, minutes) {
        const before = getWorldTimeData(world, sess).currentTotalMinutes;
        const target = Math.max(0, Number.isFinite(Number(minutes)) ? Math.trunc(Number(minutes)) : before);
        sess.bonusTimeMinutes = (Number(sess.bonusTimeMinutes) || 0) + target - before;
        return getWorldTimeData(world, sess);
    }

    function backgroundPolicy(world, sess, globalDefault = false) {
        const override = sess?.settings?.timeAdvancesWhenAway;
        const enabled = override === true || override === false
            ? override : (world?.settings?.timeAdvancesWhenAway === true || globalDefault === true);
        if (!enabled) return { enabled: false, reason: 'disabled' };
        const timeStep = world?.hudConfig?.timeStep !== undefined ? world.hudConfig.timeStep : 5;
        return Number(timeStep) === 0
            ? { enabled: false, reason: 'paused' }
            : { enabled: true, reason: null };
    }

    const api = Object.freeze({ getWorldTimeData, advanceMinutes, setAbsoluteMinutes, backgroundPolicy });
    root.HordeWorldTime = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
