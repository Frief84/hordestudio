/* Adapted from the corrected kokoro-voice-designer_1.js in the supplied ZIP. */
(function () {
    'use strict';
    const CATALOG = ['af_heart','af_sarah','af_nicole','af_sky','bf_emma','bf_isabella','am_adam','am_michael','bm_george','bm_lewis'];
    const TAG_MAP = {
        female:['af_heart','af_sarah','af_sky','bf_emma'],
        male:['am_adam','am_michael','bm_george','bm_lewis'],
        young:['af_sky','bf_emma','bm_lewis'],
        adult:['af_sarah','am_adam','af_heart'],
        mature:['bm_george','am_michael','af_heart'],
        warm:['af_heart','af_sarah','bf_emma','am_adam','bm_lewis'],
        cold:['af_nicole','bf_isabella'],
        clear:['af_nicole','bf_isabella'],
        raspy:['bm_george','am_michael'],
        gentle:['af_sarah','bf_isabella','af_heart'],
        soft:['af_sarah','bf_isabella','am_adam','bm_lewis'],
        breathy:['bf_isabella','af_sarah'],
        flattering:['af_heart','bf_emma','am_adam','bm_lewis'],
        powerful:['af_nicole','am_michael','bm_george'],
        happy:['af_sky','bf_emma','am_adam','bm_lewis'],
        british:['bf_emma','bf_isabella','bm_george','bm_lewis'],
        american:['af_heart','af_sarah','am_adam']
    };
    const TAG_ALIASES = {
        weiblich:'female', 'männlich':'male', jung:'young', erwachsen:'adult', reif:'mature',
        kalt:'cold', klar:'clear', rau:'raspy', sanft:'gentle', weich:'soft',
        hauchig:'breathy', britisch:'british', amerikanisch:'american',
        tief:'deep', dunkel:'dark', hoch:'high', hell:'bright',
        schnell:'fast', langsam:'slow', energisch:'energetic', ruhig:'calm', 'geflüstert':'whispered',
        powerfull:'powerful', softly:'soft', masculine:'male', feminine:'female',
        old:'mature', elderly:'mature'
    };
    const SUGGEST = [...Object.keys(TAG_MAP),'deep','high','fast','slow','energetic','calm','whispered'];
    const PREVIEW_TEXT = 'Welcome to Horde Studio, where imagination comes alive. Every character has a story worth hearing.';
    const normalizeTag = tag => TAG_ALIASES[String(tag).trim().toLowerCase()] || String(tag).trim().toLowerCase();
    const splitTags = input => (Array.isArray(input) ? input : []).flatMap(value =>
        (String(value).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || []).map(normalizeTag));
    const KNOWN_TAGS = new Set(SUGGEST.concat('dark','bright'));
    function profileGenderMismatch(profile, tags) {
        const gender = tags.filter(tag => tag === 'male' || tag === 'female').at(-1);
        if (!gender || !profile?.formula) return false;
        const expected = gender === 'male' ? 'm' : 'f';
        return profile.formula.split(',').some(part => part.trim().split(':')[0][1] !== expected);
    }

    function tags_to_formula(input) {
        const tags = [...new Set(splitTags(input))].slice(0,20);
        const unmapped = tags.filter(tag => !KNOWN_TAGS.has(tag));
        const gender = tags.filter(tag => tag === 'male' || tag === 'female').at(-1);
        const allowedVoices = CATALOG.filter(voice => !gender || voice[1] === (gender === 'male' ? 'm' : 'f'));
        const scores = Object.fromEntries(CATALOG.map(voice => [voice,0]));
        tags.forEach(tag => (TAG_MAP[tag] || []).forEach(voice => {
            if (allowedVoices.includes(voice)) scores[voice]++;
        }));
        if (!Object.values(scores).some(Boolean)) { scores.af_heart = 2; scores.bf_emma = 1; }
        const ranked = allowedVoices.map(voice => [voice,scores[voice],CATALOG.indexOf(voice)])
            .sort((a,b) => b[1]-a[1] || a[2]-b[2]);
        const top = ranked.filter(item => item[1] > 0).slice(0,3).map(([voice,score]) => [voice,score]);
        if (top.length === 1) {
            const fallbacks = gender === 'male' ? ['am_adam','bm_george']
                : gender === 'female' ? ['af_heart','bf_emma'] : ['bf_emma','af_heart'];
            top.push([fallbacks.find(voice => voice !== top[0][0]),0.5]);
        }
        const total = top.reduce((sum,[,score]) => sum + score,0);
        const reserve = 10*top.length;
        const parts = top.map(([voice,score]) => [voice,10+Math.floor(score/total*(100-reserve)+0.5)]);
        parts[parts.length-1][1] = 100-parts.slice(0,-1).reduce((sum,[,weight]) => sum+weight,0);
        const pitch = (tags.some(tag => ['deep','dark'].includes(tag)) ? -3 : 0) + (tags.some(tag => ['high','bright'].includes(tag)) ? 3 : 0);
        const speed = tags.some(tag => ['slow','calm','whispered'].includes(tag)) ? 0.88 : tags.some(tag => ['fast','energetic'].includes(tag)) ? 1.15 : 1;
        return {formula:parts.map(([voice,weight]) => `${voice}:${weight}`).join(','),parts,tags,speed,pitch,unmapped};
    }

    function tagsFromPersona(persona) {
        const text = String(persona || '').slice(0, 6000).toLowerCase();
        if (!text.trim()) return [];
        const male = /\b(male|man|gentleman|masculine|boy|father|son|king|prince|husband|männlich|mann|könig|vater)\b/u.test(text);
        const female = /\b(female|woman|lady|feminine|girl|mother|daughter|queen|princess|wife|weiblich|frau|königin|mutter)\b/u.test(text);
        const malePronouns = /\b(he|him|his)\b/.test(text);
        const femalePronouns = /\b(she|her|hers)\b/.test(text);
        let gender = '';
        if (male !== female && !(male && femalePronouns && !malePronouns)
            && !(female && malePronouns && !femalePronouns)) gender = male ? 'male' : 'female';
        else if (!male && !female && malePronouns !== femalePronouns)
            gender = malePronouns ? 'male' : 'female';
        const tags = gender ? [gender] : [];
        if (/\b(old|older|elderly|aged|alt|älter|reif)(?:\s+[\p{L}-]+){0,2}\s+(man|woman|male|female|gentleman|lady|person|mann|frau)\b/u.test(text)
            || /\b(he|she)\s+is\s+(?:an?\s+)?(old|older|elderly|aged)\b/u.test(text))
            tags.push('mature');
        const vocalText = text.split(/[.!?;\n]+/)
            .filter(clause => /\b(voice|speaks?|speaking|spoken|speech|accent|tone|sounds?|whispers?|talks?|baritone|stimme|spricht|sprechen|akzent|redet)\b/u.test(clause))
            .join(' ');
        if (!vocalText) return tags;
        const cues = [
            ['deep', /\b(deep|low[- ]pitched|baritone|bass|tief|dunkel)\b/u],
            ['high', /\b(high[- ]pitched|soprano|hoch|hell)\b/u],
            ['warm', /\b(warm|warmth|warmly)\b/u],
            ['cold', /\b(cold|cool|kalt)\b/u],
            ['clear', /\b(clear|crisp|klar)\b/u],
            ['raspy', /\b(raspy|rough|hoarse|rau|heiser)\b/u],
            ['gentle', /\b(gentle|gently|sanft)\b/u],
            ['soft', /\b(soft|softly|soft-spoken|leise|weich)\b/u],
            ['breathy', /\b(breathy|airy|hauchig)\b/u],
            ['powerful', /\b(powerful|powerfull|commanding|booming|kräftig)\b/u],
            ['flattering', /\b(flattering|smooth|schmeichelnd)\b/u],
            ['happy', /\b(happy|cheerful|cheerfully|fröhlich)\b/u],
            ['british', /\b(british|britisch)\b/u],
            ['american', /\b(american|amerikanisch)\b/u],
            ['slow', /\b(slow|slowly|measured|deliberate|langsam)\b/u],
            ['fast', /\b(fast|rapid|quick|quickly|schnell)\b/u],
            ['calm', /\b(calm|calmly|ruhig)\b/u],
            ['whispered', /\b(whisper|whispers|whispered|whispering|geflüstert)\b/u]
        ];
        for (const [tag, pattern] of cues) if (pattern.test(vocalText)) tags.push(tag);
        return tags.slice(0, 20);
    }

    function profileFromPersona(persona) {
        const tags = tagsFromPersona(persona);
        if (!tags.includes('male') && !tags.includes('female')) return null;
        return {engine:'kokoro',...tags_to_formula(tags),lang:'a',source:'persona'};
    }

    function render(container,onChange,initialProfile = null) {
        if (!container) return null;
        container.replaceChildren();
        const wrapper = document.createElement('div');
        wrapper.className = 'kokoro-designer';
        const input = document.createElement('input');
        input.className = 'form-input';
        input.placeholder = 'Describe a voice in your own words, e.g. an old, cheerful man with a soft voice';
        input.maxLength = 160;
        const inputNote = document.createElement('p');
        inputNote.className = 'form-hint';
        inputNote.textContent = 'Press Enter to add a description. New words are interpreted with your default AI model (which may incur charges).';
        const selectedLabel = document.createElement('p');
        selectedLabel.className = 'form-hint'; selectedLabel.textContent = 'Selected voice traits';
        const chips = document.createElement('div');
        chips.className = 'chip-row selected'; chips.setAttribute('aria-label','Selected voice traits');
        const descriptionLabel = document.createElement('p');
        descriptionLabel.className = 'form-hint'; descriptionLabel.textContent = 'Your descriptions';
        const descriptionChips = document.createElement('div');
        descriptionChips.className = 'chip-row selected'; descriptionChips.setAttribute('aria-label','Your voice descriptions');
        const suggestionLabel = document.createElement('p');
        suggestionLabel.className = 'form-hint'; suggestionLabel.textContent = 'Suggestions — click to add';
        const suggestions = document.createElement('div');
        suggestions.className = 'chip-row suggestions'; suggestions.setAttribute('aria-label','Suggested voice traits');
        const output = document.createElement('pre');
        output.className = 'formula-box';
        const previewText = document.createElement('p');
        previewText.className = 'form-hint';
        previewText.textContent = `Preview text: “${PREVIEW_TEXT}”`;
        const controls = document.createElement('div');
        const copy = document.createElement('button');
        copy.type = 'button'; copy.className = 'btn btn-ghost'; copy.textContent = 'Copy formula';
        const preview = document.createElement('button');
        preview.type = 'button'; preview.className = 'btn btn-ghost'; preview.textContent = '🔊 Preview voice';
        const repair = document.createElement('button');
        repair.type = 'button'; repair.className = 'btn btn-ghost';
        repair.textContent = 'Apply gender-correct voice'; repair.hidden = true;
        const status = document.createElement('span');
        status.setAttribute('role','status'); status.style.marginLeft = '8px';
        controls.append(copy,preview,repair,status);
        wrapper.append(input,inputNote,selectedLabel,chips,descriptionLabel,descriptionChips,
            suggestionLabel,suggestions,output,previewText,controls);
        container.append(wrapper);
        let activeTags = Array.isArray(initialProfile?.tags)
            ? [...new Set(splitTags(initialProfile.tags).filter(tag => KNOWN_TAGS.has(tag)))] : [];
        let descriptions = Array.isArray(initialProfile?.descriptions)
            ? initialProfile.descriptions.filter(value => typeof value === 'string').slice(0,5) : [];
        let profile = initialProfile?.engine === 'kokoro' ? {...initialProfile} : null;
        let previewAudio = null;
        let previewVersion = 0;
        function stopPreview() {
            if (!previewAudio) return;
            previewAudio.pause();
            previewAudio.currentTime = 0;
            previewAudio = null;
            preview.textContent = '🔊 Preview voice';
        }
        function redraw(changed = false) {
            if (changed) { previewVersion++; stopPreview(); }
            if (changed || !profile) profile = {engine:'kokoro',...tags_to_formula(activeTags),descriptions:[...descriptions],lang:'a'};
            chips.replaceChildren();
            activeTags.forEach(tag => {
                const chip = document.createElement('button');
                chip.type = 'button'; chip.className = 'chip active'; chip.textContent = `${tag} ×`;
                chip.onclick = () => { activeTags = activeTags.filter(item => item !== tag); redraw(true); };
                chips.append(chip);
            });
            if (!activeTags.length) chips.textContent = 'None selected yet';
            descriptionLabel.hidden = descriptionChips.hidden = !descriptions.length;
            descriptionChips.replaceChildren();
            descriptions.forEach(description => {
                const chip = document.createElement('button');
                chip.type = 'button'; chip.className = 'chip active'; chip.textContent = `${description} ×`;
                chip.title = 'Remove description';
                chip.onclick = () => { descriptions = descriptions.filter(item => item !== description); redraw(true); };
                descriptionChips.append(chip);
            });
            output.textContent = `${profile.formula} · Pitch ${profile.pitch || 0} · Speed ${profile.speed || 1}`;
            repair.hidden = !profileGenderMismatch(profile,activeTags);
            if (!repair.hidden) status.textContent = 'This saved voice conflicts with its gender tag. Apply the correction to save it.';
            if (changed && typeof onChange === 'function') onChange({...profile});
        }
        SUGGEST.forEach(tag => {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'chip'; button.textContent = tag;
            button.onclick = () => { if (!activeTags.includes(tag)) { activeTags.push(tag); redraw(true); } };
            suggestions.append(button);
        });
        input.onkeydown = async event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const description = input.value.trim();
            if (!description) return;
            const entered = [...new Set(splitTags([description]))];
            const known = entered.filter(tag => KNOWN_TAGS.has(tag));
            const needsInterpretation = entered.some(tag => !KNOWN_TAGS.has(tag));
            activeTags = [...new Set([...activeTags,...known])].slice(0,20);
            if (needsInterpretation && !descriptions.includes(description))
                descriptions = [...descriptions,description].slice(-5);
            redraw(true);
            input.value = '';
            if (!needsInterpretation) {
                status.textContent = 'Voice traits added.';
                return;
            }
            if (typeof window.HordeKokoroInterpretVoiceText !== 'function') {
                status.textContent = 'Description saved, but AI interpretation is unavailable. The selected traits still control the sound.';
                return;
            }
            status.textContent = 'Interpreting description with the default AI model…';
            try {
                const interpreted = await window.HordeKokoroInterpretVoiceText(description,[...activeTags]);
                if (!descriptions.includes(description)) return;
                const gender = activeTags.find(tag => tag === 'male' || tag === 'female');
                const safe = interpreted.filter(tag => KNOWN_TAGS.has(tag)
                    && (!gender || (tag !== 'male' && tag !== 'female') || tag === gender));
                activeTags = [...new Set([...activeTags,...safe])].slice(0,20);
                redraw(true);
                status.textContent = safe.length
                    ? `Description interpreted as: ${safe.join(', ')}.`
                    : 'Description saved, but no supported voice trait could be derived. Try describing tone, age, accent or gender.';
            } catch (error) {
                status.textContent = `Description saved, but AI interpretation failed: ${error.message}`;
            }
        };
        copy.onclick = () => navigator.clipboard.writeText(profile.formula).then(() => { status.textContent = 'Copied'; }).catch(error => { status.textContent = error.message; });
        repair.onclick = () => { redraw(true); status.textContent = 'Gender-correct voice applied.'; };
        preview.onclick = async () => {
            if (previewAudio) { stopPreview(); status.textContent = 'Preview stopped'; return; }
            preview.disabled = true; status.textContent = 'Generating preview…';
            const version = previewVersion;
            try {
                if (!window.HordeKokoro?.play) throw new Error('Kokoro playback is unavailable.');
                const audio = await window.HordeKokoro.play(PREVIEW_TEXT,{...profile});
                if (version !== previewVersion) {
                    audio.pause();
                    status.textContent = 'Voice changed — play the preview again.';
                    return;
                }
                previewAudio = audio;
                preview.textContent = '■ Stop preview';
                status.textContent = 'Preview playing';
                audio.addEventListener('ended', () => {
                    if (previewAudio !== audio) return;
                    previewAudio = null;
                    preview.textContent = '🔊 Preview voice';
                    status.textContent = 'Preview finished';
                }, {once:true});
            } catch (error) { status.textContent = error.message; }
            finally { preview.disabled = false; }
        };
        redraw(false);
        return {getProfile:() => ({...profile})};
    }

    window.KokoroTagDesigner = {tags_to_formula,render,TAG_MAP,PREVIEW_TEXT,normalizeTag,
        profileGenderMismatch,tagsFromPersona,profileFromPersona};
})();
