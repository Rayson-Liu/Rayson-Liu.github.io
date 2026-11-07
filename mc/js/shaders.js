'use strict';
// ---------------------------------------------------------------------------
// Built-in shader pack ("光影"): 关 / 低 / 中 / 高 / 极限
// Modelled on the look of Complementary Reimagined (own code, matched against its default settings):
// - albedo stays in display space and the lights mix in a squared space (sqrt at the end): warm sun, blue-ish
//   sky fill, side shading, a soft vanilla-AO curve, warm block light that fades under daylight
// - sun highlights per block type (stone, metals, gems, sand, snow, leaves ...) and a little sky reflection
// - its own sky (zenith / horizon / ground bands, sunset band, glare), round sun, rainbows after rain,
//   atmospheric / border / cave fog
// - soft billowing "unbound" clouds, light shafts, stylised water (vanilla texture, depth tint, foam, reflections)
// - entity shadows (a shadow map layer of the entities around the camera, the player included)
// - bloom over the whole image, Lottes tone mapping, saturation, TAA, sharpening
// With shaders on, the world renders into an HDR target; the sky, fog, clouds and light shafts are added in post.
// ---------------------------------------------------------------------------
const FX_NAMES = ['关', '低', '中', '高', '极限'];
const FX_CFG = [
  null,
  // shadow: the size of each of the 3 shadow cascades; casc: their half widths in blocks
  // taps: shadow filter samples (TAA averages them over frames); vl: light shaft samples (0 = off)
  // low: no shadow map (sky light decides the shade), clouds, FXAA
  { shadow: 0, casc: null, taps: 0, vl: 0, ssr: 0, taa: 0, clouds: 1 },
  // medium: shadows, TAA
  { shadow: 1024, casc: [16, 44, 110], taps: 3, vl: 0, ssr: 0, taa: 1, clouds: 1 },
  // high (the reference look): + light shafts, screen-space water reflections
  { shadow: 2048, casc: [20, 56, 150], taps: 4, vl: 10, ssr: 1, taa: 1, clouds: 1 },
  // ultra: more shadow and light shaft samples
  { shadow: 2048, casc: [20, 56, 150], taps: 8, vl: 16, ssr: 1, taa: 1, clouds: 1 },
];

// material ids per texture layer (red channel of the material texture)
const MAT_LEAVES = 1, MAT_PLANT = 2, MAT_WATER = 3, MAT_EMIT = 4, MAT_LAVA = 5;
// surface classes (green channel): how smooth / shiny the block is, worked out from its texels
const PBR_STONE = 1, PBR_ROUGH = 2, PBR_POLISHED = 3, PBR_METAL = 4, PBR_GEM = 5, PBR_ORE = 6, PBR_SAND = 7,
  PBR_DIRT = 8, PBR_GRASS = 9, PBR_SNOW = 10, PBR_ICE = 11, PBR_WOOD = 12, PBR_OBSIDIAN = 13, PBR_CONCRETE = 14,
  PBR_NETHERRACK = 15;

// the sky: up / middle / down colours mixed by the view's height, a warm band at the horizon around sunset,
// the ground colour below, glare around the sun (the moon at night). Display-space values
const FX_SKY = `
uniform vec3 u_skyUp, u_skyUpMoon, u_skyMid, u_skyMidSun, u_skyDown, u_skyBand, u_glareCol, u_sunVec;
uniform vec4 u_skyK; // band strength, rain^2, night glow (nightFactorM), sun visibility
float pow2f(float x){ return x * x; }
float sstep1(float x){ return x * x * (3.0 - 2.0 * x); }
vec3 fxSky(vec3 d, bool glare, bool ground){
  float VdotU = d.y, VdotS = dot(d, u_sunVec), nfM = u_skyK.z;
  float s1 = pow2f(max(VdotS, 0.0)), s2 = s1 * s1, s3 = pow2f(pow2f(max(-VdotS, 0.0)));
  float up0 = max(VdotU, 0.0);
  vec3 upC = u_skyUp + u_skyUpMoon * s3;
  vec3 midC = u_skyMid + u_skyMidSun * s2;
  float m1 = pow(pow2f(1.0 - up0), 1.0 - s2 * 0.4);
  m1 = mix(m1, 1.0, u_skyK.y * 0.15);
  vec3 c = mix(upC, midC, m1);
  float m2 = pow2f(1.0 - abs(VdotU)); m2 = m2 * m2 * (3.0 - 2.0 * m2);
  m2 *= (0.7 - nfM + s1 * (0.3 + nfM)) * u_skyK.x;
  c = mix(c, u_skyBand * (1.0 + s1 * 0.3), m2);
  float m3 = sstep1(min(max(-VdotU + 0.08, 0.0) / 0.35, 1.0));
  vec3 gm = mix(vec3(m3), vec3(m3 * m3, sqrt(m3), pow(m3, 1.0 / 3.0)), 0.75 - 0.5 * sqrt(u_skyK.y));
  c = mix(c, u_skyDown, gm);
  if (ground) c *= sstep1(pow2f(1.0 + min(VdotU, 0.0)));
  if (glare) {
    float vs = u_skyK.w > 0.5 ? VdotS : -VdotS;
    if (vs > 0.0) {
      float v4 = pow(vs, 3.0);
      c += u_glareCol * (0.075 / (1.0 - 0.925 * v4) - 0.075) * 0.7;
    }
  }
  return c;
}
`;

const FX_COMMON = `
uniform vec3 u_sunDir; // towards the light (sun by day, moon by night)
uniform vec3 u_lightCol; uniform vec3 u_ambCol; uniform vec3 u_hlCol; uniform vec3 u_blkCol;
uniform vec4 u_tf;  // noon factor, sun visibility^2, rain, shadow time (the light fading out around sunrise / sunset)
uniform vec4 u_tf2; // screen brightness setting, night vision, (1 - noon)^2, dimension (0 overworld, 1 nether, 2 end)
uniform float u_eyeWater; uniform float u_frame;
uniform highp sampler2DArrayShadow u_shadow; uniform mat4 u_shadowVP[4];
uniform int u_shadowOn; uniform int u_taps; uniform float u_shadowSize; uniform float u_shadowTexelW[4]; uniform float u_shadowRange[4];
uniform int u_entShadow; // layer 3: the entities around the camera, redrawn every frame
uniform vec3 u_fxCam;
const vec2 POISSON[8] = vec2[8](vec2(-0.613392, 0.617481), vec2(0.170019, -0.040254), vec2(-0.299417, 0.791925), vec2(0.645680, 0.493210),
  vec2(-0.651784, 0.717887), vec2(0.421003, 0.027070), vec2(-0.817194, -0.271096), vec2(0.977050, -0.108615));
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float lum(vec3 c){ return dot(c, vec3(0.2125, 0.7154, 0.0721)); }
float pow1_5(float x){ return x - x * (1.0 - x) * (1.0 - x); }
// one cascade, a soft edge of a few texels; the rotation changes every frame so TAA smooths the taps
float cascadeShadow(int i, vec3 s, float tw, float range, mat2 R){
  float texel = 1.0 / u_shadowSize, layer = float(i), bias = tw * 1.5 / range;
  if (u_taps <= 1) return texture(u_shadow, vec4(s.xy, layer, s.z - bias));
  float rad = max(1.0, 0.07 / tw), sum = 0.0;
  for (int k = 0; k < 8; k++) { if (k >= u_taps) break; sum += texture(u_shadow, vec4(s.xy + R * POISSON[k] * texel * rad, layer, s.z - bias)); }
  return sum / float(u_taps);
}
// the light reaching wp: the finest terrain cascade that holds it (outside them all the caller's sky light, faded
// towards that at the edge of the last one), and the shadows of the entities near the camera
float shadowAt(vec3 wp, vec3 n, float skyFallback){
  float ndl = dot(n, u_sunDir), ang = (ign(gl_FragCoord.xy) + u_frame * 0.618034) * 6.2831;
  mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  float v = skyFallback;
  for (int i = 0; i < 3; i++) {
    float tw = u_shadowTexelW[i];
    vec4 sp = u_shadowVP[i] * vec4(wp + n * tw * (1.2 + 1.8 * (1.0 - abs(ndl))), 1.0);
    vec3 s = sp.xyz / sp.w * 0.5 + 0.5;
    vec2 e = abs(s.xy - 0.5) * 2.0;
    if (max(e.x, e.y) > 0.97 || s.z > 1.0) continue;
    v = cascadeShadow(i, s, tw, u_shadowRange[i], R);
    if (i == 2) v = mix(v, skyFallback, smoothstep(0.8, 0.97, max(e.x, e.y)));
    break;
  }
  if (u_entShadow == 1 && v > 0.0) {
    float tw = u_shadowTexelW[3];
    vec4 sp = u_shadowVP[3] * vec4(wp + n * tw * (1.5 + 1.5 * (1.0 - abs(ndl))), 1.0);
    vec3 s = sp.xyz / sp.w * 0.5 + 0.5;
    vec2 e = abs(s.xy - 0.5) * 2.0;
    if (max(e.x, e.y) < 0.98 && s.z <= 1.0) v = min(v, mix(cascadeShadow(3, s, tw, u_shadowRange[3], R), 1.0, smoothstep(0.85, 0.98, max(e.x, e.y))));
  }
  return v;
}
float ggx(vec3 n, vec3 V, vec3 L, float smoothG){
  float sm = smoothG * 0.9 + 0.1; sm = sm * (2.0 - sm);
  float rp = 1.35 - sm, rough = rp * rp * rp * rp;
  vec3 h = normalize(L + V);
  float nh = max(dot(n, h), 0.0), lh = max(dot(L, h), 0.0), nl = max(dot(n, L), 0.0);
  float den = nh * nh * (rough - 1.0) + 1.0;
  float D = rough / (3.14159265 * den * den);
  float F = exp2((-5.55473 * lh - 6.98316) * lh) * 0.95 + 0.05;
  float nlm = 1.0 - pow(max(1.0 - nl, 0.0), 8.0); // (nl can round past 1: pow of a negative is NaN on many GPUs)
  float sp = max(nlm * D * F / max(lh * lh, 0.01), 0.0);
  return sp / (0.125 * sp + 1.0);
}
// alb: display-space albedo; lm: (sky, block) light 0..1; vao: vanilla AO (1 = open); sub: 0 solid, 1 plant, 2 leaves.
// Returns the lit colour (display space, can go above 1)
vec3 fxShade(vec3 alb, vec3 n, vec3 wp, vec3 V, vec2 lm0, float vao, int sub, float smoothG, float hlMult, float emission, bool noDir){
  vec2 lm = clamp(lm0.yx * 0.94 + 0.03, 0.0, 1.0); // (block, sky)
  int dim = int(u_tf2.w + 0.5);
  bool ow = dim == 0;
  float vsB = u_tf2.x, noon = u_tf.x, sunVis2 = u_tf.y, rain = u_tf.z;
  float NdotU = n.y, NdotL = dot(n, u_sunDir);
  float lmY2 = lm.y * lm.y, lmYM = sstep1(lm.y);
  float aE = abs(n.x), aN = abs(n.z), aE2 = aE * aE;
  vec3 lightC = u_lightCol, ambC = u_ambCol;
  float skyLSM = ow ? lmY2 * lmY2 * lmY2 * lmY2 : 1.0;
  float NdotLM = sub != 0 ? 1.0 : max(NdotL + 0.4, 0.0) * 0.714;
  float shadow = 0.0, subHL = 0.0;
  if (NdotLM > 0.0001 && u_tf.w > 0.0001 && dim != 1) {
    float sm = skyLSM;
    if (u_shadowOn == 1) sm = shadowAt(wp, sub != 0 ? u_sunDir : n, skyLSM) * min(lm.y * 10.0 - 0.3, 1.0);
    if (sub != 0) subHL = pow(max(dot(-V, u_sunDir), 0.0), 10.0) * (sub == 1 ? 0.8 : 0.6) * float(u_eyeWater < 0.5);
    shadow = max(sm, 0.0) * NdotLM * u_tf.w;
  }
  float shF = min(shadow, 1.0);
  // block light: a steep part near the source and a calm one further out, warm
  float lx = lm.x;
  float lxM = pow(lx * lx * lx * lx * lx * lx * lx * lx * (3.8 - 0.6 * vsB) + lx * (1.8 + 0.6 * vsB), 2.25);
  vec3 blockL = lxM * u_blkCol;
  emission *= 1.0 - 0.25 * lmYM * (1.0 - rain) * sqrt(sunVis2);
  vec3 minL = vec3(0.005625 + vsB * 0.043) * vec3(0.45, 0.475, 0.6) * (1.0 - lmYM) + u_tf2.y * vec3(0.5, 0.5, 0.75);
  if (!ow) minL = u_tf2.y * vec3(0.5, 0.5, 0.75);
  float ambMult = ow ? mix(lmYM, lmYM * lmYM * lmYM, rain) : 1.0;
  if (ow && u_eyeWater < 0.5) {
    // under daylight the block light counts for less; at night things close by are a little brighter
    float lxF = (sunVis2 * 0.4 + (0.6 - 0.6 * u_tf2.z)) * (6.0 - 5.0 * rain);
    lxF *= lmY2 + lmY2 * 2.0 * shF * shF;
    lxF = emission > 0.0 ? 0.0 : lxF;
    blockL *= pow(lxM / 60.0 + 0.001, 0.09 * lxF);
    float rainLF = 0.1 * rain, dist = distance(wp, u_fxCam);
    float lft = 1.0 + max(96.0 - dist, 0.0) * (0.002 * (1.0 - sunVis2) + 0.0104 * rainLF) - rainLF;
    ambMult *= lft; lightC *= lft;
  }
  float dirShade = 1.0;
  if (!noDir) {
    float NdotUM = dim == 1 ? 0.75 + abs(NdotU + 0.5) * 0.16666 : 0.75 + NdotU * 0.25;
    dirShade = NdotUM * (1.0 - 0.1 * aE2) * (1.0 + 0.075 * aN);
    if (ow) {
      // the sun crosses east to west: the east / west faces catch more of it, north / south a little of the sky
      lightC *= 1.0 + aE2 * 0.75;
      ambC = mix(ambC, lightC, (0.05 + 0.03 * float(sub)) * aN * lmY2);
      lightC *= 1.0 + max(1.0 - float(sub), 0.0) * pow(noon, 20.0) * (aN * aN * 0.8 - aE2 * 0.2);
    } else if (dim == 1) {
      dirShade *= dirShade;
      ambC += vec3(0.15, 0.06, 0.01) * pow2f(aN * 0.5 + max(-NdotU, 0.0)) * (0.7 + 0.35 * vsB);
    }
  }
  vec3 scene = lightC * shadow + ambC * ambMult;
  float ao = vao;
  if (sub != 0) ao = mix(min(ao * 1.15, 1.0), 1.0, shF);
  else {
    ao = min(ao + 0.08, 1.0);
    if (ow) ao = pow(pow1_5(ao), 1.0 + dot(scene, scene) * 0.02 + max(NdotU, 0.0) * (0.15 + 0.25 * pow2f(noon * lmY2 * lmY2)));
    else if (dim == 1) ao = pow(pow1_5(ao), 1.0 + max(NdotU, 0.0) * 0.5);
    else ao = pow(ao, 0.75 + max(NdotU, 0.0) * 0.25);
    ao = ao * 0.9 + 0.1;
  }
  vec3 hl = vec3(0.0);
  if (dim != 1 && shadow > 0.0) {
    float spec = ggx(n, V, u_sunDir, smoothG) * hlMult;
    hl = vec3(u_eyeWater < 0.5 ? shadow : pow(shadow, 0.25) * 0.35) * (subHL + spec) * u_hlCol;
  }
  vec3 fd = pow2f(dirShade * ao) * (blockL + scene * scene + minL) + emission * emission;
  return alb * sqrt(max(fd, vec3(0.0))) + hl;
}
`;

