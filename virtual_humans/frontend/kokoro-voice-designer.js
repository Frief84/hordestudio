/* Adapted from the corrected kokoro-voice-designer_1.js in the supplied ZIP. */
(function () {
    'use strict';
    const VOICE_CATALOG = [
        'af_alloy','af_aoede','af_bella','af_heart','af_jessica','af_kore','af_nicole','af_nova',
        'af_river','af_sarah','af_sky','am_adam','am_echo','am_eric','am_fenrir','am_liam',
        'am_michael','am_onyx','am_puck','am_santa','bf_alice','bf_emma','bf_isabella','bf_lily',
        'bm_daniel','bm_fable','bm_george','bm_lewis','ef_dora','em_alex','em_santa','ff_siwis',
        'hf_alpha','hf_beta','hm_omega','hm_psi','if_sara','im_nicola','jf_alpha',
        'jf_gongitsune','jf_nezumi','jf_tebukuro','jm_kumo','pf_dora','pm_alex','pm_santa',
        'zf_xiaobei','zf_xiaoni','zf_xiaoxiao','zf_xiaoyi','zm_yunjian','zm_yunxi',
        'zm_yunxia','zm_yunyang'
    ];
    const TAG_MAP = {
        female:VOICE_CATALOG.filter(voice=>voice[1]==='f'),
        male:VOICE_CATALOG.filter(voice=>voice[1]==='m'),
        american:VOICE_CATALOG.filter(voice=>voice[0]==='a'),
        british:VOICE_CATALOG.filter(voice=>voice[0]==='b'),
        spanish:VOICE_CATALOG.filter(voice=>voice[0]==='e'),
        french:VOICE_CATALOG.filter(voice=>voice[0]==='f'),
        hindi:VOICE_CATALOG.filter(voice=>voice[0]==='h'),
        italian:VOICE_CATALOG.filter(voice=>voice[0]==='i'),
        japanese:VOICE_CATALOG.filter(voice=>voice[0]==='j'),
        portuguese:VOICE_CATALOG.filter(voice=>voice[0]==='p'),
        chinese:VOICE_CATALOG.filter(voice=>voice[0]==='z'),
        young:['af_sky','af_nova','am_puck','bf_lily','bm_lewis'],
        adult:['af_heart','af_sarah','am_adam','am_michael','bm_george'],
        mature:['am_michael','am_onyx','bm_george','bm_daniel','bf_isabella'],
        warm:['af_heart','af_sarah','am_adam','bm_lewis','bf_emma'],
        cold:['af_nicole','af_kore','am_onyx','bf_isabella'],
        clear:['af_nicole','af_alloy','am_eric','bm_daniel'],
        raspy:['bm_george','am_michael','am_onyx','bm_fable'],
        scratchy:['bm_george','am_michael','bm_fable'],
        smoky:['bm_george','am_michael','am_onyx','bf_isabella'],
        tired:['bm_george','am_michael','bf_lily'],
        whisper:['am_onyx','bf_isabella','af_nicole'],
        gentle:['af_sarah','af_heart','am_liam','bf_isabella'],
        soft:['af_sarah','bf_isabella','am_liam','bm_lewis'],
        breathy:['bf_isabella','af_sarah','af_nova'],
        flattering:['af_heart','bf_emma','am_adam','bm_lewis'],
        powerful:['af_kore','am_fenrir','am_michael','bm_george'],
        happy:['af_sky','af_nova','am_puck','bm_lewis'],
        barkeeper:['bm_george','am_michael','bm_lewis'],
        elf:['af_kore','af_aoede','am_liam','bm_fable'],
        orc:['am_fenrir','am_onyx','bm_george','bm_daniel'],
        child:['af_sky','af_nova','am_puck','bf_lily'],
        drunk:['bm_george','am_michael','bf_emma']
    };
    const TAG_ALIASES = {
        weiblich:'female', 'männlich':'male', jung:'young', erwachsen:'adult', reif:'mature',
        kalt:'cold', klar:'clear', rau:'raspy', sanft:'gentle', weich:'soft',
        hauchig:'breathy', britisch:'british', amerikanisch:'american',
        tief:'deep', dunkel:'dark', hoch:'high', hell:'bright',
        schnell:'fast', langsam:'slow', energisch:'energetic', ruhig:'calm', 'geflüstert':'whisper',
        powerfull:'powerful', softly:'soft', masculine:'male', feminine:'female',
        old:'mature', elderly:'mature', rauchig:'smoky', rauchige:'smoky', kratzig:'scratchy',
        müde:'tired', muede:'tired', gehaucht:'whisper', ork:'orc', kind:'child',
        betrunken:'drunk', britisch:'british', amerikanisch:'american',
        barkeeperin:'barkeeper', bartender:'barkeeper', elfe:'elf'
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
        const languageTags = {spanish:'e',french:'f',hindi:'h',italian:'i',japanese:'j',portuguese:'p',chinese:'z'};
        const language = tags.find(tag => languageTags[tag]);
        const allowedVoices = VOICE_CATALOG.filter(voice =>
            (language ? voice[0] === languageTags[language] : ['a','b'].includes(voice[0]))
            && (!gender || voice[1] === (gender === 'male' ? 'm' : 'f')));
        const scores = Object.fromEntries(allowedVoices.map(voice => [voice,0]));
        tags.forEach(tag => (TAG_MAP[tag] || []).forEach(voice => {
            if (!['male','female','adult','american','british'].includes(tag)
                && allowedVoices.includes(voice)) scores[voice]++;
        }));
        if (tags.includes('british')) allowedVoices.filter(voice => voice[0] === 'b').forEach(voice => scores[voice]++);
        else if (tags.includes('american')) allowedVoices.filter(voice => voice[0] === 'a').forEach(voice => scores[voice]++);
        if (!Object.values(scores).some(Boolean) && allowedVoices.length) {
            const preferred = gender === 'male' ? (tags.includes('british') ? 'bm_george' : 'am_adam') : 'af_heart';
            scores[allowedVoices.includes(preferred) ? preferred : allowedVoices[0]] = 1;
        }
        const ranked = allowedVoices.map(voice => [voice,scores[voice],VOICE_CATALOG.indexOf(voice)])
            .sort((a,b) => b[1]-a[1] || a[2]-b[2]);
        const top = ranked.filter(item => item[1] > 0).slice(0,3).map(([voice,score]) => [voice,score]);
        if (top.length === 1) {
            const alternate = ranked.find(([voice]) => voice !== top[0][0]);
            if (alternate) top.push([alternate[0],0.5]);
        }
        let parts;
        if (['barkeeper','male','british'].every(tag => tags.includes(tag))
            && (tags.includes('smoky') || tags.includes('scratchy'))) {
            parts = [['bm_george',50],['am_michael',30],['bm_lewis',20]];
        } else {
            const total = top.reduce((sum,[,score]) => sum + score,0) || 1;
            parts = top.map(([voice,score]) => [voice,Math.round(score/total*100)]);
            if (parts.length) parts[parts.length-1][1] = 100-parts.slice(0,-1).reduce((sum,[,weight]) => sum+weight,0);
            parts = parts.filter(([,weight]) => weight > 0);
        }
        const pitch = (tags.some(tag => ['deep','dark'].includes(tag)) ? -3 : 0) + (tags.some(tag => ['high','bright'].includes(tag)) ? 3 : 0);
        const speed = tags.some(tag => ['slow','calm','whispered'].includes(tag)) ? 0.88 : tags.some(tag => ['fast','energetic'].includes(tag)) ? 1.15 : 1;
        const effects = {};
        for (const [tag,strength] of [['smoky',0.8],['tired',0.6],['whisper',0.65],['scratchy',0.55],['drunk',0.45]])
            if (tags.includes(tag)) effects[tag] = strength;
        return {formula:parts.map(([voice,weight]) => `${voice}:${weight}`).join(','),parts,tags,speed,pitch,
            prosody:{speed,pitch},effects,unmapped};
    }

    function tagsFromPersona(persona) {
        const text = String(persona || '').slice(0, 6000).toLowerCase();
        if (!text.trim()) return [];
        const male = /\b(male|man|gentleman|masculine|boy|father|son|king|prince|husband|männlich|mann|könig|vater)\b/u.test(text);
        const female = /\b(female|woman|lady|feminine|girl|mother|daughter|queen|princess|wife|weiblich|frau|königin|mutter)\b/u.test(text);
        const malePronouns = /\b(he|him|his)\b/.test(text);
        const femalePronouns = /\b(she|her|hers)\b/.test(text);
        let gender = '';
        // Exclusive self-referential pronouns are stronger evidence than an
        // incidental title such as "Holy Mother" in a male NPC's persona.
        if (malePronouns !== femalePronouns) gender = malePronouns ? 'male' : 'female';
        else if (!malePronouns && !femalePronouns && male !== female)
            gender = male ? 'male' : 'female';
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
        input.placeholder = 'Describe voice as text, e.g. a tired, smoky British barkeeper';
        input.setAttribute('aria-label','Describe voice as text');
        input.maxLength = 160;
        const inputNote = document.createElement('p');
        inputNote.className = 'form-hint';
        inputNote.textContent = 'Press Enter to apply deterministic voice rules. No AI model or voice cloning is used.';
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
        const renderToken = Symbol('kokoro-designer-render');
        container._kokoroRenderToken = renderToken;
        let previewAudio = null;
        let previewVersion = 0;
        function mergeTraits(traits) {
            for (const tag of traits) {
                if (!KNOWN_TAGS.has(tag)) continue;
                if (tag === 'male') activeTags = activeTags.filter(item => item !== 'female');
                if (tag === 'female') activeTags = activeTags.filter(item => item !== 'male');
                if (!activeTags.includes(tag)) activeTags.push(tag);
            }
            activeTags = activeTags.slice(0,20);
        }
        function stopPreview() {
            if (!previewAudio) return;
            previewAudio.pause();
            previewAudio.currentTime = 0;
            previewAudio = null;
            preview.textContent = '🔊 Preview voice';
        }
        function redraw(changed = false, revoice = true) {
            if (changed) { previewVersion++; stopPreview(); }
            if ((changed && revoice) || !profile)
                profile = {engine:'kokoro',...tags_to_formula(activeTags),descriptions:[...descriptions],
                    character_id:profile?.character_id || initialProfile?.character_id,lang:'a'};
            else if (changed) profile = {...profile,descriptions:[...descriptions]};
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
            button.onclick = () => { if (!activeTags.includes(tag)) { mergeTraits([tag]); redraw(true); } };
            suggestions.append(button);
        });
        input.onkeydown = async event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (container._kokoroRenderToken !== renderToken
                || (typeof container.isConnected === 'boolean' && !container.isConnected)) return;
            const description = input.value.trim();
            if (!description) return;
            const entered = [...new Set(splitTags([description]))];
            const known = [...new Set([...entered,...tagsFromPersona(description)])]
                .filter(tag => KNOWN_TAGS.has(tag));
            const needsInterpretation = entered.some(tag => !KNOWN_TAGS.has(tag));
            const oldTags = activeTags.join('\0');
            mergeTraits(known);
            if (needsInterpretation && !descriptions.includes(description))
                descriptions = [...descriptions,description].slice(-5);
            redraw(true,oldTags !== activeTags.join('\0'));
            const requestVersion = previewVersion;
            input.value = '';
            if (!needsInterpretation) {
                status.textContent = 'Voice traits added.';
                return;
            }
            status.textContent = 'Applying voice-description rules…';
            try {
                const response = await fetch('/api/tts/kokoro/text_to_profile',{
                    method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({text:description})
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
                const interpreted = Array.isArray(result.tags) ? result.tags : [];
                if (container._kokoroRenderToken !== renderToken || previewVersion !== requestVersion
                    || !descriptions.includes(description)
                    || (typeof container.isConnected === 'boolean' && !container.isConnected)) return;
                const gender = activeTags.find(tag => tag === 'male' || tag === 'female');
                const safe = interpreted.filter(tag => KNOWN_TAGS.has(tag)
                    && (!gender || (tag !== 'male' && tag !== 'female') || tag === gender));
                if (safe.length) { mergeTraits(safe); redraw(true); }
                status.textContent = safe.length
                    ? `Description interpreted as: ${safe.join(', ')}.`
                    : 'Description saved, but no audible trait matched the rules. Try tone, age, accent or gender.';
            } catch (error) {
                status.textContent = `Description saved, but rule lookup failed: ${error.message}`;
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

    window.KokoroTagDesigner = {tags_to_formula,render,TAG_MAP,VOICE_CATALOG,PREVIEW_TEXT,normalizeTag,
        profileGenderMismatch,tagsFromPersona,profileFromPersona};
})();
