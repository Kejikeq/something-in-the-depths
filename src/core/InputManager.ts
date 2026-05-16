export interface InputState {
  moveX: number; // -1 to 1 (A/D, Joystick Left/Right)
  moveY: number; // -1 to 1 (W/S, Joystick Up/Down)
  lookX: number; // Relative look delta X
  lookY: number; // Relative look delta Y
  jump: boolean; // Just pressed (edge trigger) or held, depending on physics
  action: boolean; // primary action (dig)
  secondaryAction: boolean; // secondary action
  toggleLight: boolean;
  interact: boolean;
}

export class InputManager {
  private keys: { [key: string]: boolean } = {};
  private pointerLocked: boolean = false;
  
  // Mouse state
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private mouseDown = false;

  // Touch state
  private touchState = {
    joystickId: -1,
    joystickStart: { x: 0, y: 0 },
    moveVec: { x: 0, y: 0 },
    lookId: -1,
    lastLook: { x: 0, y: 0 }
  };

  // Gamepad state
  private gamepadIndex: number | null = null;
  private lastGamepadJump = false;
  private lastGamepadAction = false;
  private lastGamepadLight = false;
  private lastGamepadInteract = false;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundClick: () => void;
  private boundPointerLockChange: () => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;
  private boundGamepadConnect: (e: GamepadEvent) => void;
  private boundGamepadDisconnect: (e: GamepadEvent) => void;

  private triggers = {
    jump: false,
    action: false,
    toggleLight: false,
    interact: false,
  };

  private deadzone = 0.15;