// smoothness / highlight / reflection per surface class, worked out from the texel colour c (display space)
const FX_MATERIAL = `
void fxMaterial(int cls, inout vec3 c, out float sG, out float hl, out float sD, out float metal){
  sG = 0.0; hl = 1.0; sD = 0.0; metal = 0.0;
  float l = lum(c), g4 = c.g * c.g * c.g * c.g, mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  if (cls == ${PBR_STONE}) { sG = min(g4 * 2.0, 1.0); sD = sG; }
  else if (cls == ${PBR_ROUGH}) { sG = min(l * l * l * l * 1.1, 1.0) * 0.75; sD = sG; }
  else if (cls == ${PBR_POLISHED}) { sG = 0.1 + l * 0.4; sD = sG; hl = 1.5; }
  else if (cls == ${PBR_METAL}) { float r4 = l * l * l * l; sG = min(r4 * 0.8 + 0.25, 1.0); hl = sG * 3.0; sD = sG; metal = 1.0; c *= 0.6 + 0.5 * l; }
  else if (cls == ${PBR_GEM}) { float f = max(c.g, 0.8); sG = f - g4 * 0.4; hl = 3.0 * max(f * f * f * f, 0.2); sD = f * f * 0.6; metal = 0.5; c *= 0.7 + 0.4 * l; }
  else if (cls == ${PBR_ORE}) {
    if (mx - mn > 0.18 || mx > 0.85) { sG = 0.85; hl = 2.5; sD = 0.5; metal = 0.5; }
    else { sG = min(g4 * 2.0, 1.0); sD = sG; }
  }
  else if (cls == ${PBR_SAND}) { sG = min(pow(c.g, 16.0) * 2.0, 1.0); sD = sG; hl = 2.0; }
  else if (cls == ${PBR_DIRT}) { sG = c.r * 0.1 + 0.1; }
  else if (cls == ${PBR_GRASS}) { sG = c.g * c.g; }
  else if (cls == ${PBR_SNOW}) { sG = (1.0 - pow(c.g, 64.0) * 0.3) * 0.4; sD = sG; hl = 2.0; }
  else if (cls == ${PBR_ICE}) { sG = 0.85; sD = 0.65; hl = 2.0; }
  else if (cls == ${PBR_WOOD}) { sG = l * l * 0.45; sD = sG * 0.4; }
  else if (cls == ${PBR_OBSIDIAN}) { float f = max(0.3 - abs(c.r - 0.3), 0.0) * 1.5; sG = min(f, 1.0); hl = 2.0 + min(f * 2.0, 1.0) * 1.5; sD = min(f + 0.07, 1.0); metal = 0.5; }
  else if (cls == ${PBR_CONCRETE}) { sG = 0.3; sD = 0.15; }
  else if (cls == ${PBR_NETHERRACK}) { sG = c.r * 0.2; }
}
`;

const FXCHUNK_VS = `#version 300 es
layout(location=0) in vec4 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in uvec2 a_tex;
layout(location=3) in vec4 a_col;
layout(location=4) in vec2 a_light;
layout(location=5) in uint a_anim;
uniform mat4 u_vp; uniform mat4 u_model; uniform int u_sec;
uniform vec3 u_cam; uniform float u_tick; uniform vec3 u_lightOv; uniform float u_time; uniform float u_wave;
invariant gl_Position; // the depth pre-pass runs this same vertex shader and must land on the same depths
uniform highp sampler2D u_mat;
out vec2 v_uv; flat out uint v_layer; flat out uint v_overlay; out vec4 v_col; out vec2 v_light; out float v_dist;
out vec3 v_wpos; flat out int v_mat; flat out int v_cls;
void main(){
  vec4 wp = u_model * vec4(a_pos.xyz,1.0);
  vec4 mt = texelFetch(u_mat, ivec2(int(a_tex.x) & 1023, int(a_tex.x) >> 10), 0);
  int mat = int(mt.r * 255.0 + 0.5);
  if (u_wave > 0.0) {
    float t = u_time * 0.001;
    if (mat == ${MAT_LEAVES}) {
      wp.x += sin(t * 1.6 + wp.z * 0.7 + wp.y * 0.4) * 0.035;
      wp.z += cos(t * 1.25 + wp.x * 0.6 + wp.y * 0.3) * 0.035;
      wp.y += sin(t * 2.1 + wp.x * 0.9 + wp.z * 0.8) * 0.018;
    } else if (mat == ${MAT_PLANT} && a_uv.y < 0.1) {
      float s = sin(t * 1.9 + wp.x * 0.55 + wp.z * 0.45) * 0.09 + sin(t * 3.7 + wp.x * 1.3) * 0.03;
      wp.x += s; wp.z += cos(t * 1.6 + wp.z * 0.5 + wp.x * 0.35) * 0.06;
    } else if (mat == ${MAT_WATER} && fract(wp.y) > 0.5) {
      wp.y += (sin(t * 1.4 + wp.x * 0.85 + wp.z * 0.3) + cos(t * 1.1 + wp.z * 0.75 - wp.x * 0.2)) * 0.022 - 0.045;
    }
  }
  gl_Position = u_vp * wp;
  v_uv = a_uv;
  uint layer = a_tex.x;
  uint anim = u_sec == 1 ? uint(a_pos.w * 65535.0 + 0.5) : a_anim;
  if (anim > 0u) layer += uint(floor(u_tick / 2.0)) % anim;
  v_layer = layer; v_overlay = a_tex.y;
  v_col = a_col;
  v_light = u_lightOv.z > 0.5 ? u_lightOv.xy : a_light;
  v_dist = length(wp.xz - u_cam.xz);
  float dy = abs(wp.y - u_cam.y); v_dist = max(v_dist, dy * 0.5);
  v_wpos = wp.xyz; v_mat = mat; v_cls = int(mt.g * 255.0 + 0.5);
}`;

