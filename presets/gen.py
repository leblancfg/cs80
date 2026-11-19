import os
import json
U={"wiki":"https://en.wikipedia.org/wiki/Yamaha_CS-80","sos95":"https://web.archive.org/web/20150607060748/http://www.soundonsound.com/sos/1995_articles/jul95/yamahacs80.html","hollow":"https://web.archive.org/web/20130327061026/http://www.hollowsun.com/donations/cs80/","vs":"https://web.archive.org/web/20090219122851/http://www.vintagesynth.com/yamaha/cs80.shtml","reid":"https://web.archive.org/web/20140917022815/http://www.gordonreid.co.uk/vintage/cs80.html","syn":"https://www.synthtopia.com/content/2010/02/21/the-iconic-sounds-of-synthesis-vangelis-blade-runner-brass-sound/","rm":"https://reverbmachine.com/blog/vangelis-tears-in-rain-blade-runner/","syntorial":"https://www.syntorial.com/preset-recipe/vangelis-blade-runner-brass/","arturia":"https://www.arturia.com/store/vangelis_tribute"}
def ch(saw=0,sq=0,sine=0,noise=0,pwm=0,feet=8,hpf=0.1,hpfq=0.1,lpf=0.6,lpfq=0.2,fenv=(0.5,0.5,0.05,0.5,0.3),a=0.05,d=0.5,s=0.7,r=0.3,bril=0.5,klvl=0.5,kbril=0.5):
    return dict(vco=dict(saw=saw,square=sq,sine=sine,noise=noise,pwm_depth=pwm,feet=feet),hpf=dict(cutoff=hpf,res=hpfq),lpf=dict(cutoff=lpf,res=lpfq),
      filter_env=dict(IL=fenv[0],AL=fenv[1],A=fenv[2],D=fenv[3],R=fenv[4]),vca_env=dict(A=a,D=d,S=s,R=r),brilliance=bril,key_level=klvl,key_brilliance=kbril)
def P(bank,name,ref,I,II=None,bal=0.5,detune=0.1,init=(0.3,0.3),after=(0.4,0.5),lfo=(0.4,"vibrato",0.0),ring=0.0,chorus=0.3,trem=0.0,pb=0.0,src=("wiki",),conf="inferred",note=""):
    return dict(bank=bank,name=name,reference=ref,source_urls=[U[x] for x in src],confidence=conf,
      params=dict(units="all 0..1 normalized except feet (16/8/4); envelope times normalized log 0..1",
        channel_I=I,channel_II=II or I,balance_I_II=bal,detune=detune,initial_touch=dict(amp=init[0],brilliance=init[1]),
        after_touch=dict(amp=after[0],brilliance=after[1],lfo_speed=0.0,lfo_depth=0.2),initial_pitchbend=pb,
        sub_oscillator_lfo=dict(speed=lfo[0],dest=lfo[1],depth=lfo[2]),ring_mod=dict(depth=ring,speed=0.3,attack=0.2,decay=0.4),chorus=chorus,tremolo=trem,
        field_confidence="all numeric values inferred by ear/estimated unless the note says otherwise",note=note))
