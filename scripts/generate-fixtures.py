"""Original/synthetic music fixtures; no private recordings or third-party songs."""
from pathlib import Path
import json
import wave
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests'/'fixtures'/'audio'
OUT.mkdir(parents=True,exist_ok=True)
rate=22050
patterns={
 'clean-melody':[64,67,69,67,64,62], 'ascending':[60,62,64,65,67,69],
 'descending':[76,74,72,71,69,67], 'repeated':[64,64,64,64,64,64],
 'sustain':[64,67,64], 'low-range':[40,43,45,47,48,50],
 'high-range':[76,79,81,79,76,74], 'leaps':[64,76,67,79,65,77],
 'soft-attacks':[60,64,67,64,62,60], 'melody-with-bass':[64,67,69,67,64,62],
 'melody-with-pad':[64,65,67,69,67,64], 'silence':[],
}
truth=[]
for name,pitches in patterns.items():
    spacing=1.1 if name=='sustain' else .65
    duration=max(4.5,len(pitches)*spacing+.5)
    data=np.zeros(int(duration*rate),dtype=np.float32)
    notes=[]
    for i,pitch in enumerate(pitches):
        start=.25+i*spacing;length=.95 if name=='sustain' else .48
        t=np.arange(round(length*rate))/rate
        hz=440*2**((pitch-69)/12)
        envelope=np.minimum(1,t/(.06 if name=='soft-attacks' else .008))*np.exp(-3*t/length)*np.minimum(1,(length-t)/.03)
        sound=sum(np.sin(2*np.pi*hz*h*t)/h**1.7 for h in range(1,7))*.43*envelope
        pos=round(start*rate);data[pos:pos+len(t)]+=sound
        notes.append({'start':start,'duration':length,'midi':pitch})
    if name in ('melody-with-bass','melody-with-pad'):
        t=np.arange(len(data))/rate
        for p in ([40,43] if name.endswith('bass') else [48,55,60]):
            data+=.055*np.sin(2*np.pi*440*2**((p-69)/12)*t)*np.minimum(1,t/.1)*np.exp(-.4*t)
    with wave.open(str(OUT/(name+'.wav')),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes((np.clip(data,-1,1)*32767).astype('<i2').tobytes())
    truth.append({'id':name,'kind':'synthetic-mixture' if 'with-' in name else 'synthetic-monophonic','duration':duration,'notes':notes})
(OUT/'truth.json').write_text(json.dumps(truth,indent=2),encoding='utf-8')
print(f'Generated {len(truth)} explicitly synthetic fixtures')
