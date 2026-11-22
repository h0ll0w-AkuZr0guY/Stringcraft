"""Explicit opt-in, low-token provider smoke test. Never invoked by CI."""
import argparse
import json
from pathlib import Path
import re
import urllib.request
import urllib.error
parser=argparse.ArgumentParser()
parser.add_argument('--key-file',required=True)
parser.add_argument('--model',default='qwen-plus')
args=parser.parse_args()
text=Path(args.key_file).read_text(encoding='utf-8-sig')
match=re.search(r'sk-[A-Za-z0-9_.-]{20,}',text)
if not match:
    raise SystemExit('No key found; file contents were not printed')
payload={'model':args.model,'max_tokens':120,'temperature':0,'enable_thinking':False,'response_format':{'type':'json_object'},'messages':[
 {'role':'system','content':'Select capo 0 or 2 from the provided numeric guitar candidates. Return JSON {"capo":integer,"reason":"brief Chinese explanation"}.'},
 {'role':'user','content':'{"summary":{"notes":6,"difficulty":"easy"},"candidates":[{"capo":0,"score":60},{"capo":2,"score":55}]}'}]}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None
request=urllib.request.Request('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+match.group(),'Origin':'https://h0ll0w-akuzr0guy.github.io'},method='POST')
try:
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=30) as response:
        data=json.load(response)
    choice=json.loads(data['choices'][0]['message']['content'])
    assert type(choice.get('capo')) is int and choice['capo'] in (0,2) and isinstance(choice.get('reason'),str)
    print(json.dumps({'provider':'Bailian','model':args.model,'validCandidate':True,'totalTokens':data.get('usage',{}).get('total_tokens'),'secretPrinted':False}))
except urllib.error.HTTPError as error:
    print(json.dumps({'provider':'Bailian','httpStatus':error.code,'validCandidate':False}));raise SystemExit(1)
except Exception:
    print('Provider test failed; response and credentials were not printed');raise SystemExit(1)