  constructor(private canvas?: HTMLCanvasElement) {
    this.boundKeyDown = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') this.triggers.jump = true;
      if (e.code === 'KeyF') this.triggers.toggleLight = true;
      if (e.code === 'KeyE') this.triggers.interact = true;
      
      // Release cursor when Alt is pressed
      if (e.altKey || e.code === 'AltLeft' || e.code === 'AltRight') {
        if (this.pointerLocked) {
          document.exitPointerLock();
        }
        e.preventDefault();
      }
    };
    this.boundKeyUp = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys[e.code] = false;
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        e.preventDefault();
      }
    };
    this.boundClick = () => {
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      const isAltPressed = this.keys['AltLeft'] || this.keys['AltRight'];
      if (!this.pointerLocked && this.canvas && !isAltPressed) {
        try {
          const promise = this.canvas.requestPointerLock() as unknown as Promise<void>;
          if (promise && typeof promise.catch === 'function') {
            promise.catch((e) => {
              if (e.name !== 'NotAllowedError' && e.name !== 'SecurityError') {
                 console.warn("Pointer lock error:", e);
              }
            });
          }
        } catch (err) {
          // Fallback for non-promise requestPointerLock
        }
      }
    };
    this.boundPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    };
    this.boundMouseMove = (e) => {
      if (this.pointerLocked) {
        // Clamp to avoid spikes (PointerLock bug in some browsers)
        const mx = Math.max(-100, Math.min(100, e.movementX));
        const my = Math.max(-100, Math.min(100, e.movementY));
        this.mouseDeltaX += mx;
        this.mouseDeltaY += my;
      }
    };
    this.boundMouseDown = (e) => {
      if (e.button === 0 && this.pointerLocked) this.triggers.action = true;
    };
    this.boundTouchStart = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.clientX < window.innerWidth / 2 && this.touchState.joystickId === -1) {
          this.touchState.joystickId = touch.identifier;
          this.touchState.joystickStart = { x: touch.clientX, y: touch.clientY };
          this.touchState.moveVec = { x: 0, y: 0 };
        } else if (this.touchState.lookId === -1) {
          this.touchState.lookId = touch.identifier;
          this.touchState.lastLook = { x: touch.clientX, y: touch.clientY };
        }
      }
    };
    this.boundTouchMove = (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.touchState.joystickId) {
          const dx = touch.clientX - this.touchState.joystickStart.x;
          const dy = touch.clientY - this.touchState.joystickStart.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const max = 50;
          const scale = Math.min(dist, max) / max;
          const angle = Math.atan2(dy, dx);
          this.touchState.moveVec = { x: Math.cos(angle) * scale, y: Math.sin(angle) * scale };
        } else if (touch.identifier === this.touchState.lookId) {
          this.mouseDeltaX += (touch.clientX - this.touchState.lastLook.x) * 2.0; 
          this.mouseDeltaY += (touch.clientY - this.touchState.lastLook.y) * 2.0;
          this.touchState.lastLook = { x: touch.clientX, y: touch.clientY };
        }
      }
    };
    this.boundTouchEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.touchState.joystickId) {
          this.touchState.joystickId = -1;
          this.touchState.moveVec = { x: 0, y: 0 };
        } else if (touch.identifier === this.touchState.lookId) {
          this.touchState.lookId = -1;
        }
      }
    };
    this.boundGamepadConnect = (e) => {
      console.log("Gamepad connected at index %d: %s.", e.gamepad.index, e.gamepad.id);
      this.gamepadIndex = e.gamepad.index;
    };
    this.boundGamepadDisconnect = (e) => {
      console.log("Gamepad disconnected from index %d: %s", e.gamepad.index, e.gamepad.id);
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    };

    if (this.canvas) {
      this.initializeListeners();
    }
  }

  public setCanvas(canvas: HTMLCanvasElement) {
    if (this.canvas) this.dispose();
    this.canvas = canvas;
    this.initializeListeners();
  }

  private initializeListeners() {
    this.initKeyboard();
    this.initMouse();
    this.initTouch();
    this.initGamepad();
  }

  private initKeyboard() {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
  }

  private initMouse() {
    this.canvas.addEventListener('click', this.boundClick);
    document.addEventListener('pointerlockchange', this.boundPointerLockChange);
    document.addEventListener('mousemove', this.boundMouseMove);
    this.canvas.addEventListener('mousedown', this.boundMouseDown);
  }

  private initTouch() {
    this.canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.boundTouchEnd);
  }

  private initGamepad() {
    window.addEventListener("gamepadconnected", this.boundGamepadConnect);
    window.addEventListener("gamepaddisconnected", this.boundGamepadDisconnect);
  }

  public dispose() {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    this.canvas.removeEventListener('click', this.boundClick);
    document.removeEventListener('pointerlockchange', this.boundPointerLockChange);
    document.removeEventListener('mousemove', this.boundMouseMove);
    this.canvas.removeEventListener('mousedown', this.boundMouseDown);
    this.canvas.removeEventListener('touchstart', this.boundTouchStart);
    this.canvas.removeEventListener('touchmove', this.boundTouchMove);
    this.canvas.removeEventListener('touchend', this.boundTouchEnd);
    window.removeEventListener("gamepadconnected", this.boundGamepadConnect);
    window.removeEventListener("gamepaddisconnected", this.boundGamepadDisconnect);
  }

  private applyDeadzone(value: number): number {
    return Math.abs(value) > this.deadzone ? value : 0;
  }

  public getState(): InputState {
    const state: InputState = {
      moveX: 0,
      moveY: 0,
      lookX: this.mouseDeltaX,
      lookY: this.mouseDeltaY,
      jump: this.triggers.jump || this.keys['Space'],
      action: this.triggers.action || this.keys['Mouse0'],
      secondaryAction: false,
      toggleLight: this.triggers.toggleLight,
      interact: this.triggers.interact,
    };

    // Reset deltas and triggers
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.triggers.jump = false;
    this.triggers.action = false;
    this.triggers.toggleLight = false;
    this.triggers.interact = false;

    // 1. Keyboard Input
    if (this.keys['KeyW'] || this.keys['ArrowUp']) state.moveY += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) state.moveY -= 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) state.moveX -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) state.moveX += 1;

    // 2. Touch Input (Overrides keyboard if active)
    if (this.touchState.joystickId !== -1) {
      // MoveVec y is positive downwards in screen space, we want positive for W/forward
      state.moveX = this.touchState.moveVec.x;
      state.moveY = -this.touchState.moveVec.y; 
    }

    // 3. Gamepad Input (Adds to or overrides previous)
    if (this.gamepadIndex !== null) {
      const gamepad = navigator.getGamepads()[this.gamepadIndex];
      if (gamepad) {
        // Left stick (Axes 0 and 1)
        const gpMoveX = this.applyDeadzone(gamepad.axes[0]);
        const gpMoveY = -this.applyDeadzone(gamepad.axes[1]); // Y axis is usually inverted
        if (gpMoveX !== 0 || gpMoveY !== 0) {
          state.moveX = gpMoveX;
          state.moveY = gpMoveY;
        }

        // Right stick (Axes 2 and 3) -> look
        const gpLookX = this.applyDeadzone(gamepad.axes[2]);
        const gpLookY = this.applyDeadzone(gamepad.axes[3]);
        // Gamepad look is continuous per frame, scale appropriately.
        // Assume 60fps, sensitivity multiplier
        state.lookX += gpLookX * 20.0; 
        state.lookY += gpLookY * 20.0;

        // Buttons
        // Button A (usually index 0)
        const jumpPressed = gamepad.buttons[0].pressed;
        if (jumpPressed && !this.lastGamepadJump) { state.jump = true; }
        this.lastGamepadJump = jumpPressed;

        // Button X or Right Trigger for Action
        const actionPressed = gamepad.buttons[2].pressed || gamepad.buttons[7].pressed;
        if (actionPressed && !this.lastGamepadAction) { state.action = true; }
        this.lastGamepadAction = actionPressed;

        // Y or Triangle / D-Pad UP for Light
        const lightPressed = gamepad.buttons[3].pressed || gamepad.buttons[12].pressed;
        if (lightPressed && !this.lastGamepadLight) { state.toggleLight = true; }
        this.lastGamepadLight = lightPressed;

        // B or Square / D-Pad DOWN for Interact
        const interactPressed = gamepad.buttons[1].pressed || gamepad.buttons[13].pressed;
        if (interactPressed && !this.lastGamepadInteract) { state.interact = true; }
        this.lastGamepadInteract = interactPressed;
      }
    }

    // Normalize keyboard movement to avoid 1.41x diagonal speed
    if (this.gamepadIndex === null && this.touchState.joystickId === -1 && (state.moveX !== 0 || state.moveY !== 0)) {
        const len = Math.sqrt(state.moveX * state.moveX + state.moveY * state.moveY);
        state.moveX /= len;
        state.moveY /= len;
    }

    return state;
  }

  public getJoystickUIData() {
      return {
          active: this.touchState.joystickId !== -1,
          baseX: this.touchState.joystickStart.x,
          baseY: this.touchState.joystickStart.y,
          thumbX: this.touchState.moveVec.x * 50,
          thumbY: this.touchState.moveVec.y * 50
      };
  }
  
  public virtualAction() {
    this.triggers.action = true;
  }
  
  public virtualJump() {
      this.triggers.jump = true;
  }

  public reset() {
    this.keys = {};
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.triggers = {
      jump: false,
      action: false,
      toggleLight: false,
      interact: false,
    };
    this.touchState.moveVec = { x: 0, y: 0 };
    this.touchState.joystickId = -1;
    this.touchState.lookId = -1;
  }
}
