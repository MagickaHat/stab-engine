# Regenerates sample.rxdata (a tiny PkmnAnimations.rxdata) for animations.test.ts:
#   ruby tools/animations/fixtures/make-sample.rb > tools/animations/fixtures/sample.rxdata
# The classes below only mirror the fields Essentials saves.
class Color
  def initialize(r,g,b,a); @c=[r,g,b,a]; end
  def _dump(_) @c.pack('D4') end
end
class PBAnimTiming
  attr_accessor :frame,:timingType,:name,:volume,:pitch,:bgX,:bgY,:opacity,:colorRed,:colorGreen,:colorBlue,:colorAlpha,:duration,:flashScope,:flashColor,:flashDuration
end
class PBAnimation < Array
  attr_accessor :id,:name,:graphic,:hue,:position,:array,:timing,:scope
end
class PBAnimations < Array
  attr_accessor :array, :selected
end
def cel(x,y,pattern,focus,extra={})
  c=[x,y,100,0,0,0,1,pattern,255,nil,nil,100,0,0,0,0,0,0,0,0,0,0,0,0,0,1,focus]
  extra.each{|k,v| c[k]=v}; c
end
a=PBAnimation.new; a.id=-1; a.name="Move:KING'SSHIELD"; a.graphic="PRAS- Strike.png"; a.hue=20; a.position=3; a.scope=0
a.array=[[cel(128,224,-1,2), cel(384,96,-2,1)], [cel(128,224,-1,2), cel(384,96,-2,1), cel(300,-20,4,3,{2=>150,3=>45,5=>1,8=>128,12=>255,15=>100,20=>1,25=>2}), nil, nil]]
t=PBAnimTiming.new; t.frame=1; t.timingType=0; t.name="Hit Sound"; t.volume=80; t.pitch=100; t.flashScope=0; t.flashColor=Color.new(255,255,255,255); t.flashDuration=5
b=PBAnimTiming.new; b.frame=0; b.timingType=1; b.name="Black BG"; b.bgX=10; b.bgY=nil; b.opacity=0; b.colorRed=nil; b.colorGreen=nil; b.colorBlue=nil; b.colorAlpha=nil; b.duration=5; b.flashScope=0; b.flashColor=Color.new(255,255,255,255)
m=PBAnimTiming.new; m.frame=2; m.timingType=2; m.name=""; m.bgX=nil; m.bgY=nil; m.opacity=255; m.colorRed=0; m.colorGreen=nil; m.colorBlue=nil; m.colorAlpha=nil; m.duration=8; m.flashScope=0; m.flashColor=Color.new(255,255,255,255)
a.timing=[t,b,m]
d=PBAnimation.new; d.name="~ Gen 1 Moves ~"; d.array=[[]]; d.timing=[]; d.graphic=""; d.hue=0; d.position=4; d.id=-1; d.scope=0
c=PBAnimation.new; c.name="Common:Burn"; c.array=[[cel(128,224,-1,2)]]; c.timing=[]; c.graphic=""; c.hue=0; c.position=4; c.id=-1; c.scope=0
all=PBAnimations.new; all.array=[d,a,c,a]; all.selected=1
data=Marshal.dump(all)
STDOUT.binmode
print data