L=[]
def add(*a,**k): L.append(P(*a,**k))
B="Brass"
add(B,"Brass 1 (factory)","CS-80 factory preset; SOS 1995 mentions Brass 1 and Brass 2 layering",ch(saw=.8,sq=.3,lpf=.55,fenv=(.25,.8,.35,.5,.3),a=.15,d=.6,s=.8,r=.25,hpf=.08),bal=.5,detune=.15,src=("sos95","vs"),conf="partially documented",note="Preset name and layering/detune behaviour documented; numbers estimated")
add(B,"Brass 2 (factory)","CS-80 factory preset; layered with Brass 1",ch(saw=.7,sq=.5,lpf=.5,fenv=(.2,.85,.4,.55,.3),a=.2,d=.6,s=.8,r=.25),detune=.2,src=("sos95",),conf="partially documented")
add(B,"Blade Runner Main Titles Brass","Vangelis, Blade Runner Main Titles (1982)",ch(sq=.8,saw=.2,pwm=.6,lpf=.5,lpfq=.2,fenv=(.1,.9,.55,.75,.8),a=.3,d=.8,s=.45,r=.6,hpf=.1),ch(sq=.6,saw=.2,pwm=.5,feet=4,lpf=.5,fenv=(.1,.85,.55,.75,.8),a=.3,d=.8,s=.45,r=.6),bal=.6,detune=.18,init=(.4,.5),after=(.35,.75),lfo=(.3,"pwm",.5),chorus=.4,src=("syn","rm","syntorial","sos95"),conf="partially documented",note="Documented qualitatively: PWM, aftertouch/initial-touch brightness response, slow filter attack, big reverb. Syntorial recipe is for a generic synth (A 250ms D 1.9s S 40%, 2 pulse osc +1 oct -6 cents, LPF 75% res 15%, slow filter env); used as guide only")
add(B,"Blade Runner Brass Swell (Tears in Rain)","Vangelis, Tears in Rain (Blade Runner)",ch(saw=.7,sq=.4,lpf=.4,fenv=(.1,.9,.7,.8,.8),a=.45,d=.7,s=.7,r=.7),detune=.2,after=(.5,.8),src=("rm",),conf="partially documented",note="Reverb Machine confirms Initial/After faders drive note-to-note brightness; values estimated")
add(B,"Blade Runner Ribbon Slide","Vangelis, Tears in Rain descending ribbon slides",ch(saw=.8,sq=.3,lpf=.55,fenv=(.3,.7,.2,.5,.5),a=.1,d=.5,s=.8,r=.5),pb=.4,src=("rm","sos95"),conf="partially documented",note="Ribbon pitch slide plus Initial Pitchbend twang documented")
add(B,"Sax Lead (Blade Runner Blues)","Vangelis, Blade Runner Blues; SOS says Initial Pitchbend gives sax/harmonica tone",ch(saw=.6,sq=.4,lpf=.45,lpfq=.35,fenv=(.3,.8,.1,.4,.2),a=.04,d=.3,s=.85,r=.15),pb=.6,lfo=(.55,"vibrato",.25),after=(.3,.6),src=("sos95",),conf="partially documented",note="Initial Pitchbend use documented")
add(B,"Chariots Brass","Vangelis, Chariots of Fire (1981) synth brass",ch(saw=.75,sq=.35,lpf=.5,fenv=(.2,.8,.25,.5,.3),a=.1,d=.5,s=.85,r=.3),detune=.2,chorus=.5,src=("wiki",))
add(B,"Africa Brass Stab","Toto, Africa (1982); CS-80 brass attributed in VintageSynth (Toto/Dune), the exact Africa part is unconfirmed",ch(saw=.8,sq=.3,lpf=.55,fenv=(.2,.85,.1,.4,.2),a=.05,d=.4,s=.8,r=.2),detune=.15,src=("vs",))
add(B,"Dune Brass","Toto, Dune soundtrack (1984); VintageSynth cites CS-80 on Dune",ch(saw=.8,sq=.4,lpf=.45,fenv=(.2,.85,.4,.6,.5),a=.18,d=.6,s=.75,r=.4),detune=.22,src=("vs",))
add(B,"Jobson Solo Brass","Eddie Jobson CS-80 leads",ch(saw=.7,sq=.4,lpf=.5,lpfq=.3,fenv=(.25,.8,.15,.4,.2),a=.05,d=.4,s=.85,r=.2),lfo=(.5,"vibrato",.2),src=("sos95","reid"))
add(B,"Flute to Trumpet","SOS: 'Flute' patch used by Steve Winwood; brilliance/resonance turn it into a trumpet",ch(sq=.6,sine=.3,saw=.2,lpf=.5,lpfq=.45,fenv=(.2,.7,.1,.3,.2),a=.06,d=.4,s=.8,r=.2),src=("sos95",),conf="partially documented")
add(B,"Horn Section","Generic CS-80 detuned brass stack",ch(saw=.6,sq=.5,lpf=.45,fenv=(.2,.8,.3,.5,.3),a=.2,d=.6,s=.85,r=.3),detune=.3,chorus=.5)
add(B,"Soft Brass","Mellow CS-80 brass for ballads",ch(saw=.5,sq=.5,lpf=.4,fenv=(.15,.7,.4,.6,.4),a=.25,d=.7,s=.8,r=.4),detune=.2)
add(B,"Bright Stab","80s pop synth brass stab",ch(saw=.9,sq=.2,lpf=.7,fenv=(.4,.95,.05,.3,.2),a=.02,d=.25,s=.5,r=.15),detune=.15)
add(B,"Octave Brass","Brass layered 8'/4'",ch(saw=.7,sq=.4,lpf=.5,fenv=(.2,.8,.3,.5,.3),a=.15,d=.6,s=.8,r=.3),ch(saw=.7,sq=.4,feet=4,lpf=.5,fenv=(.2,.8,.3,.5,.3),a=.15,d=.6,s=.8,r=.3),detune=.15)
S="Strings"
add(S,"Strings (factory)","CS-80 factory preset 'Strings'; used by Vangelis",ch(saw=.8,sq=.1,lpf=.5,fenv=(.3,.5,.2,.5,.4),a=.35,d=.6,s=.9,r=.5),detune=.3,chorus=.7,src=("vs","sos95"),conf="partially documented",note="Natural detuning making strings 'unparalleled' per VintageSynth")
add(S,"Chariots Strings","Vangelis, Chariots of Fire",ch(saw=.8,lpf=.5,fenv=(.3,.5,.2,.5,.4),a=.4,d=.6,s=.9,r=.6),detune=.3,chorus=.7)
add(S,"Ensemble Strings","Generic ensemble",ch(saw=.7,sq=.2,lpf=.5,a=.3,d=.5,s=.9,r=.5),ch(saw=.7,feet=16,lpf=.45,a=.35,d=.5,s=.9,r=.5),detune=.35,chorus=.8)
add(S,"Slow Strings","Slow attack film strings",ch(saw=.7,lpf=.4,a=.6,d=.6,s=.9,r=.7),detune=.3,chorus=.7)
add(S,"Pizzicato Strings","Short staccato strings",ch(saw=.7,lpf=.45,fenv=(.4,.5,.01,.2,.1),a=.01,d=.2,s=.0,r=.15),chorus=.4)
add(S,"Solo Violin","Expressive solo violin via aftertouch vibrato",ch(saw=.8,lpf=.55,lpfq=.2,a=.12,d=.4,s=.85,r=.25),lfo=(.55,"vibrato",.3),after=(.3,.5))
add(S,"Cello","Low 16' strings",ch(saw=.8,feet=16,lpf=.4,a=.2,d=.5,s=.85,r=.35),lfo=(.5,"vibrato",.2),chorus=.5)
add(S,"String Pad Wide","Wide detuned strings",ch(saw=.8,lpf=.5,a=.45,d=.6,s=.9,r=.6),detune=.5,chorus=.9)
add(S,"Orchestral Swell","Aftertouch driven swell",ch(saw=.75,lpf=.35,fenv=(.1,.8,.6,.7,.6),a=.5,d=.7,s=.85,r=.6),after=(.5,.9),detune=.3)
add(S,"Eno Strings","Brian Eno era CS-80 strings (VintageSynth lists Eno as user)",ch(saw=.7,lpf=.4,a=.5,d=.6,s=.9,r=.7),detune=.35,src=("vs",))
P_="Pads and Atmospheres"
add(P_,"Warm Pad","Warm 8' pad",ch(saw=.5,sq=.3,sine=.3,lpf=.4,a=.5,d=.7,s=.9,r=.7),detune=.3,chorus=.8,src=("hollow",))
add(P_,"Glass Pad","Bright resonant slow pad",ch(saw=.5,sq=.3,lpf=.6,lpfq=.4,fenv=(.2,.7,.5,.7,.6),a=.5,d=.7,s=.85,r=.7),detune=.3)
add(P_,"Deep Space Drone","Vangelis style ambient drone",ch(saw=.7,feet=16,lpf=.3,lpfq=.3,a=.8,d=.8,s=.95,r=.9),lfo=(.15,"filter",.3),detune=.4,chorus=.9)
add(P_,"Breathing Pad (ring mod)","SOS: subtle ring mod makes the synth 'breathe'",ch(saw=.6,lpf=.45,a=.5,d=.7,s=.9,r=.7),ring=.25,src=("sos95",),conf="partially documented",note="Ring mod 'breathing' behaviour documented")
add(P_,"Choir Pad","Vocal-like pad",ch(saw=.4,sq=.4,sine=.3,lpf=.4,lpfq=.4,a=.45,d=.6,s=.9,r=.6),detune=.3)
add(P_,"Evolving PWM Pad","Slow PWM pad",ch(sq=.8,pwm=.7,lpf=.45,a=.5,d=.7,s=.9,r=.7),lfo=(.2,"pwm",.6),detune=.3,src=("hollow",))
add(P_,"Dark Atmosphere","Dark filtered pad",ch(saw=.6,lpf=.25,a=.7,d=.8,s=.9,r=.8),chorus=.7)
add(P_,"Sweeping Filter Pad","Dual filter band-pass sweep",ch(saw=.7,hpf=.3,lpf=.6,lpfq=.4,fenv=(.1,.9,.7,.8,.7),a=.5,d=.8,s=.8,r=.7),lfo=(.2,"filter",.4),src=("hollow",))
add(P_,"Ethereal Sine Pad","Sine-heavy pad",ch(sine=.8,saw=.2,lpf=.5,a=.6,d=.7,s=.9,r=.8),chorus=.8)
add(P_,"Tape Pad","Gently wobbling pad",ch(saw=.6,lpf=.4,a=.4,d=.6,s=.9,r=.6),lfo=(.25,"vibrato",.1),chorus=.6)
add(P_,"Aftertouch Choir Swell","Poly-aftertouch shaped pad",ch(saw=.5,sq=.4,lpf=.3,a=.35,d=.6,s=.9,r=.6),after=(.5,.9),src=("hollow","sos95"))
add(P_,"Warm Analog Wash","Wide soft wash",ch(saw=.5,sq=.2,sine=.3,lpf=.35,a=.6,d=.8,s=.9,r=.8),detune=.45,chorus=.9)
add(P_,"Jarre Atmosphere","Jean Michel Jarre style evolving pad (VintageSynth lists Jarre as user)",ch(saw=.6,lpf=.4,lpfq=.3,a=.5,d=.7,s=.9,r=.7),lfo=(.2,"filter",.3),src=("vs",))
add(P_,"Wakeman Atmosphere","Rick Wakeman era pad (listed user)",ch(saw=.6,sq=.2,lpf=.45,a=.4,d=.6,s=.9,r=.6),src=("vs",))
add(P_,"Tangerine Dream Haze","Hazy Schulze/Tangerine Dream style pad (listed users)",ch(saw=.6,lpf=.35,a=.6,d=.8,s=.9,r=.8),detune=.4,src=("reid",))
add(P_,"Heavenly Choir","High 4' pad",ch(saw=.4,sine=.4,feet=4,lpf=.5,a=.5,d=.7,s=.9,r=.7),chorus=.8)
Ld="Leads"
add(Ld,"Solo Lead","Solo lead",ch(saw=.7,sq=.3,lpf=.55,lpfq=.3,a=.03,d=.4,s=.85,r=.2),lfo=(.5,"vibrato",.2),src=("sos95",))
add(Ld,"Vangelis Expressive Lead","Vangelis improvised lead with poly aftertouch vibrato",ch(saw=.6,sq=.4,lpf=.5,lpfq=.25,a=.06,d=.4,s=.85,r=.3),lfo=(.5,"vibrato",.3),after=(.3,.7),src=("sos95","wiki"),conf="partially documented")
add(Ld,"Pitch-Bend Lead","Ribbon sweeps",ch(saw=.7,sq=.3,lpf=.6,a=.03,d=.3,s=.9,r=.2),pb=.5,src=("sos95",),conf="partially documented")
add(Ld,"Detuned Saw Lead","Detuned two layer lead",ch(saw=.8,lpf=.6,lpfq=.4,a=.02,d=.3,s=.9,r=.15),detune=.4)
add(Ld,"Reed Lead","Nasal reed",ch(sq=.7,pwm=.3,lpf=.45,lpfq=.5,a=.04,d=.3,s=.85,r=.15))
add(Ld,"Whistle Lead","Pure sine lead",ch(sine=.9,saw=.1,lpf=.7,a=.05,d=.3,s=.9,r=.3),lfo=(.5,"vibrato",.2))
add(Ld,"Tomita Lead","Isao Tomita (listed user) soaring lead",ch(saw=.6,sq=.3,lpf=.5,a=.1,d=.5,s=.85,r=.3),lfo=(.45,"vibrato",.25),src=("reid",))
add(Ld,"Pulse Lead","Thin PWM lead",ch(sq=.9,pwm=.6,lpf=.55,a=.03,d=.3,s=.85,r=.15),lfo=(.3,"pwm",.5))
add(Ld,"Harmonica Lead","Initial pitchbend twang",ch(sq=.6,saw=.2,lpf=.4,lpfq=.5,a=.03,d=.2,s=.8,r=.1),pb=.6,src=("sos95",),conf="partially documented")
add(Ld,"Wide Solo Saw","Fat unison-like lead",ch(saw=.9,lpf=.65,a=.02,d=.3,s=.9,r=.2),detune=.5)
K="Keys and Organs"
add(K,"Piano","Electric-piano style plucky tone",ch(sq=.5,saw=.2,sine=.3,lpf=.5,fenv=(.4,.6,.01,.4,.2),a=.01,d=.7,s=.2,r=.25),init=(.5,.5),src=("sos95",))
add(K,"Funky Clavinet","Clavi pluck",ch(saw=.5,sq=.4,hpf=.35,lpf=.6,lpfq=.3,fenv=(.4,.7,.01,.25,.1),a=.01,d=.3,s=.1,r=.1),init=(.6,.6),src=("sos95",))
add(K,"Harpsichord","SOS: Bass preset with Brilliance/Resonance becomes harpsichord",ch(saw=.7,sq=.3,hpf=.3,lpf=.7,lpfq=.4,fenv=(.5,.8,.01,.25,.1),a=.005,d=.35,s=.0,r=.1),src=("sos95",),conf="partially documented")
add(K,"Organ 8'","Drawbar-like organ",ch(sine=.7,sq=.4,lpf=.7,a=.005,d=.1,s=1.0,r=.05),trem=.3)
add(K,"Organ Full","Full drawbar organ",ch(sine=.6,sq=.5,saw=.2,lpf=.75,a=.005,d=.1,s=1.0,r=.05),ch(sine=.6,sq=.3,feet=4,a=.005,d=.1,s=1.0,r=.05),trem=.4,lfo=(.55,"tremolo",.3))
add(K,"Electric Piano Soft","Mellow EP",ch(sine=.6,sq=.3,lpf=.4,fenv=(.4,.5,.01,.5,.2),a=.01,d=.8,s=.15,r=.3),init=(.5,.4))
add(K,"Church Organ","Pipe organ stack",ch(sine=.6,sq=.4,lpf=.6,a=.02,d=.1,s=1.0,r=.15),ch(sine=.5,sq=.3,feet=4,lpf=.6,a=.02,d=.1,s=1.0,r=.15),chorus=.4)
add(K,"Vibraphone Keys","Mellow mallet keys",ch(sine=.8,lpf=.5,fenv=(.3,.5,.01,.5,.3),a=.005,d=.9,s=.0,r=.5),lfo=(.4,"tremolo",.3),trem=.4)
add(K,"Wonder Clav","Stevie Wonder funky clav style (GX-1/CS-80 user)",ch(saw=.5,sq=.5,hpf=.4,lpf=.65,lpfq=.35,fenv=(.45,.75,.01,.2,.1),a=.005,d=.25,s=.05,r=.08),init=(.6,.7),src=("reid",))
add(K,"Accordion","Reed ensemble",ch(sq=.6,pwm=.3,sine=.2,lpf=.5,a=.03,d=.2,s=.9,r=.1),ch(sq=.6,pwm=.3,feet=4,lpf=.5,a=.03,d=.2,s=.9,r=.1),detune=.2)
add(K,"Winwood Flute Keys","Steve Winwood Flute patch (SOS)",ch(sine=.5,sq=.4,noise=.05,lpf=.5,a=.06,d=.3,s=.8,r=.2),src=("sos95",),conf="partially documented")
add(K,"Honky Clav Bright","Bright percussive clavinet",ch(saw=.6,sq=.3,hpf=.4,lpf=.75,fenv=(.5,.8,.01,.15,.05),a=.003,d=.2,s=.0,r=.05))
Bs="Bass"
add(Bs,"Bass (factory)","SOS: chunky 'Bass' preset",ch(saw=.6,sq=.4,sine=.4,feet=16,lpf=.35,lpfq=.2,fenv=(.4,.5,.01,.3,.1),a=.005,d=.3,s=.7,r=.1),src=("sos95",),conf="partially documented")
add(Bs,"Sub Bass","Sine/square sub",ch(sine=.9,sq=.3,feet=16,lpf=.25,a=.005,d=.2,s=.9,r=.1))
add(Bs,"Pluck Bass","Short pluck",ch(saw=.7,feet=16,lpf=.4,fenv=(.5,.7,.005,.2,.05),a=.003,d=.25,s=.2,r=.08))
add(Bs,"Resonant Bass","Resonant sweep bass",ch(saw=.7,feet=16,lpf=.35,lpfq=.5,fenv=(.4,.8,.01,.3,.1),a=.005,d=.3,s=.6,r=.1))
add(Bs,"Fat Bass 16/8","Two-layer fat bass",ch(saw=.7,feet=16,lpf=.4,a=.005,d=.3,s=.8,r=.1),ch(saw=.5,sq=.4,feet=8,lpf=.4,a=.005,d=.3,s=.8,r=.1),detune=.2)
add(Bs,"Pedal Drone Bass","Sustained pedal tone",ch(saw=.6,sine=.4,feet=16,lpf=.3,a=.1,d=.5,s=1.0,r=.4))
add(Bs,"Rubber Bass","Rubbery low squelch",ch(sq=.7,feet=16,lpf=.3,lpfq=.45,fenv=(.4,.6,.01,.25,.1),a=.004,d=.2,s=.5,r=.08))
add(Bs,"Growl Bass","Gritty bass with noise",ch(saw=.8,noise=.1,feet=16,lpf=.45,lpfq=.4,a=.005,d=.3,s=.7,r=.1))
Bl="Bells and Plucks"
add(Bl,"Ring Bell","Ring mod metallic bell",ch(sine=.8,lpf=.7,fenv=(.4,.5,.01,.5,.3),a=.003,d=.9,s=.0,r=.6),ring=.7,src=("sos95",),conf="partially documented")
add(Bl,"Glass Pluck","Glassy pluck",ch(sq=.5,sine=.4,feet=4,lpf=.7,fenv=(.5,.8,.01,.3,.1),a=.003,d=.5,s=.0,r=.3))
add(Bl,"Marimba","Wooden mallet",ch(sine=.8,sq=.2,lpf=.5,fenv=(.4,.6,.01,.2,.1),a=.003,d=.35,s=.0,r=.2))
add(Bl,"Blade Runner Metal Harp","Metallic harp (Blade Runner texture)",ch(saw=.4,sq=.4,feet=4,lpf=.7,fenv=(.4,.8,.01,.4,.2),a=.003,d=.8,s=.0,r=.5),ring=.3,chorus=.5,src=("syn",),conf="partially documented",note="Synthtopia mentions a metallic harp in Blade Runner covers; CS-80 origin of the original part unconfirmed")
add(Bl,"Music Box","High 4' bell tone",ch(sine=.8,sq=.1,feet=4,lpf=.7,a=.002,d=.7,s=.0,r=.4))
add(Bl,"Harp","Plucked harp",ch(saw=.4,sine=.4,lpf=.55,fenv=(.4,.6,.01,.4,.1),a=.003,d=.6,s=.0,r=.35))
add(Bl,"Kalimba","Short thumb piano",ch(sine=.7,sq=.3,feet=4,lpf=.5,a=.003,d=.3,s=.0,r=.2))
add(Bl,"Chime Cascade","Ring mod chimes",ch(sine=.7,lpf=.8,a=.002,d=1.0,s=.0,r=.7),ring=.5,chorus=.5)
add(Bl,"Steel Drum","Pitched metallic",ch(sine=.6,sq=.4,lpf=.6,a=.002,d=.5,s=.0,r=.3),ring=.35)
add(Bl,"Pizz Pluck","Short pluck",ch(saw=.6,lpf=.5,fenv=(.4,.7,.005,.2,.05),a=.003,d=.25,s=.0,r=.1))
F="FX and Soundtrack"
add(F,"Doctor Who Ring Scream","SOS: ring mod scream with Attack/Decay/Depth fully employed (recreation target)",ch(saw=.5,sine=.4,lpf=.7,a=.02,d=.6,s=.7,r=.5),ring=.9,src=("sos95",),conf="partially documented")
add(F,"Wind Noise Sweep","Noise sweep",ch(noise=.8,hpf=.3,lpf=.6,lpfq=.4,fenv=(.1,.9,.7,.8,.8),a=.6,d=.8,s=.7,r=.8),src=("hollow",))
add(F,"Blade Runner Rocket Noise","Rocket/engine noise texture",ch(noise=.9,lpf=.35,lpfq=.3,a=.4,d=.8,s=.9,r=.8),lfo=(.1,"filter",.4),src=("syn",),conf="partially documented",note="Synthtopia notes rocket noise made with separate noise source in a cover; not confirmed CS-80")
add(F,"Ribbon Sci-Fi Dive","Pitch dive via ribbon",ch(saw=.7,lpf=.5,a=.03,d=.5,s=.8,r=.5),pb=.7,src=("sos95",),conf="partially documented")
add(F,"Ring Mod Siren","Modulating siren",ch(saw=.6,lpf=.7,a=.05,d=.5,s=.9,r=.3),ring=.8,lfo=(.4,"ring",.6))
add(F,"Tension Drone","Dark swelling drone",ch(saw=.6,sq=.3,feet=16,lpf=.25,lpfq=.4,a=.8,d=.8,s=.9,r=.9),ring=.2)
add(F,"Cinematic Impact","Low hit",ch(saw=.7,noise=.2,feet=16,lpf=.4,fenv=(.6,.5,.01,.7,.6),a=.003,d=.9,s=.0,r=.8),chorus=.5)
add(F,"Mutiny on the Bounty Pad","Vangelis, Mutiny on the Bounty (VintageSynth cites CS-80)",ch(saw=.6,lpf=.45,a=.4,d=.7,s=.9,r=.6),detune=.3,src=("vs",))
add(F,"Opera Sauvage Texture","Vangelis, Opera Sauvage",ch(saw=.6,sq=.3,lpf=.4,a=.5,d=.7,s=.9,r=.7),src=("wiki",))
add(F,"Spiral Arpeggio Tone","Vangelis, Spiral (1977), first CS-80 album",ch(sq=.6,saw=.3,lpf=.5,a=.01,d=.3,s=.6,r=.2),src=("wiki",))
add(F,"China Texture","Vangelis, China (1979)",ch(saw=.6,sq=.3,lpf=.45,a=.3,d=.6,s=.85,r=.5),src=("wiki",))
add(F,"Jon and Vangelis Pad","Jon and Vangelis albums",ch(saw=.6,lpf=.45,a=.4,d=.6,s=.9,r=.6),detune=.3,src=("wiki",))
add(F,"Space Whoosh","Filter/noise whoosh",ch(noise=.6,saw=.2,lpf=.5,fenv=(.05,.95,.6,.7,.5),a=.3,d=.6,s=.3,r=.6))
add(F,"Telephone Ring","Ring mod trill",ch(sq=.7,lpf=.8,a=.002,d=.1,s=.9,r=.05),ring=.6,trem=.3)
bank_order=["Brass","Strings","Pads and Atmospheres","Leads","Keys and Organs","Bass","Bells and Plucks","FX and Soundtrack"]
cnt={}
for p in L: cnt[p["bank"]]=cnt.get(p["bank"],0)+1; p["slot"]=cnt[p["bank"]]
L.sort(key=lambda p:(bank_order.index(p["bank"]),p["slot"]))
json.dump(L,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"presets.json"),"w"),indent=1,ensure_ascii=False)
md=["# CS-80 preset library","","Bank layout. Confidence: documented = numeric panel data from a cited source; partially documented = name, character or behaviour documented, numbers estimated; inferred = estimated by ear and architecture.","","| Bank | Slot | Name | Reference | Confidence |","|---|---|---|---|---|"]
for p in L: md.append(f"| {p['bank']} | {p['slot']} | {p['name']} | {p['reference']} | {p['confidence']} |")
md+=["","## Sources and gaps","","Sources fetched: Wikipedia CS-80, Gordon Reid CS-80 page, SOS July 1995 CS80 review, Hollow Sun CS-80 page, VintageSynth Explorer, Synthtopia Blade Runner brass article, Reverb Machine Tears in Rain article, Syntorial Blade Runner brass recipe, Arturia Vangelis Tribute page (name only). Source URLs per preset are in presets.json.","","Gaps:","","- No source reachable in this run gave numeric panel settings (slider positions) for any preset. web_search was largely unavailable, and manualslib, cs80.com setting sheets and scans were not reached. Documented material covers architecture, behaviour and preset names (Brass 1, Brass 2, Flute, Bass, Strings per SOS 1995).","- The full list of the 22 factory preset names was not found; only the few names cited are labelled factory. The rest are original recreation targets named after recordings or sound families.","- The count of fully documented entries is zero; partially documented entries have qualitative documentation only. All numbers are normalized 0..1 estimates, not measurements.","- Attributions to verify: Africa (Toto) brass, Dune, Mutiny on the Bounty, Doctor Who ring mod scream and the Blade Runner harp and rocket noise come from the cited pages and are not confirmed as CS-80 parts. Wonderful Christmastime is not included (Prophet).","- Arturia and GForce preset data was not copied; only the Vangelis Tribute page's existence was used as inspiration.","- Next step: obtain the Yamaha CS-80 owner's manual and setting-sheet scans to fill the 22 factory voices and Vangelis charts."]
open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"PRESETS.md"),"w").write("\n".join(md)+"\n")
from collections import Counter
print(len(L),Counter(p["bank"] for p in L),Counter(p["confidence"] for p in L))
