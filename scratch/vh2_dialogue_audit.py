"""Provider-free dialogue job recovery, concurrency and context acceptance."""
from test_runtime import node_executable
import sys, tempfile, unittest, uuid, json, threading, sqlite3
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from test_runtime import node_executable
from virtual_humans.backend.vh2_runtime import WorldService, Conflict, encode, QUANTUM
from virtual_humans.backend.vh2_dialogue import LEASE_MS
from virtual_humans.backend import vh2_workers
ROOT=Path(__file__).resolve().parents[1]
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
class Dialogue(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.now=1788764400000
        self.s=self.open()
        self.w=self.s.command({'schemaVersion':1,'key':'fixture','type':'create','name':'Alex'})['worldId']
        self.cmd('receive_message',text="I'm from London.")
        self.cmd('advance',steps=1)
    def open(self):return WorldService(Path(self.tmp.name)/'a.sqlite',node_executable(ROOT),ROOT,clock=lambda:self.now)
    def tearDown(self):self.s.close();self.tmp.cleanup()
    def cmd(self,kind,**args):
        body={'schemaVersion':1,'key':str(uuid.uuid4()),'type':kind,'worldId':self.w,'expectedRevision':self.s.projection(self.w)['revision'],**args}
        return body,self.s.command(body)
    def state(self):return self.s.projection(self.w)['state']
    def queue(self,text='Oh, nice.'):
        return self.cmd('queue_dialogue',text=text)[1]['jobId']
    def status(self):return self.s.dialogue.list(self.w)[0]['status']
    def test_worker_failure_reports_safe_storage_diagnostic_and_recovers_queue(self):
        job_id=self.queue('A saved reply.')
        with patch.object(self.s.dialogue,'run_once',side_effect=sqlite3.OperationalError('secret-token-in-error')):
            self.assertFalse(self.s.poll_dialogue_once())
        report=self.s.status()['dialogueDiagnostic']
        self.assertEqual(report['state'],'recovering')
        self.assertEqual(report['consecutiveFailures'],1)
        self.assertEqual(report['lastFailure'],{'category':'storage','stage':'run_reply_job','at':self.now,'worldId':None})
        self.assertNotIn('secret-token-in-error',json.dumps(self.s.status()))
        self.assertEqual(self.status(),'queued')
        self.assertTrue(self.s.poll_dialogue_once())
        recovered=self.s.status()['dialogueDiagnostic']
        self.assertEqual(recovered['state'],'healthy')
        self.assertEqual(recovered['lastFailure'],report['lastFailure'])
        self.assertEqual(recovered['lastRecoveredAt'],self.now)
        self.assertEqual(self.s.status()['dialogueError'],'')
        self.assertEqual(self.status(),'delivered')
        self.assertEqual(self.s.dialogue.list(self.w)[0]['id'],job_id)

    def test_worker_storage_maintenance_diagnostic_does_not_touch_saved_message(self):
        self.s._storage_optimizing=True
        try:self.assertFalse(self.s.poll_dialogue_once())
        finally:self.s._storage_optimizing=False
        report=self.s.status()['dialogueDiagnostic']
        self.assertEqual(report['lastFailure']['category'],'storage_maintenance')
        self.assertEqual(report['lastFailure']['stage'],'list_lives')
        self.assertIn('storage maintenance',self.s.status()['dialogueError'])
        self.assertEqual(len([m for m in self.state()['communication']['messages'] if m['role']=='user']),1)
        self.assertTrue(self.s.poll_dialogue_once())
        self.assertEqual(self.s.status()['dialogueDiagnostic']['state'],'healthy')

    def test_worker_local_fault_is_not_mislabeled_as_provider_failure(self):
        with patch.object(self.s.dialogue,'run_once',side_effect=RuntimeError('Bearer hidden-secret')):
            self.assertFalse(self.s.poll_dialogue_once())
        report=self.s.status()
        self.assertEqual(report['dialogueDiagnostic']['lastFailure']['category'],'local_worker')
        self.assertEqual(report['dialogueDiagnostic']['lastFailure']['stage'],'run_reply_job')
        self.assertNotIn('Bearer hidden-secret',json.dumps(report))
        self.assertNotIn('provider',report['dialogueError'].lower())
    def test_calendar_order_and_clock_do_not_cancel_reply(self):
        import copy
        state=self.state()
        ages={'self':{'currentAge':25,'asOf':'2026-09-12'},'friend':{'currentAge':26,'asOf':'2026-09-12'}}
        state['truth']['companion'].setdefault('vh2Calendar',{})['ages']=ages
        first=self.s.dialogue.snapshot(self.w,1,state)[1]
        other=copy.deepcopy(state);other['simAt']+=60_000
        other['truth']['companion']['vh2Calendar']['ages']=dict(reversed(list(ages.items())))
        self.assertEqual(first,self.s.dialogue.snapshot(self.w,2,other)[1])
        other['truth']['companion']['vh2Calendar']['ages']['friend']['currentAge']=27
        self.assertNotEqual(first,self.s.dialogue.snapshot(self.w,2,other)[1])
    def test_malformed_retry_is_bounded_and_excludes_uncertainty(self):
        from virtual_humans.backend.vh2_dialogue import reply_retry_allowed
        malformed=('failed','Malformed structured reply; no metadata was delivered.')
        self.assertTrue(reply_retry_allowed([malformed]))
        self.assertFalse(reply_retry_allowed([malformed,malformed]))
        self.assertFalse(reply_retry_allowed([('unknown','Timeout')]))
        self.assertFalse(reply_retry_allowed([('failed','Daily request limit reached; no submission made.')]))
        self.assertFalse(reply_retry_allowed([malformed,('unknown','Timeout')]))
        self.assertTrue(reply_retry_allowed([('superseded','Changed')]))

    def make_check_in(self):
        self.cmd('receive_message',text="I'll text you in 20 minutes.")
        self.cmd('advance',steps=1)
        self.queue();job=self.s.dialogue.claim();source=job['snapshot']['context']['readyMessageIds'][-1]
        output=json.dumps({'reply':'Talk later','appraisals':[],'commitments':[{'sourceMessageId':source,'evidence':"I'll text you in 20 minutes.",'dueInMinutes':20,'confidence':1}]})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        return self.state()['truth']['companion']['vh2Psychology']['checkIns'][0]

    def test_location_context_is_explicit_and_does_not_default_home(self):
        state=json.loads(json.dumps(self.state()))
        state['truth']['present']['placeId']=None
        request,_=self.s.dialogue.snapshot(self.w,1,state)
        self.assertEqual(request['context']['current']['location'],{'status':'unknown'})
        self.assertIn('Missing or unknown location',request['messages'][0]['content'])
        state['truth']['companion']['lifeProfile']['places']=[{'id':'cafe','label':'Corner Cafe','kind':'social'}]
        state['truth']['present']['placeId']='cafe'
        request,_=self.s.dialogue.snapshot(self.w,1,state)
        self.assertEqual(request['context']['current']['location'],{'status':'established','id':'cafe','label':'Corner Cafe','kind':'social'})

    def test_markdown_wrapped_json_delivers_only_reply(self):
        self.queue();job=self.s.dialogue.claim()
        output='```json\n'+json.dumps({'reply':'Yep.','appraisals':[]})+'\n```'
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(self.state()['communication']['messages'][-1]['text'],'Yep.')
        self.assertEqual(self.state(),self.s.replay(self.w))

    def enable_dialogue_photos(self):
        with self.s.connect() as db:
            db.execute('BEGIN IMMEDIATE');revision,state=self.s.read(db,self.w);before=json.loads(encode(state))
            state['integration']={'providerScope':'horde:alex','autoReplies':False,'source':'test'}
            state['truth']['companion']['allowPhotos']=True
            self.s.commit_event(db,self.w,revision,before,state,'TEST_PHOTO_INTEGRATION')
        companion_id=self.state()['truth']['companion']['id']
        self.cmd('add_bible_asset',role='identity',entityId=companion_id,label='Identity',tags=['face'],image=PNG)
        entry=self.state()['truth']['companion']['vh2Assets']['entries'][0]
        self.cmd('review_bible_asset',entryId=entry['id'],status='approved')
        vh2_workers.settings(self.s,dict(scope='horde:alex',provider='magnific',tool='fixture.generate',
            enabled=True,model='fixture/image',dailyLimit=100,explicitDailyLimit=100,maxReferences=10))

    def test_photo_action_queues_real_image_and_delivers_after_provider_result(self):
        self.enable_dialogue_photos();self.cmd('set_running',running=True);self.queue();job=self.s.dialogue.claim()
        self.assertTrue(job['snapshot']['context']['mediaActions']['photo']['enabled'])
        output=json.dumps({'reply':'One sec—I’ll take one now.','photoAction':{
            'decision':'send','scene':'A casual front-camera selfie at the recorded location.',
            'captureType':'front_camera_selfie'}})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        state=self.state();photo=state['photos'][-1]
        self.assertEqual((photo['origin'],photo['destination'],photo['status']),('dialogue_action','private_chat','submitted'))
        self.assertEqual(state['communication']['messages'][-1]['text'],'One sec—I’ll take one now.')
        with self.s.connect() as db:
            queued=json.loads(db.execute('SELECT snapshot FROM vh2_provider_jobs WHERE id=?',('image:'+photo['id'],)).fetchone()[0])
        self.assertEqual((queued['automatic'],queued['explicitRequest'],queued['purpose']),(True,False,'dialogue'))
        self.s.image_executor=lambda *args:PNG;self.cmd('set_running',running=True)
        for _ in range(20):
            vh2_workers.poll(self.s)
            if any(message.get('type')=='photo' for message in self.state()['communication']['messages']):break
        delivered=self.state()
        self.assertTrue(any(message.get('type')=='photo' and message.get('assetId') for message in delivered['communication']['messages']))
        self.assertEqual(delivered,self.s.replay(self.w))

    def test_photo_action_is_rejected_when_no_durable_image_route_exists(self):
        self.queue();job=self.s.dialogue.claim()
        self.assertFalse(job['snapshot']['context']['mediaActions']['photo']['enabled'])
        output=json.dumps({'reply':'Sent it.','photoAction':{'decision':'send','scene':'A selfie','captureType':'front_camera_selfie'}})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(self.status(),'delivered')
        self.assertTrue(any(message.get('role')=='assistant' for message in self.state()['communication']['messages']))
        self.assertEqual([],vh2_workers.status(self.s,self.w))


    def test_explicit_requests_are_queued_independently_of_model_action(self):
        self.enable_dialogue_photos();self.cmd('receive_message',text='Send me a selfie.');self.cmd('advance',steps=1);self.queue();job=self.s.dialogue.claim()
        self.assertTrue(job['snapshot']['context']['mediaActions']['photo']['explicitRequest'])
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':'Sure, give me a second.'})))
        state=self.state();photo=state['photos'][-1]
        with self.s.connect() as db:queued=json.loads(db.execute('SELECT snapshot FROM vh2_provider_jobs WHERE id=?',('image:'+photo['id'],)).fetchone()[0])
        self.assertEqual((queued['automatic'],queued['explicitRequest']), (False,True))
        self.assertEqual(state['communication']['messages'][-1]['text'],'Sure, give me a second.')

    def test_explicit_scene_text_wins_over_model_rewritten_photo_action(self):
        # Resolve the setup message so the request scene contains only this
        # turn, as it would in an already-established chat.
        self.queue();setup_job=self.s.dialogue.claim()
        self.assertTrue(self.s.dialogue.finish(setup_job['id'],setup_job['token'],json.dumps({'reply':'Nice.'})))
        self.enable_dialogue_photos()
        scene=('Sammie, send me a natural, photorealistic picture of yourself sitting on the edge '
               'of your bed, topless, with your chest completely bare. No shirt, no bra, no clothing '
               'covering your upper body. Frame the photo from your head to your waist, with soft '
               'natural bedroom lighting.')
        self.cmd('receive_message',text=scene);self.cmd('advance',steps=1);self.queue();job=self.s.dialogue.claim()
        action={'reply':'Sure, give me a second.','photoAction':{
            'decision':'send','scene':'A tasteful bedroom selfie wearing a white camisole.',
            'captureType':'front_camera_selfie'}}
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps(action)))
        photo=self.state()['photos'][-1]
        with self.s.connect() as db:
            snapshot=json.loads(db.execute('SELECT snapshot FROM photo_jobs WHERE id=?',(photo['id'],)).fetchone()[0])
            queued=json.loads(db.execute('SELECT snapshot FROM vh2_provider_jobs WHERE id=?',('image:'+photo['id'],)).fetchone()[0])
        self.assertEqual(snapshot['scene'],scene)
        self.assertIn(scene,queued['request']['prompt'])
        self.assertNotIn('white camisole',queued['request']['prompt'])

    def test_request_only_keeps_explicit_requests_and_blocks_unsolicited_actions(self):
        self.enable_dialogue_photos();c=self.state()['truth']['companion'];self.cmd('configure_expression_profile',fields={'photoBehaviorMode':'request_only'})
        self.queue();job=self.s.dialogue.claim();self.assertFalse(job['snapshot']['context']['mediaActions']['photo']['spontaneousEnabled'])
        output=json.dumps({'reply':'Just chatting.','photoAction':{'decision':'send','scene':'At home','captureType':'front_camera_selfie'}})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output));self.assertFalse(self.state().get('photos',[]))
        self.cmd('receive_message',text='Send me another photo.');self.cmd('advance',steps=1);self.queue();job=self.s.dialogue.claim()
        self.assertTrue(job['snapshot']['context']['mediaActions']['photo']['explicitRequest'])
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':'Of course.'})))

    def test_photo_intent_avoids_discussion_and_negation(self):
        from virtual_humans.backend.vh2_photo_intent import classify
        self.assertEqual(classify('Send me a selfie.'),'explicit')
        self.assertEqual(classify("Show me what you're wearing."),'explicit')
        self.assertEqual(classify('Take a picture of yourself sitting on the couch.'),'explicit')
        self.assertEqual(classify('Do you take photos?'),'none')
        self.assertEqual(classify("Don't send me a photo."),'none')
        self.assertEqual(classify('Photos are nice.'),'ambiguous')
        self.assertEqual(classify('Can I see another angle?',True),'explicit')
        request=('Sammie, send me a natural, photorealistic picture of yourself sitting on the edge '
                 'of your bed, topless, with your chest completely bare. No shirt, no bra, no clothing '
                 'covering your upper body. Frame the photo from your head to your waist, with soft '
                 'natural bedroom lighting.')
        self.assertEqual(classify(request),'explicit')

    def test_photo_allowances_default_to_100_and_explicit_budget_is_separate(self):
        self.enable_dialogue_photos()
        with self.s.connect() as db:
            config=json.loads(vh2_workers.current(db,'horde:alex')['config'])
            self.assertEqual((config['dailyLimit'],config['explicitDailyLimit']),(100,100))
            self.assertEqual(vh2_workers.autonomous_budget(db,'horde:alex',config,self.now)['remaining'],100)
            self.assertEqual(vh2_workers.explicit_budget(db,'horde:alex',config,self.now)['remaining'],100)

    def test_older_settings_client_preserves_both_saved_caps(self):
        self.enable_dialogue_photos()
        vh2_workers.settings(self.s,dict(scope='horde:alex',enabled=True,model='fixture/image',apiKey='OFFLINE_TEST_KEY',dailyLimit=3,explicitDailyLimit=7))
        saved=vh2_workers.settings(self.s,dict(scope='horde:alex',enabled=False,model='fixture/image'))
        self.assertEqual((saved['dailyLimit'],saved['explicitDailyLimit']),(3,7))
        self.assertTrue(saved['hasKey'])

    def test_photo_queue_race_cannot_deliver_a_false_promise(self):
        from unittest import mock
        self.enable_dialogue_photos()
        self.cmd('receive_message',text='Send me a photo.')
        self.cmd('advance',steps=1);self.queue();job=self.s.dialogue.claim()
        before=self.state().get('photos',[])
        with mock.patch.object(vh2_workers,'queue_image',side_effect=ValueError('Settings changed')):
            accepted=self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':"I will send it now."}))
        self.assertFalse(accepted)
        self.assertEqual(self.state().get('photos',[]),before)
        self.assertNotIn('I will send it now.',str(self.state()['communication']['messages']))

    def test_wide_chat_photo_uses_personal_photograph_end_to_end(self):
        self.enable_dialogue_photos()
        self.cmd('receive_message',text='Send me a wide candid photo in the garden wearing a red coat.')
        self.cmd('advance',steps=1);self.queue();job=self.s.dialogue.claim()
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':'Give me a moment.'})))
        self.assertEqual(self.state()['photos'][-1]['captureType'],'personal_photograph')
        with self.s.connect() as db:
            frozen=json.loads(db.execute("SELECT snapshot FROM vh2_provider_jobs WHERE kind='image' ORDER BY rowid DESC LIMIT 1").fetchone()[0])
        self.assertTrue(frozen['explicitRequest']);self.assertFalse(frozen['automatic'])
        self.assertNotIn('arm length',frozen['request']['prompt'])

    def test_quota_exhaustion_keeps_explicit_chat_reply_and_resets_at_midnight(self):
        self.enable_dialogue_photos();self.cmd('receive_message',text='Send me a selfie.');self.cmd('advance',steps=1);self.queue();job=self.s.dialogue.claim()
        with self.s.connect() as db:
            db.execute('BEGIN IMMEDIATE');revision,state=self.s.read(db,self.w);before=json.loads(encode(state));photo=state.setdefault('photos',[])
            # Reserve the configured allowance using already-attempted isolated jobs.
            cfg=json.loads(vh2_workers.current(db,'horde:alex')['config']);day=self.now//86400000*86400000
            for i in range(cfg['explicitDailyLimit']):
                db.execute('INSERT INTO vh2_provider_jobs VALUES (?,?,?,?,?,?,?,?,?,?)',(f'quota:{i}',self.w,'image','failed',encode({'scope':'horde:alex','explicitRequest':True,'automatic':False}),None,'mock failure',day+i,None,day+i))
            self.s.commit_event(db,self.w,revision,before,state,'TEST_QUOTA_EXHAUSTED')
        # Rebuild the snapshot after the isolated quota reservations.
        self.s.dialogue.finish(job['id'],job['token'],'{"reply":"I can’t send one right now, but we can keep talking."}')
        self.assertTrue(any(m.get('role')=='assistant' and 'keep talking' in m.get('text','') for m in self.state()['communication']['messages']))
        with self.s.connect() as db:
            cfg=json.loads(vh2_workers.current(db,'horde:alex')['config']);self.now=(self.now//86400000+1)*86400000
            self.assertEqual(vh2_workers.explicit_budget(db,'horde:alex',cfg,self.now)['remaining'],cfg['explicitDailyLimit'])

    def test_five_and_ten_repeated_explicit_requests_stay_queueable(self):
        self.enable_dialogue_photos()
        for total in (5,10):
            for i in range(total):
                self.cmd('receive_message',text=f'Send me a selfie, attempt {total}-{i}.');self.cmd('advance',steps=1);self.queue();job=self.s.dialogue.claim()
                self.assertTrue(job['snapshot']['context']['mediaActions']['photo']['explicitAvailable'])
                self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':'Sure.'})))
                with self.s.connect() as db:
                    row=db.execute("SELECT snapshot FROM vh2_provider_jobs WHERE kind='image' AND json_extract(snapshot,'$.explicitRequest')=1 ORDER BY created_at DESC LIMIT 1").fetchone()
                    if row:
                        sid=json.loads(row['snapshot'])['photoId'];db.execute("UPDATE vh2_provider_jobs SET status='failed',error='fixture result' WHERE id=?",('image:'+sid,))
                # Close terminal test captures so the next chat request can proceed.
                with self.s.connect() as db:
                    db.execute('BEGIN IMMEDIATE');revision,state=self.s.read(db,self.w);before=json.loads(encode(state))
                    for p in state.get('photos',[]):
                        if p.get('status')=='submitted':p['status']='failed'
                    self.s.commit_event(db,self.w,revision,before,state,'TEST_TERMINAL_PHOTO')
            if total==5:continue
        self.assertEqual(len([p for p in self.state().get('photos',[]) if p.get('status')=='failed']),15)

    def test_natural_mode_allows_spontaneous_and_persists(self):
        self.enable_dialogue_photos()
        self.cmd('configure_expression_profile',fields={'photoBehaviorMode':'natural'})
        self.assertEqual(self.state()['truth']['companion']['photoBehaviorMode'],'natural')
        self.queue();job=self.s.dialogue.claim()
        self.assertEqual(job['snapshot']['context']['mediaActions']['photo']['mode'],'natural')
        self.assertTrue(job['snapshot']['context']['mediaActions']['photo']['spontaneousEnabled'])
        output=json.dumps({'reply':'I caught the sunset.','photoAction':{'decision':'send','scene':'A casual view of the sunset.','captureType':'front_camera_selfie'}})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(self.state()['communication']['messages'][-1]['text'],'I caught the sunset.')
        self.s.close();self.s=self.open()
        self.assertEqual(self.state()['truth']['companion']['photoBehaviorMode'],'natural')

    def test_photo_friendly_allows_spontaneous_and_request_only_ignores_them(self):
        self.enable_dialogue_photos();self.cmd('configure_expression_profile',fields={'photoBehaviorMode':'photo_friendly'})
        self.queue();job=self.s.dialogue.claim();self.assertTrue(job['snapshot']['context']['mediaActions']['photo']['spontaneousEnabled'])
        output=json.dumps({'reply':'I have a nice view from here.','photoAction':{'decision':'send','scene':'The character shares the view from the window.','captureType':'front_camera_selfie'}})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output));self.assertEqual(len(self.state().get('photos',[])),1)
        with self.s.connect() as db:
            row=db.execute("SELECT id FROM vh2_provider_jobs WHERE kind='image' ORDER BY created_at DESC LIMIT 1").fetchone();db.execute("UPDATE vh2_provider_jobs SET status='failed' WHERE id=?",(row['id'],))
            db.commit();db.execute('BEGIN IMMEDIATE');revision,state=self.s.read(db,self.w);before=json.loads(encode(state));state['photos'][-1]['status']='failed';self.s.commit_event(db,self.w,revision,before,state,'TEST_TERMINAL')
        self.cmd('configure_expression_profile',fields={'photoBehaviorMode':'request_only'});self.cmd('receive_message',text='Tell me what you think of this weather.');self.cmd('advance',steps=1);self.queue();job=self.s.dialogue.claim()
        self.assertFalse(job['snapshot']['context']['mediaActions']['photo']['spontaneousEnabled'])
        out=json.dumps({'reply':'Just a little cloudy.','photoAction':{'decision':'send','scene':'Unsolicited image.','captureType':'front_camera_selfie'}})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],out));self.assertEqual(len(self.state().get('photos',[])),1)
    def test_wrapped_json_with_trailing_text_is_rejected(self):
        self.queue();job=self.s.dialogue.claim()
        output='```json\n'+json.dumps({'reply':'Yep.','appraisals':[]})+'\n```\nExtra commentary'
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(self.status(),'failed')

    def test_check_in_receipt_and_replay(self):
        item=self.make_check_in()
        self.cmd('advance',steps=3)
        self.cmd('receive_message',text='Back now!')
        self.cmd('advance',steps=2)
        state=self.state();outcome=state['truth']['companion']['vh2Psychology']['checkIns'][0]
        self.assertEqual(outcome['status'],'fulfilled')
        self.assertTrue(outcome['outcomeMessageId'])
        self.assertGreater(state['truth']['companion']['relationshipDynamics']['trust'],0)
        self.assertEqual(state,self.s.replay(self.w))
        self.s.close();self.s=self.open()
        self.assertEqual(state,self.state())
        self.assertEqual(item['id'],outcome['id'])

    def test_check_in_dismissal_is_persisted_and_has_no_penalty(self):
        item=self.make_check_in()
        self.cmd('dismiss_check_in',checkInId=item['id'])
        self.cmd('advance',steps=12)
        self.assertEqual(self.state()['truth']['companion']['vh2Psychology']['checkIns'][0]['status'],'dismissed')
        self.assertEqual(self.state()['truth']['companion']['relationshipDynamics']['trust'],0)
        self.assertEqual(self.state(),self.s.replay(self.w))

    def test_relationship_policy_validation_and_atomic_effects(self):
        policy=self.state()['truth']['companion']['vh2Psychology']['relationshipPolicy']
        for patch in ({'friendliness':101},{'minPositiveExchanges':1.5},{'trustOpenness':True}):
            with self.assertRaises(ValueError):self.cmd('configure_relationship_learning',policy={**policy,**patch})
        self.cmd('configure_relationship_learning',policy={**policy,'rejectionSensitivity':100})
        self.cmd('receive_message',text='You are useless and I hate talking to you.')
        self.cmd('advance',steps=1)
        self.queue();job=self.s.dialogue.claim();source=job['snapshot']['context']['readyMessageIds'][-1]
        self.assertEqual(job['snapshot']['context']['relationship']['policy']['rejectionSensitivity'],100)
        output=json.dumps({'reply':'That bothered me.','appraisals':[{'sourceMessageId':source,'evidence':'You are useless and I hate talking to you.','interpretation':'hostility','confidence':1}]})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        state=self.state();self.assertAlmostEqual(state['truth']['companion']['relationshipDynamics']['trust'],-.3)
        self.assertEqual(state['truth']['companion']['relationshipDynamics']['attraction'],0)
        self.assertEqual(state,self.s.replay(self.w))
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],output))

    def test_appraisal_configuration_is_validated_and_fences_old_job(self):
        policy={'enabled':True,'emotionalImpact':2,'minConfidence':.9,'maxEmotionChange':1}
        for patch in ({'emotionalImpact':99},{'enabled':1},{'minConfidence':False},{'maxEmotionChange':-1}):
            with self.assertRaises(ValueError):self.cmd('configure_conversation_appraisal',policy={**policy,**patch})
        self.queue();job=self.s.dialogue.claim()
        self.cmd('configure_conversation_appraisal',policy=policy)
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'Old policy reply'))
        self.assertEqual('superseded',self.status())
        self.assertEqual(policy,self.state()['truth']['companion']['vh2Psychology']['conversationPolicy'])
        self.assertEqual(self.state(),self.s.replay(self.w))

    def test_disabled_appraisal_ignores_unsolicited_proposals(self):
        self.cmd('configure_conversation_appraisal',policy={'enabled':False,'emotionalImpact':1,'minConfidence':.8,'maxEmotionChange':4})
        self.queue();job=self.s.dialogue.claim();source=job['snapshot']['context']['readyMessageIds'][0]
        self.assertFalse(job['snapshot']['context']['appraisalEnabled'])
        output=json.dumps({'reply':'Okay','appraisals':[{'sourceMessageId':source,'evidence':"I'm from London.",'interpretation':'enjoyment','confidence':1}]})
        before=self.state()['truth']['companion']['mood']['valence']
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(before,self.state()['truth']['companion']['mood']['valence'])
        self.assertFalse(any(e['kind']=='conversation_appraisal' for e in self.state()['truth']['companion']['vh2Psychology']['episodes']))

    def test_structured_appraisal_atomic_replay(self):
        self.queue();job=self.s.dialogue.claim()
        source=job['snapshot']['context']['readyMessageIds'][0]
        before=self.state()['truth']['companion']['mood']['valence']
        proposal={'sourceMessageId':source,'evidence':"I'm from London.",'interpretation':'enjoyment','confidence':.9}
        output=json.dumps({'reply':'London!','appraisals':[proposal,proposal]})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        state=self.state();psy=state['truth']['companion']['vh2Psychology']
        self.assertEqual(1,len([e for e in psy['episodes'] if e['kind']=='conversation_appraisal']))
        self.assertAlmostEqual(before+.36,state['truth']['companion']['mood']['valence'])
        self.assertEqual('London!',state['communication']['messages'][-1]['text'])
        self.assertGreater(state['truth']['companion']['emotionState']['felt']['joy'],0)
        context=self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],state)[0]['context']
        self.assertEqual(state['truth']['companion']['emotionState']['felt'],context['current']['emotions']['felt'])
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(state,self.s.replay(self.w))

    def test_unsupported_appraisal_does_not_change_mood(self):
        self.queue();job=self.s.dialogue.claim()
        source=job['snapshot']['context']['readyMessageIds'][0]
        before=self.state()['truth']['companion']['mood']['valence']
        proposals=[{'sourceMessageId':source,'evidence':'invented quotation','interpretation':'support','confidence':1},
                   {'sourceMessageId':source,'evidence':"I'm from London.",'interpretation':'support','confidence':1,'trust':100}]
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':'Oh nice','appraisals':proposals})))
        self.assertEqual(before,self.state()['truth']['companion']['mood']['valence'])

    def test_malformed_envelope_never_leaks(self):
        self.queue();job=self.s.dialogue.claim()
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'{"reply":"hello","appraisals":null}'))
        self.assertEqual('failed',self.status())
        self.assertEqual(1,len(self.state()['communication']['messages']))

    def test_queued_restart_exactly_one_delivery(self):
        body,receipt=self.cmd('queue_dialogue',text='Hi')
        self.assertEqual(receipt,self.s.command(body))
        self.s.close();self.s=self.open()
        self.assertTrue(self.s.dialogue.run_once())
        self.assertFalse(self.s.dialogue.run_once())
        self.assertEqual('delivered',self.status())
        self.assertEqual(2,len(self.state()['communication']['messages']))
        self.assertEqual(self.state(),self.s.replay(self.w))
    def test_snapshot_is_immutable_and_scoped(self):
        job_id=self.queue();job=self.s.dialogue.claim()
        self.assertEqual('London',job['snapshot']['context']['knownPlayerFacts'][0]['value'])
        self.assertNotIn('truth',job['snapshot']['context'])
        with self.s.connect() as db:
            with self.assertRaises(sqlite3.IntegrityError):db.execute('UPDATE dialogue_jobs SET snapshot=? WHERE id=?',('{}',job_id))
        self.cmd('receive_message',text='An unread follow-up')
        self.assertNotIn('An unread follow-up',encode(job['snapshot']))
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'Stale reply'))
        self.assertEqual('superseded',self.status())
        self.assertEqual([],self.state()['playerKnowledge'])
    def test_expired_worker_fenced_and_recovered(self):
        self.queue();first=self.s.dialogue.claim();self.now+=LEASE_MS+1
        self.s.close();self.s=self.open();second=self.s.dialogue.claim()
        self.assertNotEqual(first['token'],second['token'])
        self.assertEqual(2,second['attempt'])
        self.assertFalse(self.s.dialogue.finish(first['id'],first['token'],'Late'))
        self.assertTrue(self.s.dialogue.finish(second['id'],second['token'],'Recovered'))
        self.assertFalse(self.s.dialogue.finish(second['id'],second['token'],'Duplicate'))
        self.assertEqual(1,len(self.state()['playerKnowledge']))
    def test_one_worker_claim_and_one_active_job(self):
        self.queue()
        with self.assertRaises(Conflict):self.queue('Second')
        results=[]
        threads=[threading.Thread(target=lambda:results.append(self.s.dialogue.claim())) for _ in range(2)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(1,sum(r is not None for r in results))
    def test_unrelated_revision_does_not_discard_valid_reply(self):
        self.queue();job=self.s.dialogue.claim()
        simulation_start=self.state()['simAt']
        self.cmd('set_running',running=True)
        self.now+=3000
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],'Still valid'))
        self.assertEqual(simulation_start+3000,self.state()['communication']['messages'][-1]['deliveredAt'])
        self.assertTrue(self.state()['running'])
    def test_sleep_during_work_discards_reply(self):
        self.queue();job=self.s.dialogue.claim()
        with self.s.connect() as db:
            rev,before=self.s.read(db,self.w);after=json.loads(encode(before))
            after['truth']['companion']['humanDynamics']['sleep']={'stage':'asleep','lastAt':after['simAt'],
                'sleepStartedAt':after['simAt'],'pressure':80,'nap':False}
            self.s.commit_event(db,self.w,rev,before,after,'TEST_SLEEP')
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'Awake?'))
        self.assertEqual('superseded',self.status())
        self.assertEqual([],self.state()['playerKnowledge'])
    def test_worker_runs_outside_writer_and_failure_isolated(self):
        self.queue()
        def executor(job):
            # A separate DB connection can write while expression is executing.
            self.cmd('set_running',running=True)
            raise RuntimeError('SECRET_PROVIDER_TOKEN')
        self.assertFalse(self.s.dialogue.run_once(executor))
        self.assertEqual('failed',self.status())
        self.assertNotIn('SECRET_PROVIDER_TOKEN',encode(self.s.dialogue.list(self.w)))
        self.now+=QUANTUM;self.assertEqual([],self.s.tick())
        self.assertGreater(self.state()['simAt'],1788764400000)
    def test_invalid_output_and_bounded_recovery(self):
        self.queue();job=self.s.dialogue.claim()
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'<|channel>thought secret'))
        self.assertEqual('failed',self.status())
        self.queue()
        for _ in range(3):
            self.assertIsNotNone(self.s.dialogue.claim());self.now+=LEASE_MS+1
        self.assertIsNone(self.s.dialogue.claim());self.assertEqual('failed',self.status())
        self.assertEqual([],self.state()['playerKnowledge'])
    def test_delivery_failure_rolls_back_job_and_transcript(self):
        self.queue();job=self.s.dialogue.claim();before=self.s.projection(self.w)
        original=self.s.commit_event
        def fail(*args,**kwargs):
            if args[5]=='REPLY_DELIVERED':raise RuntimeError('Simulated commit failure')
            return original(*args,**kwargs)
        self.s.commit_event=fail
        with self.assertRaises(RuntimeError):self.s.dialogue.finish(job['id'],job['token'],'Hello')
        self.s.commit_event=original
        self.assertEqual('leased',self.status())
        self.assertEqual(before,self.s.projection(self.w))
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],'Hello'))
    def test_kernel_upgrade_invalidates_worker(self):
        self.queue();job=self.s.dialogue.claim();self.s.kernel_version+='-new-fixture'
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'Wrong kernel'))
        self.assertEqual('superseded',self.status())
        self.assertEqual([],self.state()['playerKnowledge'])
    def test_stale_queue_never_invokes_executor(self):
        self.queue();self.cmd('receive_message',text='Wait, different question')
        def must_not_run(job):self.fail('Stale work reached executor')
        self.assertFalse(self.s.dialogue.run_once(must_not_run))
        self.assertEqual('superseded',self.status())
if __name__=='__main__':unittest.main(verbosity=2)
