export function createController(canvas, opts = {}) {
  
    /* An attempt at a generalised THREE.js controller for
     * proscenium-style viewing of a scene (ie. <180 viewing angle)
     * with simple one-button interaction that works cross-platform,
     * bashed together from @mattdesl's canvas-sketch mouse input
     * https://github.com/mattdesl/canvas-sketch/issues/42
     * and the THREE.js DeviceOrientationControls
     */
    /* A work in progress; I gave up on getting z/gamma 
     * rotation working, that would require working 
     * with quaternions to rotate the trackball - but
     * implementing that would require more time to dive
     * into quaternions ¯\_(ツ)_/¯
     */
    
    const controller = {
      
      pointer: {
        x: 0,
        y: 0,
        hasEverChanged: false,
        isPressed: false,
        hasEverBeenPressed: false
      },
  
      deviceOrientation: {
        alpha: 0,
        beta: 0,
        gamma: 0,
        hasEverChanged: false,
      },
  
      screenOrientation: {
        value: window.orientation || 0,
        hasEverChanged: false,
      },
  
      deviceMotionSinceLastUpdate: {
        alpha: 0,
        beta: 0,
        gamma: 0,
        interval: 0,
        hasEverChanged: false,
      },
  
      angleRestriction: { 
        alpha: Math.PI,
        beta: Math.PI,
      },
  
      angleOffset: {
        alpha: 0,
        beta: Math.PI * 0.5,
      },
      
      sensitivity: {
        pointer: 0.2,
        orientation: 4.0,
        reset: 0.05,
      },
  
      hand: new THREE.Vector2(),
      joystick: new THREE.Vector2(),
      trackball: new THREE.Object3D(),
  
      _joystickMovement: new THREE.Vector2(),
      _joystickNormalised: new THREE.Vector2(),
      _joystickMovementNormalised: new THREE.Vector2(),
      
      dispose,
      update
    };
  
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
  
    window.addEventListener("mousedown", down);
    window.addEventListener("touchstart", down);
  
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
  
    window.addEventListener("orientationchange", onScreenOrientation);
    window.addEventListener("deviceorientation", onDeviceOrientation);
    window.addEventListener("devicemotion", onDeviceMotion);
  
    const setObjectQuaternion = function () {
  
          const zed = new THREE.Vector3( 0, 0, 1 );
  
          const euler = new THREE.Euler();
  
          const q0 = new THREE.Quaternion();
  
          const q1 = new THREE.Quaternion( - Math.sqrt( 0.5 ), 0, 0, Math.sqrt( 0.5 ) ); // - PI/2 around the x-axis
  
          return function ( quaternion, alpha, beta, gamma, orient ) {
  
              euler.set( beta, alpha, - gamma, 'YXZ' );
  
              quaternion.setFromEuler( euler ); // orient the device
  
              quaternion.multiply( q1 ); // camera looks out the back of the device, not the top
  
              quaternion.multiply( q0.setFromAxisAngle( zed, - orient ) ); // adjust for screen orientation
  
          };
  
    }();
    
    return controller;
  
    function move(ev) {
  
      ev.preventDefault();
  
      const cx = ev.clientX || (ev.touches ? ev.touches[0].clientX : 0);
      const cy = ev.clientY || (ev.touches ? ev.touches[0].clientY : 0);
      const rect = canvas.getBoundingClientRect();
  
      controller.pointer.x = cx - rect.left;
      controller.pointer.y = cy - rect.top;
      
      controller.pointer.hasEverChanged = true;
      
      if (opts.onMove) opts.onMove(ev);
  
    }
  
    function down(ev) {
  
      controller.pointer.isPressed = true;

      controller.pointer.hasEverBeenPressed = true;
      
      if (opts.onMouseDown) opts.onMouseDown(ev);
  
    }
  
    function up(ev) {
  
      controller.pointer.isPressed = false;
  
      if (opts.onMouseUp) opts.onMouseUp(ev);
  
    } 
  
    function onScreenOrientation(ev) {
  
      controller.screenOrientation.value = window.orientation || 0;
      controller.screenOrientation.hasEverChanged = true;
  
      if (opts.onScreenOrientation) opts.onScreenOrientation(ev);
      
    }
    
    function onDeviceOrientation(ev) {
  
      controller.deviceOrientation.alpha = ev.alpha;
      controller.deviceOrientation.beta = ev.beta;
      controller.deviceOrientation.gamma = ev.gamma;
      
      controller.deviceOrientation.hasEverChanged = true;
      
      if (opts.onDeviceOrientation) opts.onDeviceOrientation(ev);
      
    }
    
    function onDeviceMotion(ev) {
  
      controller.deviceMotionSinceLastUpdate.alpha += ev.rotationRate.alpha ;
      controller.deviceMotionSinceLastUpdate.beta  += ev.rotationRate.beta  ;
      controller.deviceMotionSinceLastUpdate.gamma += ev.rotationRate.gamma ;
  
      controller.deviceMotionSinceLastUpdate.interval += ev.interval;
  
      controller.deviceMotionSinceLastUpdate.hasEverChanged = true;
      
      if (opts.onDeviceMotion) opts.onDeviceMotion();
      
    }
  
    function update() {

      const c = controller;
  
      // Reset joystick secondary vectors
      c._joystickNormalised.set(0,0);
      c._joystickMovement.set(0,0);
      c._joystickMovementNormalised.set(0,0);
  
      let orientable = c.deviceMotionSinceLastUpdate.hasEverChanged
  
      if ( c.pointer.hasEverChanged ) {
  
        // Remap pointer screen position between -1 and 1
        c.hand.x = - ( 2 * ( c.pointer.x / canvas.width  ) - 1 );
        c.hand.y = - ( 2 * ( c.pointer.y / canvas.height ) - 1 );
        
        if ( !orientable || c.pointer.isPressed ) {
  
          // Joystick moves towards hand position
          c._joystickMovement.x += c.sensitivity.pointer * ( c.hand.x - c.joystick.x );
          c._joystickMovement.y += c.sensitivity.pointer * ( c.hand.y - c.joystick.y );
  
        }
        
      }
  
      if ( orientable ) {
  
        const r = c.deviceMotionSinceLastUpdate;
        
        if ( r.interval == 0 ) return; // Prevent divide-by-zero
        
        c._joystickMovement.x += c.sensitivity.orientation * THREE.MathUtils.degToRad( r.beta / r.interval )  ;
        c._joystickMovement.y += c.sensitivity.orientation * THREE.MathUtils.degToRad( - r.alpha / r.interval ) ;
  
        // Joystick gradually resets back to zero
        c._joystickMovement.x -= c.sensitivity.reset * c.joystick.x;
        c._joystickMovement.y -= c.sensitivity.reset * c.joystick.y;
  
        // Device motion hard resets every update
        c.deviceMotionSinceLastUpdate.alpha = 0;
        c.deviceMotionSinceLastUpdate.beta  = 0;
        c.deviceMotionSinceLastUpdate.gamma = 0;
        c.deviceMotionSinceLastUpdate.interval = 0;
  
      }
  
      // Get magnitude and make it exponential
      let magnitude = c.joystick.length();
      let m = 1 - ( 1 - magnitude ) * ( 1 - magnitude );
  
      // Update normalised vectors
      c._joystickMovementNormalised.copy( c._joystickMovement ).normalize();
      c._joystickNormalised.copy( c.joystick ).normalize();
      
      // Get dot product and map between -1 and 1
      let dotNormal = c._joystickNormalised.dot( c._joystickMovementNormalised );
      let dot = 0.5 * ( dotNormal + 1 );
  
      // Resulting movement is greater when moving towards centre of joystick
      const o = 1 - m * dot;
  
      c.joystick.x += c._joystickMovement.x * o ;
      c.joystick.y += c._joystickMovement.y * o ;
  
      c.joystick.clampLength( 0, 1 );
      
      // Set the final orientation of the trackball ( for camera to anchor to )
      setObjectQuaternion(
        c.trackball.quaternion,
        c.angleOffset.alpha + c.joystick.x *  c.angleRestriction.alpha,
        c.angleOffset.beta  + c.joystick.y * -c.angleRestriction.beta ,
        0,
        THREE.MathUtils.degToRad( c.screenOrientation.value )
      );
  
    }
  
    function dispose() {
      
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
  
      window.removeEventListener("mousedown", down);
      window.removeEventListener("touchstart", down);
  
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
  
      window.removeEventListener("orientationchange", onScreenOrientation);
      window.removeEventListener("deviceorientation", onDeviceOrientation);
      window.removeEventListener("devicemotion", onDeviceMotion);
      
    }
  }