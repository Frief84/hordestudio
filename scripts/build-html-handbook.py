#!/usr/bin/env python3
"""Compile the reviewed manuscript and real screenshots into offline runtime assets."""
import importlib.util, json, re
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parent.parent
source=root/'docs/user-manual/v18.3.5'
spec=importlib.util.spec_from_file_location('manuscript',source/'content.py')
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
asset=root/'assets/manual'; asset.mkdir(parents=True,exist_ok=True)
pages=[]
for item in module.PAGES:
    page=dict(item); page['id']=re.sub(r'[^a-z0-9]+','-',page['title'].lower()).strip('-')
    if page['shot']:
        name=page['shot']; target=asset/(name+'.webp')
        with Image.open(source/'screens'/(name+'.png')) as im:
            im.thumbnail((1600,1200)); im.convert('RGB').save(target,'WEBP',quality=86)
        page['image']='assets/manual/'+target.name
    pages.append(page)
pages[0]['body']='Use the chapter list, full-text search and alphabetical index to find any topic. Each topic has a permanent link. Click screenshots to enlarge them. Print opens a complete, readable manual. The real application screenshots use an isolated demonstration library; Maya Chen and Harbour Museum Mystery are authored teaching examples.\n'+pages[0]['body'].split('\n',1)[1]
pip=next(p for p in pages if 'pip' in p['title'].lower())
pip['body']='''Open Pip in the sidebar for help with Horde Studio. Pip searches the complete illustrated manual and supplementary product notes locally. Start with a concrete question, such as “How do I start Maya’s life?” or paste the relevant error. Follow-up questions use your recent conversation to find related topics. Source links open the matching manual chapters.
Open Assistant settings to choose Built-in handbook for offline help, or select Pip’s own provider and exact model ID. This choice is independent of your character, World and global model. Configure that provider’s credentials in Settings > Connections first. Refresh models to browse the catalog, or type an exact model ID; catalog membership is not required.
Example: configure your OpenRouter key in Connections, choose OpenRouter in Pip, enter the exact DeepSeek ID listed by OpenRouter, and press Save assistant settings. Pip will send your question, recent Pip conversation and relevant manual excerpts to that service. Cloud answers consume provider credits. No library, timeline, saved conversations or provider secrets are included in Pip’s knowledge prompt.
Pip is a support assistant, not an editor of your saves. It can explain a setup and point to the guide, but it cannot see your screen or verify your connection without information you provide. Clear removes the current conversation and cancels a pending answer. If the provider fails, Pip shows the error and falls back to the local handbook. Model answers can be imperfect; use the linked source when checking a specific control.'''
pip['body'] += '\nThe selected LLM generates every conversational answer. The knowledge base contains the complete manual and authored control explanations, split into retrievable passages. Full-text retrieval works immediately. Pip’s active provider/model context is authoritative: the assistant is not TinyBrain. Test assistant sends a real question to your saved model and displays its response.\nFor semantic retrieval, open Embedding settings and configure an embedding model in Settings > Memory. Return to Pip and press Build semantic index. This sends product documentation only to that embedding service and stores the resulting vectors in this browser. Select Semantic + full-text retrieval and save. Each semantic question embeds your query, combines vector similarity with full-text relevance, and gives matching passages to the chat LLM. Index construction and query embeddings can incur provider charges. Rebuild after changing the embedding model or when the app indicates that documentation changed.\nThe index is separate from character and World memories. Pip never indexes your library, personas, timelines or saved conversations. A model failure is explicitly labelled; offline references are not represented as a successful LLM answer. If semantic retrieval is unavailable, the selected chat LLM still receives full-text knowledge with a visible notice.'
# Keep the original topic's appearance and accessibility guidance.
pip['body'] += '\n' + '\n'.join(module.PAGES[next(i for i,p in enumerate(module.PAGES) if p['title']==pip['title'])]['body'].split('\n')[2:]).replace('zoom your PDF reader', 'enlarge the screenshot')
pip['shot']='pip-assistant-settings'
pip['image']='assets/manual/pip-assistant-settings.webp'
with Image.open(source/'screens/pip-assistant-settings.png') as im:
    im.thumbnail((1600,1200)); im.convert('RGB').save(asset/'pip-assistant-settings.webp','WEBP',quality=86)