// depth pre-pass for the shaded terrain: with leaves layered over each other the full lighting shader ran
// several times a pixel; after this pass it runs once, for the front surface only
const FXDEPTH_FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray u_tex; uniform float u_alphaTest;
in vec2 v_uv; flat in uint v_layer; flat in uint v_overlay;
out vec4 o;
void main(){ if (v_overlay < 0x8000u && texture(u_tex, vec3(v_uv, float(v_layer))).a < u_alphaTest) discard; o = vec4(0.0); }`;
const FXCHUNK_FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform float u_day; uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_alphaTest; uniform vec4 u_colorMul;
uniform float u_gamma; uniform vec3 u_nightTint; uniform vec3 u_ambient;
uniform uint u_portalLayer; uniform sampler2D u_portalTex; uniform float u_time; uniform vec2 u_res;
uniform vec3 u_cam; uniform int u_pass; uniform mat4 u_vp; uniform mat4 u_invVP;
uniform sampler2D u_sceneColor; uniform highp sampler2D u_sceneDepth; uniform vec2 u_nf; uniform int u_ssr;
uniform sampler2D u_waveTex;
${FX_SKY}
${FX_COMMON}
${FX_MATERIAL}
in vec2 v_uv; flat in uint v_layer; flat in uint v_overlay; in vec4 v_col; in vec2 v_light; in float v_dist;
in vec3 v_wpos; flat in int v_mat; flat in int v_cls;
out vec4 o;
float linZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * u_nf.x * u_nf.y / (u_nf.y + u_nf.x - z * (u_nf.y - u_nf.x)); }
#ifdef FX_TRANSLUCENT
// screen-space reflection along R from the surface at wp; a = 0 when it leaves the screen without a hit
vec4 ssr(vec3 wp, vec3 R){
  vec3 rp = wp; float stepL = 0.35;
  for (int i = 0; i < 32; i++) {
    rp += R * stepL; stepL *= 1.12;
    vec4 cp = u_vp * vec4(rp, 1.0);
    if (cp.w <= 0.0) break;
    vec3 nd = cp.xyz / cp.w; vec2 uv = nd.xy * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float sd = texture(u_sceneDepth, uv).r;
    if (sd >= 0.99999) continue;
    float rd = linZ(nd.z * 0.5 + 0.5), sz = linZ(sd);
    if (rd > sz && rd - sz < stepL * 2.5 + 0.5) {
      vec2 ed = abs(uv - 0.5) * 2.0;
      return vec4(texture(u_sceneColor, uv).rgb, 1.0 - smoothstep(0.75, 1.0, max(ed.x, ed.y)));
    }
  }
  return vec4(0.0);
}
#endif
void main(){
  if (v_layer == u_portalLayer) { // (integers: see render.js CHUNK_FS)
    vec2 sc = gl_FragCoord.xy / u_res.y;
    vec3 col = vec3(0.035, 0.07, 0.09);
    for (int i = 0; i < 6; i++) {
      float fi = float(i), s = 0.6 + fi * 0.35, a = fi * 1.3;
      mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
      vec2 uv = r * sc * s + vec2(u_time * 0.000012 * (fi + 2.0), u_time * 0.000018 * (7.0 - fi));
      col += texture(u_portalTex, uv).rgb * vec3(0.4 + 0.1 * sin(fi), 0.6 + 0.15 * cos(fi * 2.0), 0.7 + 0.2 * sin(fi * 3.0)) * (0.5 + 0.12 * fi);
    }
    o = vec4(col * 1.3, 1.0);
    return;
  }
  vec4 t = texture(u_tex, vec3(v_uv, float(v_layer)));
  vec3 c;
  uint ovl = v_overlay & 0x7fffu;
  if (v_overlay >= 0x8000u) t.a = 1.0; // 图形品质 流畅: leaves drawn solid
  int cls = v_cls;
  if (ovl > 0u) {
    vec4 ov = texture(u_tex, vec3(v_uv, float(ovl)));
    c = mix(t.rgb, ov.rgb * v_col.rgb, ov.a);
    if (ov.a > 0.5) cls = ${PBR_GRASS};
  } else c = t.rgb * v_col.rgb;
  if (t.a < u_alphaTest) discard;
  // (a zero cross product - a sliver of a triangle, or far out where a phone's half precision loses the position's low
  // bits - normalized to NaN; and a single NaN pixel spreads through the bloom chain into a black patch). The length
  // squared goes as the pixel's size in blocks to the 4th: a wall a block away on a 2560 wide screen is ~1e-13, a
  // spyglass far less - a cut at 1e-12 lit those walls as floors (the whole wall 42 levels off at FOV 10), so only
  // what is next to zero is left out
  vec3 nc = cross(dFdx(v_wpos), dFdy(v_wpos)); float nl2 = dot(nc, nc);
  vec3 n = nl2 > 1e-30 ? nc * inversesqrt(nl2) : vec3(0.0, 1.0, 0.0);
  vec3 V = normalize(u_cam - v_wpos);
  if (dot(n, V) < 0.0) n = -n;
  // the mesher's shade is vanilla's face shading (top 1, north / south 0.8, east / west 0.6, bottom 0.5) times its
  // AO; the lighting here shades by direction itself, so only the AO is kept
  vec3 an = abs(n);
  float faceShade = an.y > 0.5 ? (n.y > 0.0 ? 1.0 : 0.5) : an.z > an.x ? 0.8 : 0.6;
  float ao = clamp(v_col.a / faceShade, 0.0, 1.0);
  vec3 lit;
  float alpha = t.a;
  bool open = u_tf2.w < 0.5 && u_eyeWater < 0.5;
#ifdef FX_TRANSLUCENT
  if (v_mat == ${MAT_WATER}) {
    // ---- water: the vanilla texture tinted by the biome colour, clearer where shallow, foam along shores,
    // sun highlight and reflections (screen space, else the sky)
    vec2 suv = gl_FragCoord.xy / u_res;
    vec3 tint = v_col.rgb;
    vec3 glM = vec3(tint.r, max(tint.g, 0.39), tint.b); glM = glM * (2.0 - glM) * vec3(1.0, 0.85, 0.8);
    vec3 cP = t.rgb;
    vec3 wc = cP * cP * glM;
    float fn = texture(u_waveTex, (floor(v_wpos.xz * 16.0) / 16.0) * 0.05 + vec2(u_time * 0.00002, -u_time * 0.00001)).a - 0.5;
    wc = pow(wc, vec3(1.0 + fn * 0.25));
    alpha = t.a * (2.0 - t.a);
    float reflectMult = 1.0;
    float fres = clamp(1.0 - dot(n, V), 0.0, 1.0), fres2 = fres * fres, fres4 = fres2 * fres2;
    if (u_eyeWater < 0.5) {
      float bd = texture(u_sceneDepth, suv).r;
      float front = linZ(gl_FragCoord.z), back = linZ(bd);
      float k = length(v_wpos - u_cam) / max(front, 1e-3);
      float wFog = bd >= 0.99999 ? 1.0 : 1.0 - exp(-max(back - front, 0.0) * k * 0.075);
      alpha *= 0.25 + 0.75 * wFog;
      float wf2 = 1.0 - pow2f(pow2f(1.0 - wFog));
      wc *= 2.5 - wf2 - 0.5 * v_light.x;
      if (n.y > 0.99 && bd < 0.99999) {
        vec4 fp = u_invVP * vec4(suv * 2.0 - 1.0, bd * 2.0 - 1.0, 1.0);
        float yDif = fp.y / fp.w - v_wpos.y;
        float cpm = dot(cP, cP), thr = min(cpm * cpm * 1.6, 1.2);
        float foam = pow2f(clamp((thr + yDif) / thr, 0.0, 1.0)) * (0.4 + 0.25 * v_light.x) * clamp((fract(v_wpos.y) - 0.7) * 10.0, 0.0, 1.0);
        wc = mix(wc, vec3(0.9, 0.95, 1.05), foam);
        alpha = mix(alpha, 1.0, foam);
        reflectMult = 1.0 - foam;
      }
    } else reflectMult = 0.5;
    reflectMult *= 0.5 + 0.5 * max(n.y, 0.0);
    float hl = min(pow2f(pow2f(dot(cP, cP) * 0.4)), 0.5) * (16.0 - 15.0 * fres2) * (u_skyK.w > 0.5 ? 0.85 : 0.425);
    lit = fxShade(wc, n, v_wpos, V, v_light, 1.0, 0, 0.5, hl, 0.0, true);
    vec3 R = reflect(-V, n);
    vec3 refl = open ? fxSky(R, true, true) * sstep1(v_light.x) : u_fogColor * 0.5;
    if (u_ssr == 1) { vec4 s = ssr(v_wpos, R); refl = mix(refl, s.rgb, s.a); }
    float fresM = (fres * fres2 * 0.85 + 0.15) * reflectMult;
    lit = mix(lit, refl, fresM);
    alpha = mix(alpha, 1.0, fres4);
  } else
#endif
  {
    float sG, hl, sD, metal; int sub = 0; float emission = 0.0; bool noDir = false;
    fxMaterial(cls, c, sG, hl, sD, metal);
    vec2 lm = v_light;
    if (v_mat == ${MAT_LEAVES}) {
      sub = 2;
      float f = min(pow2f(c.g - 0.15 * (c.r + c.b)) * 2.5, 1.0);
      sG = f * 0.4; hl = (f * 4.0 + 2.0) * (1.0 - pow2f(pow2f(clamp(1.0 - dot(n, V), 0.0, 1.0))));
    } else if (v_mat == ${MAT_PLANT}) sub = 1;
    else if (v_mat == ${MAT_LAVA}) { emission = lum(c) * 7.48 + 0.5; lm = vec2(0.0); noDir = true; c *= 0.84; }
    else if (v_mat == ${MAT_EMIT}) emission = 2.6 * smoothstep(0.3, 0.92, max(c.r, max(c.g, c.b)));
    lit = fxShade(c, n, v_wpos, V, lm, ao, sub, sG, hl, emission, noDir);
#ifdef FX_TRANSLUCENT
    // glass, ice, stained glass: a sky reflection at grazing angles
    float fr = clamp(1.0 - dot(n, V), 0.0, 1.0);
    if (open) lit = mix(lit, fxSky(reflect(-V, n), true, true) * sstep1(v_light.x), (fr * fr * fr * 0.85 + 0.15) * 0.5);
#else
    // (rough blocks - stone, dirt - only get the sun highlight: a sky reflection made them look wet and blue)
    if (sD > 0.25 && open && v_light.x > 0.5) {
      // smooth blocks pick up a little of the sky (tinted by metals): the horizon colour blending up into the zenith
      vec3 R = reflect(-V, n);
      float fr = clamp(1.0 - dot(n, V), 0.0, 1.0);
      float k = (fr * fr * fr * 0.85 + 0.15) * sD * sD * smoothstep(0.5, 1.0, v_light.x);
      vec3 refl = mix(u_skyMid, u_skyUp, sD * sqrt(max(R.y, 0.0))) * mix(vec3(1.0), c * 1.5, metal);
      lit = mix(lit, refl * min(lum(lit) * 3.0 + 0.3, 1.0), k * (0.35 + 0.65 * metal));
    }
#endif
  }
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  lit = mix(lit, u_fogColor, f);
  o = vec4(lit, alpha) * u_colorMul;
}`;

const FXENT_VS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in vec3 a_n;
uniform mat4 u_vp; uniform mat4 u_model; uniform vec3 u_cam;
out vec2 v_uv; out vec3 v_n; out vec3 v_wpos; out float v_dist;
void main(){
  vec4 wp = u_model * vec4(a_pos,1.0);
  gl_Position = u_vp * wp;
  v_uv = a_uv; v_n = mat3(u_model) * a_n; v_wpos = wp.xyz;
  v_dist = length(wp.xz - u_cam.xz);
}`;
const FXENT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec2 u_light; uniform float u_day; uniform vec4 u_overlay; uniform vec3 u_tint;
uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_gamma; uniform vec3 u_nightTint; uniform vec3 u_ambient; uniform float u_bright; uniform float u_fade;
uniform vec3 u_cam;
${FX_SKY}
${FX_COMMON}
in vec2 v_uv; in vec3 v_n; in vec3 v_wpos; in float v_dist; out vec4 o;
void main(){
  vec4 t = texture(u_tex, v_uv);
  if (t.a < 0.1) discard;
  vec3 c = t.rgb * u_tint;
  c = mix(c, u_overlay.rgb, u_overlay.a);
  float nl2 = dot(v_n, v_n);
  vec3 n = nl2 > 1e-12 ? v_n * inversesqrt(nl2) : vec3(0.0, 1.0, 0.0); // (a model's zero normal: no NaN, see FXCHUNK_FS)
  vec3 V = normalize(u_cam - v_wpos);
  if (dot(n, V) < 0.0) n = -n;
  // the hand is drawn around the camera at the origin: its light is the light where the camera is
  bool hand = dot(u_cam, u_cam) < 1e-8 && dot(u_fxCam, u_fxCam) > 1e-6;
  vec3 wp = hand ? u_fxCam : v_wpos;
  vec3 lit = fxShade(c, n, wp, V, u_light, 1.0, 0, 0.0, 1.0, 0.0, false);
  vec3 disp = mix(lit, c * 1.1, u_bright);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  o = vec4(mix(disp, u_fogColor, f), t.a * (1.0 - u_fade));
}`;

const FXSHADOW_VS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in uvec2 a_tex;
uniform mat4 u_vp; uniform mat4 u_model; uniform float u_time; uniform highp sampler2D u_mat;
out vec2 v_uv; flat out uint v_layer; flat out uint v_ov;
void main(){
  vec3 wp = (u_model * vec4(a_pos, 1.0)).xyz;
  int mat = int(texelFetch(u_mat, ivec2(int(a_tex.x) & 1023, int(a_tex.x) >> 10), 0).r * 255.0 + 0.5);
  float t = u_time * 0.001;
  if (mat == ${MAT_LEAVES}) { wp.x += sin(t * 1.6 + wp.z * 0.7 + wp.y * 0.4) * 0.035; wp.z += cos(t * 1.25 + wp.x * 0.6 + wp.y * 0.3) * 0.035; }
  else if (mat == ${MAT_PLANT} && a_uv.y < 0.1) wp.x += sin(t * 1.9 + wp.x * 0.55 + wp.z * 0.45) * 0.09;
  gl_Position = u_vp * vec4(wp, 1.0);
  v_uv = a_uv; v_layer = a_tex.x; v_ov = a_tex.y;
}`;
const FXSHADOW_FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray u_tex;
in vec2 v_uv; flat in uint v_layer; flat in uint v_ov; out vec4 o;
void main(){ if (v_ov < 0x8000u && texture(u_tex, vec3(v_uv, float(v_layer))).a < 0.35) discard; o = vec4(1.0); }`;

// entities into the shadow map (their model meshes: position, uv, normal), cut out where the skin is transparent
const FXENTSHADOW_VS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv;
uniform mat4 u_vp; uniform mat4 u_model; out vec2 v_uv;
void main(){ gl_Position = u_vp * u_model * vec4(a_pos, 1.0); v_uv = a_uv; }`;
const FXENTSHADOW_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex; in vec2 v_uv; out vec4 o;
void main(){ if (texture(u_tex, v_uv).a < 0.1) discard; o = vec4(1.0); }`;

