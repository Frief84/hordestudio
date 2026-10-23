"""Focused handoff hardening; all image requests are compiled offline."""
import unittest
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from virtual_humans.backend import vh2_photo_intent as intent, vh2_workers

class PhotoReliability(unittest.TestCase):
 def test_paid_photo_intent_requires_an_image_request(self):
  for text in ['Could you send me the address?', 'Can you make dinner?', 'Would you show me the schedule?', 'Can I see you tomorrow?', 'Please send me more details about the invoice.', 'Send me a picture frame.', 'How do you take a photo?', 'Can you explain how to take a photo?', 'Can you take photos?']:
   self.assertNotEqual(intent.classify(text, True),'explicit',text)
  for text in ['Send me a photo without a jacket.', 'Please take a wide candid picture in the garden.', 'Could you send a picture?']:
   self.assertEqual(intent.classify(text),'explicit',text)
  self.assertEqual(intent.classify('Another angle?'),'ambiguous')
  self.assertEqual(intent.classify('Another angle?',True),'explicit')
  self.assertEqual(intent.classify("Don't send me a selfie."),'none')
  self.assertEqual(intent.classify('Do you take photos?'),'none')
 def test_framing_has_priority_over_a_generic_model_selfie(self):
  self.assertEqual(intent.capture_type('A wide candid photo in the garden.','front_camera_selfie'),'personal_photograph')
  self.assertEqual(intent.capture_type('A mirror selfie.'),'mirror_selfie')
  self.assertEqual(intent.capture_type('Send me a selfie.'),'front_camera_selfie')
  self.assertEqual(intent.capture_type('Send me a photo.'),'personal_photograph')
 def test_explicit_clothes_exclude_old_photos_and_garment_references(self):
  snapshot={'companion':{'age':30,'lifeProfile':{'socialCircle':[]}},'scene':'A wide photo wearing a red coat.',
   'photoContext':{'atMs':1000000,'placeId':'home','outfit':'SAVED_BLUE_SWEATER','garmentIds':[]},
   'destination':'private_chat','captureType':'personal_photograph',
   'referenceAssets':[{'role':'identity','assetId':'face','label':'Face'},{'role':'garment','assetId':'old','label':'Old sweater'}]}
  state={'photos':[{'assetId':'previous','destination':'private_chat','at':999999,'photoContext':dict(snapshot['photoContext'])}]}
  with patch.object(vh2_workers,'asset_data',side_effect=lambda db,world,asset:asset):
   request,hashes,refs=vh2_workers.compile_image(None,'offline',state,snapshot,{'model':'fixture','maxReferences':1})
  self.assertEqual(refs,['face']);self.assertNotIn('SAVED_BLUE_SWEATER',request['prompt'])
  self.assertNotIn('arm length',request['prompt']);self.assertIn('wearing a red coat',request['prompt'])

 def test_new_setting_excludes_old_place_and_previous_image(self):
  snapshot={'companion':{'age':30,'lifeProfile':{'socialCircle':[]}},'scene':'A candid photograph in the garden.',
   'photoContext':{'atMs':1000000,'placeId':'home','placeLabel':'SAVED_OFFICE','zoneDescription':'SAVED_DESK','garmentIds':[]},
   'destination':'private_chat','captureType':'personal_photograph',
   'referenceAssets':[{'role':'identity','assetId':'face','label':'Face'},{'role':'place','assetId':'office','label':'Office'}]}
  state={'photos':[{'assetId':'previous','destination':'private_chat','at':999999,'photoContext':dict(snapshot['photoContext'])}]}
  with patch.object(vh2_workers,'asset_data',side_effect=lambda db,world,asset:asset):
   request,hashes,refs=vh2_workers.compile_image(None,'offline',state,snapshot,{'model':'fixture','maxReferences':1})
  self.assertEqual(refs,['face']);self.assertNotIn('SAVED_OFFICE',request['prompt']);self.assertNotIn('SAVED_DESK',request['prompt'])

if __name__=='__main__':unittest.main()
