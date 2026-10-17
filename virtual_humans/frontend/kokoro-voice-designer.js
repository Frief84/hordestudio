/* Adapted from the corrected kokoro-voice-designer_1.js in the supplied ZIP. */
(function () {
    'use strict';
    const CATALOG = ['af_heart','af_sarah','af_nicole','af_sky','bf_emma','bf_isabella','am_adam','am_michael','bm_george','bm_lewis'];
    const TAG_MAP = {
        weiblich:['af_heart','af_sarah','af_sky','bf_emma'],
        'männlich':['am_adam','am_michael','bm_george','bm_lewis'],
        jung:['af_sky','bf_emma','bm_lewis'],
        erwachsen:['af_sarah','am_adam','af_heart'],
        reif:['bm_george','am_michael','af_heart'],
        warm:['af_heart','af_sarah','bf_emma'],
        kalt:['af_nicole','bf_isabella'],
        klar:['af_nicole','bf_isabella'],
        rau:['bm_george','am_michael'],
        sanft:['af_sarah','bf_isabella','af_heart'],
        weich:['af_sarah','bf_isabella'],
        hauchig:['bf_isabella','af_sarah'],
        britisch:['bf_emma','bf_isabella','bm_george','bm_lewis'],
        amerikanisch:['af_heart','af_sarah','am_adam']
    };
    const SUGGEST = [...Object.keys(TAG_MAP),'tief','hoch','schnell','langsam','energisch','ruhig','geflüstert'];

    function tags_to_formula(input) {
        const tags = [...new Set((Array.isArray(input) ? input : []).map(tag => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0,20);
        const scores = Object.fromEntries(CATALOG.map(voice => [voice,0]));
        tags.forEach(tag => (TAG_MAP[tag] || []).forEach(voice => { scores[voice]++; }));
        if (!Object.values(scores).some(Boolean)) { scores.af_heart = 2; scores.bf_emma = 1; }
        const ranked = CATALOG.map((voice,index) => [voice,scores[voice],index]).sort((a,b) => b[1]-a[1] || a[2]-b[2]);
        const top = ranked.filter(item => item[1] > 0).slice(0,3).map(([voice,score]) => [voice,score]);
        if (top.length === 1) top.push([top[0][0] === 'bf_emma' ? 'af_heart' : 'bf_emma',0.5]);
        const total = top.reduce((sum,[,score]) => sum + score,0);
        const reserve = 10*top.length;
        const parts = top.map(([voice,score]) => [voice,10+Math.floor(score/total*(100-reserve)+0.5)]);
        parts[parts.length-1][1] = 100-parts.slice(0,-1).reduce((sum,[,weight]) => sum+weight,0);
        const pitch = (tags.some(tag => ['tief','dunkel'].includes(tag)) ? -3 : 0) + (tags.some(tag => ['hoch','hell'].includes(tag)) ? 3 : 0);
        const speed = tags.some(tag => ['langsam','ruhig','geflüstert'].includes(tag)) ? 0.88 : tags.some(tag => ['schnell','energisch'].includes(tag)) ? 1.15 : 1;
        return {formula:parts.map(([voice,weight]) => `${voice}:${weight}`).join(','),parts,tags,speed,pitch};
    }

    function render(container,onChange,initialProfile = null) {
        if (!container) return null;
        container.replaceChildren();
        const wrapper = document.createElement('div');
        wrapper.className = 'kokoro-designer';
        const input = document.createElement('input');
        input.className = 'form-input';
        input.placeholder = 'Tag eingeben + Enter, z. B. weiblich, warm';
        input.maxLength = 40;
        const chips = document.createElement('div');
        chips.className = 'chip-row';
        const suggestions = document.createElement('div');
        suggestions.className = 'chip-row suggestions';
        const output = document.createElement('pre');
        output.className = 'formula-box';
        const controls = document.createElement('div');
        const copy = document.createElement('button');
        copy.type = 'button'; copy.className = 'btn btn-ghost'; copy.textContent = 'Formel kopieren';
        const preview = document.createElement('button');
        preview.type = 'button'; preview.className = 'btn btn-ghost'; preview.textContent = 'Vorschau sprechen';
        const status = document.createElement('span');
        status.setAttribute('role','status'); status.style.marginLeft = '8px';
        controls.append(copy,preview,status);
        wrapper.append(input,chips,suggestions,output,controls);
        container.append(wrapper);
        let activeTags = Array.isArray(initialProfile?.tags) ? [...initialProfile.tags] : [];
        let profile = initialProfile?.engine === 'kokoro' ? {...initialProfile} : null;
        function redraw(changed = false) {
            if (changed || !profile) profile = {engine:'kokoro',...tags_to_formula(activeTags),lang:'a'};
            chips.replaceChildren();
            activeTags.forEach(tag => {
                const chip = document.createElement('button');
                chip.type = 'button'; chip.className = 'chip active'; chip.textContent = `${tag} ×`;
                chip.onclick = () => { activeTags = activeTags.filter(item => item !== tag); redraw(true); };
                chips.append(chip);
            });
            output.textContent = `${profile.formula} · Pitch ${profile.pitch || 0} · Speed ${profile.speed || 1}`;
            if (changed && typeof onChange === 'function') onChange({...profile});
        }
        SUGGEST.forEach(tag => {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'chip'; button.textContent = tag;
            button.onclick = () => { if (!activeTags.includes(tag)) { activeTags.push(tag); redraw(true); } };
            suggestions.append(button);
        });
        input.onkeydown = event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const tag = input.value.trim().toLowerCase();
            if (tag && !activeTags.includes(tag)) { activeTags.push(tag); redraw(true); }
            input.value = '';
        };
        copy.onclick = () => navigator.clipboard.writeText(profile.formula).then(() => { status.textContent = 'Kopiert'; }).catch(error => { status.textContent = error.message; });
        preview.onclick = async () => {
            preview.disabled = true; status.textContent = 'Erzeuge Vorschau…';
            try {
                await window.HordeKokoro.play('Hello, this is my voice.',profile);
                status.textContent = 'Vorschau läuft';
            } catch (error) { status.textContent = error.message; }
            finally { preview.disabled = false; }
        };
        redraw(false);
        return {getProfile:() => ({...profile})};
    }

    window.KokoroTagDesigner = {tags_to_formula,render,TAG_MAP};
})();
