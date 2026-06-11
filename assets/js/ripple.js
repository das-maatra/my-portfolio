(function () {
  if (typeof THREE === 'undefined') return;

  function initRipple(img) {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const container = img.parentElement;

    // ── Config ────────────────────────────────────────────────
    const SIM_MAX      = 400;   // cap simulation resolution — keeps perf consistent at any display size
    const SIM_STEPS    = 1;     // wave equation steps per frame
    const DROP_R_RATIO = 0.028; // mouse drop radius as a fraction of sim width
    const MOVE_TH      = 4;     // px cursor must travel before placing a new drop

    // ── Renderer ──────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(1);
    renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    container.appendChild(renderer.domElement);

    let cssW = container.offsetWidth;
    let cssH = container.offsetHeight;
    renderer.setSize(cssW, cssH, false); // false = don't override CSS dimensions

    let W = cssW;
    let H = cssH;
    let simW, simH;

    function buildSimDims() {
      const s = Math.min(1, SIM_MAX / Math.max(W, H));
      simW = Math.max(1, Math.round(W * s));
      simH = Math.max(1, Math.round(H * s));
    }

    // ── Scene ─────────────────────────────────────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    scene.add(quad);

    // ── Image texture ─────────────────────────────────────────
    const imgCanvas = document.createElement('canvas');
    const imgCtx    = imgCanvas.getContext('2d');
    let imgTex;

    function buildImageTex() {
      imgCanvas.width  = W;
      imgCanvas.height = H;
      const s  = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const sw = img.naturalWidth  * s;
      const sh = img.naturalHeight * s;
      imgCtx.clearRect(0, 0, W, H);
      imgCtx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh);
      if (imgTex) imgTex.dispose();
      imgTex = new THREE.CanvasTexture(imgCanvas);
      imgTex.minFilter = imgTex.magFilter = THREE.LinearFilter;
    }

    // ── Ping-pong render targets ───────────────────────────────
    // Two targets at sim resolution — swap each step so we can read
    // the previous frame while writing the next one.
    const rtOpts = {
      type:          THREE.HalfFloatType,
      minFilter:     THREE.LinearFilter,
      magFilter:     THREE.LinearFilter,
      format:        THREE.RGBAFormat,
      depthBuffer:   false,
      stencilBuffer: false
    };
    let rtA, rtB, rtRead, rtWrite;

    function buildRTs() {
      if (rtA) { rtA.dispose(); rtB.dispose(); }
      rtA = new THREE.WebGLRenderTarget(simW, simH, rtOpts);
      rtB = new THREE.WebGLRenderTarget(simW, simH, rtOpts);
      rtRead = rtA; rtWrite = rtB;
    }

    // ── Shaders ───────────────────────────────────────────────
    const VERT = `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

    // Simulation pass — runs at sim resolution.
    // Standard 2D wave equation: next = c2 * avg + (2 - c2) * curr - prev
    // R channel = current height, G = previous height.
    const simMat = new THREE.ShaderMaterial({
      uniforms: {
        tState:            { value: null },
        uTexelSize:        { value: new THREE.Vector2() },
        uDropPos:          { value: new THREE.Vector2(-9999, -9999) },
        uDropRadius:       { value: 30.0 },
        uDropStrength:     { value: 0.55 },
        uAddDrop:          { value: 0.0 },
        uWaveNormal:       { value: new THREE.Vector2(0, 1) },
        uWaveOffset:       { value: 0.0 },
        uWaveHalfW:        { value: 0.0 },
        uWaveFreq:         { value: 0.0 },
        uWaveLateralFreq:  { value: 0.0 },
        uWaveLateralPhase: { value: 0.0 },
        uWaveStrength:     { value: 0.0 },
        uWaveActive:       { value: 0.0 }
      },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tState;
        uniform vec2  uTexelSize;
        uniform vec2  uDropPos;
        uniform float uDropRadius;
        uniform float uDropStrength;
        uniform float uAddDrop;
        uniform vec2  uWaveNormal;
        uniform float uWaveOffset;
        uniform float uWaveHalfW;
        uniform float uWaveFreq;
        uniform float uWaveLateralFreq;
        uniform float uWaveLateralPhase;
        uniform float uWaveStrength;
        uniform float uWaveActive;

        void main() {
          vec2 uv = gl_FragCoord.xy * uTexelSize;
          vec2 ts = uTexelSize;

          float curr = texture2D(tState, uv).r;
          float prev = texture2D(tState, uv).g;

          // 8-neighbour weighted average (diagonals at half weight, normalised by 6)
          float n  = texture2D(tState, uv + vec2( 0.0,  ts.y)).r;
          float s  = texture2D(tState, uv + vec2( 0.0, -ts.y)).r;
          float e  = texture2D(tState, uv + vec2( ts.x,  0.0)).r;
          float w  = texture2D(tState, uv + vec2(-ts.x,  0.0)).r;
          float ne = texture2D(tState, uv + vec2( ts.x,  ts.y)).r;
          float nw = texture2D(tState, uv + vec2(-ts.x,  ts.y)).r;
          float se = texture2D(tState, uv + vec2( ts.x, -ts.y)).r;
          float sw = texture2D(tState, uv + vec2(-ts.x, -ts.y)).r;

          float avg  = ((n + s + e + w) + 0.5 * (ne + nw + se + sw)) / 6.0;
          float c2   = 0.4;
          float next = c2 * avg + (2.0 - c2) * curr - prev;
          next *= 0.988;

          // Mouse drop
          if (uAddDrop > 0.5) {
            float d = distance(gl_FragCoord.xy, uDropPos);
            if (d < uDropRadius)
              next += uDropStrength * (1.0 - d / uDropRadius);
          }

          // Ambient plane wave injection
          if (uWaveActive > 0.5) {
            float proj = dot(gl_FragCoord.xy, uWaveNormal) - uWaveOffset;
            if (proj >= 0.0 && proj < uWaveHalfW) {
              float t       = proj / uWaveHalfW;
              float env     = sin(t * 3.14159265);
              float tang    = dot(gl_FragCoord.xy, vec2(-uWaveNormal.y, uWaveNormal.x));
              // amplitude and phase vary along the wave front so it looks organic
              float ampMod  = 0.35 + 0.65 * abs(sin(tang * uWaveLateralFreq + uWaveLateralPhase));
              float phShift = sin(tang * uWaveLateralFreq * 0.6 + uWaveLateralPhase * 1.7) * 1.4;
              next += uWaveStrength * env * sin(proj * uWaveFreq + phShift) * ampMod;
            }
          }

          gl_FragColor = vec4(next, curr, 0.0, 1.0);
        }
      `
    });

    // Display pass — runs at full display resolution.
    // Reads wave height from the sim texture, displaces UVs, and applies
    // chromatic aberration. Aberration is boosted near active ripples.
    // uTexelSize     = sim-space texel (for neighbour sampling)
    // uDispTexelSize = display-space texel (gl_FragCoord → 0–1 UV)
    // uTime          = wall-clock seconds, framerate-independent
    const dispMat = new THREE.ShaderMaterial({
      uniforms: {
        tState:         { value: null },
        tImage:         { value: null },
        uTexelSize:     { value: new THREE.Vector2() },
        uDispTexelSize: { value: new THREE.Vector2() },
        uFadeAlpha:     { value: 0.0 },
        uTime:          { value: 0.0 }
      },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tState;
        uniform sampler2D tImage;
        uniform vec2  uTexelSize;
        uniform vec2  uDispTexelSize;
        uniform float uFadeAlpha;
        uniform float uTime;

        void main() {
          vec2 uv = gl_FragCoord.xy * uDispTexelSize;
          vec2 ts = uTexelSize;

          // Multi-frequency drift for the base chromatic aberration
          float caX = sin(uTime * 0.38) * 0.018 + sin(uTime * 0.13) * 0.009;
          float caY = cos(uTime * 0.29) * 0.003 + cos(uTime * 0.17) * 0.002;
          vec2 caOff  = vec2(caX, caY);
          vec2 caOffG = vec2(cos(uTime * 0.21) * 0.009, sin(uTime * 0.33) * 0.002);

          // Wave surface gradient → UV displacement
          float wE = texture2D(tState, uv + vec2( ts.x,  0.0)).r;
          float wW = texture2D(tState, uv + vec2(-ts.x,  0.0)).r;
          float wN = texture2D(tState, uv + vec2( 0.0,  ts.y)).r;
          float wS = texture2D(tState, uv + vec2( 0.0, -ts.y)).r;
          vec2 disp   = vec2((wW - wE) * 3.0, (wS - wN) * 3.0);
          vec2 baseUV = clamp(uv + disp, 0.001, 0.999);

          // Amplify aberration near ripple displacement on hover
          float rippleBoost = min(1.0, length(disp) * 25.0) * uFadeAlpha;
          vec2 caFinal  = caOff  * (1.0 + rippleBoost * 6.0);
          vec2 caOffGFinal = caOffG * (1.0 + rippleBoost * 6.0);

          // Sample R/G/B at offset UVs, then convert each to luminance
          vec4 colR = texture2D(tImage, clamp(baseUV + caFinal,     0.001, 0.999));
          vec4 colG = texture2D(tImage, clamp(baseUV + caOffGFinal, 0.001, 0.999));
          vec4 colB = texture2D(tImage, clamp(baseUV - caFinal,     0.001, 0.999));

          gl_FragColor = vec4(
            dot(colR.rgb, vec3(0.299, 0.587, 0.114)),
            dot(colG.rgb, vec3(0.299, 0.587, 0.114)),
            dot(colB.rgb, vec3(0.299, 0.587, 0.114)),
            1.0
          );
        }
      `
    });

    // ── Helpers ───────────────────────────────────────────────
    function setUniformSizes() {
      simMat.uniforms.uTexelSize.value.set(1 / simW, 1 / simH);
      dispMat.uniforms.uTexelSize.value.set(1 / simW, 1 / simH);
      dispMat.uniforms.uDispTexelSize.value.set(1 / W, 1 / H);
    }

    function simulate() {
      simMat.uniforms.tState.value = rtRead.texture;
      quad.material = simMat;
      renderer.setRenderTarget(rtWrite);
      renderer.render(scene, camera);
      const tmp = rtRead; rtRead = rtWrite; rtWrite = tmp;
    }

    function display() {
      dispMat.uniforms.tState.value = rtRead.texture;
      dispMat.uniforms.tImage.value = imgTex;
      quad.material = dispMat;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }

    // ── Animation loop ────────────────────────────────────────
    let isOver = false, fadeAlpha = 0.0, t0 = null;

    function tick(now) {
      if (t0 === null) t0 = now;
      dispMat.uniforms.uTime.value = (now - t0) * 0.0038;

      fadeAlpha = isOver ? 1.0 : Math.max(0.0, fadeAlpha - 0.0018);
      dispMat.uniforms.uFadeAlpha.value = fadeAlpha;

      updateAmbientWave();

      for (let i = 0; i < SIM_STEPS; i++) {
        simulate();
        simMat.uniforms.uAddDrop.value    = 0.0;
        simMat.uniforms.uWaveActive.value = 0.0;
      }

      display();
      requestAnimationFrame(tick);
    }

    // ── Mouse drops ───────────────────────────────────────────
    let lastX = -1, lastY = -1;

    function placeDrop(simX, simY, strength) {
      simMat.uniforms.uDropPos.value.set(simX, simY);
      simMat.uniforms.uDropRadius.value   = simW * DROP_R_RATIO;
      simMat.uniforms.uDropStrength.value = strength;
      simMat.uniforms.uAddDrop.value      = 1.0;
    }

    function addDrop(cssX, cssY) {
      placeDrop(cssX * simW / cssW, simH - cssY * simH / cssH, 0.35);
    }

    function getCSS(e) {
      const r = renderer.domElement.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    function getTouch(e) {
      const r = renderer.domElement.getBoundingClientRect();
      const t = e.touches[0];
      return [t.clientX - r.left, t.clientY - r.top];
    }

    renderer.domElement.addEventListener('mousemove', e => {
      const [cx, cy] = getCSS(e);
      if (lastX >= 0 && Math.hypot(cx - lastX, cy - lastY) > MOVE_TH) addDrop(cx, cy);
      lastX = cx; lastY = cy;
    });

    renderer.domElement.addEventListener('mouseenter', e => {
      isOver = true;
      const [cx, cy] = getCSS(e);
      lastX = cx; lastY = cy;
      addDrop(cx, cy);
    });

    renderer.domElement.addEventListener('mouseleave', () => {
      isOver = false;
      lastX = -1; lastY = -1;
    });

    renderer.domElement.addEventListener('touchstart', e => {
      isOver = true;
      const [cx, cy] = getTouch(e);
      lastX = cx; lastY = cy;
      addDrop(cx, cy);
    });

    renderer.domElement.addEventListener('touchmove', e => {
      const [cx, cy] = getTouch(e);
      if (lastX >= 0 && Math.hypot(cx - lastX, cy - lastY) > MOVE_TH) addDrop(cx, cy);
      lastX = cx; lastY = cy;
    });

    renderer.domElement.addEventListener('touchend', () => {
      isOver = false;
      lastX = -1; lastY = -1;
    });

    // ── Ambient plane waves ───────────────────────────────────
    // Slow waves that drift across the photo so the effect stays alive
    // when the mouse isn't moving. One wave at a time with a random gap.
    // Alternates between cardinal (side) and diagonal directions.
    let ambientWave = null;
    let lastWasDiagonal = false;

    function updateAmbientWave() {
      if (!ambientWave) return;

      const t        = ambientWave.frame / ambientWave.totalFrames;
      const strength = Math.pow(Math.sin(t * Math.PI), 2) * ambientWave.peakStrength;

      simMat.uniforms.uWaveNormal.value.set(ambientWave.nx, ambientWave.ny);
      simMat.uniforms.uWaveOffset.value       = ambientWave.offset;
      simMat.uniforms.uWaveHalfW.value        = ambientWave.halfW;
      simMat.uniforms.uWaveFreq.value         = ambientWave.freq;
      simMat.uniforms.uWaveLateralFreq.value  = ambientWave.lateralFreq;
      simMat.uniforms.uWaveLateralPhase.value = ambientWave.lateralPhase;
      simMat.uniforms.uWaveStrength.value     = strength;
      simMat.uniforms.uWaveActive.value       = 1.0;

      ambientWave.frame++;
      if (ambientWave.frame >= ambientWave.totalFrames) {
        ambientWave = null;
        scheduleAmbient();
      }
    }

    function startAmbientWave() {
      // Alternate cardinal ↔ diagonal, small jitter so it doesn't feel mechanical
      const isDiagonal = !lastWasDiagonal;
      lastWasDiagonal  = isDiagonal;
      const slice = Math.PI * 2 / 4;
      const base  = isDiagonal ? Math.PI / 4 : 0;
      const angle = base + Math.floor(Math.random() * 4) * slice + (Math.random() - 0.5) * slice * 0.2;
      const nx    = Math.cos(angle);
      const ny    = Math.sin(angle);

      // Ray-cast from centre in the opposite direction to find the entry edge
      const cx = simW / 2, cy = simH / 2;
      let tMax = Infinity;
      if (nx >  1e-6) tMax = Math.min(tMax, cx        /  nx);
      if (nx < -1e-6) tMax = Math.min(tMax, (simW - cx) / -nx);
      if (ny >  1e-6) tMax = Math.min(tMax, cy        /  ny);
      if (ny < -1e-6) tMax = Math.min(tMax, (simH - cy) / -ny);

      const bx     = cx - tMax * nx;
      const by     = cy - tMax * ny;
      const offset = bx * nx + by * ny;

      const numCycles    = isDiagonal ? 1.5 + Math.random() * 0.5 : 1 + Math.random() * 0.5;
      const halfW        = Math.max(simW, simH) * 0.18;
      const freq         = (Math.PI * 2 * numCycles) / halfW;
      const lateralFreq  = (Math.PI * 2 * (1 + Math.random())) / Math.min(simW, simH);
      const lateralPhase = Math.random() * Math.PI * 2;

      // Offset so the spatial peak of the strip lands right at the frame edge —
      // distortion is strongest there and fades naturally as the wave travels in
      const entryOffset = offset - halfW * 0.5;

      ambientWave = {
        nx, ny,
        offset: entryOffset,
        halfW,
        freq,
        lateralFreq,
        lateralPhase,
        peakStrength: 0.018 + Math.random() * 0.036,
        frame: 0,
        totalFrames: 120
      };
    }

    function scheduleAmbient() {
      setTimeout(startAmbientWave, 3000 + Math.random() * 5000);
    }

    // ── Resize ────────────────────────────────────────────────
    window.addEventListener('resize', () => {
      cssW = container.offsetWidth;
      cssH = container.offsetHeight;
      W = cssW; H = cssH;
      buildSimDims();
      renderer.setSize(W, H, false);
      setUniformSizes();
      buildImageTex();
      buildRTs();
    });

    // ── Init ──────────────────────────────────────────────────
    function start() {
      img.style.opacity = '0';
      buildSimDims();
      buildImageTex();
      buildRTs();
      setUniformSizes();
      requestAnimationFrame(tick);
      startAmbientWave();
    }

    if (img.complete && img.naturalWidth) start();
    else img.addEventListener('load', start);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const photo = document.querySelector('.about-photo img');
    if (photo) initRipple(photo);
  });
})();
