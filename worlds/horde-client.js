/* Optional AI Horde queue transport.
 * Deliberately independent from the OpenAI-compatible providers: Horde has a
 * job queue, a status endpoint and different timeout/retry semantics.
 */
(function (root) {
    'use strict';
    const API = 'https://aihorde.net/api/v2';
    const sleep = (ms, signal) => new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        const timer = setTimeout(resolve, Math.max(0, ms));
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    const retryAfterMs = response => {
        const raw = response?.headers?.get?.('Retry-After');
        const seconds = Number(raw);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30000, seconds * 1000);
        const date = raw ? Date.parse(raw) : NaN;
        return Number.isFinite(date) ? Math.max(0, Math.min(30000, date - Date.now())) : 0;
    };
    const request = async (path, init = {}, options = {}) => {
        const timeoutMs = Math.max(1, Number(options.timeoutMs) || 30000);
        const controller = new AbortController();
        const forward = () => controller.abort(options.signal?.reason || new DOMException('Aborted', 'AbortError'));
        if (options.signal?.aborted) forward();
        else options.signal?.addEventListener('abort', forward, { once: true });
        const timer = setTimeout(() => controller.abort(Object.assign(new Error(`AI Horde request timed out after ${timeoutMs}ms`), { name: 'TimeoutError' })), timeoutMs);
        try {
            return await fetch(`${API}${path}`, { ...init, signal: controller.signal });
        } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', forward); }
    };
    const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    const auth = key => ({ 'Content-Type': 'application/json', apikey: String(key || '0000000000').trim() || '0000000000' });
    const readJson = async response => {
        const raw = await response.text();
        let value = {};
        try { value = raw ? JSON.parse(raw) : {}; } catch (_) { value = { message: raw }; }
        return { raw, value };
    };
    const waitForJob = async (id, options, paths) => {
        const started = Date.now();
        const maxWaitMs = Math.max(1000, Number(options.maxWaitMs) || 90000);
        let delay = 1000;
        let empty = 0;
        let last = null;
        while (Date.now() - started < maxWaitMs) {
            const response = await request(paths.status(id), { headers: auth(options.apiKey) }, { signal: options.signal, timeoutMs: 30000 });
            if (response.status === 429) {
                await sleep(Math.max(retryAfterMs(response), delay), options.signal);
                delay = Math.min(12000, delay * 2);
                continue;
            }
            const { value } = await readJson(response);
            if (!response.ok) throw new Error(`AI Horde status ${response.status}: ${value.message || value.error || response.statusText}`);
            last = value;
            let text = paths.extract(value);
            if (!text && value.done === true && paths.final) {
                const finalResponse = await request(paths.final(id), { headers: auth(options.apiKey) }, { signal: options.signal, timeoutMs: 30000 });
                if (finalResponse.status === 429) { await sleep(Math.max(retryAfterMs(finalResponse), delay), options.signal); continue; }
                const finalBody = await readJson(finalResponse);
                if (!finalResponse.ok) throw new Error(`AI Horde result ${finalResponse.status}: ${finalBody.value.message || finalResponse.statusText}`);
                last = finalBody.value;
                text = paths.extract(last);
            }
            if (text) return { text, raw: value, polls: empty };
            if (value.done === true || value.faulted === true || value.failed === true) {
                throw new Error(value.faulted || value.failed ? 'AI Horde job failed.' : 'AI Horde completed without a usable generation.');
            }
            empty += 1;
            if (empty >= Math.max(1, Number(options.maxEmpty) || 10)) throw new Error('AI Horde returned too many empty results. Retry the request.');
            await sleep(delay, options.signal);
            delay = Math.min(12000, delay * 2);
        }
        throw Object.assign(new Error('AI Horde queue exceeded the 90-second wait budget.'), { code: 'HORDE_QUEUE_TIMEOUT', last });
    };
    async function generateText(options = {}) {
        if (!online()) throw Object.assign(new Error('AI Horde is unavailable while the browser is offline.'), { code: 'HORDE_OFFLINE' });
        const body = {
            prompt: String(options.prompt || ''),
            models: options.model && options.model !== 'any' ? [String(options.model)] : ['ANY_UNCENSORED'],
            params: { max_length: Math.max(16, Math.min(8192, Number(options.maxTokens) || 1024)), temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.8 }
        };
        const response = await request('/generate/text/async', { method: 'POST', headers: auth(options.apiKey), body: JSON.stringify(body) }, { signal: options.signal, timeoutMs: 40000 });
        if (response.status === 429) {
            if (options._retried429) throw new Error('AI Horde rate limit persisted after Retry-After backoff.');
            const wait = Math.max(retryAfterMs(response), 1000);
            await sleep(wait, options.signal);
            return generateText({ ...options, _retried429: true });
        }
        const { value } = await readJson(response);
        if (!response.ok) throw new Error(`AI Horde submit ${response.status}: ${value.message || value.error || response.statusText}`);
        if (!value.id) throw new Error('AI Horde did not return a job id.');
        const result = await waitForJob(value.id, { ...options, maxWaitMs: 90000, maxEmpty: 10 }, {
            status: id => `/generate/text/status/${encodeURIComponent(id)}`,
            extract: data => String(data.generations?.[0]?.text || '').trim()
        });
        return { ...result, id: value.id };
    }
    async function listModels(options = {}) {
        if (!online()) throw Object.assign(new Error('AI Horde is unavailable while the browser is offline.'), { code: 'HORDE_OFFLINE' });
        const type = options.type === 'image' ? 'image' : 'text';
        const response = await request(`/status/models?type=${type}&model_state=all`, { headers: auth(options.apiKey) }, { signal: options.signal, timeoutMs: 30000 });
        const { value } = await readJson(response);
        if (!response.ok) throw new Error(`AI Horde models ${response.status}: ${value.message || response.statusText}`);
        return (Array.isArray(value) ? value : []).map(model => ({
            id: String(model.name || model.id || '').trim(), name: String(model.name || model.id || '').trim(),
            context_length: Number(model.max_context_length) || 8192,
            supported_parameters: [], architecture: { output_modalities: [type] }, pricing: {}
        })).filter(model => model.id);
    }
    async function generateImage(options = {}) {
        if (!online()) throw Object.assign(new Error('AI Horde is unavailable while the browser is offline.'), { code: 'HORDE_OFFLINE' });
        const body = { prompt: String(options.prompt || ''), n: 1, width: Number(options.width) || 640, height: Number(options.height) || Number(options.width) || 640,
            steps: Number(options.steps) || 20, cfg_scale: Number(options.cfg) || 6.5, sampler_name: 'k_euler', karras: true, r2: true, trusted_workers: false };
        if (options.model && options.model !== 'any') body.models = [String(options.model)];
        const submit = await request('/generate/async', { method: 'POST', headers: auth(options.apiKey), body: JSON.stringify(body) }, { signal: options.signal, timeoutMs: 40000 });
        if (submit.status === 429) {
            if (options._retried429) throw new Error('AI Horde rate limit persisted after Retry-After backoff.');
            await sleep(Math.max(retryAfterMs(submit), 1000), options.signal);
            return generateImage({ ...options, _retried429: true });
        }
        const { value } = await readJson(submit);
        if (!submit.ok || !value.id) throw new Error(`AI Horde image submit ${submit.status}: ${value.message || value.error || 'no job id'}`);
        const result = await waitForJob(value.id, { ...options, maxWaitMs: 90000, maxEmpty: 10 }, {
            status: id => `/generate/check/${encodeURIComponent(id)}`,
            final: id => `/generate/status/${encodeURIComponent(id)}`,
            extract: data => String(data.generations?.[0]?.img || '').trim()
        });
        return { url: result.text, id: value.id, raw: result.raw };
    }
    root.HordeStudioHordeClient = Object.freeze({ generateText, generateImage, listModels, online, retryAfterMs });
})(typeof globalThis !== 'undefined' ? globalThis : window);
