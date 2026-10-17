/* Adapted from the supplied kokoro-world-bridge.js for Horde Studio's renderers. */
(function () {
    'use strict';
    const valid = profile => profile?.engine === 'kokoro' && typeof profile.formula === 'string';
    function getProfileFor(npc,world,companion) {
        if (valid(npc?.voice_profile)) return npc.voice_profile;
        if (valid(world?.voice_settings?.default_profile)) return world.voice_settings.default_profile;
        if (valid(companion?.voice_profile)) return companion.voice_profile;
        return null;
    }
    function gpuSelected() {
        try { return localStorage.getItem('horde_kokoro_device') === 'gpu'; }
        catch { return false; }
    }
    async function synthesize(text,profile) {
        if (!valid(profile)) throw new Error('Keine Kokoro-Stimme gewählt.');
        const response = await fetch('/api/tts/kokoro/synthesize',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({text:String(text || '').slice(0,1000),formula:profile.formula,
                speed:profile.speed ?? 1,pitch:profile.pitch ?? 0,lang:profile.lang || 'a',gpu:gpuSelected()})
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error || `Kokoro HTTP ${response.status}`);
        }
        return response.blob();
    }
    async function play(text,profile) {
        const blob = await synthesize(text,profile);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const release = () => URL.revokeObjectURL(url);
        audio.addEventListener('ended',release,{once:true});
        audio.addEventListener('error',release,{once:true});
        try { await audio.play(); } catch (error) { release(); throw error; }
        return audio;
    }
    function attachButton(element,message,npc,world,companion) {
        if (!element) return;
        const profile = getProfileFor(npc,world,companion);
        const existing = element.querySelector(':scope > .kokoro-tts-btn');
        if (!profile) { existing?.remove(); return; }
        const text = String(message?.text || message?.content || '').trim();
        if (!text) return;
        const button = existing || document.createElement('button');
        button.type = 'button'; button.className = 'kokoro-tts-btn btn btn-ghost';
        button.textContent = '🔊'; button.title = `Mit Kokoro sprechen: ${(profile.tags || []).join(', ') || profile.formula}`;
        button.setAttribute('aria-label','Nachricht mit Kokoro vorlesen');
        button.onclick = async event => {
            event.stopPropagation(); button.disabled = true; button.textContent = '⏳';
            try { await play(text,profile); button.textContent = '🔊'; }
            catch (error) { button.textContent = '⚠️'; button.title = error.message; if (typeof showToast === 'function') showToast(`Kokoro: ${error.message}`,'error'); }
            finally { button.disabled = false; }
        };
        if (!existing) element.append(button);
    }
    window.HordeKokoro = {getProfileFor,synthesize,play,attachButton,gpuSelected};
})();
