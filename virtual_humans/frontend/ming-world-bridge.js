(function () {
    'use strict';
    function getProfileFor(npc) {
        const saved = npc?.tts_profiles?.ming;
        return saved && ['design','reference','builtin'].includes(saved.mode) ? saved : null;
    }
    async function synthesize(text,profile,options = {}) {
        if (window.state?.globalSettings?.ttsProvider === 'none') throw new Error('TTS is disabled.');
        const response = await fetch('/api/tts/ming/synthesize',{
            method:'POST',headers:{'Content-Type':'application/json'},signal:options.signal,
            body:JSON.stringify({text:String(text || '').slice(0,1000),profile,
                model:profile?.model || window.state?.globalSettings?.mingModel || '0.5b',
                ...(options.worldId ? {worldId:options.worldId} : {})})
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error || `Ming HTTP ${response.status}`);
        }
        return response.blob();
    }
    async function play(text,profile,options = {}) {
        const blob = await synthesize(text,profile,options);
        if (options.signal?.aborted) throw new DOMException('Playback cancelled.','AbortError');
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            URL.revokeObjectURL(url);
            options.signal?.removeEventListener('abort',onAbort);
        };
        const onAbort = () => { audio.pause(); release(); };
        options.signal?.addEventListener('abort',onAbort,{once:true});
        audio.addEventListener('ended',release,{once:true});
        audio.addEventListener('error',release,{once:true});
        audio.addEventListener('pause',release,{once:true});
        try { await audio.play(); } catch (error) { release(); throw error; }
        return audio;
    }
    window.HordeMing = {getProfileFor,synthesize,play};
})();