// ---- post processing -------------------------------------------------------------------
const POST_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
out vec2 v_uv;
void main(){ v_uv = P[gl_VertexID] * 0.5 + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;
const POST_HEAD = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform vec2 u_texel; uniform vec2 u_nf; uniform mat4 u_invVP; uniform vec3 u_cam; uniform float u_frame;
vec3 worldPos(vec2 uv, float d){ vec4 p = u_invVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float lum(vec3 c){ return dot(c, vec3(0.2125, 0.7154, 0.0721)); }
`;
// Light shafts at half resolution: the sun's light scattered along the view, walked through the shadow map
// with samples bunched near the camera; weighted by a fog curve so the far part counts for less. Linear light
const VOL_FS = POST_HEAD + `
uniform highp sampler2D u_depth; uniform highp sampler2DArrayShadow u_shadow; uniform mat4 u_shadowVP[3]; uniform vec3 u_sunDir; uniform float u_shadowRange[3];
uniform vec3 u_vlCol; uniform int u_samples; uniform float u_maxD; uniform float u_shadowD; uniform vec4 u_vlK; // night, eye sky light, sun up, -
float volLit(vec3 wp){
  for (int i = 1; i < 3; i++) {
    vec4 sp = u_shadowVP[i] * vec4(wp, 1.0); vec3 s = sp.xyz / sp.w * 0.5 + 0.5;
    if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) continue;
    return texture(u_shadow, vec4(s.xy, float(i), s.z - 0.5 / u_shadowRange[i]));
  }
  return u_vlK.y;
}
float wgt(float d){ float x = pow(clamp(d / u_maxD, 0.0, 1.0), 0.9); return x * x * (3.0 - 2.0 * x); }
void main(){
  float d = texture(u_depth, v_uv).r;
  if (d < 0.01) { o = vec4(0.0); return; }
  bool sky = d >= 0.99999;
  vec3 ray = worldPos(v_uv, min(d, 0.99999)) - u_cam;
  float lv = sky ? u_maxD : length(ray); vec3 dir = normalize(ray);
  float rayEnd = min(lv, u_maxD), thr = min(u_shadowD, u_maxD);
  float jit = fract(ign(gl_FragCoord.xy) + u_frame * 0.618034);
  float acc = 0.0, last = 0.0, lastD = 1.0;
  for (int i = 0; i < 16; i++) {
    if (i >= u_samples) break;
    float tt = (float(i) + jit) / float(u_samples);
    float nd = tt * tt * thr;
    if (nd >= rayEnd) break;
    lastD = volLit(u_cam + dir * nd);
    acc += lastD * (wgt(nd) - wgt(last));
    last = nd;
  }
  // the rest of the way: past the shadow maps lit by how open the sky is where the camera is
  acc += (rayEnd > thr ? u_vlK.y : lastD) * (wgt(rayEnd) - wgt(last));
  float VdotL = dot(dir, u_sunDir), VdotU = max(dir.y, 0.0);
  float vdlm = max((VdotL + 1.0) * 0.5, 0.0);
  float vdum = 1.0 - VdotU; vdum *= vdum; vdum = vdum * vdum * (3.0 - 2.0 * vdum);
  vdum = pow(vdum, min(lv / u_maxD, 1.0) * 3.0);
  float m = mix(vdum * vdlm, 1.0, 0.4 * u_vlK.x);
  if (u_vlK.z < 0.5) m *= 0.3 + 0.4 * u_vlK.w + 0.5 * max(u_maxD - lv, 0.0) / u_maxD;
  o = vec4(u_vlCol * acc * m, 1.0);
}`;
// "Unbound" clouds at half resolution: a 32-block thick layer around y 192 of soft, billowing cloud made of four
// octaves of a tiling 3D noise, walked in 32-block steps (the step offset changes every frame; TAA smooths it).
// Each sample is lit by its height in the layer, brighter towards the sun where it is thin, and blended with the
// sky the further it is. Display space, premultiplied by the cover in alpha
const CLOUD_FS = POST_HEAD + `
uniform highp sampler2D u_depth; uniform sampler2D u_cloudNoise;
uniform vec4 u_cloud; // wind, altitude (middle), view limit, rain
uniform vec3 u_cAmb; uniform vec3 u_cLight;
${FX_SKY}
const float ST = 16.0, TALL = 32.0, NARROW = 0.00012;
float noise3(vec3 p){
  p.z = fract(p.z) * 128.0;
  float iz = floor(p.z), fz = p.z - iz;
  float a = textureLod(u_cloudNoise, p.xy + vec2(23.0, 29.0) * iz / 128.0, 0.0).r;
  float b = textureLod(u_cloudNoise, p.xy + vec2(23.0, 29.0) * (iz + 1.0) / 128.0, 0.0).r;
  return mix(a, b, fz);
}
float cloudNoise(vec3 p, float relY){
  vec3 q = p * NARROW;
  float wind = u_cloud.x, n = 0.0, w = 1.0, tot = 0.0;
  for (int i = 0; i < 4; i++) { n += noise3(q - vec3(0.0, 0.0, wind)) * w; tot += w; q *= 3.0; wind *= 0.5; w *= 0.5; }
  n /= tot; n *= n;
  n *= 1.14 * (0.8 + 0.1 * clamp(-relY / TALL, 0.0, 1.0) + 0.4 * u_cloud.w);
  float th = clamp(abs(u_cloud.y - p.y) / ST, 0.001, 0.999); th *= th; th *= th; th *= th;
  return n - (th * 0.2 + 0.25);
}
void main(){
  float d = texture(u_depth, v_uv).r;
  if (d < 0.01) { o = vec4(0.0); return; }
  vec3 ray = worldPos(v_uv, min(d, 0.99999)) - u_cam;
  float sceneDist = d >= 0.99999 ? 1e9 : length(ray);
  vec3 dir = normalize(ray);
  float alt = u_cloud.y, y0 = alt - ST, y1 = alt + ST, t0, t1;
  if (abs(dir.y) < 1e-4) {
    if (u_cam.y < y0 || u_cam.y > y1) { o = vec4(0.0); return; }
    t0 = 0.0; t1 = u_cloud.z;
  } else {
    float ta = (y0 - u_cam.y) / dir.y, tb = (y1 - u_cam.y) / dir.y;
    t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
  }
  float lim = u_cloud.z, hxz = max(length(dir.xz), 1e-4);
  t1 = min(min(t1, lim / hxz), sceneDist);
  if (t1 <= t0) { o = vec4(0.0); return; }
  float stepL = max(32.0, (t1 - t0) / 48.0);
  int n = int((t1 - t0) / stepL) + 1;
  float jit = fract(ign(gl_FragCoord.xy) + u_frame * 0.618034);
  float VdotS = dot(dir, u_sunVec), sunVis = u_skyK.w, rain = u_cloud.w;
  float v1 = max(sunVis > 0.5 ? VdotS : -VdotS, 0.0), v1m = v1 * (1.0 - rain);
  float v2 = v1 * v1 * abs(sunVis - 0.5) * 2.0, v3 = v2 * (2.5 + rain) + 1.5 * rain, v4 = pow(v1m, 100.0) * sunVis;
  float edge = 0.5 + 10.0 * pow(v1m, 90.0);
  vec3 sky = fxSky(dir, true, false), col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= n) break;
    float t = t0 + (float(i) + jit) * stepL;
    if (t > t1) break;
    vec3 p = u_cam + dir * t;
    float cn = cloudNoise(p, p.y - u_cam.y);
    if (cn <= 0.00001) continue;
    float op = min(cn * 8.0, 1.0);
    float sh = 1.0 - (y1 - p.y) / TALL;
    sh *= 1.0 + 0.2 * v3 * (1.0 - op) + v4;
    vec3 c = u_cAmb * (0.4 + 0.6 * sh) + u_cLight * sh;
    float ratio = clamp((lim - length(p.xz - u_cam.xz)) / lim, 0.0, 1.0);
    float p15 = ratio - ratio * (1.0 - ratio) * (1.0 - ratio);
    c = mix(sky, c, p15 * p15 * 0.69 * 0.69);
    col = mix(col, c, 1.0 - min(a, 1.0));
    a += op * pow(min(ratio, 0.8) * 1.25, edge);
    if (a > 0.9) { a = 1.0; break; }
  }
  a = min(a, 1.0);
  o = vec4(col * a, a);
}`;
// Pass A (full resolution): the sky and sun where nothing was drawn, fog, the clouds, then to linear light with the
// light shafts added. Alpha: how much more this pixel feeds the bloom (distance haze at night / in rain / caves)
const COMPOSE_FS = POST_HEAD + `
uniform sampler2D u_color; uniform highp sampler2D u_depth; uniform sampler2D u_clouds; uniform sampler2D u_vol;
uniform int u_useClouds, u_useVol, u_skyOn, u_fogOn; uniform vec2 u_cloudSlab;
uniform vec3 u_sunDisc; uniform float u_renderD; uniform float u_yOff;
uniform vec4 u_fogK;  // rain, eye sky light (smoothed), cave factor, screen brightness
uniform vec4 u_atmK;  // inverse night factor, sun visibility^2, noon, sun factor
uniform vec3 u_nightUp; uniform vec3 u_dayDownFog;
uniform vec4 u_misc;  // rainbow, underwater, aurora, bloom fog mult
uniform sampler2D u_noise; uniform float u_time;
${FX_SKY}
float altF(float y){ float a = 1.0 - clamp(y - 63.1, 0.0, 60.0) / 60.0; return a * a; }
vec3 rainbow(vec3 dir){
  float a = dot(dir, -u_sunVec);
  float x = (a - 0.715) / 0.055; // 0..1 across the bow (about 42 degrees from the point opposite the sun)
  if (x < 0.0 || x > 1.0) return vec3(0.0);
  vec3 c = clamp(abs(fract(x * 0.8 + vec3(0.0, 0.333, 0.667)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return c * sin(x * 3.14159) * smoothstep(-0.05, 0.25, dir.y);
}
// aurora: a few thin bands in a sheet high up, swaying (snowy biomes at night)
vec3 aurora(vec3 dir){
  if (dir.y < 0.05) return vec3(0.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float h = 1.0 + float(i) * 0.06;
    vec2 p = dir.xz / dir.y * h * 0.35 + vec2(u_time * 0.000004, 0.0);
    float n = textureLod(u_noise, p * 0.6, 0.0).a;
    float band = (1.0 - smoothstep(0.0, 0.035, abs(n - 0.5))) * textureLod(u_noise, p * 0.13 + 0.3, 0.0).b;
    acc += mix(vec3(0.1, 1.0, 0.45), vec3(0.6, 0.25, 1.0), float(i) / 7.0) * band;
  }
  return acc * 0.06 * smoothstep(0.05, 0.3, dir.y);
}
void main(){
  vec3 c = texture(u_color, v_uv).rgb;
  float d = texture(u_depth, v_uv).r;
  bool hand = d < 0.01, sky = d >= 0.99999;
  vec3 ray = worldPos(v_uv, sky ? 0.99999 : d) - u_cam; vec3 dir = normalize(ray);
  float dist = length(ray);
  float bf = 1.0;
  if (!hand) {
    if (sky && u_skyOn == 1) {
      // (not darkened below the horizon: the border fog fades the terrain into this same colour)
      vec3 s = fxSky(dir, true, false);
      float mu = dot(dir, u_sunVec);
      s += u_sunDisc * smoothstep(0.99955, 0.99975, mu);
      if (u_misc.x > 0.0) s += rainbow(dir) * u_misc.x * 0.12;
      if (u_misc.z > 0.0) s += aurora(dir) * u_misc.z;
      c += s;
    } else if (!sky && u_fogOn == 1) {
      float rain = u_fogK.x;
      // cave fog
      float cave = u_fogK.z;
      if (cave > 0.0) c = mix(c, vec3(0.13, 0.13, 0.15) * (0.7 + 0.3 * u_fogK.w), cave * (0.9 - 0.9 * exp(-dist * 0.015)));
      // atmospheric haze, thickest low down
      float rdf = min(192.0 / u_renderD, 1.0);
      float fog = 1.0 - exp(-pow(dist * (0.001 - 0.0007 * rain), 2.0 - rain * rain) * dist * rdf);
      float wy = u_cam.y + ray.y + u_yOff;
      float afr = altF(wy), af = afr * 0.9 + 0.1;
      fog *= 0.95 - 0.1 - 0.15 * (1.0 - rain);
      float caf = altF(u_cam.y + u_yOff + 15.0);
      af = mix(af, 1.0, 0.8 * caf); af *= 1.0 - 0.5 * caf * (1.0 - rain);
      fog *= 0.2 + 0.8 * (1.0 - pow(1.0 - u_fogK.y, 4.0));
      fog *= (1.0 - cave) * af;
      if (fog > 0.0) {
        float VdotS = dot(dir, u_sunVec);
        float nfm = 2.5 - 0.625 * max(afr * afr * afr * afr, rain);
        float blend = pow(u_atmK.x, 4.0 - VdotS - 2.5 * u_atmK.y);
        vec3 fc = mix(u_nightUp * (nfm - blend * nfm), u_dayDownFog, blend);
        c = mix(c, fc, clamp(fog, 0.0, 1.0));
      }
      // border fog: into the sky at the edge of the render distance
      float bd = max(length(ray.xz), abs(ray.y)) / u_renderD;
      bd *= bd; bd *= bd; bd *= bd; bd *= bd;
      bd = 1.0 - exp(-3.0 * bd);
      if (bd > 0.0) c = mix(c, fxSky(dir, true, false), bd);
      if (u_misc.x > 0.0 && dist > 48.0) c += rainbow(dir) * u_misc.x * 0.12 * smoothstep(48.0, 128.0, dist);
    }
    if (u_useClouds == 1) {
      float slab = abs(dir.y) < 1e-4 ? 0.0 : ((dir.y > 0.0 ? u_cloudSlab.x : u_cloudSlab.y) - u_cam.y) / dir.y;
      if (sky || dist > max(slab, 0.0)) { vec4 cl = texture(u_clouds, v_uv); c = c * (1.0 - cl.a) + cl.rgb; }
    }
    float lv = sky ? 400.0 : dist;
    float bfog = 1.0 - exp(-lv * 0.02); bfog *= bfog; bfog *= bfog;
    bf = 1.0 + bfog * u_misc.w;
  }
  if (u_misc.y > 0.5) c *= vec3(0.80, 0.87, 0.97) * 0.85;
  vec3 lin = pow(max(c, vec3(0.0)), vec3(2.2));
  if (u_useVol == 1 && !hand) lin += texture(u_vol, v_uv).rgb * (u_misc.y > 0.5 ? 0.25 : 1.0);
  // a NaN (or infinite) pixel stops here: the bloom below spreads a single one into a black patch
  lin = mix(vec3(0.0), lin, lessThan(abs(lin), vec3(1e30)));
  o = vec4(lin, bf);
}`;
// bloom: the whole image (not just bright parts) blurred over several scales and mixed in a little
const DOWN0_FS = POST_HEAD + `
uniform sampler2D u_src;
void main(){
  vec4 a = texture(u_src, v_uv + vec2(-0.5, -0.5) * u_texel), b = texture(u_src, v_uv + vec2(0.5, -0.5) * u_texel);
  vec4 c = texture(u_src, v_uv + vec2(-0.5, 0.5) * u_texel), d = texture(u_src, v_uv + vec2(0.5, 0.5) * u_texel);
  vec3 s = a.rgb * a.a + b.rgb * b.a + c.rgb * c.a + d.rgb * d.a;
  o = vec4(min(s * 0.25, vec3(64.0)), 1.0);
}`;
const DOWN_FS = POST_HEAD + `
uniform sampler2D u_src;
void main(){
  vec3 c = texture(u_src, v_uv).rgb * 4.0;
  c += texture(u_src, v_uv + vec2(-1.0, -1.0) * u_texel).rgb + texture(u_src, v_uv + vec2(1.0, -1.0) * u_texel).rgb;
  c += texture(u_src, v_uv + vec2(-1.0, 1.0) * u_texel).rgb + texture(u_src, v_uv + vec2(1.0, 1.0) * u_texel).rgb;
  o = vec4(c / 8.0, 1.0);
}`;
const UP_FS = POST_HEAD + `
uniform sampler2D u_src; uniform sampler2D u_add;
void main(){
  vec3 c = vec3(0.0);
  c += texture(u_src, v_uv + vec2(-2.0, 0.0) * u_texel).rgb + texture(u_src, v_uv + vec2(2.0, 0.0) * u_texel).rgb;
  c += texture(u_src, v_uv + vec2(0.0, -2.0) * u_texel).rgb + texture(u_src, v_uv + vec2(0.0, 2.0) * u_texel).rgb;
  c += (texture(u_src, v_uv + vec2(-1.0, 1.0) * u_texel).rgb + texture(u_src, v_uv + vec2(1.0, 1.0) * u_texel).rgb
     + texture(u_src, v_uv + vec2(-1.0, -1.0) * u_texel).rgb + texture(u_src, v_uv + vec2(1.0, -1.0) * u_texel).rgb) * 2.0;
  o = vec4(c / 12.0 + texture(u_add, v_uv).rgb, 1.0);
}`;
// Pass B: bloom, Lottes tone mapping (contrast 1.05, white at 8, mid grey kept), sRGB, the dark end kept readable
// and a little desaturated, saturation / vibrance, vignette. Alpha = luma (for FXAA)
const LOTTES_A = 1.05, LOTTES_HM = Math.pow(8, LOTTES_A), LOTTES_MI = Math.pow(0.25, LOTTES_A);
const LOTTES_B = (LOTTES_HM * 0.25 - LOTTES_MI) / ((LOTTES_HM - LOTTES_MI) * 0.25);
const LOTTES_C = LOTTES_MI * (LOTTES_HM - LOTTES_HM * 0.25) / ((LOTTES_HM - LOTTES_MI) * 0.25);
const GRADE_FS = POST_HEAD + `
uniform sampler2D u_src; uniform sampler2D u_bloom; uniform float u_bloomK;
vec3 lottes(vec3 x){ vec3 xa = pow(max(x, vec3(0.0)), vec3(${LOTTES_A.toFixed(4)})); return xa / (xa * ${LOTTES_B.toFixed(6)} + ${LOTTES_C.toFixed(6)}); }
vec3 toSRGB(vec3 c){ return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, 12.92 * c, vec3(lessThan(c, vec3(0.0031308)))); }
void main(){
  vec3 c = texture(u_src, v_uv).rgb;
  c = mix(c, texture(u_bloom, v_uv).rgb * 0.2, u_bloomK);
  float L0 = lum(c);
  vec3 t = toSRGB(clamp(lottes(c), 0.0, 1.0));
  float dark = 1.0 - smoothstep(0.0, 0.1, L0);
  t = mix(t, pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)), dark * 0.75);
  t = mix(t, vec3(1.0), smoothstep(0.0, 16.0, L0));
  t = mix(t, vec3(lum(t)), dark * 0.25);
  t = clamp(t, 0.0, 1.0);
  // a little more saturation
  float gv = (t.r + t.g + t.b) / 3.0;
  t = t * 1.07 - gv * 0.07;
  vec2 q = v_uv - 0.5; t *= 1.0 - dot(q, q) * 0.3;
  t = clamp(t, 0.0, 1.0);
  o = vec4(t, dot(t, vec3(0.299, 0.587, 0.114)));
}`;
// TAA: last frame's result moved to where this frame sees the same point (camera motion through the depth),
// clamped to this frame's 3x3 neighbourhood so moving things and new views do not smear
const TAA_FS = POST_HEAD + `
uniform sampler2D u_cur; uniform sampler2D u_hist; uniform highp sampler2D u_depth; uniform mat4 u_invVPU; uniform mat4 u_prevVP; uniform float u_reset;
void main(){
  vec4 cur = texture(u_cur, v_uv);
  vec3 mn = cur.rgb, mx = cur.rgb;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec3 s = texture(u_cur, v_uv + vec2(x, y) * u_texel).rgb; mn = min(mn, s); mx = max(mx, s);
  }
  float d = texture(u_depth, v_uv).r;
  vec2 puv = v_uv;
  if (d >= 0.01) {
    vec4 p = u_invVPU * vec4(v_uv * 2.0 - 1.0, min(d, 0.99999) * 2.0 - 1.0, 1.0); p /= p.w;
    vec4 pc = u_prevVP * vec4(p.xyz, 1.0);
    puv = pc.xy / pc.w * 0.5 + 0.5;
  }
  float w = 0.9;
  vec2 vel = (puv - v_uv) / u_texel;
  w = mix(w, 0.65, clamp(length(vel) / 32.0, 0.0, 1.0));
  if (u_reset > 0.5 || puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) w = 0.0;
  vec3 h = clamp(texture(u_hist, puv).rgb, mn, mx);
  vec3 r = mix(cur.rgb, h, w);
  o = vec4(r, dot(r, vec3(0.299, 0.587, 0.114)));
}`;
// to the screen: FXAA (without TAA) and a light sharpening
const FINAL_FS = POST_HEAD + `
uniform sampler2D u_src; uniform int u_fxaa; uniform float u_sharp;
void main(){
  vec3 rgbM = texture(u_src, v_uv).rgb;
  vec3 res = rgbM;
  if (u_fxaa == 1) {
    float lM = texture(u_src, v_uv).a;
    float lNW = texture(u_src, v_uv + vec2(-1.0, -1.0) * u_texel).a, lNE = texture(u_src, v_uv + vec2(1.0, -1.0) * u_texel).a;
    float lSW = texture(u_src, v_uv + vec2(-1.0, 1.0) * u_texel).a, lSE = texture(u_src, v_uv + vec2(1.0, 1.0) * u_texel).a;
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    if (lMax - lMin >= max(0.0312, lMax * 0.125)) {
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
      dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * u_texel;
      vec3 a = 0.5 * (texture(u_src, v_uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(u_src, v_uv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture(u_src, v_uv - dir * 0.5).rgb + texture(u_src, v_uv + dir * 0.5).rgb);
      float lB = dot(b, vec3(0.299, 0.587, 0.114));
      res = (lB < lMin || lB > lMax) ? a : b;
    }
  }
  if (u_sharp > 0.0) {
    vec3 nb = texture(u_src, v_uv + vec2(u_texel.x, 0.0)).rgb + texture(u_src, v_uv - vec2(u_texel.x, 0.0)).rgb
            + texture(u_src, v_uv + vec2(0.0, u_texel.y)).rgb + texture(u_src, v_uv - vec2(0.0, u_texel.y)).rgb;
    res += (rgbM - nb * 0.25) * u_sharp;
  }
  o = vec4(clamp(res, 0.0, 1.0), 1.0);
}`;

function lookAtM(out, eye, at, up) {
  let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out.set([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
  return out;
}

// small vector helpers for the colour set-up
const V3 = {
  mix: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  mul: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
  sc: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  pow: (a, e) => [Math.pow(Math.max(a[0], 0), e[0] ?? e), Math.pow(Math.max(a[1], 0), e[1] ?? e), Math.pow(Math.max(a[2], 0), e[2] ?? e)],
  max: (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
// Halton (2, 3) for the TAA sub-pixel offsets
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

class ShaderPack {
  constructor(r) {
    this.r = r; this.level = 0; this.ok = true;
    const gl = r.gl;
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    try {
      // two terrain programs: solid blocks, and water / glass (with the reflections) - one program with both ran
      // every pixel slower
      this.pChunk = compile(gl, FXCHUNK_VS, FXCHUNK_FS);
      this.pChunkT = compile(gl, FXCHUNK_VS, FXCHUNK_FS.replace('#version 300 es\n', '#version 300 es\n#define FX_TRANSLUCENT\n'));
      this.pDepth = compile(gl, FXCHUNK_VS, FXDEPTH_FS);
      this.pEnt = compile(gl, FXENT_VS, FXENT_FS);
      this.pShadow = compile(gl, FXSHADOW_VS, FXSHADOW_FS);
      this.pEntShadow = compile(gl, FXENTSHADOW_VS, FXENTSHADOW_FS);
      const P = (fs) => compile(gl, POST_VS, fs);
      this.pVol = P(VOL_FS); this.pCloud = P(CLOUD_FS); this.pCompose = P(COMPOSE_FS);
      this.pDown0 = P(DOWN0_FS); this.pDown = P(DOWN_FS); this.pUp = P(UP_FS); this.pGrade = P(GRADE_FS);
      this.pTAA = P(TAA_FS); this.pFinal = P(FINAL_FS);
    } catch (e) { console.warn('shader pack unavailable', e); this.ok = false; return; }
    this.targets = {}; this.size = [0, 0]; this.shadowSize = 0;
    this.cmpSampler = gl.createSampler();
    gl.samplerParameteri(this.cmpSampler, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.samplerParameteri(this.cmpSampler, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.samplerParameteri(this.cmpSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.samplerParameteri(this.cmpSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.cmpSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.samplerParameteri(this.cmpSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // the cascades' light-space matrices (3 x 16), texel sizes and depth ranges in blocks
    this.shadowVP = new Float32Array(64); this.shadowTexelW = new Float32Array([0.1, 0.1, 0.1, 0.1]); this.shadowRange = new Float32Array([1, 1, 1, 1]);
    this.entRec = null; this.entShadowOn = false;
    this.invVP = M4.create(); this.invVPU = M4.create(); this.vpU = M4.create(); this.prevVP = M4.create();
    this.frameN = 0; this.histOK = false; this.histI = 0;
    this.wet = 0; this.eyeSky = 1; this.snowy = 0; this.dry = 0; this.lastT = performance.now();
    this.buildMaterials();
  }

  // per texture layer (1024 x 4: layer & 1023, layer >> 10): r = leaves / plants / water / emissive / lava,
  // g = the surface class (by texture name)
  buildMaterials() {
    const gl = this.r.gl, m = new Uint8Array(4096 * 4);
    const frames = (layer) => Math.max(1, ANIM_FRAMES[layer] || 1);
    const mark = (layer, v) => { if (layer == null || layer < 0) return; for (let i = 0, k = frames(layer); i < k; i++) m[(layer + i) * 4] = v; };
    const TILE_NAMES = [];
    for (const name in ASSETS.tiles) TILE_NAMES[ASSETS.tiles[name]] = name;
    const cubeLayers = new Set();
    for (const b of BLOCKS) if (b && b.tex && b.shape === SH_CUBE) for (const l of [].concat(b.tex)) cubeLayers.add(l);
    const modelLayers = (b) => {
      const out = new Set();
      for (let meta = 0; meta < 16; meta++) {
        try {
          if (b.model) { for (const e of b.model(meta).els) for (const f in e.faces) out.add(e.faces[f][4]); continue; }
          const st = vanillaState(b, meta, null);
          if (VM.has(st.key)) for (const qs of VM.select(st.key, st.p, 0)) for (const q of qs) out.add(q.layer);
        } catch (e) { /* a state this block does not have */ }
      }
      return out;
    };
    for (const b of BLOCKS) {
      if (!b || !b.tex) continue;
      const layers = Array.isArray(b.tex) ? b.tex : [b.tex];
      let v = 0;
      if (b.key.endsWith('leaves')) v = MAT_LEAVES;
      else if (b.shape === SH_CROSS || b.shape === SH_CROP) v = MAT_PLANT;
      else if (b.id === WATER) v = MAT_WATER;
      else if (b.id === LAVA || b.key === 'magma_block') v = MAT_LAVA;
      else if (b.light >= 10) v = MAT_EMIT;
      if (!v) continue;
      // a model block's tex is only a placeholder (layer 0, stone - every lantern / torch / campfire made stone
      // glow): its layers come from the model, less those full cubes use (a beacon's glass and obsidian), and of its
      // states' textures only the lit ones (candle_lit next to candle, redstone_lamp_on), not a lava cauldron's pot
      if (b.shape === SH_MODEL) {
        const ls = modelLayers(b), nm = [...ls].map(l => TILE_NAMES[l] || '');
        for (const l of ls) {
          const name = TILE_NAMES[l] || '';
          if (cubeLayers.has(l) || name.startsWith('cauldron_') || nm.some(o => o !== name && o.replace(/_lit|_on$/, '') === name)) continue;
          mark(l, v);
        }
      }
      else for (const l of layers) mark(l, v);
    }
    for (const k of ['water_still', 'water_flow']) if (ASSETS.tiles[k] !== undefined) mark(ASSETS.tiles[k], MAT_WATER);
    for (const k of ['lava_still', 'lava_flow']) if (ASSETS.tiles[k] !== undefined) mark(ASSETS.tiles[k], MAT_LAVA);
    for (const k of ['fire_0', 'fire_1', 'torch', 'glowstone', 'jack_o_lantern', 'furnace_front_on']) if (ASSETS.tiles[k] !== undefined) mark(ASSETS.tiles[k], MAT_EMIT);
    // surface classes by texture name (first match wins)
    const CLS = [
      [/^(raw_)?(iron|gold|copper|exposed_copper|netherite)_block|^(cut|chiseled)_copper|^exposed_(cut|chiseled)_copper|copper_(bulb|grate|door|trapdoor)|^iron_(bars|door|trapdoor)|^(anvil|chipped_anvil|damaged_anvil)|chain$|^lantern|^soul_lantern|^cauldron|^hopper|^heavy_core|^lightning_rod|rail/, PBR_METAL],
      [/^(diamond|emerald|lapis|amethyst|redstone)_block|^budding_amethyst|^amethyst_cluster|^(large|medium|small)_amethyst_bud|^beacon/, PBR_GEM],
      [/_ore$|^ancient_debris|^gilded_blackstone/, PBR_ORE],
      [/obsidian/, PBR_OBSIDIAN],
      [/^(packed_|blue_)?ice$|^frosted_ice/, PBR_ICE],
      [/^snow|^powder_snow|grass_block_snow/, PBR_SNOW],
      [/^(red_)?sand$|^suspicious_sand/, PBR_SAND],
      [/^polished_|^smooth_|^quartz|^chiseled_quartz|^calcite|^purpur|^prismarine_bricks|^dark_prismarine|^end_stone_bricks|_glazed_terracotta$|^bone_block|^dripstone|^chiseled_polished/, PBR_POLISHED],
      [/_concrete$/, PBR_CONCRETE],
      [/^(stone|cobblestone|mossy_cobblestone|stone_bricks|mossy_stone_bricks|cracked_stone_bricks|chiseled_stone_bricks|smooth_stone|furnace_|dispenser|dropper|observer|piston|grindstone|stonecutter|infested)/, PBR_STONE],
      [/^(granite|diorite|andesite|tuff|deepslate|cobbled_deepslate|chiseled_deepslate|cracked_deepslate|blackstone|basalt|end_stone|sandstone|red_sandstone|cut_sandstone|cut_red_sandstone|chiseled_sandstone|chiseled_red_sandstone|bricks|mud_bricks|terracotta|.*_terracotta|gravel|clay|packed_mud|chiseled_tuff)/, PBR_ROUGH],
      [/^(dirt|coarse_dirt|rooted_dirt|podzol|mycelium|farmland|dirt_path|mud$|soul_soil|soul_sand|grass_block_side|grass_side_base)/, PBR_DIRT],
      [/^grass_block_top|^moss_block|^moss_carpet/, PBR_GRASS],
      [/_planks$|_log$|_log_top$|_wood$|^stripped_|_stem$|_stem_top$|_hyphae$|^bookshelf|^barrel|^crafting_table|_door_(top|bottom)$|_trapdoor$|^chest_|^composter|^bamboo_block|^bamboo_mosaic/, PBR_WOOD],
      [/^netherrack|^nether_bricks|^red_nether_bricks|^crimson_nylium|^warped_nylium|^cracked_nether_bricks|^chiseled_nether_bricks/, PBR_NETHERRACK],
    ];
    for (const name in ASSETS.tiles) {
      const layer = ASSETS.tiles[name];
      if (name.startsWith('i_')) continue;
      for (const [re, c] of CLS) if (re.test(name)) { for (let i = 0, k = frames(layer); i < k; i++) m[(layer + i) * 4 + 1] = c; break; }
    }
    this.matTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, m);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  // ---- render targets --------------------------------------------------------------------
  tex(w, h, fmt) {
    const gl = this.r.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const F = {
      hdr: this.floatOK ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
      ldr: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
      depth: [gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT],
    }[fmt];
    gl.texImage2D(gl.TEXTURE_2D, 0, F[0], w, h, 0, F[1], F[2], null);
    const filt = fmt === 'depth' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  fbo(color, depth) {
    const gl = this.r.gl, f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    if (!color) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    return f;
  }
  target(name, w, h, fmt) {
    const t = this.targets[name];
    if (t && t.w === w && t.h === h) return t;
    const gl = this.r.gl;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    const tex = this.tex(w, h, fmt);
    if (name.startsWith('hist')) this.histOK = false;
    return (this.targets[name] = { tex, fb: this.fbo(tex, null), w, h });
  }
  ensure() {
    const gl = this.r.gl, W = this.r.canvas.width, H = this.r.canvas.height;
    if (this.size[0] !== W || this.size[1] !== H) {
      for (const k in this.targets) { gl.deleteTexture(this.targets[k].tex); gl.deleteFramebuffer(this.targets[k].fb); }
      this.targets = {};
      for (const k of ['sceneColor', 'sceneDepth', 'copyColor', 'copyDepth']) if (this[k]) gl.deleteTexture(this[k]);
      for (const k of ['sceneFB', 'copyFB']) if (this[k]) gl.deleteFramebuffer(this[k]);
      this.sceneColor = this.tex(W, H, 'hdr'); this.sceneDepth = this.tex(W, H, 'depth');
      this.sceneFB = this.fbo(this.sceneColor, this.sceneDepth);
      this.copyColor = this.tex(W, H, 'hdr'); this.copyDepth = this.tex(W, H, 'depth');
      this.copyFB = this.fbo(this.copyColor, this.copyDepth);
      this.size = [W, H];
      this.histOK = false;
    }
    const cfg = FX_CFG[this.level];
    if (cfg.shadow !== this.shadowSize) {
      if (this.shadowTex) { gl.deleteTexture(this.shadowTex); for (const f of this.shadowFB) gl.deleteFramebuffer(f); this.shadowTex = null; }
      if (cfg.shadow) {
        // the 3 cascades: layers of one depth texture, a framebuffer each
        this.shadowTex = this.depthArray(cfg.shadow, 4);
        this.shadowFB = [0, 1, 2, 3].map((i) => {
          const f = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, f);
          gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.shadowTex, 0, i);
          gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
          return f;
        });
      }
      this.shadowSize = cfg.shadow;
      this.shadowCache = null;
    }
    if (this.lastLevel !== this.level) { this.lastLevel = this.level; this.histOK = false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- colours of the sky and the light for this frame (after Complementary's day / night / rain model) ----
  atmos(env, game) {
    const r = this.r, sd = env.sunDir, SdotU = sd[1], ow = env.sky === 'overworld' && game.dim === 'overworld';
    const now = performance.now(), dt = Math.min(0.25, (now - this.lastT) / 1000); this.lastT = now;
    const c01 = (x) => Math.max(0, Math.min(1, x)), sqrt2 = (x) => 1 - Math.pow(1 - c01(x), 4);
    const sunVis = c01((SdotU + 0.0625) / 0.125), sunVis2 = sunVis * sunVis;
    const sunFactor = SdotU < 0 ? c01((SdotU + 0.375) / 0.75) : c01((SdotU + 0.03125) / 0.0625);
    const noon = Math.sqrt(Math.max(SdotU, 0)), night = Math.max(-SdotU, 0), invNoon = 1 - noon, invNoon2 = invNoon * invNoon;
    const shadowTime = Math.pow(Math.abs(sunVis - 0.5) * 2, 4);
    const rain = env.rain || 0, rain2 = rain * rain, invRain = 1 - rain, vsB = c01(r.gamma);
    // wetness lingers after rain (rainbows); snowy / dry biomes change the rain colours
    this.wet = rain > this.wet ? rain : Math.max(rain, this.wet - dt / 90);
    const k = 1 - Math.exp(-dt * 0.5), temp = env.temp ?? 0.8;
    this.snowy += ((temp < 0.15 ? 1 : 0) - this.snowy) * k; this.dry += ((temp > 1.0 ? 1 : 0) - this.dry) * k;
    const sky = env.skyColor || [0.5, 0.7, 1.0];
    const A = {};
    const nfs2 = sqrt2(night), nfM = sqrt2(nfs2) * 0.4;
    // sky bands
    const skySqrt = sky.map(Math.sqrt), invRain2 = invRain * invRain;
    const skyM = V3.mix(V3.max(skySqrt, [0.63, 0.67, 0.73]), skySqrt, invRain2);
    const skyM2 = V3.mix(V3.max(sky, V3.sc([0.265, 0.295, 0.35], sunFactor)), sky, invRain2);
    const nmscW = V3.add(V3.add([-0.1, -0.4, -0.6], V3.sc([0, 0.06, 0.12], noon)), V3.sc([-0.1, 0.3, 0.6], this.snowy)), ndscW = V3.add(V3.add([-0.15, -0.3, -0.42], V3.sc([0, 0.02, 0.08], noon)), V3.add(V3.sc([-0.25, -0.01, 0.25], this.snowy), V3.sc([-0.05, -0.09, -0.1], this.dry)));
    const noonUp = V3.mul(V3.pow(skyM, 2.9), V3.add([0.85, 0.92, 0.81], V3.sc([0.1, 0, 0.1], rain)));
    const noonMid = V3.add(V3.mul(V3.pow(skyM, 1.5), V3.add([1.3, 1.3, 1.3], V3.sc(nmscW, rain))), V3.sc(noonUp, 0.65));
    const noonDown = V3.add(V3.mul(skyM, V3.add([0.9, 0.9, 0.9], V3.sc(ndscW, rain))), V3.sc(noonUp, 0.25));
    const ssUp = V3.mul(skyM2, V3.add([0.72, 0.522, 0.47], V3.sc([0.1, 0.2, 0.35], rain2)));
    const ssMid = V3.mul(skyM2, V3.add([1.8, 1.3, 1.2], V3.sc([0.15, 0.25, -0.05], rain2)));
    const ssDownP = V3.add([1.45, 0.86, 0.5], V3.sc([-0.8, -0.3, 0], rain));
    const ssDown = V3.add(V3.sc(ssDownP, 0.5), V3.sc(ssMid, 0.25));
    const dayUp = V3.mix(noonUp, ssUp, invNoon2), dayMid = V3.mix(noonMid, ssMid, invNoon2), dayDown = V3.mix(noonDown, ssDown, invNoon2);
    const ncf = V3.add(V3.sc([0.07 * 0.9, 0.14 * 0.9, 0.24 * 0.9], 1 - 0.5 * rain), sky);
    const nightUp = V3.sc(V3.pow(ncf, 0.9), 0.45), nightMid = V3.sc(nightUp.map(Math.sqrt), 0.65), nightDown = V3.mul(nightMid, [0.82, 0.82, 0.88]);
    A.skyUp = V3.mix(V3.sc(nightUp, 1.5 - 0.5 * nfs2), dayUp, sunFactor);
    A.skyUpMoon = V3.sc(nightUp, nfM * 1.5 * (1 - sunFactor));
    A.skyMid = V3.mix(V3.sc(nightMid, 3 - 2 * nfs2), dayMid, sunFactor);
    A.skyMidSun = V3.sc(dayMid, 0.3 * sunFactor);
    A.skyDown = V3.mix(nightDown, dayDown, (sunFactor + sunVis) * 0.5);
    A.skyBand = ssDownP;
    A.skyK = [invNoon * sunFactor * invRain, rain2, nfM, sunVis];
    let glare = V3.mix([0.38 * 0.3, 0.4 * 0.3, 0.5 * 0.3], V3.add([1.5, 0.7, 0.3], V3.sc([0, 0.5, 0.5], noon)), sunVis);
    const gl0 = (glare[0] + glare[1] + glare[2]) / 3;
    glare = V3.sc(V3.mix(glare, [gl0, gl0, gl0], 0.5 * rain), (1 - 0.6 * rain) * shadowTime);
    A.glare = glare;
    A.nightUp = nightUp; A.dayDownFog = V3.sc(dayDown, 0.9 + 0.3 * noon);
    // lights (ground)
    const noonL = V3.sc([0.65, 0.55, 0.375], 2.05), noonA = V3.sc(V3.pow(sky, 0.75), 0.85);
    const ssL = V3.sc(V3.pow([0.64, 0.45, 0.3], 1.5 + invNoon), 5.0), ssA = V3.mul(noonA, [1.21 * 0.95, 0.92 * 0.95, 0.76 * 0.95]);
    const nightL = V3.sc([0.15, 0.14, 0.2], 0.9 * (0.4 + vsB * 0.4)), nightA = V3.sc([0.09, 0.12, 0.17], 0.9 * (1.55 + vsB * 0.77));
    const drlc = V3.add(V3.sc([-0.06, 0, 0.04], this.snowy), V3.sc([0.01, -0.035, -0.06], this.dry));
    const dayRL = V3.add(V3.add(V3.sc([0.21, 0.16, 0.13], 0.85), V3.sc([0, 0.02, 0.06], noon)), drlc), dayRA = V3.sc([0.2, 0.2, 0.25], 1.8 + 0.5 * vsB);
    const nightRL = V3.sc([0.03, 0.035, 0.05], 0.5 + 0.5 * vsB), nightRA = V3.sc([0.16, 0.2, 0.3], 0.75 + 0.6 * vsB);
    const rsvr = 0.2 * this.snowy + 0.2 * this.dry;
    const clearL = V3.mix(nightL, V3.mix(ssL, noonL, noon), sunVis2), clearA = V3.mix(nightA, V3.mix(ssA, noonA, noon), sunVis2);
    const rainL = V3.sc(V3.mix(nightRL, V3.sc(dayRL, 1 - rsvr), sunVis2), 2.5), rainA = V3.mix(nightRA, V3.sc(dayRA, 1 + rsvr), sunVis2);
    let light = V3.mix(clearL, rainL, rain), amb = V3.mix(clearA, rainA, rain);
    let dim = 0;
    if (game.dim === 'nether') {
      dim = 1; light = [0, 0, 0];
      const f = env.fogColor, fn = V3.norm(V3.add(f, [1e-4, 1e-4, 1e-4]));
      amb = V3.sc(V3.add(V3.add(V3.sc(f, 0.6), V3.sc(fn, 0.2)), [0.075, 0.03, 0.005]), 0.9 + 0.45 * vsB);
    } else if (game.dim === 'end') {
      dim = 2; const el = [0.68, 0.51, 1.07];
      light = V3.sc(el, 0.35 - 0.2 * vsB); amb = V3.sc(el, 0.2 + 0.2 * vsB);
    } else if (!ow) { light = [0, 0, 0]; }
    A.light = light; A.amb = amb; A.dim = dim;
    A.hl = dim === 1 ? [0, 0, 0] : V3.sc(V3.norm(V3.pow(light, 0.37)), (0.3 + 1.5 * (dim ? 1 : sunVis2)) * (1 - 0.85 * rain));
    A.blk = [0.1775, 0.104, 0.077];
    // clouds
    const cRain = V3.mix(nightMid, dayMid, sunFactor);
    const nightCL = V3.sc([0.11, 0.14, 0.2], 0.9), clearCL = V3.mix(nightCL, V3.mix(ssL, noonL, noon), sunVis2);
    const cLight0 = V3.mix(clearCL, rainL, rain);
    A.cAmb = V3.sc(V3.mix(V3.sc(amb, sunVis2 * (0.55 + 0.17 * noon) + 0.35), V3.sc(cRain, 0.5), rain), 1 - 0.25 * rain);
    A.cLight = V3.mix(V3.sc(cLight0, 1.3), V3.sc(cRain, 0.45), noon * rain);
    // light shafts: their own colours (blue-white at noon, orange low down)
    const vlNoon = [0.4, 0.75, 1.3], vlSs = V3.sc(V3.pow([0.62, 0.39, 0.24], 1.5 + invNoon), 6.8), vlNight = [0.08, 0.12, 0.23];
    let vl = V3.mix(V3.mix(vlNight, V3.mix(vlSs, vlNoon, noon * noon), sunVis2), rainL, rain);
    const rainyNight = (1 - sunVis) * rain;
    if (sunVis < 0.5) vl = V3.sc(V3.norm(V3.pow(vl, 1 - Math.max(0, 1 - 1.5 * night) + rain)), 0.0766 + 0.0766 * vsB);
    vl = V3.pow(vl, 0.5 + (0.5 + 0.25 * sunVis) * invNoon * invRain + 0.3 * rain);
    vl = V3.sc(vl, 1 - (0.3 + 0.3 * noon) * rain - 0.5 * rainyNight + sunVis * invNoon2 * invRain);
    const vlTime = c01((Math.abs(SdotU) - 0.05) / 0.15);
    let vlMult = vlTime * (rain2 + (1 - rain2) * (invNoon2 * 0.875 + 0.125)) * (1.4 - 0.4 * rain);
    A.vl = ow ? V3.sc(vl, vlMult) : [0, 0, 0]; A.rainyNight = rainyNight;
    // the sun's disc: warm when low
    const discUp = c01((SdotU + 0.1) / 0.15);
    A.sunDisc = V3.sc(V3.mix([3.2, 1.3, 0.45], [2.6, 2.3, 1.9], c01(SdotU / 0.5)), 4 * discUp * invRain);
    // eye sky light (fog in caves), smoothed
    let es = 1;
    try { const p = game.player; if (p && game.world && game.state === 'play') es = game.world.skyAt(Math.floor(r.camPos[0]), Math.floor(r.camPos[1]), Math.floor(r.camPos[2])) / 15; } catch (e) { }
    this.eyeSky += (es - this.eyeSky) * (1 - Math.exp(-dt * 2));
    A.cave = ow ? Math.min(c01(1 - (r.camPos[1] + (r.yOff || 0)) / 61.9), 1 - this.eyeSky) : 0;
    A.bloomFog = ow ? (rain2 * 8 + 3 * (1 - sunFactor)) * this.eyeSky + A.cave * 14 : (dim === 1 ? 14 : 0);
    A.bloomFog *= 0.12 * 8.33333;
    A.rainbow = ow ? c01((this.wet - rain) * 2) * sunVis * invRain : 0;
    A.aurora = ow ? this.snowy * c01(night * 3) * invRain : 0;
    Object.assign(A, { sunVis, sunVis2, sunFactor, noon, night, invNoon2, shadowTime, rain, vsB });
    return A;
  }

  // ---- frame ----------------------------------------------------------------------------
  // called after the camera is set: prepares lighting, renders the shadow map, binds the HDR target
  begin(env, game) {
    const r = this.r, gl = r.gl, cfg = FX_CFG[this.level];
    this.ensure();
    this.env = env; this.cfg = cfg; this.game = game;
    this.frameN++;
    const sd = env.sunDir, hasSky = env.sky === 'overworld' && game.dim === 'overworld';
    const A = this.A = this.atmos(env, game);
    // towards the light: the sun by day, the moon by night (switching at the horizon); a fixed sky light in the end
    const day = sd[1] >= 0;
    const L = game.dim === 'end' ? [0.3, 0.85, 0.42] : day ? sd : [-sd[0], -sd[1], -sd[2]];
    this.sunDir = normalize3([L[0], Math.max(L[1], 0.02), L[2] + 0.0001]);
    this.sunVec = normalize3([sd[0], sd[1], sd[2] + 0.0001]);
    // kept for render.js: the sky draws no square sun while this is set
    this.sunDiscCol = hasSky ? A.sunDisc : null;
    this.shadowOn = !!(cfg.shadow && hasSky && A.shadowTime > 0.001 && this.shadowTex);
    // the cloud layer around y 192: the wind moves the noise (its octaves at halving speeds, so it repeats every 8)
    const yOff = r.yOff || 0;
    this.cloud = new Float32Array([(env.tick * 0.05 * 0.0006) % 8, 192 - yOff, 4000, env.rain || 0]);
    this.cloudsOn = !!(cfg.clouds && hasSky && r.showClouds && !game.headInWater && !game.headInLava);
    // fog: the shaders keep vanilla's only under water / lava / blindness; otherwise post does it
    this.special = !!(game.headInWater || game.headInLava || env.fogFar < 20 || env.sky !== 'overworld');
    this.renderD = env.fogFar;
    if (!this.special) { env.fogNear = 1e8; env.fogFar = 2e8; }
    // TAA: a sub-pixel offset of the whole frame, different every frame
    this.taa = !!cfg.taa;
    M4.mul(this.vpU, r.proj, r.view);
    if (this.taa) {
      const i = (this.frameN % 8) + 1, jx = (halton(i, 2) - 0.5) * 2 / this.size[0], jy = (halton(i, 3) - 0.5) * 2 / this.size[1];
      for (const m of [r.proj, r.vp]) for (let c = 0; c < 4; c++) { m[c * 4] += jx * m[c * 4 + 3]; m[c * 4 + 1] += jy * m[c * 4 + 3]; }
    }
    if (this.shadowOn) { this.renderShadow(cfg); this.renderEntityShadow(cfg); } else this.entShadowOn = false;
    this.invVP.set(invert4(r.vp)); this.invVPU.set(invert4(this.vpU));
    // bind the scene target
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.viewport(0, 0, this.size[0], this.size[1]);
    this.setLightUniforms(this.pEnt);
    for (const P of [this.pChunk, this.pChunkT]) {
      this.setLightUniforms(P);
      gl.uniform1f(P.u.u_wave, 1);
      gl.uniform1i(P.u.u_mat, 5);
      gl.uniform2f(P.u.u_nf, r.near, r.far);
      gl.uniform1i(P.u.u_ssr, cfg.ssr);
      gl.uniformMatrix4fv(P.u.u_invVP, false, this.invVP);
      gl.uniform1i(P.u.u_sceneColor, 6); gl.uniform1i(P.u.u_sceneDepth, 7);
    }
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.activeTexture(gl.TEXTURE0);
    r.fxOn = true;
  }
  setSky(P) {
    const gl = this.r.gl, A = this.A;
    gl.uniform3fv(P.u.u_skyUp, A.skyUp); gl.uniform3fv(P.u.u_skyUpMoon, A.skyUpMoon); gl.uniform3fv(P.u.u_skyMid, A.skyMid);
    gl.uniform3fv(P.u.u_skyMidSun, A.skyMidSun); gl.uniform3fv(P.u.u_skyDown, A.skyDown); gl.uniform3fv(P.u.u_skyBand, A.skyBand);
    gl.uniform3fv(P.u.u_glareCol, A.glare); gl.uniform3fv(P.u.u_sunVec, this.sunVec); gl.uniform4fv(P.u.u_skyK, A.skyK);
  }
  setLightUniforms(P) {
    const gl = this.r.gl, A = this.A;
    gl.useProgram(P.p);
    this.setSky(P);
    gl.uniform3fv(P.u.u_sunDir, this.sunDir);
    gl.uniform3fv(P.u.u_lightCol, A.light); gl.uniform3fv(P.u.u_ambCol, A.amb); gl.uniform3fv(P.u.u_hlCol, A.hl); gl.uniform3fv(P.u.u_blkCol, A.blk);
    gl.uniform4f(P.u.u_tf, A.noon, A.sunVis2, A.rain, A.dim === 2 ? 1 : A.shadowTime);
    gl.uniform4f(P.u.u_tf2, A.vsB, this.env.nightVision || 0, A.invNoon2, A.dim);
    gl.uniform1f(P.u.u_eyeWater, this.game && this.game.headInWater ? 1 : 0);
    gl.uniform1f(P.u.u_frame, this.taa ? this.frameN % 64 : 0);
    gl.uniform1i(P.u.u_shadowOn, this.shadowOn ? 1 : 0);
    gl.uniform1i(P.u.u_taps, this.cfg.taps);
    gl.uniform1f(P.u.u_shadowSize, this.shadowSize || 1);
    gl.uniform1fv(P.u['u_shadowTexelW[0]'], this.shadowTexelW);
    gl.uniform1fv(P.u['u_shadowRange[0]'], this.shadowRange);
    gl.uniformMatrix4fv(P.u['u_shadowVP[0]'], false, this.shadowVP);
    gl.uniform1i(P.u.u_entShadow, this.entShadowOn ? 1 : 0);
    if (P.u.u_fxCam) gl.uniform3fv(P.u.u_fxCam, this.r.camPos);
    if (P.u.u_waveTex) { gl.uniform1i(P.u.u_waveTex, 11); gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, this.noiseTex()); }
    gl.uniform1i(P.u.u_shadow, 3);
    // shadow map on unit 3 (compare); bound even when off so the sampler is valid
    const t = this.shadowTex || this.dummyDepth();
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t); gl.bindSampler(3, this.cmpSampler);
    gl.activeTexture(gl.TEXTURE0);
  }
  depthArray(size, layers) {
    const gl = this.r.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, size, size, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return t;
  }
  // 128 x 128 random values (seeded), filtered and repeating: the clouds' 3D noise is built from it
  cloudNoiseTex() {
    if (this._cnoise) return this._cnoise;
    const gl = this.r.gl, d = new Uint8Array(128 * 128);
    let st = 20261023;
    for (let i = 0; i < d.length; i++) { st = (st * 16807) % 2147483647; d[i] = (st / 2147483647) * 255; }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 128, 128, 0, gl.RED, gl.UNSIGNED_BYTE, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return (this._cnoise = t);
  }
  // a tiling noise (periodic value noise over octaves, 128 x 128), made once: rg = a gradient normal (0.5 = flat),
  // b = a height, a = an independent noise
  noiseTex() {
    if (this._noise) return this._noise;
    const gl = this.r.gl, size = 128;
    const fbm = (seed) => {
      const out = new Float32Array(size * size);
      let amp = 0.5, total = 0;
      for (let period = 4, o = 0; period <= size / 2; period *= 2, o++) {
        const L = new Float32Array(period * period); let s = seed + o * 101;
        for (let i = 0; i < L.length; i++) { s = (s * 16807) % 2147483647; L[i] = s / 2147483647; }
        const cell = size / period, g = (a, b) => L[(b % period) * period + (a % period)];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
          const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
          const v = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * sx, w = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * sx;
          out[y * size + x] += (v + (w - v) * sy) * amp;
        }
        total += amp; amp *= 0.55;
      }
      for (let i = 0; i < out.length; i++) out[i] /= total;
      return out;
    };
    const h = fbm(1234), n = fbm(98765), d = new Uint8Array(size * size * 4), c8 = (v) => Math.max(0, Math.min(255, v));
    const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 6, dz = (at(x, y + 1) - at(x, y - 1)) * 6, len = Math.hypot(dx, 1, dz), i = (y * size + x) * 4;
      d[i] = c8((-dx / len) * 127.5 + 127.5); d[i + 1] = c8((-dz / len) * 127.5 + 127.5); d[i + 2] = c8(h[y * size + x] * 255); d[i + 3] = c8(n[y * size + x] * 255);
    }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return (this._noise = t);
  }
  dummyDepth() {
    if (!this._dummy) this._dummy = this.depthArray(1, 4);
    return this._dummy;
  }
  // The 3 cascades, each an orthographic map from the sun around a point a little ahead of the camera, snapped
  // to whole texels so edges don't crawl. A map is in world space, so it stays valid while nothing it shows
  // changes: each is redrawn when the camera has moved a tenth of its width, the sun has turned (~0.25 deg),
  // terrain near by changed, or after a while (the waving leaves) - the far ones less often than the near one
  renderShadow(cfg) {
    const r = this.r, gl = r.gl, cam = r.camPos, L = this.sunDir, size = cfg.shadow;
    const maxHalf = Math.max(48, (r.renderDist || 8) * 16);
    const halves = cfg.casc.map((h) => Math.min(h, maxHalf));
    // where the camera looks, level
    const v = r.view, fw = [-v[2], 0, -v[10]], fl = Math.hypot(fw[0], fw[2]) || 1;
    const cache = this.shadowCache || (this.shadowCache = [null, null, null]);
    if (r.shadowDirty) { for (const c of cache) if (c) c.dirty = true; r.shadowDirty = false; }
    const EVERY = [4, 8, 16], DIRTY = [3, 6, 12];
    let bound = false;
    for (let i = 0; i < 3; i++) {
      const D = halves[i], c = cache[i];
      if (c && c.size === size && c.half === D && this.frameN - c.frame < EVERY[i] && !(c.dirty && this.frameN - c.frame >= DIRTY[i]) &&
        Math.hypot(cam[0] - c.cam[0], cam[1] - c.cam[1], cam[2] - c.cam[2]) < D * 0.1 && L[0] * c.sun[0] + L[1] * c.sun[1] + L[2] * c.sun[2] > 0.99999) continue;
      cache[i] = { cam: [...cam], sun: [...L], frame: this.frameN, size, half: D, dirty: false };
      const at = [cam[0] + fw[0] / fl * D * 0.4, cam[1], cam[2] + fw[2] / fl * D * 0.4];
      // depth range: the box plus 150 blocks towards the sun for tall things (mountains) casting into it
      const range = D * 2 + 300, view = M4.create(), proj = M4.create();
      lookAtM(view, [L[0] * (D + 150), L[1] * (D + 150), L[2] * (D + 150)], [0, 0, 0], Math.abs(L[1]) > 0.99 ? [1, 0, 0] : [0, 0, 1]);
      const p = [view[0] * at[0] + view[4] * at[1] + view[8] * at[2] + view[12], view[1] * at[0] + view[5] * at[1] + view[9] * at[2] + view[13], view[2] * at[0] + view[6] * at[1] + view[10] * at[2] + view[14]];
      const tw = D * 2 / size;
      p[0] = Math.floor(p[0] / tw) * tw; p[1] = Math.floor(p[1] / tw) * tw;
      M4.ortho(proj, p[0] - D, p[0] + D, p[1] - D, p[1] + D, -p[2] - range / 2, -p[2] + range / 2);
      const vp = M4.create(); M4.mul(vp, proj, view);
      this.shadowVP.set(vp, i * 16); this.shadowTexelW[i] = tw; this.shadowRange[i] = range;
      if (!bound) {
        bound = true;
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3.0);
        gl.useProgram(this.pShadow.p);
        gl.uniform1f(this.pShadow.u.u_time, r.frameTime ?? performance.now() % 10000000);
        gl.uniform1i(this.pShadow.u.u_tex, 0); gl.uniform1i(this.pShadow.u.u_mat, 5);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.matTex);
        // (the shadow array is bound on unit 3 for sampling; it is drawn into here, so unbind it there)
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.texArray);
      }
      this.drawShadowCascade(i, vp, at, D, size);
    }
    if (bound) { gl.disable(gl.POLYGON_OFFSET_FILL); gl.enable(gl.CULL_FACE); }
  }
  // layer 3: last frame's entity draws (game.drawEntities keeps them, the player included in first person) in a
  // 64-block square around the camera, drawn every frame
  renderEntityShadow(cfg) {
    const r = this.r, gl = r.gl, rec = this.entRec, cam = r.camPos, L = this.sunDir, size = cfg.shadow, D = 32;
    this.entShadowOn = false;
    if (!rec || !rec.length) return;
    const range = D * 2 + 300, view = M4.create(), proj = M4.create();
    lookAtM(view, [L[0] * (D + 150), L[1] * (D + 150), L[2] * (D + 150)], [0, 0, 0], Math.abs(L[1]) > 0.99 ? [1, 0, 0] : [0, 0, 1]);
    const p = [view[0] * cam[0] + view[4] * cam[1] + view[8] * cam[2] + view[12], view[1] * cam[0] + view[5] * cam[1] + view[9] * cam[2] + view[13], view[2] * cam[0] + view[6] * cam[1] + view[10] * cam[2] + view[14]];
    const tw = D * 2 / size;
    p[0] = Math.floor(p[0] / tw) * tw; p[1] = Math.floor(p[1] / tw) * tw;
    M4.ortho(proj, p[0] - D, p[0] + D, p[1] - D, p[1] + D, -p[2] - range / 2, -p[2] + range / 2);
    const vp = M4.create(); M4.mul(vp, proj, view);
    this.shadowVP.set(vp, 48); this.shadowTexelW[3] = tw; this.shadowRange[3] = range;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB[3]);
    gl.viewport(0, 0, size, size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3.0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    const E = this.pEntShadow, S = this.pShadow, R2 = (D + 8) * (D + 8);
    let cur = null, vao = null;
    for (const d of rec) {
      const dx = d.m[12] - cam[0], dz = d.m[14] - cam[2];
      if (dx * dx + dz * dz > R2) continue;
      if (d.tex) {
        if (cur !== E) { cur = E; gl.useProgram(E.p); gl.uniformMatrix4fv(E.u.u_vp, false, vp); gl.uniform1i(E.u.u_tex, 1); }
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, d.tex);
        gl.uniformMatrix4fv(E.u.u_model, false, d.m);
      } else {
        if (cur !== S) {
          cur = S; gl.useProgram(S.p); gl.uniformMatrix4fv(S.u.u_vp, false, vp);
          gl.uniform1f(S.u.u_time, r.frameTime ?? performance.now() % 10000000); gl.uniform1i(S.u.u_tex, 0); gl.uniform1i(S.u.u_mat, 5);
          gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.matTex);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.texArray);
        }
        gl.uniformMatrix4fv(S.u.u_model, false, d.m);
      }
      // (a packed model's parts share a VAO and start at their own quad: render.js packParts)
      if (d.vao !== vao) { vao = d.vao; gl.bindVertexArray(vao); }
      gl.drawElements(gl.TRIANGLES, d.n * 1.5, gl.UNSIGNED_INT, d.off || 0);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.enable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.texArray);
    r.tex1 = null; // (unit 1 holds the last skin drawn here, not the one render.js entBegin bound)
    this.entShadowOn = true;
  }
  drawShadowCascade(i, vp, at, D, size) {
    const r = this.r, gl = r.gl, P = this.pShadow;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB[i]);
    gl.viewport(0, 0, size, size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(P.u.u_vp, false, vp);
    const planes = frustumPlanes(vp), R2 = (D * 1.42 + 24) * (D * 1.42 + 24);
    const list = this.casList || (this.casList = []);
    list.length = 0;
    for (const s of r.sections.values()) {
      if (!s.o) continue;
      const dx = s.x + 8 - at[0], dz = s.z + 8 - at[2];
      if (dx * dx + dz * dz > R2) continue;
      if (!aabbInFrustum(planes, s.x, s.y, s.z, s.x + 16, s.y + 16, s.z + 16)) continue;
      list.push(s);
    }
    // by mesh page: depth only, the order changes nothing drawn, and each page's VAO binds once (render.js secDraw;
    // in the sections' order it was a bind per section, ~1 000 for the far cascade)
    list.sort((a, b) => a.o.a.pg.id - b.o.a.pg.id);
    r.secDraw(P, list, true, false);
  }
  // before the translucent pass: snapshot colour + depth for reflections / the water's depth
  copyScene() {
    const gl = this.r.gl, [W, H] = this.size;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFB);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copyFB);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.copyColor);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.copyDepth);
    gl.activeTexture(gl.TEXTURE0);
    this.copied = true;
  }
  pass(P, tgt, setup) {
    const gl = this.r.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null);
    gl.viewport(0, 0, tgt ? tgt.w : this.size[0], tgt ? tgt.h : this.size[1]);
    gl.useProgram(P.p);
    let unit = 0;
    const bind = (name, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.bindSampler(unit, null); if (P.u[name]) gl.uniform1i(P.u[name], unit); unit++; };
    if (P.u.u_texel) gl.uniform2f(P.u.u_texel, 1 / (tgt ? tgt.w : this.size[0]), 1 / (tgt ? tgt.h : this.size[1]));
    if (P.u.u_nf) gl.uniform2f(P.u.u_nf, this.r.near, this.r.far);
    if (P.u.u_invVP) gl.uniformMatrix4fv(P.u.u_invVP, false, this.invVP);
    if (P.u.u_cam) gl.uniform3fv(P.u.u_cam, this.r.camPos);
    if (P.u.u_frame) gl.uniform1f(P.u.u_frame, this.taa ? this.frameN % 64 : 0);
    setup(bind, P);
    gl.bindVertexArray(this.r.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // after the world (and hand) is drawn: post chain to the screen
  end() {
    const r = this.r, gl = r.gl, cfg = this.cfg, [W, H] = this.size, A = this.A, env = this.env, game = this.game;
    r.fxOn = false;
    // the passes below bind their own textures on units 0 - 5: whatever draws after them (previews, icons) binds the
    // terrain / entity programs' textures again (render.js ufState / bindFrameTex: once an epoch)
    r.ufEpoch = (r.ufEpoch || 0) + 1;
    if (!this.copied) this.copyScene();
    this.copied = false;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    const color = this.sceneColor, depth = this.sceneDepth;
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    let vol = null, clouds = null;
    if (cfg.vl && this.shadowOn && (A.vl[0] + A.vl[1] + A.vl[2]) > 0.002) {
      const a = this.target('vol', hw, hh, 'hdr');
      this.pass(this.pVol, a, (bind, P) => {
        bind('u_depth', depth);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowTex); gl.bindSampler(5, this.cmpSampler); gl.uniform1i(P.u.u_shadow, 5);
        gl.uniformMatrix4fv(P.u['u_shadowVP[0]'], false, this.shadowVP.subarray(0, 48)); gl.uniform3fv(P.u.u_sunDir, this.sunDir); gl.uniform1fv(P.u['u_shadowRange[0]'], this.shadowRange.subarray(0, 3));
        gl.uniform3fv(P.u.u_vlCol, A.vl); gl.uniform1i(P.u.u_samples, cfg.vl);
        gl.uniform1f(P.u.u_maxD, Math.max(128, this.renderD * 0.98)); gl.uniform1f(P.u.u_shadowD, cfg.casc[2]);
        gl.uniform4f(P.u.u_vlK, A.rainyNight, this.eyeSky, A.sunVis > 0.5 ? 1 : 0, A.rain * A.rain);
      });
      gl.bindSampler(5, null); gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null); gl.activeTexture(gl.TEXTURE0);
      vol = a.tex;
    }
    if (this.cloudsOn) {
      const t = this.target('clouds', hw, hh, 'hdr');
      this.pass(this.pCloud, t, (bind, P) => {
        bind('u_depth', depth); bind('u_cloudNoise', this.cloudNoiseTex());
        this.setSky(P);
        gl.uniform4fv(P.u.u_cloud, this.cloud);
        gl.uniform3fv(P.u.u_cAmb, A.cAmb); gl.uniform3fv(P.u.u_cLight, A.cLight);
      });
      clouds = t.tex;
    }
    // A: sky, fog, clouds, light shafts -> linear HDR
    const lin = this.target('lin', W, H, 'hdr'), black = this.blackTex();
    const skyOn = env.sky === 'overworld' && !game.headInWater && !game.headInLava ? 1 : 0;
    this.pass(this.pCompose, lin, (bind, P) => {
      bind('u_color', color); bind('u_depth', depth); bind('u_clouds', clouds || black); bind('u_vol', vol || black); bind('u_noise', this.noiseTex());
      this.setSky(P);
      gl.uniform1i(P.u.u_useClouds, clouds ? 1 : 0); gl.uniform1i(P.u.u_useVol, vol ? 1 : 0);
      gl.uniform1i(P.u.u_skyOn, skyOn); gl.uniform1i(P.u.u_fogOn, !this.special && env.sky === 'overworld' ? 1 : 0);
      gl.uniform2f(P.u.u_cloudSlab, this.cloud[1] - 16, this.cloud[1] + 16);
      gl.uniform3fv(P.u.u_sunDisc, A.sunDisc); gl.uniform1f(P.u.u_renderD, Math.max(32, this.renderD - 12)); gl.uniform1f(P.u.u_yOff, r.yOff || 0);
      gl.uniform4f(P.u.u_fogK, A.rain, this.eyeSky, A.cave, A.vsB);
      gl.uniform4f(P.u.u_atmK, 1 - A.night, A.sunVis2, A.noon, A.sunFactor);
      gl.uniform3fv(P.u.u_nightUp, A.nightUp); gl.uniform3fv(P.u.u_dayDownFog, A.dayDownFog);
      gl.uniform4f(P.u.u_misc, A.rainbow, game.headInWater ? 1 : 0, A.aurora, this.special ? 0 : A.bloomFog);
      gl.uniform1f(P.u.u_time, r.frameTime ?? performance.now() % 10000000);
    });
    // bloom: 1/2 (weighted by the bloom haze), then 1/4 .. 1/64 summed back up
    const b0 = this.target('b0', hw, hh, 'hdr');
    this.pass(this.pDown0, b0, (bind) => bind('u_src', lin.tex));
    const chain = [b0];
    for (let i = 1; i <= 5; i++) {
      const prev = chain[i - 1], t = this.target('b' + i, Math.max(1, prev.w >> 1), Math.max(1, prev.h >> 1), 'hdr');
      this.pass(this.pDown, t, (bind) => bind('u_src', prev.tex));
      chain.push(t);
    }
    for (let i = 5; i >= 2; i--) {
      const src = chain[i], dst = this.target('u' + (i - 1), chain[i - 1].w, chain[i - 1].h, 'hdr');
      this.pass(this.pUp, dst, (bind) => { bind('u_src', src.tex); bind('u_add', chain[i - 1].tex); });
      chain[i - 1] = dst;
    }
    const bloom = chain[1].tex;
    // B: grade into LDR
    const ldr = this.target('ldr', W, H, 'ldr');
    this.pass(this.pGrade, ldr, (bind, P) => { bind('u_src', lin.tex); bind('u_bloom', bloom); gl.uniform1f(P.u.u_bloomK, 0.12); });
    let out = ldr;
    if (this.taa) {
      const cur = this.target('hist' + this.histI, W, H, 'ldr'), prev = this.target('hist' + (1 - this.histI), W, H, 'ldr');
      this.pass(this.pTAA, cur, (bind, P) => {
        bind('u_cur', ldr.tex); bind('u_hist', prev.tex); bind('u_depth', depth);
        gl.uniformMatrix4fv(P.u.u_invVPU, false, this.invVPU); gl.uniformMatrix4fv(P.u.u_prevVP, false, this.prevVP);
        gl.uniform1f(P.u.u_reset, this.histOK ? 0 : 1);
      });
      this.histOK = true; this.histI = 1 - this.histI; out = cur;
    } else this.histOK = false;
    this.prevVP.set(this.vpU);
    this.pass(this.pFinal, null, (bind, P) => { bind('u_src', out.tex); gl.uniform1i(P.u.u_fxaa, this.taa ? 0 : 1); gl.uniform1f(P.u.u_sharp, this.taa ? 0.25 : 0.125); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.CULL_FACE);
    for (let i = 0; i < 8; i++) gl.bindSampler(i, null);
    gl.activeTexture(gl.TEXTURE0);
  }
  blackTex() {
    if (!this._black) {
      const gl = this.r.gl; this._black = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._black);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    }
    return this._black;
  }
}
function smoothstep01(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function normalize3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
