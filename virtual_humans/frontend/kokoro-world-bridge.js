/* Adapted from the supplied kokoro-world-bridge.js for Horde Studio's renderers. */
(function () {
    'use strict';
    const valid = profile => profile?.engine === 'kokoro' && typeof profile.formula === 'string' && !!profile.formula.trim();
    const identified = (profile,id,force = false) => profile ? {...profile,
        character_id:force ? String(id || 'kokoro-preview')
            : profile.character_id || String(id || 'kokoro-preview')} : null;
    const DEFAULT_NARRATOR = Object.freeze({engine:'kokoro',formula:'af_nicole:100',
        parts:[['af_nicole',100]],tags:['female','clear'],speed:1,pitch:0,lang:'a'});
    const FALLBACK_VOICES = {
        male:['am_adam','bm_george','am_michael','bm_lewis'],
        female:['af_heart','bf_emma','af_sarah','bf_isabella'],
        unknown:['am_adam','af_heart','bm_george','bf_emma','am_michael','af_sarah']
    };
    function genderSafeProfile(profile) {
        if (!valid(profile) || !Array.isArray(profile.tags)) return profile;
        const designer = window.KokoroTagDesigner;
        const tags = profile.tags.map(tag => designer?.normalizeTag?.(tag) || tag);
        if (!designer?.profileGenderMismatch?.(profile,tags)) return profile;
        const corrected = designer.tags_to_formula(tags);
        return {...profile,formula:corrected.formula,parts:corrected.parts};
    }
    function getProfileFor(npc,world,companion) {
        if (valid(npc?.voice_profile)) return identified(genderSafeProfile(npc.voice_profile),npc.id);
        if (npc?.voice_source === 'custom') return null;
        if (npc && npc.voice_source !== 'world') {
            const inferred = window.KokoroTagDesigner?.profileFromPersona?.(npc.persona);
            if (valid(inferred)) return identified(inferred,npc.id);
        }
        if (valid(world?.voice_settings?.default_profile))
            return identified(genderSafeProfile(world.voice_settings.default_profile),npc?.id || world.id,true);
        if (valid(companion?.voice_profile)) return identified(genderSafeProfile(companion.voice_profile),companion.id);
        return null;
    }
    function getNarratorProfile(world) {
        const settings = world?.voice_settings;
        if (settings && Object.prototype.hasOwnProperty.call(settings,'narrator_profile'))
            return valid(settings.narrator_profile)
                ? identified(genderSafeProfile(settings.narrator_profile),`world:${world?.id || 'default'}:narrator`,true) : null;
        return identified(valid(settings?.default_profile) ? genderSafeProfile(settings.default_profile)
            : DEFAULT_NARRATOR,`world:${world?.id || 'default'}:narrator`,true);
    }
    function getWorldTurnProfileFor(npc,world) {
        const selected = getProfileFor(npc,world);
        if (valid(selected) && !(selected.source === 'persona' && selected.tags?.length <= 1))
            return selected;
        if (!npc) return null;
        const tags = window.KokoroTagDesigner?.tagsFromPersona?.(npc.persona) || [];
        const gender = tags.includes('male') ? 'male' : tags.includes('female') ? 'female' : 'unknown';
        const voices = FALLBACK_VOICES[gender];
        const identity = String(npc.id || npc.name || '');
        let hash = 0;
        for (const char of identity) hash = (Math.imul(hash,31) + char.codePointAt(0)) | 0;
        const voice = voices[(hash >>> 0) % voices.length];
        return {engine:'kokoro',formula:`${voice}:100`,parts:[[voice,100]],tags:gender === 'unknown' ? [] : [gender],
            speed:selected?.speed ?? 1,pitch:selected?.pitch ?? 0,lang:'a',character_id:String(npc.id || npc.name)};
    }
    function gpuSelected() {
        try { return localStorage.getItem('horde_kokoro_device') === 'gpu'; }
        catch { return false; }
    }
    async function synthesize(text,profile,options = {}) {
        if (!valid(profile)) throw new Error('No Kokoro voice selected.');
        profile = genderSafeProfile(profile);
        const response = await fetch('/api/tts/kokoro/synthesize',{
            method:'POST',headers:{'Content-Type':'application/json'},
            signal:options.signal,
            body:JSON.stringify({text:String(text || '').slice(0,1000),formula:profile.formula,
                speed:profile.speed ?? 1,pitch:profile.pitch ?? 0,effects:profile.effects || {},
                character_id:String(options.characterId || profile.character_id || `preview:${profile.formula}`),
                lang:profile.lang || 'a',gpu:gpuSelected()})
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error || `Kokoro HTTP ${response.status}`);
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
    function attachButton(element,message,npc,world,companion) {
        if (!element) return;
        const profile = getProfileFor(npc,world,companion);
        const existing = element.querySelector(':scope > .kokoro-tts-btn');
        if (!profile) { existing?.remove(); return; }
        const text = String(message?.text || message?.content || '').trim();
        if (!text) return;
        const button = existing || document.createElement('button');
        button.type = 'button'; button.className = 'kokoro-tts-btn btn btn-ghost';
        const displayTags = (profile.tags || []).map(tag => window.KokoroTagDesigner?.normalizeTag?.(tag) || tag);
        button.textContent = '🔊'; button.title = `Speak with Kokoro: ${displayTags.join(', ') || profile.formula}`;
        button.setAttribute('aria-label','Read message aloud with Kokoro');
        button.onclick = async event => {
            event.stopPropagation(); button.disabled = true; button.textContent = '⏳';
            try { await play(text,profile); button.textContent = '🔊'; }
            catch (error) { button.textContent = '⚠️'; button.title = error.message; if (typeof showToast === 'function') showToast(`Kokoro: ${error.message}`,'error'); }
            finally { button.disabled = false; }
        };
        if (!existing) element.append(button);
    }
    window.HordeKokoro = {getProfileFor,getWorldTurnProfileFor,getNarratorProfile,
        synthesize,play,attachButton,gpuSelected};
})();
