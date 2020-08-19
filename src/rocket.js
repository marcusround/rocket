const canvasSketch = require('canvas-sketch');
const glsl = require('glslify');
const random = require('canvas-sketch-util/random');

global.THREE = require('three');
require("three/examples/js/loaders/GLTFLoader");

import { createController } from './controller.js';

// Setup our sketch
const settings = {
  context: 'webgl',
  animate: true
};

const sketch = ({ context, time }) => {

  const s = {
    speed: {
      normalised: 0.5,
      value: 8.0,
      min: 1.0,
      max: 16.0, 
    },
    frequency: {
      normalised: 0.5,
      value: 3.0,
      min: 0.8,
      max: 4.0,
    },
    planetSpacing: 3,
    planetScale: 1.0,
    rocketScale: 1.0,
    trailSettings: {
      lifeCycle: 1,
      axialResolution: 16,
      radialResolution: 12,
      // maxLength: 1.85 * Math.PI,
      startRadius: 0.13,
      maxRadius: 0.26,
      shrinkRate: {
        normalised: 0.5,
        value: 0.006,
        min: 0.002,
        max: 0.024,
      },
    },
    debugMode: false,
    timeSinceLastButtonPress: 0,
  }

  const timeValues = {
    time: 0,
    previous: 0,
    delta: 0,
    speedAdjusted: 0,
  };

  // Create a renderer
  const renderer = new THREE.WebGLRenderer({
    canvas: context.canvas
  });

  renderer.setClearColor(0x002244);

  // Setup a camera
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, -4);
  camera.lookAt(new THREE.Vector3());

  const controller = createController(context.canvas);
  
  if ( ! s.debugMode ) {
    controller.angleRestriction.alpha = Math.PI * 0.09;
    controller.angleRestriction.beta = Math.PI * 0.14;
  }
  
  const scene = new THREE.Scene();

  scene.add(controller.trackball);
  controller.trackball.add(camera);

  const starfieldFrag = glsl(/* glsl */`
    #define STAR_LAYER_COUNT 8.

    varying vec2 vUv;
    uniform float time;

    float Star(vec2 uv)
    {
      float d = length(uv);
      // float m =.012/d;
      // m *= m;
      // m *= m;
      float m = smoothstep(0.01,0.008,d);
      return m;
    }

    float Hash21(vec2 p) {
      // Pseudorandom number generator
      p = fract(p*vec2(123.45, 678.91));
      p += dot(p, p+45.32);
      return fract(p.x * p.y);
    }

    float StarLayer(vec2 uv)
    {
      float col = 0.;

      vec2 gv = fract(uv)-.5;
      vec2 id = floor(uv);
      
      float n = Hash21(id);
      
      float size = fract(n*123.456);
      float star = Star(gv-0.93*(vec2(n,fract(n*67.89))-.5));
      
      col += star;
      return col;
    }

    float Starfield (vec2 uv, float t)
    {
      float col = 0.;
      for (float i=0.; i <= 1.; i += 1./STAR_LAYER_COUNT)
      {
          float scale = mix(19.,1.5,i);
          col += StarLayer(uv*scale + vec2(2.5*t, .0) + i * 123.456);
      }
      return col;
    }

    void main()
    {
      // Adjust for aspect ratio of plane
      vec2 st = vUv * vec2(1.2,1.);

      float t = time * -.03;
      
      vec3 col = vec3(.03,.09,.26);
      col += Starfield (st, t);

      gl_FragColor = vec4(col,1.0);
    }
  `);

  const basicVertShader = glsl(/* glsl */`
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vNormal = normal;
      vUv =  uv ;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `);

  const bg = new THREE.Mesh(
    new THREE.PlaneBufferGeometry(1,1,1),
    new THREE.ShaderMaterial({
      vertexShader: basicVertShader,
      fragmentShader: starfieldFrag,
      uniforms: {
        time: { value: time }
      }
    })
  );

  bg.rotation.set(Math.PI, 0, 0);
  bg.scale.set(25,20,1);
  bg.position.set(0,0,4);
  scene.add(bg);

  const planetFrag = glsl(/* glsl */`
    precision highp float;
    
    uniform sampler2D palette;
    varying float elevation;
  
    float between (float value, float min, float max) {
      return step(min, value) * step(value, max);
    }

    float fitToIndex(float index, float count) {
      return ( 0.5 + index ) / count;
    }
  
    void main () {
      // Palette height ranges and indices
      float ocean = between(elevation, 0.00, 0.04) * fitToIndex(0., 7.);
      float beach = between(elevation, 0.04, 0.06) * fitToIndex(2., 7.);
      float grass = between(elevation, 0.06, 1.00) * fitToIndex(1., 7.);
      
      // One and only one terrain should be non-zero
      float terrain = ocean + beach + grass;
  
      // Map to image uv
      vec4 sample = texture2D(palette,vec2(terrain,0.));

      vec3 color = sample.xyz;
      gl_FragColor = vec4(color, 1.0);
    }
  `);

  const planetVert = glsl(/* glsl */`
    varying vec2 vUv;
    varying float elevation;
  
    uniform sampler2D palette;
  
    uniform float seed;
  
    #pragma glslify: noise = require('glsl-noise/classic/4d');
  
    void main () {
      vUv = uv;
      vec3 pos = position.xyz;
      float land      = noise(vec4( 3.0 * position.xyz , seed));
      float detail    = noise(vec4( 6.0 * position.xyz , seed + 123.));
      float continent = noise(vec4( 1.5 * position.xyz , seed + 456.));
  
      // Normalise to 0..1
      detail = (detail + 1.) * .5;
      land = (land + 1.) * .5;
      continent = (continent + 1.) * .5;
  
      // Refine each layer;
      detail = .5 * detail * detail * detail;
      land = .75 * land;
      continent = -1. * continent;
  
      elevation = detail + land + continent;
  
      pos += normal * elevation * 0.15;
      gl_Position =
        projectionMatrix * modelViewMatrix
        * vec4(pos, 1.0);
    }
  `);

  // Setup a geometry
  const sphereGeo = new THREE.SphereBufferGeometry(1, 24, 24);

  const paletteTexture = new THREE.TextureLoader().load("tex/palette.png");
  paletteTexture.minFilter = THREE.NearestFilter;
  paletteTexture.magFilter = THREE.NearestFilter;
  
  const planets = []
  const rockets = [];
  const loader = new THREE.GLTFLoader();
  loader.load( 'gltf/rocket.gltf', (gltf) => {

    gltf.scene.traverse( (child) => {

      if (child.isMesh) {
        let rocket = new THREE.Mesh(
          child.geometry,
          new THREE.MeshBasicMaterial({
            map: paletteTexture,
            side: THREE.DoubleSide,
            wireframe: s.debugMode,
          })
        )

        rocket.scale.set(0.01 * s.rocketScale,0.01 * s.rocketScale,0.01 * s.rocketScale);

        rocket.trail = new Trail(s.trailSettings);

        rocket.paths = {
          xRot: new Path(4., Math.PI / 4, 2.),
          y: new Path(1., Math.PI / 12, 2.),
          z: new Path(1., Math.PI / 8., 2.),
        }
        
        scene.add(rocket);
        scene.add(rocket.trail);
        rockets.push(rocket);

      }
    })

    // Only add planets once rocket is loaded, so the timing is synced
    for (let i = 0; i < planetPositions.length; i += 2) {
      const planet = new Planet(s.planetSpacing * planetPositions[i], planetPositions[i+1], i);
      planets.push(planet);
      scene.add(planet);
    }
  });
  
  class Marker extends THREE.Mesh {
    constructor(x, color, scale) {
      super(
        sphereGeo,
        new THREE.MeshBasicMaterial({color: color})
      );
      this.startX = x;
      this.position.x = x;
      this.scale.set(scale,scale,scale);
      scene.add(this);
    }

    update( timeAdjusted ) {
      this.position.setX((this.startX + ( timeAdjusted )) % (16*s.planetSpacing) - 5 * s.planetSpacing);
    }
  };

  const planetPositions = [
    /* x, z */
    1.00 * Math.PI, 0.0,
    2.10 * Math.PI, 0.25, 
    3.75 * Math.PI, 0.0, 
    4.50 * Math.PI, 0.0
  ];
  const markers = {};

  if (s.debugMode)
  {
    markers.planetSpacing = [];
    for (let x = 0; x < 16 * s.planetSpacing; x += Math.PI * s.planetSpacing) {
      const m = new Marker( x, 0xcccc00, 0.005*x);
      markers.planetSpacing.push(m);
    }
  
    markers.xPos    = new Marker(-0.5, 0xff0000, 0.03);
    markers.yPos    = new Marker(-0.5, 0x00ff00, 0.03);
    markers.zPos    = new Marker(-0.5, 0x0000ff, 0.03);
    markers.nullPos = new Marker(-0.5, 0xffffff, 0.03);
    
    markers.xRot    = new Marker(0.5, 0xff0000, 0.03);
    markers.yRot    = new Marker(0.5, 0x00ff00, 0.03);
    markers.zRot    = new Marker(0.5, 0x0000ff, 0.03);
    markers.nullRot = new Marker(0.5, 0xffffff, 0.03);
  }

  class Planet extends THREE.Mesh {
    constructor(x, z, seed) {
      /* Each planet must have its own
      * material, so that the seed can be
      * changed without affecting other planets
      */
      super(
        sphereGeo,
        new THREE.ShaderMaterial({
          fragmentShader: planetFrag,
          vertexShader: planetVert,
          uniforms: {
            palette: { value: paletteTexture },
            seed: { value: seed }
            },
            wireframe: s.debugMode,
        })
      )
      this.startX = x;
      this.scale.set(s.planetScale, s.planetScale, s.planetScale);
      this.seed = seed;
      this.rotation.x = random.gaussian();
      this.position.z = z;
      this.needsRespawn = false;
    }
      
    update( timeAdjusted, time ) {
      this.position.setX((this.startX + ( timeAdjusted )) % (16*s.planetSpacing) - 5 * s.planetSpacing);
      this.position.setY(.5 * Math.sin( (time + this.seed)  * 1.5));
      this.rotation.y = time * 1.8;
      if (this.position.x > 0)
      {
        this.needsRespawn = true;
      }
      else if (this.needsRespawn)
      {
        this.respawn((123.45 * time)%321);
      }
    }
    
    respawn(seed) {
      this.seed = seed;
      this.material.uniforms.seed.value = seed;
      this.rotation.x = random.gaussian();
      this.needsRespawn = false;
    }
  }

  class Path { 
    constructor ( amplitude, frequency, wobble ) {
      this.amplitude = amplitude;
      this.frequency = frequency;
      this.wobble = wobble;
      this._startFrequency = frequency;
      this._frequency = frequency;
      this._phase = 0.0;
    }

    SetMultiplier(m) {
      this.frequency = this._startFrequency * m;
    }

    UpdateFrequency(t) {
      if (this.frequency != this._frequency) {
        let curr = (t * this._frequency + this._phase) % (2 * Math.PI);
        let next = (t * this.frequency) % (2 * Math.PI);
        this._phase = curr - next;
        this._frequency = this.frequency;
      }
    }

    getPosition(t) {
      const sin = Math.sin(this._frequency * t + this._phase);
      return sin * this.amplitude * this.wobble * 2. * (1. - (this.wobble/2) * Math.abs(sin));
    }

    getRotation(t) {
      return this.getPosition(t+.66/this._frequency)
              - this.getPosition(t-.33/this._frequency);
    }
  }

  let circleGeo = new THREE.CircleBufferGeometry(
    1,
    s.trailSettings.radialResolution
  );

  let trailMaterial = new THREE.MeshBasicMaterial({
    color: 0xfece2a,
    wireframe: s.debugMode
  })

  let safeSpawnPoint = -2 * Math.PI;

  const sphereMesh = new THREE.Mesh(
    sphereGeo, trailMaterial);
  sphereMesh.position.setX(safeSpawnPoint);
  scene.add(sphereMesh);

  class TrailCircle extends THREE.Mesh {
    constructor(x, y, z, r, shrinkRate) {
      super(circleGeo,trailMaterial);
      this.r = r;
      this.position.set(x, y, z);
      this.rotation.reorder('YXZ');
      this.rotation.set(0, Math.PI / 2, 0);
      this.scale.set(r, r, r);
      this.visible = s.debugMode;
      this.age = 0;
      this.shrinkRate = shrinkRate;

    }

    Shrink() {

      if ( this.r < this.shrinkRate ) {
        this.r = 0;
      } else { 
        this.r -= this.shrinkRate;
      }

    }
    
    Update() {
      
      this.scale.setScalar(this.r);
      // MatrixWorld must be updated before trail.FitToCircles
      this.updateMatrixWorld();

    }
  }

  class Trail extends THREE.Mesh {
    constructor(trailSettings) {

      super(
        new THREE.CylinderBufferGeometry(
          1, 1,
          trailSettings.maxLength,
          trailSettings.radialResolution,
          trailSettings.axialResolution - 1,
          true
        ),
        trailMaterial
      )

      this.userData = { ...trailSettings };

      this.circles = new Array(this.userData.axialResolution);

      let circleSpacing = this.userData.maxLength / (this.userData.axialResolution - 1);

      for (let i = 0; i < this.userData.axialResolution; i++) {

        this.circles[i] = new TrailCircle(
          i * circleSpacing, 0, 0,
          this.userData.startRadius,
          this.userData.shrinkRate.value
        );

        scene.add(this.circles[i]);

      }

      this.leader = this.circles[0];

      this.FitToCircles();

    }

    MoveTrail(speed) {

      let lastCircle = this.circles[this.circles.length - 1];
      let endTrigger = lastCircle.age > this.userData.lifeCycle ;

      for (let i = this.circles.length - 1; i >= 0; i--) {

        let thisCircle = this.circles[i];

        if ( endTrigger && i > 0 ) {

          let targetCircle = this.circles[i - 1];

          /* For full accuracy, the first follower should
           * get its own position and rotation from the path,
           * rather than simply offsetting the leader. But
           * it's only really a problem when both speed and 
           * frequency are very high, so we don't bother
           */ 
          thisCircle.position.set(
            targetCircle.position.x,
            targetCircle.position.y,
            targetCircle.position.z
          );
          thisCircle.rotation.set(
            targetCircle.rotation.x,
            targetCircle.rotation.y,
            targetCircle.rotation.z
          );

          thisCircle.r = targetCircle.r;
          thisCircle.shrinkRate = targetCircle.shrinkRate;

        }

        if ( i > 0 ) {
          thisCircle.position.x += speed;
          thisCircle.Shrink();
        }
        
        thisCircle.Update();
        
      }
      
      if ( endTrigger ) {
        lastCircle.age = 0;
      }
      lastCircle.age += 1;

      // Probably inefficient to call FitToCircles
      // separately as opposed to doing it all in one
      // loop. But for now its easier to read/write
      // separately
      this.FitToCircles();

    }

    FitToCircles() {
      /* 
       * Attach the vertices of the cylinder mesh
       * to each of the circles in the trail
       */
      const cylinderVertexPositions = this.geometry.getAttribute('position').clone();

      // Both Cylinder and Circle have duplicate vertex at seam
      const numPointsOnCircle = this.userData.radialResolution + 1;
      
      for (let i = 0; i < this.circles.length; i++) {

        const circleVertexWorldPositions =
          this.circles[i].geometry
            .getAttribute('position')
            .clone()
            .applyMatrix4(this.circles[i].matrixWorld);


        for (let j = 0; j < numPointsOnCircle; j++) {
          cylinderVertexPositions.copyAt(
            i * numPointsOnCircle + j, // Cylinder vertex index
            circleVertexWorldPositions,
            j + 1 //Circle vertex index (skips first central vertex)
          );
        }

      }

      this.geometry.setAttribute('position', cylinderVertexPositions);
    }
  }

  return {
    resize({ pixelRatio, viewportWidth, viewportHeight }) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(viewportWidth, viewportHeight, false);
      camera.aspect = viewportWidth / viewportHeight;
      camera.zoom = 0.82 * Math.sqrt ( Math.abs ( viewportWidth / viewportHeight ) );
      camera.updateProjectionMatrix();
    },

    // Update & render
    render({ time }) {
      
      timeValues.time = time;
      timeValues.delta = time - timeValues.previous;

      timeValues.speedAdjusted += timeValues.delta * s.speed.value;

      controller.update();

      renderer.render(scene, camera);
      
      bg.material.uniforms.time.value = timeValues.speedAdjusted;
      
      planets.forEach( p => p.update( timeValues.speedAdjusted, timeValues.time ) );
      
      if (s.debugMode) {
        markers.planetSpacing.forEach((marker) => {
          marker.update( timeValues.speedAdjusted );
        });
      }
      
      if ( controller.pointer.hasEverBeenPressed ) {

        if ( controller.pointer.isPressed ) {

          s.speed.normalised +=
          ( 1 - s.speed.normalised )
          * ( 1 - s.speed.normalised )
          * 0.05;
          
          s.trailSettings.shrinkRate.normalised = ( 1 - s.speed.normalised );
          
          s.timeSinceLastButtonPress = 0;
  
        } else {
  
          s.timeSinceLastButtonPress += timeValues.delta;

          if ( s.timeSinceLastButtonPress > 14 ) {

            // Resume normal speed after period of inactivity
            s.speed.normalised = Math.min( 0.5, s.speed.normalised + 0.001 );
            s.trailSettings.shrinkRate.normalised = ( 1 - s.speed.normalised );

          } else {

            s.speed.normalised *= 0.995;
            s.trailSettings.shrinkRate.normalised += 0.1;

          }

        }

        s.speed.normalised = Math.min(1, Math.max(0, s.speed.normalised));
        s.trailSettings.shrinkRate.normalised = Math.min(1, Math.max(0, s.trailSettings.shrinkRate.normalised));
        const sp = sineWaveMap(s.speed.normalised, 0, 1, 3 * Math.PI/2, 5 * Math.PI/2, true);
        s.speed.value = s.speed.min + sp * ( s.speed.max - s.speed.min );

        s.trailSettings.shrinkRate.value = 
          s.trailSettings.shrinkRate.min
          + s.trailSettings.shrinkRate.normalised
            * ( s.trailSettings.shrinkRate.max - s.trailSettings.shrinkRate.min );

      }

      rockets.forEach((rocket) => {
        
        rocket.paths.xRot.SetMultiplier( s.speed.value / s.planetSpacing );
        rocket.paths.y.SetMultiplier( s.speed.value / s.planetSpacing );
        rocket.paths.z.SetMultiplier( s.speed.value / s.planetSpacing );

        rocket.paths.xRot.UpdateFrequency( timeValues.time );
        rocket.paths.y.UpdateFrequency( timeValues.time );
        rocket.paths.z.UpdateFrequency( timeValues.time );

        rocket.position.y = rocket.paths.y.getPosition( timeValues.time );
        rocket.rotation.z = Math.PI / 2 - 0.1 * rocket.paths.y.getRotation( timeValues.time );
        
        rocket.position.z = 2. * rocket.paths.z.getPosition( timeValues.time );
        rocket.rotation.y = .5 * rocket.paths.z.getRotation( timeValues.time );
        
        rocket.rotation.x = .036 * rocket.paths.xRot.getRotation( timeValues.time );

        rocket.trail.leader.position.set(
          rocket.position.x,
          rocket.position.y,
          rocket.position.z
        );

        rocket.trail.leader.rotation.set(
          rocket.rotation.z - Math.PI/2,
          rocket.rotation.y - Math.PI/2,
          0,
        );
        
        rocket.trail.leader.shrinkRate = s.trailSettings.shrinkRate.value;

        rocket.trail.leader.updateMatrixWorld();

        // TODO remove the need for this magic number
        rocket.trail.MoveTrail(s.speed.value * 0.012);
        
        if (s.debugMode) {
          markers.xPos.position.x = rocket.position.x;
          markers.yPos.position.y = rocket.position.y;
          markers.zPos.position.z = rocket.position.z;
          markers.xRot.position.x = rocket.rotation.x;
          markers.yRot.position.y = rocket.rotation.y;
          markers.zRot.position.z = rocket.rotation.z -Math.PI / 2;
        }
      })
      
      timeValues.previous = time;
    },
    
    // Dispose of events & renderer for cleaner hot-reloading
    unload() {
      renderer.dispose();
      controller.dispose();
    }
  }
};

const sineWaveMap = function(x, min, max, mapMin, mapMax, normalise) {

  // Map x to a segment of a sine wave, for easing

  if (x < min) {
    x = min
  }
  if (x > max) {
    x = max
  }

  const fx = Math.sin(mapMin + (mapMax - mapMin) * (x - min) / (max - min))
  
  if (normalise) {
    return 0.5 * ( 1 + fx )
  } else {
    return fx
  }

}

canvasSketch(sketch, settings);
