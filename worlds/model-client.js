/* One HTTP boundary for foreground Worlds turns and background simulation.
 * The caller owns model policy and the state transaction; this module owns
 * transport, JSON decoding, and a single outcome vocabulary. */
(function (root) {
'use strict';

function clockNow() {
    return root.performance?.now ? root.performance.now() : Date.now();
}

function attempt(outcome, response, startedAt, now, data = null) {
    return {
        outcome,
        status: response?.status || 0,
        durationMs: Math.max(0, now() - startedAt),
        usage: data?.usage || null,
        providerTiming: data && {
            load_duration: data.load_duration ?? null,
            prompt_eval_duration: data.prompt_eval_duration ?? null,
            eval_duration: data.eval_duration ?? null,
            prompt_eval_count: data.prompt_eval_count ?? null,
            eval_count: data.eval_count ?? null
        }
    };
}

function abortReason(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error('World model request stopped.');
    error.name = 'AbortError';
    return error;
}

function failureOutcome(error, signal) {
    const reason = signal?.aborted ? signal.reason : error;
    if (reason?.name === 'TimeoutError' || reason?.code === 'WORLD_MODEL_TIMEOUT') return 'timeout';
    if (signal?.aborted || reason?.name === 'AbortError') return 'aborted';
    if (reason?.cause?.code === 'ECONNREFUSED' || reason?.code === 'ECONNREFUSED') return 'server_unreachable';
    return 'network_error';
}

function responseError(response, data) {
    const detail = String(data?.error?.message || data?.error || response.statusText || 'Provider request failed');
    const error = new Error(`Model server HTTP ${response.status}: ${detail}`);
    error.status = response.status;
    error.code = /model.*(?:not found|not loaded|does not exist)/i.test(detail)
        ? 'WORLD_MODEL_UNAVAILABLE' : response.status === 504
            ? 'WORLD_MODEL_TIMEOUT' : 'WORLD_MODEL_PROVIDER_ERROR';
    return error;
}

// Ollama's native empty-chat request loads a model without generating a turn.
// Probe only the standard Ollama port; other OpenAI-compatible servers retain
// their normal request path. Loading is cancellable, outside the turn budget.
async function prepareLocalModel({ url, model, signal, headers = {}, fetcher = root.fetch,
    onLoading = () => {}, onLoaded = () => {} }) {
    const base = new URL(url);
    if (base.port !== '11434') return false;
    const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)].filter(Boolean));
    const status = await awaitAbortable(() => fetcher(`${base.origin}/api/ps`, {
        headers, signal: probeSignal
    }), probeSignal);
    if (status.status === 404) return false;
    const listed = await awaitAbortable(() => status.json(), probeSignal);
    if (!status.ok) throw responseError(status, listed);
    if (!Array.isArray(listed.models)) return false;
    if (listed.models.some(entry => entry.name === model || entry.model === model)) return false;
    onLoading();
    try {
        const response = await awaitAbortable(() => fetcher(`${base.origin}/api/chat`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal,
            body: JSON.stringify({ model, messages: [], stream: false })
        }), signal);
        const data = await awaitAbortable(() => response.json(), signal);
        if (!response.ok || data.error) throw responseError(response, data);
        if (data.done !== true) throw new Error('Ollama did not confirm that the model finished loading.');
        return true;
    } catch (error) {
        if (!signal?.aborted) {
            const wrapped = new Error(`Local model loading failed: ${error.message}`, { cause: error });
            wrapped.code = error.code === 'WORLD_MODEL_UNAVAILABLE'
                ? error.code : 'WORLD_MODEL_LOAD_FAILED';
            wrapped.status = error.status;
            throw wrapped;
        }
        throw error;
    } finally { onLoaded(); }
}

// Some OpenAI-compatible servers send HTTP 200 and then never finish the JSON
// body. Fetch abort normally rejects response.text(), but it is not reliable
// for every browser/proxy combination. Settle our own await on abort as well.
function awaitAbortable(operation, signal) {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (!signal) {
        try { return Promise.resolve(operation()); }
        catch (error) { return Promise.reject(error); }
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (done, value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            done(value);
        };
        const onAbort = () => finish(reject, abortReason(signal));
        signal.addEventListener('abort', onAbort, { once: true });
        let pending;
        try { pending = operation(); }
        catch (error) { finish(reject, error); return; }
        Promise.resolve(pending).then(
            value => finish(resolve, value), error => finish(reject, error));
    });
}