pip['terms']+=['Pip provider','Pip model','DeepSeek','Assistant settings']
pages.append(dict(id='nanogpt-model-troubleshooting',ch='Maintenance and troubleshooting',title='NanoGPT model discovery and exact IDs',body='''NanoGPT’s authenticated catalog follows the account’s model visibility and subscription settings. If you only see one family, inspect NanoGPT Settings > Models and the “Also show paid models” preference, then refresh Horde’s catalog. Showing paid models can make additional models available for selection and does not make their use free.
Horde requests the detailed text catalog so capabilities and pricing are available. Search by family, provider or exact ID. A model missing from the catalog is not automatically invalid: type its exact ID, save, and test one small request. Use the NanoGPT model ID, which may differ from the OpenRouter ID for the same model.
A provider response such as “model not found” means the service rejected that ID or route. Verify it in NanoGPT’s own model browser and confirm account access. A successful catalog request does not validate a key or prove generation access. For authentication errors, reconnect the NanoGPT key in Settings > Connections. Never paste your key into Pip.''',terms=['NanoGPT','No models found','Model not found','Model visibility','Custom model ID'],shot=None,table=None,example=None,diagram=None))
for page in pages:
    page['body']=page['body'].replace('v18.3.5', 'v18.3.7')
scene_guide=next(p for p in pages if p['id']=='map-ledger-memory-and-state-inspection')
scene_guide['body'] += '\nExperimental scene record mode: open World Studio > AI, find World Kernel, choose Scene record + ledger under Scene tracking, and save the World. Existing Worlds keep Structured events until you opt in. This mode records the ending location, named participants and anonymous groups with fewer conversational fields. The Scene record line in World play and recorded cast in History show what was saved. Omitted people and anonymous groups remain in a continuous scene until an explicit departure. Schedules do not silently remove foreground participants; time skips release the scene hold. Movement permissions and enabled dice, inventory and other mechanics remain checked.\nIf the location or a person is wrong, open the timeline menu > Correct state, choose the player or character and the mapped location, provide a reason and save. Corrections preserve an audit record and do not silently award items or change dice results. Invalid scene proposals are discarded instead of overwriting the previous scene. This experimental mode still depends on the selected model returning a consistent ending scene; it does not infer every physical fact from prose.'
scene_guide['body'] += '\nWorlds integration: Structured events remains the default. Linked actions (preview), available under World Studio > AI > World Kernel > Scene tracking, uses transactional ordered action chains and saves a candidate before publishing it. It is opt-in; existing worlds are not migrated automatically. Physical transfers require co-location and mapped journeys account for authored travel duration. Scene record mode remains a separate experiment: if verification fails, readable prose can continue as provisional conversation while saved state stays authoritative. Correct scene repairs the map or cast when needed.\nWorld Lore adds a place guide and author/debug view for locations, access and place knowledge. Generate World Structure builds an editable index without replacing the original lore. The map editor supports room positions, room sizes, route waypoints and shared-door locks; changing geometry does not move characters. Ambience / BGM controls can play local audio with region music and location overrides. Locally uploaded file references need their audio files on the destination installation.'
scene_guide['terms'] += ['Linked actions','World Structure','Map editor','Ambience / BGM','Scene record', 'Scene tracking', 'Anonymous groups', 'Recorded cast']
used={Path(p['image']).name for p in pages if p.get('image')}
for stale in asset.glob('*.webp'):
    if stale.name not in used: stale.unlink()
(root/'horde-handbook.js').write_text('// Generated by scripts/build-html-handbook.py; no runtime Python dependency.\nwindow.HordeHandbook = Object.freeze('+json.dumps(dict(version='18.3.7',pages=pages),ensure_ascii=False)+');\n')
print(f'Built {len(pages)} topics and {len(list(asset.glob("*.webp")))} screenshots.')
