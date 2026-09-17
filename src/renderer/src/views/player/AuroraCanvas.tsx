import { useEffect, useRef } from 'react';
import type { RGB } from './palette';

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

// Calm version approved in the preview: very slow drift, small amplitude, static grain.
// Grain uses a sin-free hash: fract(sin(...)) loses precision on many GPUs and draws diagonal stripes.
const FRAGMENT = `precision highp float;
uniform float t, mode;
uniform vec2 res;
uniform vec3 c0, c1, c2;
float h(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
void main(){
  vec2 uv = gl_FragCoord.xy / res;
  vec2 p = uv * vec2(res.x / res.y, 1.);
  float s = t * .008;
  vec2 q = p + .08 * vec2(sin(p.y * 1.6 + s * 2.), cos(p.x * 1.4 - s * 1.5));
  vec2 a = vec2(.35 + .12 * sin(s * 1.3), .4 + .08 * cos(s * 1.7));
  vec2 b = vec2(1.15 + .12 * cos(s * 1.1), .72 + .08 * sin(s * 1.9));
  vec2 c = vec2(.8 + .15 * sin(s * .7), .18 + .1 * cos(s));
  float wa = 1. / (.08 + pow(distance(q, a), 2.) * 2.6);
  float wb = 1. / (.08 + pow(distance(q, b), 2.) * 2.6);
  float wc = 1. / (.08 + pow(distance(q, c), 2.) * 2.8);
  vec3 col = (c0 * wa + c1 * wb + c2 * wc) / (wa + wb + wc);
  vec3 warm = vec3(.09, .06, .05);
  col = mix(col * .7, warm + col * .25, mode);
  col *= .55;
  col += (h(floor(gl_FragCoord.xy)) - .5) * .022;
  gl_FragColor = vec4(col, 1.);
}`;

/**
 * Full-bleed gradient painted from artwork colors.
 * `mode` 0 = Aurora, ~0.55 = Pocket, ~0.85 = Vinyl (warmer, darker). `still` freezes motion.
 */
export function AuroraCanvas({ colors, mode, still }: { colors: RGB[]; mode: number; still: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(colors);
  const props = useRef({ mode, still });
  target.current = colors;
  props.current = { mode, still };

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!el || !gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uT = gl.getUniformLocation(prog, 't');
    const uRes = gl.getUniformLocation(prog, 'res');
    const uMode = gl.getUniformLocation(prog, 'mode');
    const uC = ['c0', 'c1', 'c2'].map((n) => gl.getUniformLocation(prog, n));

    const resize = () => {
      // 0.75 resolution: soft enough to be cheap, fine enough that grain doesn't look blocky when scaled.
      const dpr = Math.min(devicePixelRatio, 1.5) * 0.75;
      el.width = Math.max(1, Math.round(el.clientWidth * dpr));
      el.height = Math.max(1, Math.round(el.clientHeight * dpr));
      gl.viewport(0, 0, el.width, el.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let current: RGB[] = target.current.map((c) => [...c] as RGB);
    let currentMode = props.current.mode;
    let frame = 0;
    let last = 0;
    let clock = 0;
    const draw = (ts: number) => {
      const dt = last ? Math.min((ts - last) / 1000, 0.1) : 0;
      last = ts;
      if (!document.hidden) {
        if (!props.current.still) clock += dt;
        const k = Math.min(1, dt * 1.5);
        current = current.map((c, i) => c.map((v, j) => v + ((target.current[i]?.[j] ?? v) - v) * k) as RGB);
        currentMode += (props.current.mode - currentMode) * k;
        gl.uniform1f(uT, clock);
        gl.uniform2f(uRes, el.width, el.height);
        gl.uniform1f(uMode, currentMode);
        uC.forEach((u, i) => gl.uniform3fv(u, current[i]!));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 -z-20 size-full" />;
}