async function json({ url, body, init = {}, fetcher = root.fetch, now = clockNow,
    onSettled = null, timeoutMs = 0 }) {
    if (typeof fetcher !== 'function') throw new Error('World model transport is unavailable.');
    const startedAt = now();
    let response = null;
    let data = null;
    let outcome = 'network_error';
    const deadline = Number(timeoutMs);
    const bounded = Number.isFinite(deadline) && deadline > 0;
    const externalSignal = init.signal;
    const controller = bounded ? new AbortController() : null;
    let timeoutId = null;
    let forwardAbort = null;
    if (controller) {
        forwardAbort = () => controller.abort(abortReason(externalSignal));
        if (externalSignal?.aborted) forwardAbort();
        else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
        timeoutId = setTimeout(() => {
            const error = new Error(`World model response did not complete within ${Math.round(deadline / 1000)}s.`);
            error.name = 'TimeoutError';
            error.code = 'WORLD_MODEL_TIMEOUT';
            controller.abort(error);
        }, deadline);
    }
    const requestInit = controller ? { ...init, signal: controller.signal } : init;
    try {
        response = await awaitAbortable(() => fetcher(url,
            { ...requestInit, body: JSON.stringify(body) }), requestInit.signal);
        let raw;
        try { raw = await awaitAbortable(() => response.text(), requestInit.signal); }
        catch (error) { outcome = 'body_error'; throw error; }
        try { data = raw ? JSON.parse(raw) : {}; }
        catch (_) {
            outcome = 'invalid_json';
            if (response.ok) {
                const error = new Error('The model provider returned invalid JSON. Retry this turn or choose another model.');
                error.code = 'WORLD_MODEL_INVALID_JSON';
                error.stage = 'parsing';
                throw error;
            }
            data = {};
        }
        if (response.ok) {
            try { data = decodeCompletionBody(raw); }
            catch (error) {
                outcome = error.code === 'WORLD_MODEL_PROVIDER_ERROR' ? 'provider_error' : 'empty_completion';
                throw error;
            }
        }
        if (outcome !== 'invalid_json') outcome = response.ok ? 'ok' : 'http_error';
        return { response, data };
    } catch (error) {
        const failure = failureOutcome(error, requestInit.signal);
        if (failure === 'timeout' || failure === 'aborted' || failure === 'server_unreachable') outcome = failure;
        else if (response && outcome === 'network_error') outcome = 'body_error';
        if (!error.code && outcome === 'network_error') error.code = 'WORLD_MODEL_NETWORK_ERROR';
        if (!error.code && outcome === 'server_unreachable') error.code = 'WORLD_MODEL_SERVER_UNREACHABLE';
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (externalSignal && forwardAbort) externalSignal.removeEventListener('abort', forwardAbort);
        // Diagnostics must never replace a valid model reply or hide the
        // provider's original failure.
        if (onSettled) {
            try { onSettled(attempt(outcome, response, startedAt, now, data)); }
            catch (error) { root.console?.warn?.('World model diagnostics failed:', error?.message || error); }
        }
    }
}

async function stream({ url, body, init = {}, fetcher = root.fetch, now = clockNow, onFailure = null }) {
    if (typeof fetcher !== 'function') throw new Error('World model transport is unavailable.');
    const startedAt = now();
    try {
        const response = await awaitAbortable(() => fetcher(url,
            { ...init, body: JSON.stringify(body) }), init.signal);
        return { response, startedAt };
    } catch (error) {
        if (onFailure) {
            try { onFailure(attempt(failureOutcome(error, init.signal), null, startedAt, now)); }
            catch (diagnosticError) { root.console?.warn?.('World model diagnostics failed:', diagnosticError?.message || diagnosticError); }
        }
        throw error;
    }
}

// All configured text providers expose chat completions (the Horde adapter
// does so as well). Normalize content at this boundary, never reasoning text.
function contentText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.filter(part => part && (!part.type || ['text', 'output_text'].includes(part.type)))
        .map(part => typeof part.text === 'string' ? part.text : '').join('');
}

function structuredCompletion(data) {
    const choice = data?.choices?.[0];
    const message = choice?.message || choice?.delta || {};
    const fail = (code, message, stage) => {
        const error = new Error(message);
        Object.assign(error, { code, stage });
        throw error;
    };
    if (choice?.finish_reason === 'length') fail('WORLD_INTENT_TRUNCATED',
        'The intent model exhausted its output token budget before completing the response.', 'parsing');
    if (message.refusal || choice?.finish_reason === 'content_filter') fail('WORLD_INTENT_REFUSED',
        'The model declined to resolve this action.', 'semantic');
    const calls = (message.tool_calls || []).filter(call => call?.function?.arguments != null);
    if (calls.length > 1) fail('WORLD_INTENT_AMBIGUOUS_RESPONSE',
        'The intent model returned multiple structured results; one result is required.', 'schema');
    const source = calls[0]?.function?.arguments ?? message.function_call?.arguments
        ?? message.parsed ?? contentText(message.content);
    if (source && typeof source === 'object' && !Array.isArray(source)) return source;
    if (typeof source !== 'string' || !source.trim()) fail('WORLD_INTENT_EMPTY_RESPONSE',
        'The intent model returned no structured action content.', 'parsing');
    // Accept a single whole-response Markdown fence, not arbitrary JSON scraped
    // from prose or a reasoning trace. Ambiguous/truncated output stays invalid.
    const text = source.trim().replace(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i, '$1').trim();
    try { return JSON.parse(text); }
    catch (_) { return fail('WORLD_INTENT_INVALID_JSON',
        'The intent model returned malformed JSON. Retry the turn.', 'parsing'); }
}

