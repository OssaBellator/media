import { createMotionBlurSamples } from './motion-sampling.js';

const PHASES=new Set(['centered','leading','trailing']);
const WEIGHT_CURVES=new Set(['box','triangle','cosine']);
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}

export function normalizeMotionBlurPolicy(value={}){
  const enabled=value?.enabled===true;
  const shutterAngle=clamp(value?.shutterAngle??180,0,360);
  const phase=PHASES.has(value?.phase)?value.phase:'centered';
  const weightCurve=WEIGHT_CURVES.has(value?.weightCurve)?value.weightCurve:'box';
  return{enabled,shutterAngle,phase,weightCurve};
}

export function motionBlurPolicyFromComposition(composition){
  const props=composition?.props??{};
  return normalizeMotionBlurPolicy({
    enabled:props.motionBlurEnabled===true,
    shutterAngle:props.shutterAngle??180,
    phase:props.shutterPhase??'centered',
    weightCurve:props.motionBlurWeightCurve??'box',
  });
}

export function vectorSupersampleForFidelity(fidelity){
  return Math.max(1,Math.min(4,Math.round(Number(fidelity?.vectorSupersample)||1)));
}

export function temporalSamplesForFidelity(plan,fidelity={}){
  const policy=normalizeMotionBlurPolicy(plan?.motionBlur);
  const time=Number(plan?.time)||0;
  const requested=Math.max(1,Math.round(Number(fidelity?.temporalSamples)||1));
  if(!policy.enabled||policy.shutterAngle<=0||requested<=1)return[{index:0,alpha:.5,time,weight:1}];
  const fps=Math.max(.001,Number(fidelity?.fps??plan?.fps)||30);
  return createMotionBlurSamples({time,fps,shutterAngle:policy.shutterAngle,samples:requested,phase:policy.phase,weightCurve:policy.weightCurve});
}

export function shouldTemporalAccumulate(plan,fidelity={}){
  return temporalSamplesForFidelity(plan,fidelity).length>1;
}

export function fidelityRenderHints(plan,fidelity={}){
  const temporalSamples=temporalSamplesForFidelity(plan,fidelity);
  return{
    mode:fidelity?.mode??'playback',
    resolutionScale:Number(fidelity?.resolutionScale??1),
    vectorSupersample:vectorSupersampleForFidelity(fidelity),
    temporalSamples,
    temporal:temporalSamples.length>1,
  };
}
