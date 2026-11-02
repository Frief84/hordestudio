import ast
import copy
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]

class InterceptorAudit(unittest.TestCase):
    def load(self, logger_broken=False):
        source = (ROOT / 'horde_mcp_bridge.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        names = {'log_comfy_submission', 'comfy_generate', 'set_workflow_input', 'detect_workflow_input'}
        module = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[])
        posted = []
        temp = tempfile.TemporaryDirectory()
        output = Path(temp.name)
        def path_factory(_):
            if logger_broken:
                raise OSError('logging unavailable')
            return output
        def request(url, method='GET', **kwargs):
            if url.endswith('/prompt'):
                posted.append(copy.deepcopy(kwargs['payload']['prompt']))
                return 200, {}, {'prompt_id': 'job'}
            return 200, {}, {'job': {'outputs': {'out': {'images': [{'filename': 'out.png'}]}}}}
        env = {
            'Path': lambda value: path_factory(value), 'os': Mock(environ={'HORDE_COMFY_PROMPT_LOG_DIR': str(output)}), 'datetime': datetime, 'json': json, 'copy': copy, 'Any': __import__('typing').Any,
            'time': Mock(time=lambda: 1_792_000_000, sleep=lambda _: None),
            'loopback_base_url': lambda *args: 'http://localhost:8188',
            'json_request': request,
            'http_request': lambda *args, **kwargs: (200, {}, b'{"name":"reference.png"}'),
            'multipart_image': lambda *args: (b'image-bytes', 'boundary'),
            'download_image': lambda _: 'result',
            'urllib': __import__('urllib'), 're': __import__('re'), 'base64': __import__('base64'),
            'secrets': __import__('secrets'),
        }
        env['urllib'].parse = __import__('urllib.parse', fromlist=['parse'])
        exec(compile(ast.fix_missing_locations(module), 'bridge', 'exec'), env)
        return env, posted, output, temp

    def workflow(self):
        return {
            '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'model.safetensors'}},
            '2': {'class_type': 'LoraLoader', 'inputs': {'model': ['1', 0], 'clip': ['1', 1], 'lora_name': 'style.safetensors', 'strength_model': 0.7}},
            '3': {'class_type': 'IPAdapterFaceID', 'inputs': {'model': ['2', 0], 'image': ['4', 0], 'ipadapter': ['1', 2], 'weight': 0.8, 'weight_type': 'linear', 'start_at': 0.0, 'end_at': 0.85, 'combine_embeds': 'concat'}},
            '4': {'class_type': 'ImageScale', 'inputs': {'image': ['5', 0], 'width': 512, 'height': 512}},
            '5': {'class_type': 'LoadImage', 'inputs': {'image': 'uploaded.png'}},
            '6': {'class_type': 'CLIPTextEncode', 'inputs': {'text': 'full positive prompt'}},
            '7': {'class_type': 'CLIPTextEncode', 'inputs': {'text': 'negative text'}},
            '8': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['7', 0]}},
            '9': {'class_type': 'EmptyLatentImage', 'inputs': {'width': 768, 'height': 1024, 'batch_size': 1}},
            '10': {'class_type': 'KSampler', 'inputs': {'model': ['3', 0], 'positive': ['6', 0], 'negative': ['8', 0], 'latent_image': ['9', 0], 'seed': 123, 'steps': 30, 'cfg': 6.5, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1.0}},
            '11': {'class_type': 'KSamplerAdvanced', 'inputs': {'model': ['2', 0], 'positive': ['6', 0], 'negative': ['7', 0], 'latent_image': ['9', 0], 'noise_seed': 456, 'steps': 20, 'cfg': 5, 'sampler_name': 'dpmpp_2m', 'scheduler': 'karras', 'denoise': 0.8}},
            '12': {'class_type': 'FaceIDUnknown', 'inputs': {'model': ['missing', 0], 'weight': 0.5}},
            '13': {'class_type': 'CLIPTextEncode', '_meta': {'title': 'Additional conditioning'}, 'inputs': {'text': 'additional exact text'}},
        }

    def test_capture_and_actual_paths_and_parameters(self):
        env, posted, output, temp = self.load()
        workflow = self.workflow()
        original = copy.deepcopy(workflow)
        body = {'workflow': workflow, 'prompt': 'full positive prompt', 'seed': 789}
        self.assertEqual(env['comfy_generate'](body), 'result')
        self.assertEqual(posted[0]['10']['inputs']['seed'], 789)
        expected_submission = copy.deepcopy(original)
        expected_submission['10']['inputs']['seed'] = 789
        self.assertEqual(posted[0], expected_submission)
        self.assertEqual(workflow, original)
        report = next(output.glob('*.md')).read_text(encoding='utf-8')
        self.assertIn('full positive prompt', report)
        self.assertIn('negative text', report)
        self.assertIn('additional exact text', report)
        self.assertIn('Sampler 10:', report)
        self.assertIn('Node 6 (CLIPTextEncode)', report)
        self.assertIn('Node 8 (ConditioningZeroOut)', report)
        self.assertIn('CheckpointLoaderSimple', report)
        self.assertIn('LoraLoader', report)
        self.assertIn('IPAdapterFaceID', report)
        self.assertIn('`weight`: 0.8', report)
        self.assertIn('`strength_model`: 0.7', report)
        self.assertIn('- Seed: 789', report)
        self.assertIn('- Seed: 456', report)
        self.assertIn('Width: 768', report)
        self.assertIn('Height: 1024', report)
        self.assertIn('Node 5 (LoadImage)', report)
        self.assertIn('reference-image count: 1 linked LoadImage node', report)
        temp.cleanup()

    def test_unknown_links_are_reported_without_crashing(self):
        env, posted, output, temp = self.load()
        workflow = self.workflow()
        workflow['10']['inputs']['model'] = ['missing-node', 0]
        env['log_comfy_submission'](workflow)
        report = next(output.glob('*.md')).read_text(encoding='utf-8')
        self.assertIn('missing-node (missing node)', report)
        self.assertIn('model path could not be resolved', report)
        temp.cleanup()

    def test_logging_is_disabled_without_explicit_directory(self):
        env, posted, output, temp = self.load()
        env['os'].environ = {}
        env['log_comfy_submission'](self.workflow())
        self.assertEqual(list(output.iterdir()), [])
        temp.cleanup()

    def test_nested_credentials_are_redacted(self):
        env, posted, output, temp = self.load()
        workflow=self.workflow()
        workflow['3']['inputs']['provider_options']={'api_key':'PRIVATE_SENTINEL','image':'data:image/png;base64,PRIVATE_IMAGE'}
        env['log_comfy_submission'](workflow)
        report=next(output.glob('*.md')).read_text()
        self.assertNotIn('PRIVATE_SENTINEL',report)
        self.assertNotIn('PRIVATE_IMAGE',report)
        temp.cleanup()

    def test_failure_to_log_does_not_block_submission(self):
        env, posted, output, temp = self.load(logger_broken=True)
        workflow = self.workflow()
        self.assertEqual(env['comfy_generate']({'workflow': workflow, 'prompt': 'full positive prompt', 'seed': 789}), 'result')
        workflow['10']['inputs']['seed'] = 789
        self.assertEqual(posted, [workflow])
        temp.cleanup()

if __name__ == '__main__':
    unittest.main()
