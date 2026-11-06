/*
 * Cinematic manufacturing scene — dependency-free WebGL2.
 *
 * A high-quality original factory still is used as the texture. The shader
 * continuously animates flowing atmospheric haze, volumetric sunrise, subtle
 * glints over the moving production line, lens breathing and micro-parallax.
 * Hard-edged equipment stays stable instead of being melted by displacement.
 *
 * Fallback: the original CSS background remains fully functional when WebGL,
 * GPU resources or motion preference disallow animation.
 */
(() => {
  const hero = document.getElementById("top");
  const canvas = document.getElementById("hero-cinema");
  // 首屏动效常驻：不再提供暂停开关；缺失按钮节点时用占位对象兜住旧逻辑
  const noopToggle = {
    hidden: false, disabled: false,
    setAttribute() {}, getAttribute() { return "false"; },
    addEventListener() {}, classList: { add() {}, remove() {} },
  };
  const noopLabel = { textContent: "" };
  const button = document.getElementById("cinema-toggle") || noopToggle;
  const buttonLabel = document.getElementById("cinema-toggle-label") || noopLabel;
  if (!hero || !canvas) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  if (reduced.matches) {
    button.hidden = true;
    return;
  }

  const vertexSource = `#version 300 es
    precision highp float;
    in vec2 aPosition;
    out vec2 vUV;
    void main() {
      vUV = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentSource = `#version 300 es
    precision highp float;
    in vec2 vUV;
    out vec4 fragColor;
    uniform sampler2D uImage;
    uniform vec2 uResolution;
    uniform vec2 uImageResolution;
    uniform vec2 uPointer;
    uniform float uTime;
    uniform float uScroll;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),u.x),
                 mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),u.x),u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i=0; i<4; i++) {
        v += a * noise2(p);
        p = p*2.13 + vec2(13.1, 7.9);
        a *= 0.49;
      }
      return v;
    }
    vec2 coverUV(vec2 uv) {
      float screenAspect = uResolution.x / uResolution.y;
      float imageAspect = uImageResolution.x / uImageResolution.y;
      if (screenAspect > imageAspect) {
        uv.y = (uv.y - .5) * (imageAspect / screenAspect) + .5;
      } else {
        uv.x = (uv.x - .5) * (screenAspect / imageAspect) + .5;
      }
      return uv;
    }
    void main() {
      vec2 uv = vUV;
      float t = uTime;
      // Very slow lens breathing; no hard industrial edges are locally warped.
      float zoom = 1.045 + .011 * sin(t*.22);
      vec2 lens = (uv - .5) / zoom + .5;
      lens -= uPointer * .006;
      lens.y += uScroll * .008;
      vec2 sampleUV = coverUV(lens);
      vec3 color = texture(uImage, clamp(sampleUV,vec2(.001),vec2(.999))).rgb;

      // Two broad volumes of cold morning vapor travel at different speeds.
      vec2 mistUV = vec2(uv.x * 3.25 - t*.048, uv.y*2.20 + t*.012);
      float mist = fbm(mistUV + vec2(0.,sin(t*.17)*.13));
      float mist2 = fbm(vec2(uv.x*4.4 + t*.071,uv.y*3.6 - t*.029));
      float fog = smoothstep(.35,.69,mist*.73 + mist2*.27);
      float backDepth = smoothstep(.10,.60,uv.x) * (1. - smoothstep(.74,1.0,uv.x));
      float fogAmount = (.055 + .15*fog) * (.75 + .25*backDepth);
      vec3 mistColor = mix(vec3(.115,.195,.255),vec3(.30,.34,.34),smoothstep(.38,.85,uv.x));
      color = mix(color,mistColor,fogAmount);

      // The architectural sunrise itself breathes and its thin inner rays
      // stream along the established diagonal from upper right.
      float rayDistance = uv.y - (.92*uv.x - .08);
      float sunArea = exp(-pow(rayDistance/.22,2.0)) * smoothstep(.37,.83,uv.x);
      float fibers = .53 + .24*sin(rayDistance*78. + t*.85)
                          + .13*sin(rayDistance*164. - t*.58);
      float rollingDust = fbm(vec2(uv.x*8.1-t*.19,uv.y*6.1+t*.08));
      float sunlight = sunArea * (.65 + .35*sin(t*.38))
                      * clamp(fibers + .3*rollingDust, .20, 1.1);
      color += vec3(.14,.071,.022) * sunlight;

      // Moving warm reflections across the lower-right metallic conveyor.
      // Their travel is continuous; the parts and machine outlines stay put.
      float conveyor = smoothstep(.51,.75,uv.x) * (1. - smoothstep(.34,.58,uv.y));
      float glint = pow(max(0.,sin((uv.x*.83 - uv.y*.23)*38. - t*2.15)), 20.);
      float glint2 = pow(max(0.,sin((uv.x*.57 + uv.y*.19)*51. - t*1.55)), 34.);
      color += vec3(.15,.095,.035) * conveyor * (glint*.38 + glint2*.26);

      // Filmic micro-contrast and a restrained, warm-cool color relationship.
      vec3 slate = vec3(.035,.083,.126);
      float leftDepth = 1. - smoothstep(.04,.60,uv.x);
      color = mix(color,slate,leftDepth*.055);
      float grain = (hash21(gl_FragCoord.xy + fract(t*.73)*191.7)-.5)*.012;
      color += grain;
      fragColor = vec4(clamp(color,0.0,1.0),1.0);
    }
  `;

  let gl, program, texture, locations, context2d, mistLayer, sceneImage;
  let frameId = 0, visible = true, paused = false, initialized = false;
  let lastDraw = 0, frameCount = 0;
  let targetPointer = [0, 0], smoothPointer = [0, 0];
  let imageWidth = 1672, imageHeight = 941;
  let startTime = performance.now(), frozenTime = 0;
  let savedElapsed = 0;

  function unavailable(error) {
    initialized = false;
    hero.classList.remove("cinema-active");
    hero.dataset.cinema = "fallback";
    if (error) hero.dataset.cinemaError = String(error.message || error).slice(0,180);
    button.disabled = true;
    buttonLabel.textContent = "静态场景 · 兼容模式";
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
    }
    return shader;
  }
  function setup(image) {
    sceneImage = image;
    gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, preserveDrawingBuffer: false,
      depth: false, stencil: false, powerPreference: "high-performance"
    });
    if (!gl) {
      setupCanvas2D(image);
      return;
    }
    program = gl.createProgram();
    const vs = compile(gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vs); gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Shader linking failed");
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program,"aPosition");
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);

    texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
    imageWidth = image.naturalWidth; imageHeight = image.naturalHeight;
    locations = {
      image: gl.getUniformLocation(program,"uImage"),
      resolution: gl.getUniformLocation(program,"uResolution"),
      imageResolution: gl.getUniformLocation(program,"uImageResolution"),
      time: gl.getUniformLocation(program,"uTime"),
      pointer: gl.getUniformLocation(program,"uPointer"),
      scroll: gl.getUniformLocation(program,"uScroll")
    };
    gl.uniform1i(locations.image,0);
    gl.uniform2f(locations.imageResolution,imageWidth,imageHeight);
    resize();
    initialized = true;
    startTime = performance.now();
    render(startTime);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL render error");
    hero.classList.add("cinema-active");
    hero.dataset.cinema = "webgl";
    buttonLabel.textContent = "暂停动态场景";
    button.setAttribute("aria-pressed","false");
  }
  function setupCanvas2D(image) {
    context2d = canvas.getContext("2d", { alpha: false });
    if (!context2d) throw new Error("Canvas2D unavailable");
    imageWidth = image.naturalWidth; imageHeight = image.naturalHeight;
    // A light, reusable volumetric-mist texture. Drawn only once, then moved.
    mistLayer = document.createElement("canvas");
    mistLayer.width = 900; mistLayer.height = 420;
    const m = mistLayer.getContext("2d");
    if (!m) throw new Error("Atmosphere layer unavailable");
    let seed = 48271;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i=0;i<65;i++) {
      const x = random()*950-25, y=random()*430;
      const r = 55+random()*165;
      const grad = m.createRadialGradient(x,y,0,x,y,r);
      const warm = random()>.72;
      grad.addColorStop(0,warm ? "rgba(220,185,142,.065)" : "rgba(143,169,181,.07)");
      grad.addColorStop(.46,warm ? "rgba(194,164,129,.028)" : "rgba(118,145,162,.035)");
      grad.addColorStop(1,"rgba(100,135,160,0)");
      m.fillStyle = grad; m.fillRect(x-r,y-r,r*2,r*2);
    }
    resize();
    initialized = true;
    startTime = performance.now();
    render(startTime);
    hero.classList.add("cinema-active");
    hero.dataset.cinema = "canvas2d";
    buttonLabel.textContent = "暂停动态场景";
    button.setAttribute("aria-pressed","false");
  }
  function drawCanvas2D(t) {
    const c = context2d;
    const w = canvas.width, h = canvas.height;
    const zoom = 1.055 + .015*Math.sin(t*.26);
    const scale = Math.max(w/imageWidth,h/imageHeight)*zoom;
    const dw = imageWidth*scale, dh = imageHeight*scale;
    const dx = (w-dw)/2 - smoothPointer[0]*w*.008;
    const dy = (h-dh)/2 - smoothPointer[1]*h*.008;
    c.clearRect(0,0,w,h);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.drawImage(sceneImage,dx,dy,dw,dh);

    // Two independently flowing vapor sheets create persistent real movement.
    const travel1 = (t*10)%(w*.7);
    const travel2 = (t*6)%(w*.95);
    c.globalCompositeOperation = "screen";
    c.globalAlpha = .33+.06*Math.sin(t*.31);
    c.drawImage(mistLayer,-w*.45+travel1,h*.16,w*1.55,h*.68);
    c.globalAlpha = .18+.04*Math.sin(t*.22+1.4);
    c.drawImage(mistLayer,w*.12-travel2,h*.04,w*1.45,h*.78);

    // Sun shafts shift in intensity and in position, without distorting steel.
    c.save();
    c.globalCompositeOperation = "screen";
    const shift = Math.sin(t*.25)*w*.025;
    const beam = c.createLinearGradient(w*.58+shift,h*.45,w*.88+shift,h*.04);
    beam.addColorStop(0,"rgba(255,182,77,0)");
    beam.addColorStop(.43,"rgba(255,194,105,.16)");
    beam.addColorStop(.66,"rgba(255,215,144,.34)");
    beam.addColorStop(1,"rgba(255,193,107,.04)");
    c.globalAlpha = .62+.23*Math.sin(t*.36);
    c.fillStyle = beam;
    c.beginPath();
    c.moveTo(w*.78+shift,0);
    c.lineTo(w*1.03+shift,0);
    c.lineTo(w*.72+shift,h*.69);
    c.lineTo(w*.46+shift,h*.69);
    c.closePath();
    c.fill();
    const glow = c.createRadialGradient(w*.76,h*.43,0,w*.76,h*.43,w*.32);
    glow.addColorStop(0,"rgba(255,200,115,.16)");
    glow.addColorStop(1,"rgba(255,200,115,0)");
    c.globalAlpha = .6+.25*Math.sin(t*.42+.8);
    c.fillStyle=glow;
    c.fillRect(w*.42,h*.05,w*.58,h*.78);
    c.restore();

    // A small series of warm moving reflections along the foreground rollers.
    c.save(); c.globalCompositeOperation="screen";
    c.beginPath();
    c.rect(w*.56,h*.55,w*.44,h*.45); c.clip();
    const offset = (t*75)%Math.max(1,w*.38);
    for (let j=0;j<3;j++) {
      const x = w*.5 + (offset+j*w*.19)%(w*.58);
      const sheen=c.createLinearGradient(x-25,0,x+25,0);
      sheen.addColorStop(0,"rgba(247,179,90,0)");
      sheen.addColorStop(.5,"rgba(255,215,149,.075)");
      sheen.addColorStop(1,"rgba(247,179,90,0)");
      c.fillStyle=sheen; c.fillRect(x-25,h*.58,50,h*.42);
    }
    c.restore();
    c.globalAlpha=1; c.globalCompositeOperation="source-over";
  }
  function resize() {
    if (!gl && !context2d) return;
    const rect = hero.getBoundingClientRect();
    const maxPixels = 1280000;
    const preferredScale = Math.min(window.devicePixelRatio || 1,window.innerWidth < 640 ? .8 : 1.1);
    const scale = Math.min(preferredScale,Math.sqrt(maxPixels/Math.max(1,rect.width*rect.height)));
    canvas.width = Math.max(1,Math.round(rect.width*scale));
    canvas.height = Math.max(1,Math.round(rect.height*scale));
    if (gl) gl.viewport(0,0,canvas.width,canvas.height);
  }
  function render(now) {
    frameId = 0;
    if ((!gl && !context2d) || (!context2d && (!program || !locations)) || (!initialized && frameCount > 0)) return;
    // Mobile GPUs are capped to about 24fps, desktop to 30fps.
    const interval = window.innerWidth < 640 ? 42 : 32;
    if (lastDraw && now-lastDraw < interval) { schedule(); return; }
    lastDraw = now;
    smoothPointer[0] += (targetPointer[0]-smoothPointer[0])*.04;
    smoothPointer[1] += (targetPointer[1]-smoothPointer[1])*.04;
    const elapsed = paused ? frozenTime : savedElapsed + (now - startTime)/1000;
    if (context2d) {
      drawCanvas2D(elapsed);
    } else {
      gl.useProgram(program);
      gl.uniform2f(locations.resolution,canvas.width,canvas.height);
      gl.uniform2f(locations.pointer,smoothPointer[0],smoothPointer[1]);
      gl.uniform1f(locations.time,elapsed);
      gl.uniform1f(locations.scroll,Math.min(1,Math.max(0,window.scrollY/Math.max(1,hero.offsetHeight))));
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
    frameCount++;
    if (frameCount % 90 === 0) hero.dataset.cinemaFrames = String(frameCount);
    schedule();
  }
  function schedule() {
    if (!frameId && initialized && !paused && visible && !document.hidden && !reduced.matches) {
      frameId = requestAnimationFrame(render);
    }
  }
  function setPaused(next) {
    if (!initialized) return;
    paused = next;
    if (paused) {
      frozenTime = savedElapsed + (performance.now()-startTime)/1000;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    } else {
      savedElapsed = frozenTime;
      startTime = performance.now();
      schedule();
    }
    button.setAttribute("aria-pressed",String(paused));
    buttonLabel.textContent = paused ? "继续动态场景" : "暂停动态场景";
    hero.dataset.cinema = paused ? "paused" : (context2d ? "canvas2d" : "webgl");
  }
  hero.addEventListener("pointermove",event => {
    if (!finePointer.matches || !initialized) return;
    const rect = hero.getBoundingClientRect();
    targetPointer = [
      ((event.clientX-rect.left)/rect.width-.5)*2,
      ((event.clientY-rect.top)/rect.height-.5)*2
    ];
  }, { passive:true });
  hero.addEventListener("pointerleave",() => { targetPointer=[0,0]; },{passive:true});

  new ResizeObserver(() => {
    if (!initialized) return;
    resize();
    if (paused) render(performance.now());
  }).observe(hero);
  new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    if (!visible && frameId) { cancelAnimationFrame(frameId); frameId=0; }
    else schedule();
  },{threshold:.01}).observe(hero);
  document.addEventListener("visibilitychange",() => {
    if (document.hidden && frameId) { cancelAnimationFrame(frameId); frameId=0; }
    else schedule();
  });
  reduced.addEventListener?.("change",() => {
    if (reduced.matches) {
      if (frameId) cancelAnimationFrame(frameId);
      frameId=0;
      hero.classList.remove("cinema-active");
      button.hidden=true;
    } else {
      button.hidden=false;
      if (initialized) { hero.classList.add("cinema-active"); schedule(); }
    }
  });
  canvas.addEventListener("webglcontextlost",event => {
    event.preventDefault(); unavailable();
  });

  const image = new Image();
  image.decoding = "async";
  image.onload = () => { try { setup(image); } catch (err) { unavailable(err); } };
  image.onerror = unavailable;
  image.src = "assets/img/hero-golden.jpg";
})();