function structuredFormatUnsupported(response, data) {
    return [400, 422].includes(response?.status)
        && /response_format|json_schema|structured.?outputs?/i.test(String(data?.error?.message || data?.error || ''))
        && /unsupported|not supported|does not support|not available|unknown|unrecognized/i
            .test(String(data?.error?.message || data?.error || ''));
}

function decodeCompletionBody(raw) {
    let data;
    try { data = JSON.parse(String(raw || '').trim()); }
    catch (_) {
        const error = new Error('The model provider returned neither streaming events nor a valid JSON chat completion. Retry or choose another model.');
        error.code = 'WORLD_MODEL_INVALID_COMPLETION';
        error.stage = 'parsing';
        throw error;
    }
    if (data?.error) {
        const error = new Error(String(data.error?.message || data.error || 'Model provider error.'));
        error.code = 'WORLD_MODEL_PROVIDER_ERROR';
        throw error;
    }
    if (!Array.isArray(data?.choices) || !data.choices.length
        || !data.choices.some(choice => choice && (choice.message || choice.delta))) {
        const error = new Error('The model provider returned no chat-completion choices. Retry or choose another model.');
        error.code = 'WORLD_MODEL_EMPTY_COMPLETION';
        error.stage = 'parsing';
        throw error;
    }
    return { ...data, choices: data.choices.map(choice => ({ ...choice,
        ...(choice.message ? { message: { ...choice.message,
            content: contentText(choice.message.content) } } : {}),
        ...(choice.delta ? { delta: { ...choice.delta,
            content: contentText(choice.delta.content) } } : {})
    })) };
}

// Compatible providers differ on whether a streamed field is a delta or the
// whole text accumulated so far. Accept either without duplicating a growing
// prefix; an unrelated fragment still appends in arrival order.
function mergeStreamText(previous, incoming) {
    const before = String(previous || '');
    const next = String(incoming || '');
    if (!next) return before;
    if (before && next.length > before.length && next.startsWith(before)) return next;
    return before + next;
}

// Compare only like routes/protocols. Missing legacy measurements remain
// unknown; they must not become artificial zero-millisecond samples.
function latencySummary(history) {
    const groups = new Map();
    for (const message of history || []) {
        const audit = message.callAudit;
        if (message.role !== 'dm' || !audit?.metrics) continue;
        const first = audit.calls?.[0] || {};
        const key = JSON.stringify([first.provider || 'unknown', first.model || 'unknown', audit.protocol || 'unknown']);
        if (!groups.has(key)) groups.set(key, { provider: first.provider || 'unknown', model: first.model || 'unknown',
            protocol: audit.protocol || 'unknown', turns: 0, repairedTurns: 0, rejectedTurns: 0, samples: [] });
        const group = groups.get(key);
        group.turns++;
        if (audit.receiptRepair > 0) group.repairedTurns++;
        if (message.stateSource === 'frozen_no_receipt') group.rejectedTurns++;
        const duration = audit.metrics.acceptedDisplayMs;
        if (message.stateSource !== 'frozen_no_receipt' && typeof duration === 'number' && Number.isFinite(duration) && duration >= 0)
            group.samples.push(duration);
    }
    return [...groups.values()].map(({ samples, ...group }) => {
        samples.sort((a, b) => a - b);
        const middle = Math.floor(samples.length / 2);
        return { ...group, measuredTurns: samples.length,
            medianMs: samples.length ? (samples[middle] + samples[Math.floor((samples.length - 1) / 2)]) / 2 : null,
            p95Ms: samples.length ? samples[Math.ceil(samples.length * 0.95) - 1] : null };
    });
}

root.HordeWorldModelClient = {
    prepareLocalModel,
    failureOutcome, responseError,
    latencySummary,
    json, stream, decodeCompletionBody, mergeStreamText,
    contentText, structuredCompletion, structuredFormatUnsupported,
    runAbortable: awaitAbortable,
    readText: (response, signal) => awaitAbortable(() => response.text(), signal),
    readChunk: (reader, signal) => awaitAbortable(() => reader.read(), signal)
};
if (typeof module !== 'undefined') module.exports = root.HordeWorldModelClient;
})(globalThis);
