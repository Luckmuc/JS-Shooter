import * as THREE from 'three';

const FIXED_STEP = 1 / 60;
const MAX_BULLETS = 30;

export default class Game {
  constructor() {
    this.clock = new THREE.Clock();
    this.accumulator = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x20232a);

  this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  // camera stays at local origin; we position the player via yawObject
  this.camera.position.set(0, 0, 0);

  // player root: yaw (y-rotation) -> pitch (x-rotation) -> camera
  this.yawObject = new THREE.Object3D();
  this.pitchObject = new THREE.Object3D();
  this.yawObject.add(this.pitchObject);
  this.pitchObject.add(this.camera);
  // set initial player position (camera height)
  this.yawObject.position.set(0, 1.6, 5);
  this.scene.add(this.yawObject);

  // preallocate arrays used by environment creation
  this.buildingPositions = [];
  this.buildingDoors = [];
  this.insideBuilding = null;
  this.clouds = [];
  this.buildingBoxes = []; // { box3, topY, climbable }
  this.stairBoxes = []; // { box3, topY }
  // runtime arrays needed during world creation
  this.bullets = [];
  this.tracers = [];
  this.targets = [];
  this.score = 0;

    // prefer WebGL2 when available, then try graceful fallbacks
    let renderer = null;
    const canvas = document.createElement('canvas');
    // 1) try WebGL2 with antialias
    try {
      const ctx2 = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
      if (ctx2) {
        renderer = new THREE.WebGLRenderer({ canvas, context: ctx2 });
        console.log('Using WebGL2 context');
      }
    } catch (e) { renderer = null; }

    // 2) try WebGL1 context manually with antialias off (lower memory)
    if (!renderer) {
      try {
        const ctx1 = canvas.getContext('webgl', { antialias: false, powerPreference: 'high-performance' }) || canvas.getContext('experimental-webgl');
        if (ctx1) {
          renderer = new THREE.WebGLRenderer({ canvas, context: ctx1 });
          console.log('Using WebGL1 context');
        }
      } catch (e) { renderer = null; }
    }

    // 3) fallback to letting Three.js create a renderer (may still fail)
    if (!renderer) {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        console.log('Using default WebGL renderer (antialias:false)');
      } catch (e) {
        try {
          renderer = new THREE.WebGLRenderer();
          console.log('Using default WebGL renderer (final fallback)');
        } catch (err) {
          console.warn('WebGL renderer could not be created; continuing without renderer.');
          renderer = null;
        }
      }
    }
    this.renderer = renderer;
    if (this.renderer) {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      document.body.appendChild(this.renderer.domElement);
    } else {
      // renderer not available; UI will show message in start()
      console.warn('Renderer not available; game will show an overlay on start.');
    }

  this._setupLights();
  this._setupWorld();
  // improved environment
  this._createSky();
  this._createGround();
  this._createClouds();
    // weapons: configs for hitscan behavior
    this.weapons = [
      { id: 'shotgun', name: 'Shotgun', fireRate: 1.2, pellets: 9, spread: 0.14, damage: 1, automatic: false, scopeFov: this.camera.fov },
      { id: 'sniper', name: 'Sniper', fireRate: 0.6, pellets: 1, spread: 0.0, damage: 10, automatic: false, scopeFov: 12 },
      { id: 'smg', name: 'SMG', fireRate: 14.0, pellets: 1, spread: 0.02, damage: 1, automatic: true, scopeFov: this.camera.fov }
    ];
    this.currentWeaponIndex = 2; // start with SMG
  this.unlocked = { shotgun: false, sniper: false, smg: true };
  this.money = 50; // starting money
  this.buildingPositions = [];
  // shooting / autoshoot state
  this.shooting = false;
  this.timeSinceLastShot = 0;
  // world setup moved to _setupWorld
  }

  _setupLights() {
    // Ambient + directional for pleasant daylight
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x444422, 0.8);
    hemi.position.set(0, 200, 0);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(-100, 200, -100);
    dir.castShadow = true;
    dir.shadow.camera.left = -200;
    dir.shadow.camera.right = 200;
    dir.shadow.camera.top = 200;
    dir.shadow.camera.bottom = -200;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    // a subtle fill light to keep interiors readable
    const fill = new THREE.DirectionalLight(0x9999ff, 0.25);
    fill.position.set(120, 80, 80);
    this.scene.add(fill);
  }

  _setupWorld() {
    // Recreate the stable grid city, sidewalks, trees and buildings
    const cols = 6, rows = 6;
    const blockW = 36, blockD = 36;
    const gap = 8; // street width
    const startX = -((cols * (blockW + gap)) / 2) + (blockW + gap)/2;
    const startZ = -((rows * (blockD + gap)) / 2) - 120 + (blockD + gap)/2;
    const palette = [0xd9e6f2, 0xe8d8c3, 0xcfe3d6, 0xd0cbe6, 0xe6e0c9];

    // central park
    const parkSize = 80;
    const park = new THREE.Mesh(new THREE.CircleGeometry(parkSize, 32), new THREE.MeshStandardMaterial({ color: 0x6db36b }));
    park.rotation.x = -Math.PI/2;
    park.position.set(startX + (cols/2)*(blockW+gap) - (blockW+gap)/2, 0.01, startZ + (rows/2)*(blockD+gap) - (blockD+gap)/2);
    this.scene.add(park);

    // fountain
    const fountain = new THREE.Mesh(new THREE.CylinderGeometry(6,6,0.6,24), new THREE.MeshStandardMaterial({ color: 0x8fbce6 }));
    fountain.position.set(park.position.x, 0.3, park.position.z);
    this.scene.add(fountain);

    // materials
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2e2e2e });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cf });

    // grid of roads and buildings
    for (let cx = 0; cx < cols; cx++) {
      for (let cz = 0; cz < rows; cz++) {
        const px = startX + cx * (blockW + gap);
        const pz = startZ + cz * (blockD + gap);

        // road X and Z (one horizontal, one vertical) centered between blocks
        const roadX = new THREE.Mesh(new THREE.PlaneGeometry(blockW + gap, gap), roadMat);
        roadX.rotation.x = -Math.PI/2; roadX.position.set(px, 0.02, pz - (blockD/2 + gap/2)); this.scene.add(roadX); roadX.userData.hittable = true;
        const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(gap, blockD + gap), roadMat);
        roadZ.rotation.x = -Math.PI/2; roadZ.position.set(px - (blockW/2 + gap/2), 0.02, pz); this.scene.add(roadZ); roadZ.userData.hittable = true;

        // park center, add more trees near park center
        if (Math.abs(cx - cols/2) < 1 && Math.abs(cz - rows/2) < 1) {
          for (let t = 0; t < 10; t++) {
            const tx = px + (Math.random()-0.5)*blockW*0.6; const tz = pz + (Math.random()-0.5)*blockD*0.6;
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2, 6), new THREE.MeshStandardMaterial({ color: 0x5b3b2b }));
            trunk.position.set(tx, 1, tz);
            const foliage = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2f8b2f }));
            foliage.position.set(0, 1.6, 0); trunk.add(foliage); this.scene.add(trunk); trunk.userData.hittable = true;
          }
        }

        // create 1-3 buildings per block, placed neatly
        const count = 1 + Math.floor(Math.random()*2);
        for (let i = 0; i < count; i++) {
          const bw = 10 + Math.random()*12; const bd = 10 + Math.random()*10; const bh = 6 + Math.random()*18;
          const color = palette[Math.floor(Math.random()*palette.length)];
          const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
          const bx = px + (i === 0 ? -8 : 8) + (Math.random()-0.5)*6;
          const bz = pz + (Math.random()-0.5)*6;
          const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
          box.position.set(bx, bh/2, bz);

          // door on a random face but ensure it faces a road
          const face = Math.random() > 0.5 ? 'x+' : 'z+';
          // use a thin box for doors so depth and hinge are visible
          const doorDepth = 0.12;
          const doorGeo = new THREE.BoxGeometry(0.9, 1.95, doorDepth);
          const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b3b2b });
          const door = new THREE.Mesh(doorGeo, doorMat);
          if (face === 'x+') {
            door.position.set(bw/2 - doorDepth/2 - 0.02, -bh/2 + 1.0, 0);
            door.rotation.y = -Math.PI/2;
            door.userData.hinge = 'x+';
          } else {
            door.position.set(0, -bh/2 + 1.0, bd/2 - doorDepth/2 - 0.02);
            door.userData.hinge = 'z+';
          }
          door.userData.isDoor = true; door.userData.open = false;
          box.add(door);

          // windows: bluish glass material
          const winMat = new THREE.MeshStandardMaterial({ color: 0x6fb3ff, emissive: 0x224466, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.95 });
          const colsW = Math.max(1, Math.floor(bw/3)); const rowsW = Math.max(1, Math.floor(bh/2.5));
          for (let wx = 0; wx < colsW; wx++) for (let wy = 0; wy < rowsW; wy++) {
            if (Math.random() > 0.75) continue;
            const ww = 0.9, wh = 0.9;
            const w = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), winMat);
            const ux = -bw/2 + 1 + wx * (bw-2) / Math.max(1, colsW-1);
            const uy = -bh/2 + 1.1 + wy * 1.9;
            // put windows on all 4 faces
            const w1 = w.clone(); w1.position.set(bw/2 - 0.03, uy, ux); w1.rotation.y = -Math.PI/2; box.add(w1);
            const normal1 = new THREE.Vector3(1,0,0);
            const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, wh+0.06, ww+0.06), new THREE.MeshStandardMaterial({ color: 0x444444 }));
            f1.position.copy(w1.position).add(normal1.clone().multiplyScalar(0.035)); f1.rotation.copy(w1.rotation); box.add(f1);
            const w2 = w.clone(); w2.position.set(-bw/2 + 0.03, uy, ux); w2.rotation.y = Math.PI/2; box.add(w2);
            const normal2 = new THREE.Vector3(-1,0,0);
            const f2 = f1.clone(); f2.position.copy(w2.position).add(normal2.clone().multiplyScalar(0.035)); f2.rotation.copy(w2.rotation); box.add(f2);
            const w3 = w.clone(); w3.position.set(ux, uy, bd/2 - 0.03); box.add(w3);
            const normal3 = new THREE.Vector3(0,0,1);
            const f3 = f1.clone(); f3.position.copy(w3.position).add(normal3.clone().multiplyScalar(0.035)); f3.rotation.copy(w3.rotation); box.add(f3);
            const w4 = w.clone(); w4.position.set(ux, uy, -bd/2 + 0.03); w4.rotation.y = Math.PI; box.add(w4);
            const normal4 = new THREE.Vector3(0,0,-1);
            const f4 = f1.clone(); f4.position.copy(w4.position).add(normal4.clone().multiplyScalar(0.035)); f4.rotation.copy(w4.rotation); box.add(f4);
          }

          // roof and small details
          const roof = new THREE.Mesh(new THREE.BoxGeometry(bw*1.02, 0.4, bd*1.02), new THREE.MeshStandardMaterial({ color: 0x2e2e2e, roughness: 0.7 }));
          roof.position.set(0, bh/2 + 0.2, 0); box.add(roof);

          // maybe add a climbable balcony
          let climbable = false;
          if (Math.random() > 0.65) {
            climbable = true;
            const bal = new THREE.Mesh(new THREE.BoxGeometry(Math.min(3, bw*0.6), 0.3, 2), new THREE.MeshStandardMaterial({ color: 0x333333 }));
            bal.position.set(bw/2 - 0.3, -bh/2 + 1.4, 0);
            box.add(bal);
            bal.userData.climbable = true;
          }

          box.userData.hittable = true;
          this.scene.add(box);
          // compute bounding box for collisions
          const bb = new THREE.Box3().setFromObject(box);
          this.buildingBoxes.push({ box3: bb, topY: bb.max.y, climbable });

          // create interior: visible stairs, floor rooms, and elevator shaft + car
          const floors = Math.max(2, Math.floor(bh / 6));
          const stairWidth = Math.min(2.2, bw * 0.4);
          const stairs = [];
          // elevator shaft and car
          const elevShaft = new THREE.Mesh(new THREE.BoxGeometry(1.2, bh * 0.9, 1.2), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
          elevShaft.position.set(box.position.x, 0, box.position.z - bd/4);
          this.scene.add(elevShaft);
          const carHeight = bh / Math.max(1, floors);
          const elevCar = new THREE.Mesh(new THREE.BoxGeometry(1.0, carHeight * 0.9, 1.0), new THREE.MeshStandardMaterial({ color: 0x111111 }));
          elevCar.position.set(elevShaft.position.x, -bh/2 + carHeight/2, elevShaft.position.z);
          this.scene.add(elevCar);

          for (let f = 0; f < floors; f++) {
            const sy = -bh/2 + (f + 0.5) * (bh / Math.max(1, floors));
            // visible stair landing
            const step = new THREE.Mesh(new THREE.BoxGeometry(stairWidth, 0.3, 2.2), new THREE.MeshStandardMaterial({ color: 0x6b6b6b }));
            step.position.set(bx - bw/4, sy - 0.2, bz);
            this.scene.add(step);
            // simple floor room
            const room = new THREE.Mesh(new THREE.BoxGeometry(bw*0.6, (bh / Math.max(1, floors)) * 0.85, bd*0.6), new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.9 }));
            room.position.set(box.position.x + bw*0.15, sy, box.position.z);
            this.scene.add(room);
            // room door facing corridor
            const roomDoor = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.8), new THREE.MeshStandardMaterial({ color: 0x1e1e1e }));
            roomDoor.position.set(room.position.x + (bw*0.6)/2 - 0.02, sy - (bh / Math.max(1,floors))/2 + 0.9, room.position.z);
            roomDoor.rotation.y = -Math.PI/2;
            this.scene.add(roomDoor);
            // occasional target in room
            if (Math.random() > 0.5) {
              const targ = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10), new THREE.MeshStandardMaterial({ color: 0xff4444 }));
              targ.position.set(room.position.x, sy - 0.2, room.position.z);
              this.scene.add(targ);
              this.targets.push({ mesh: targ, alive: true });
            }
            // invisible stair collision helper for climbing/stepping
            const stairMesh = new THREE.Mesh(new THREE.BoxGeometry(stairWidth, 0.4, 1.6), new THREE.MeshStandardMaterial({ color: 0x000000, opacity: 0.0, transparent: true }));
            stairMesh.position.set(bx - bw/4, sy - 0.1, bz);
            stairMesh.visible = false;
            this.scene.add(stairMesh);
            const sbb = new THREE.Box3().setFromObject(stairMesh);
            this.stairBoxes.push({ box3: sbb, topY: sbb.max.y });
            stairs.push(stairMesh);
          }

          // save door world position and interior teleports
          const doorWorld = door.getWorldPosition(new THREE.Vector3());
          const insidePos = new THREE.Vector3(box.position.x, 1.2, box.position.z);
          this.buildingDoors.push({ doorPos: doorWorld.clone(), insidePos, outsidePos: new THREE.Vector3(bx + 2, 1.6, bz + 2), building: box, door, elevator: { shaft: elevShaft, car: elevCar, floors, currentFloor: 0, carHeight: carHeight } });
          this.buildingPositions.push(box.position.clone());
        }
      }
    }

    // sidewalks along roads
    for (let i = -6; i <= 6; i += 6) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(1000, 3), sidewalkMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(i * 10 - 100, 0.02, -100);
      this.scene.add(sw);
      sw.userData.hittable = true;
    }

    // add street lamps and benches for charm
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    for (let i = -6; i <= 6; i += 4) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 8), lampMat);
      pole.position.set(i * 12, 1.5, -40);
      this.scene.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b6 }));
      bulb.position.set(pole.position.x, 2.6, pole.position.z);
      this.scene.add(bulb);
      pole.userData.hittable = true;
    }

    // benches
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x6b3b2b });
    for (let i = 0; i < 12; i++) {
      const bx = -60 + i * 10;
      const bz = -20 + (i % 3) * 6;
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 0.6), benchMat);
      bench.position.set(bx, 0.4, bz);
      this.scene.add(bench);
    }

    // add some trees along sidewalks
    for (let i = 0; i < 40; i++) {
      const x = -100 + (Math.random() - 0.5) * 600;
      const z = -100 + (Math.random() - 0.5) * 600;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2, 6), new THREE.MeshStandardMaterial({ color: 0x5b3b2b }));
      trunk.position.set(x, 1, z);
      const foliage = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0x2f8b2f }));
      foliage.position.set(0, 1.6, 0);
      trunk.add(foliage);
      this.scene.add(trunk);
      trunk.userData.hittable = true;
    }
  }
  _setupUI() {
    this.targetsEl = document.getElementById('targets');
    this._updateScore();

    // create shop overlay (hidden by default) with money display and buttons
    this.shopEl = document.createElement('div');
    this.shopEl.style.position = 'fixed';
    this.shopEl.style.left = '50%';
    this.shopEl.style.top = '50%';
    this.shopEl.style.transform = 'translate(-50%,-50%)';
    this.shopEl.style.padding = '14px';
    this.shopEl.style.minWidth = '320px';
    this.shopEl.style.background = 'rgba(10,10,12,0.95)';
    this.shopEl.style.color = '#fff';
    this.shopEl.style.border = '1px solid #333';
    this.shopEl.style.display = 'none';
    this.shopEl.style.zIndex = 9999;
    this.shopEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="margin:0">Shop</h3>
        <div>Money: $<span id="money">${this.money}</span></div>
      </div>
      <div id="shop-list" style="display:flex;flex-direction:column;gap:8px">
      </div>
      <div style="margin-top:8px"><small>Press B to close</small></div>
    `;
    const list = this.shopEl.querySelector('#shop-list');
    const addBtn = (id, label, cost) => {
      const btn = document.createElement('button');
      btn.dataset.weapon = id;
      btn.textContent = `${label} - $${cost}`;
      btn.style.padding = '10px'; btn.style.fontSize = '14px';
      btn.onclick = () => { this._buyWeapon(id, cost); };
      list.appendChild(btn);
      if (this.unlocked[id]) { btn.disabled = true; btn.textContent = `${label} (Owned)`; }
    };
    addBtn('smg', 'SMG', 120);
    addBtn('shotgun', 'Shotgun', 150);
    addBtn('sniper', 'Sniper', 200);
    document.body.appendChild(this.shopEl);

    // mini-map canvas (top-left)
    this.miniCanvas = document.createElement('canvas');
    this.miniCanvas.width = 200; this.miniCanvas.height = 200;
    this.miniCanvas.style.position = 'fixed';
    this.miniCanvas.style.left = '8px';
    this.miniCanvas.style.top = '8px';
    this.miniCanvas.style.zIndex = '9998';
    this.miniCanvas.style.border = '2px solid rgba(0,0,0,0.4)';
    document.body.appendChild(this.miniCanvas);
  }

  _setupControls() {
    // basic pointer lock + movement
  this.move = { forward: 0, right: 0 };
  this.velocity = new THREE.Vector3();
  this.gravity = -24.0;
  this.jumpSpeed = 8.0;
  this.standingHeight = 1.6;
  this.crouchHeight = 1.05;
  this.crouching = false;
  this.grounded = false;

    const onKey = (e, value) => {
      const down = value;
      switch (e.code) {
        case 'KeyW': this.move.forward = down ? 1 : (this.move.forward === 1 ? 0 : this.move.forward); break;
        case 'KeyS': this.move.forward = down ? -1 : (this.move.forward === -1 ? 0 : this.move.forward); break;
        case 'KeyA': this.move.right = down ? -1 : (this.move.right === -1 ? 0 : this.move.right); break;
        case 'KeyD': this.move.right = down ? 1 : (this.move.right === 1 ? 0 : this.move.right); break;
        case 'Space':
          if (down && this.grounded) {
            this.velocity.y = this.jumpSpeed;
            this.grounded = false;
          }
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.sneaking = down;
          this.crouching = down;
          break;
  case 'Digit1': if (down) { this.currentWeaponIndex = 0; this.fireRate = this.weapons[0].fireRate; this.scopeFov = this.weapons[0].scopeFov; console.log('Weapon: Shotgun'); } break;
  case 'Digit2': if (down) { this.currentWeaponIndex = 1; this.fireRate = this.weapons[1].fireRate; this.scopeFov = this.weapons[1].scopeFov; console.log('Weapon: Sniper'); } break;
  case 'Digit3': if (down) { this.currentWeaponIndex = 2; this.fireRate = this.weapons[2].fireRate; this.scopeFov = this.weapons[2].scopeFov; console.log('Weapon: SMG'); } break;
  case 'KeyB': if (down) { this._toggleShop(); } break;
      case 'KeyE': if (down) {
          if (this.insideBuilding) {
            this._closeInterior();
          } else {
            // find nearest door
            let best = null; let bestDist = 2.0 * 2.0;
            for (const d of this.buildingDoors) {
              const dx = d.doorPos.distanceToSquared(this.yawObject.position);
              if (dx < bestDist) { best = d; bestDist = dx; }
            }
            if (best) this._openInterior(best);
          }
        } break;
      }
    };
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));

    // pointer lock and mouse look
    this.pitch = 0; // up/down
    this.yaw = 0; // left/right
    const onPointerMove = (e) => {
      if (document.pointerLockElement === document.body) {
        // apply base sensitivity multiplied by current scale (keeps base tiny and stable)
        const sx = this.baseSensitivity.x * this.sensitivityScale;
        const sy = this.baseSensitivity.y * this.sensitivityScale;
        this.targetYaw -= e.movementX * sx;
        this.targetPitch -= e.movementY * sy;
        // clamp pitch
        const limit = Math.PI / 2 - 0.01;
        this.targetPitch = Math.max(-limit, Math.min(limit, this.targetPitch));
      }
    };
    window.addEventListener('mousemove', onPointerMove);

    // pointer lock control triggers
    document.addEventListener('pointerlockchange', () => {
      // when pointer is locked to the body we allow shooting
      this.pointerLocked = (document.pointerLockElement === document.body);
      const info = document.getElementById('info');
      if (info) info.textContent = this.pointerLocked ? 'Pointer locked • Left click to shoot' : 'Click to lock pointer • WASD to move • Mouse to look';
    });

    // shooting: hold left mouse to autofire; right mouse to scope (hold)
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      if (e.button === 0) {
        this.shooting = true;
        this.timeSinceLastShot = 1 / this.fireRate; // allow immediate shot
        // also trigger a shot immediately
        this._shoot();
      } else if (e.button === 2) {
        this.scoped = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.shooting = false;
      if (e.button === 2) this.scoped = false;
    });
    // prevent context menu while scoping/right-click
    window.addEventListener('contextmenu', (e) => { if (this.scoped) e.preventDefault(); });

    // allow clicking on the canvas to re-request pointer lock if it was lost
    // this must be a user gesture, so attach to the renderer DOM element
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.style.cursor = 'crosshair';
      this.renderer.domElement.addEventListener('click', () => {
        if (!this.pointerLocked) {
          try { document.body.requestPointerLock(); } catch (e) { /* ignore */ }
        }
      });
    }
  }

  lockPointer() {
    // helper to request pointer lock from a user gesture
    try {
      document.body.requestPointerLock();
    } catch (err) {
      // some browsers require this to be called directly from an event; handled in main.js
    }
  }

  _createWeapon() {
  // refined gun with layered parts and a canvas detail texture
  const gun = new THREE.Group();

  // canvas texture for panels and markings
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2e2e30'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#42464b';
  for (let i = 0; i < 8; i++) ctx.fillRect(8 + i * 60, 18, 40, 6);
  ctx.fillStyle = '#bfc8d4'; ctx.font = '20px sans-serif'; ctx.fillText('V1', 12, 110);
  const detailTex = new THREE.CanvasTexture(canvas);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;

  const metalMat = new THREE.MeshStandardMaterial({ color: 0x111216, metalness: 0.8, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x22252b, metalness: 0.2, roughness: 0.6, map: detailTex });

  // receiver / body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.6), darkMat);
  body.position.set(0.28, -0.15, -0.35);
  gun.add(body);

  // long barrel (slightly inset)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 16), metalMat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.75, -0.15, -0.05);
  gun.add(barrel);

  // suppressor tip
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, metalness: 0.9, roughness: 0.2 }));
  tip.rotation.z = Math.PI / 2;
  tip.position.set(1.15, -0.15, -0.05);
  gun.add(tip);

  // top rail / sight tube
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.06), metalMat);
  rail.position.set(0.33, -0.03, -0.15);
  gun.add(rail);

  // simple scope (cylinder)
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.32, 12), new THREE.MeshStandardMaterial({ color: 0x0e0e10, metalness: 0.7, roughness: 0.25 }));
  scope.rotation.z = Math.PI / 2;
  scope.position.set(0.65, -0.05, -0.08);
  gun.add(scope);

  // grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.12), new THREE.MeshStandardMaterial({ color: 0x181818, metalness: 0.1, roughness: 0.8 }));
  grip.position.set(0.05, -0.28, -0.05);
  grip.rotation.x = 0.22;
  gun.add(grip);

  // magazine
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.04), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.2, roughness: 0.7 }));
  mag.position.set(0.05, -0.06, -0.25);
  mag.rotation.x = -0.12;
  gun.add(mag);

  // muzzle flash geometry
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.95 }));
  flash.visible = false;

  // muzzle object for accurate spawn position and flash
  const muzzle = new THREE.Object3D();
  muzzle.position.set(1.18, -0.15, -0.05);
  muzzle.add(flash);
  gun.add(muzzle);

  this.weapon = { group: gun, flash, muzzle };

  // attach to pitchObject so weapon follows orientation without allowing roll
  gun.position.set(0.35, -0.18, 0);
  this.pitchObject.add(gun);
  }

  _createSky() {
    // simple sky gradient using a large inverted sphere with shader-like material using canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
  // richer sky gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#1e3a8a'); // deep blue top
  gradient.addColorStop(0.45, '#3b82f6');
  gradient.addColorStop(0.75, '#7dd3fc');
  gradient.addColorStop(1, '#f0f7ff');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;

    const geom = new THREE.SphereGeometry(500, 32, 15);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    const sky = new THREE.Mesh(geom, mat);
    sky.rotation.x = Math.PI / 2;
    this.scene.add(sky);

  // subtle fog for depth
  this.scene.fog = new THREE.FogExp2(0x9fbbe0, 0.0006);

    // sun light + visible sun
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.2);
    sun.position.set(100, 200, 100);
    this.scene.add(sun);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 16), sunMat);
    sunMesh.position.copy(sun.position);
    this.scene.add(sunMesh);
  }

  _createGround() {
    // grass ground
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    // simple grass color with subtle noise
    ctx.fillStyle = '#6aa84f'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2000; i++) {
      ctx.fillStyle = `rgba(80,120,60,${Math.random()*0.06})`;
      ctx.fillRect(Math.random()*size, Math.random()*size, 1, 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.userData.hittable = true;
    this.scene.add(ground);
  }

  _createBuildings() {
    // build a structured grid city: streets and blocks
    const blockW = 40, blockD = 40;
    const cols = 6, rows = 6;
    const startX = -cols/2 * (blockW + 8);
    const startZ = -rows/2 * (blockD + 8) - 120;
    const palette = [0x7f8ca6, 0xa98f6b, 0x6b9a6a, 0x8a6b9a, 0x9aa6b0, 0xbfa26b];
    for (let x = 0; x < cols; x++) {
      for (let z = 0; z < rows; z++) {
        const px = startX + x * (blockW + 8);
        const pz = startZ + z * (blockD + 8);
        // street borders
        const road = new THREE.Mesh(new THREE.PlaneGeometry(blockW+8, 6), new THREE.MeshStandardMaterial({ color: 0x2f2f2f }));
        road.rotation.x = -Math.PI/2; road.position.set(px, 0.02, pz - (blockD/2 + 3)); this.scene.add(road); road.userData.hittable = true;
        const road2 = new THREE.Mesh(new THREE.PlaneGeometry(6, blockD+8), new THREE.MeshStandardMaterial({ color: 0x2f2f2f }));
        road2.rotation.x = -Math.PI/2; road2.position.set(px - (blockW/2 + 3), 0.02, pz); this.scene.add(road2); road2.userData.hittable = true;
        // create buildings in block (maybe 1-3 buildings)
        const buildingCount = 1 + Math.floor(Math.random()*3);
        for (let b = 0; b < buildingCount; b++) {
          const bw = 8 + Math.random()*12; const bd = 8 + Math.random()*12; const bh = 6 + Math.random()*20;
          const color = palette[Math.floor(Math.random()*palette.length)];
          // create an actual box geometry with proper dimensions (avoids scaling artifacts)
          const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
          const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
          const ox = (Math.random()-0.5)*(blockW-bw);
          const oz = (Math.random()-0.5)*(blockD-bd);
          box.position.set(px + ox, bh/2, pz + oz);
          // door (record door world position and inside position)
          const doorGeo = new THREE.PlaneGeometry(1.2, 2.0);
          const doorMat = new THREE.MeshStandardMaterial({ color: 0x221a12 });
          const door = new THREE.Mesh(doorGeo, doorMat);
          // place door flush on +X face (slightly inset to avoid z-fighting)
          door.position.set(bw/2 - 0.02, -bh/2 + 1.0, 0);
          door.rotation.y = -Math.PI/2;
          box.add(door);
          // world door positions are computed after the building is added to the scene
          // balconies
          if (Math.random() > 0.6) {
            const bal = new THREE.Mesh(new THREE.BoxGeometry(bw*0.3, 0.3, 2), new THREE.MeshStandardMaterial({ color: 0x333333 }));
            bal.position.set(bw/2 - 0.3, 0.6, 0);
            box.add(bal);
          }
          box.userData.hittable = true;
          // add simple window rows as small inset blue glass planes
          const winMat = new THREE.MeshStandardMaterial({ color: 0x6fb3ff, emissive: 0x224466, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.95 });
          for (let yy = -Math.floor(bh/2)+1; yy < Math.floor(bh/2); yy += 2) {
            if (Math.random() > 0.6) continue;
            const ww = Math.min(1.2, bw*0.28);
            const wh = 1.0;
            const w = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), winMat);
            const face = Math.floor(Math.random()*4);
            if (face === 0) { w.position.set(bw/2 - 0.03, yy + 0.6, (Math.random()-0.5)*bd*0.6); w.rotation.y = -Math.PI/2; }
            else if (face === 1) { w.position.set(-bw/2 + 0.03, yy + 0.6, (Math.random()-0.5)*bd*0.6); w.rotation.y = Math.PI/2; }
            else if (face === 2) { w.position.set((Math.random()-0.5)*bw*0.6, yy + 0.6, bd/2 - 0.03); }
            else { w.position.set((Math.random()-0.5)*bw*0.6, yy + 0.6, -bd/2 + 0.03); w.rotation.y = Math.PI; }
            box.add(w);
          }
          // roof detail
          const roof = new THREE.Mesh(new THREE.BoxGeometry(bw*1.02, 0.4, bd*1.02), new THREE.MeshStandardMaterial({ color: 0x2e2e2e, roughness: 0.7 }));
          roof.position.set(0, bh/2 + 0.2, 0);
          box.add(roof);
          // maybe add balcony
          let climbable = false;
          if (Math.random() > 0.6) {
            climbable = true;
            const bal = new THREE.Mesh(new THREE.BoxGeometry(Math.min(3, bw*0.4), 0.28, 2), new THREE.MeshStandardMaterial({ color: 0x333333 }));
            bal.position.set(bw/2 - 0.28, 0.6, 0);
            box.add(bal);
            bal.userData.climbable = true;
          }

          this.scene.add(box);
          // compute door world position now that box is in scene
          const doorWorld = door.getWorldPosition(new THREE.Vector3());
          const insidePos = new THREE.Vector3(box.position.x, 1.2, box.position.z);
          this.buildingDoors.push({ doorPos: doorWorld.clone(), insidePos, outsidePos: this.yawObject.position.clone(), building: box });
          this.buildingPositions.push(box.position.clone());
          // register bounding box for collision
          const bb = new THREE.Box3().setFromObject(box);
          this.buildingBoxes.push({ box3: bb, topY: bb.max.y, climbable });
        }
      }
    }
  }

  _createClouds() {
    // soft sprite clouds: generate a blurred radial texture and create several large sprites
    const cloudCan = document.createElement('canvas'); cloudCan.width = cloudCan.height = 512;
    const cc = cloudCan.getContext('2d');
    const grd = cc.createRadialGradient(256,256,20,256,256,240);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    cc.fillStyle = grd; cc.fillRect(0,0,512,512);
    // add subtle shapes
    for (let i = 0; i < 6; i++) {
      cc.globalAlpha = 0.15 + Math.random()*0.25;
      cc.beginPath(); cc.ellipse(160+Math.random()*200, 160+Math.random()*200, 120+Math.random()*80, 80+Math.random()*60, Math.random()*Math.PI*2, 0, Math.PI*2); cc.fill();
    }
    const cloudTex = new THREE.CanvasTexture(cloudCan); cloudTex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.9, depthWrite: false });
    const count = 8;
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(mat.clone());
      const s = 140 + Math.random()*180;
      sp.scale.set(s, s*0.6, 1);
      sp.position.set((Math.random()-0.5)*800, 90 + Math.random()*80, -100 + Math.random()*400);
      this.scene.add(sp);
      this.clouds.push(sp);
    }
  }

  _spawnTargets(n) {
    const geo = new THREE.SphereGeometry(0.5, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0x220000 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.position.set((Math.random() - 0.5) * 40, 0.5 + Math.random() * 4, -10 - Math.random() * 60);
      this.scene.add(m);
      this.targets.push({ mesh: m, alive: true });
    }
    this._updateScore();
  }

  _updateScore() {
    if (this.targetsEl) this.targetsEl.textContent = this.targets.filter(t => t.alive).length;
  }

  _shoot() {
    // weapon-aware hitscan
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    this.camera.getWorldDirection(camDir);
    const weapon = this.weapons[this.currentWeaponIndex];
    // build hittable list once
    const hittables = [];
    this.scene.traverse((obj) => { if (obj.isMesh && obj.userData && obj.userData.hittable) hittables.push(obj); });

    // for each pellet/ray
    const pellets = weapon.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      // compute spread direction
      let dir = camDir.clone();
      if (weapon.spread && weapon.spread > 0.0001) {
        // random cone using spherical coords
        const angle = (Math.random() - 0.5) * weapon.spread;
        const angle2 = (Math.random() - 0.5) * weapon.spread;
        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(angle2, angle, 0));
        dir.applyQuaternion(quat).normalize();
      }
      const ray = new THREE.Raycaster(camPos, dir, 0, 2000);
      const intersects = ray.intersectObjects(hittables, true);
      let hitPoint = camPos.clone().add(dir.clone().multiplyScalar(1000));
      if (intersects.length > 0) {
        hitPoint = intersects[0].point.clone();
        // attempt to remove target if we hit a target mesh
        for (const t of this.targets) {
          if (!t.alive) continue;
          let obj = intersects[0].object;
          while (obj) {
            if (obj === t.mesh) { t.alive = false; this.scene.remove(t.mesh); this._updateScore(); break; }
            obj = obj.parent;
          }
        }
      }

      // draw subtle line tracer only (no sphere)
      try {
        const start = camPos.clone().add(dir.clone().multiplyScalar(1.2));
  const geom = new THREE.BufferGeometry().setFromPoints([start.clone(), start.clone()]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffeecc, transparent: true, opacity: 0.38 });
        const line = new THREE.Line(geom, mat);
        line.frustumCulled = false;
        this.scene.add(line);
        this.tracers.push({ line, start: start.clone(), dir: dir.clone(), maxDist: start.distanceTo(hitPoint), t: 0, dur: 0.05 });

  const impact = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffcc99, transparent: true, opacity: 0.95 }));
  impact.position.copy(hitPoint);
  impact.frustumCulled = false;
  this.scene.add(impact);
  setTimeout(() => { this.scene.remove(impact); }, 220);
      } catch (e) {}
    }

    // muzzle flash and recoil: only show if muzzle is not too close to camera (avoid crosshair artifact)
    if (this.weapon && this.weapon.flash) {
      const muzzlePos = new THREE.Vector3();
      this.weapon.muzzle.getWorldPosition(muzzlePos);
  // reuse previously computed camPos from above (avoid redeclaring const)
  this.camera.getWorldPosition(camPos);
  if (muzzlePos.distanceTo(camPos) > 0.4) {
        this.weapon.flash.visible = true;
        setTimeout(() => { if (this.weapon && this.weapon.flash) this.weapon.flash.visible = false; }, 60);
      }
    }
    this.recoil = Math.max(this.recoil, 0.12);
  }

  _loop() {
    if (!this.running) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    this.accumulator += dt;
    // fixed-step physics updates
    while (this.accumulator >= FIXED_STEP) {
      this._fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this._render();
    requestAnimationFrame(this._loop.bind(this));
  }

  _fixedUpdate(dt) {
  // smooth camera rotation (interpolate towards targets)
  const smoothFactor = 1 - Math.exp(-this.smoothSpeed * dt); // responsive smoothing
  this.smoothedPitch += (this.targetPitch - this.smoothedPitch) * smoothFactor;
  this.smoothedYaw += (this.targetYaw - this.smoothedYaw) * smoothFactor;
  // apply smoothed rotations to yaw/pitch objects
  this.yawObject.rotation.y = this.smoothedYaw;
  this.pitchObject.rotation.x = this.smoothedPitch;

  // apply movement
  const baseSpeed = 6.0;
  const speed = this.crouching || this.sneaking ? baseSpeed * 0.5 : baseSpeed;
    // convert camera orientation to movement direction so W is always forward relative to view
  const camDir = new THREE.Vector3();
  this.pitchObject.getWorldDirection(camDir);
  camDir.y = 0; // ignore vertical component for movement
  camDir.normalize();
  // getWorldDirection points to the camera's look direction; invert so forward = movement forward
  const forward = camDir.clone().negate();
  // right vector: cross(forward, up) so positive X is to the player's right
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(forward, this.move.forward);
    moveDir.addScaledVector(right, this.move.right);
    if (moveDir.lengthSq() > 0.0001) moveDir.normalize();

  // horizontal movement
  this.yawObject.position.addScaledVector(moveDir, speed * dt);

  // vertical movement / simple gravity + grounding
  this.velocity.y += this.gravity * dt;
  this.yawObject.position.y += this.velocity.y * dt;
  // smooth crouch transition: lerp current y towards target height
  const targetStand = this.crouching ? this.crouchHeight : this.standingHeight;
  const currentY = this.yawObject.position.y;
  // interpolate towards target to soften crouch/stand, but only when grounded
  if (this.grounded) {
    const yLerp = 1 - Math.exp(-12 * dt);
    this.yawObject.position.y = THREE.MathUtils.lerp(this.yawObject.position.y, targetStand, yLerp);
  }
  if (this.yawObject.position.y <= targetStand + 0.001) {
    this.yawObject.position.y = targetStand;
    this.velocity.y = 0;
    this.grounded = true;
  }

  // simple collision: prevent walking through building bounding boxes
  if (this.buildingBoxes && this.buildingBoxes.length) {
    const pos2d = new THREE.Vector2(this.yawObject.position.x, this.yawObject.position.z);
    for (const bb of this.buildingBoxes) {
      // expand box slightly for comfortable collision
      const expanded = bb.box3.clone().expandByScalar(0.25);
      if (pos2d.x >= expanded.min.x && pos2d.x <= expanded.max.x && pos2d.y >= expanded.min.z && pos2d.y <= expanded.max.z) {
        // inside horizontally: push out along shortest axis
        const dxMin = Math.abs(this.yawObject.position.x - expanded.min.x);
        const dxMax = Math.abs(expanded.max.x - this.yawObject.position.x);
        const dzMin = Math.abs(this.yawObject.position.z - expanded.min.z);
        const dzMax = Math.abs(expanded.max.z - this.yawObject.position.z);
        // choose smallest penetration to resolve
        const minPen = Math.min(dxMin, dxMax, dzMin, dzMax);
        if (minPen === dxMin) this.yawObject.position.x = expanded.min.x - 0.26;
        else if (minPen === dxMax) this.yawObject.position.x = expanded.max.x + 0.26;
        else if (minPen === dzMin) this.yawObject.position.z = expanded.min.z - 0.26;
        else this.yawObject.position.z = expanded.max.z + 0.26;
        // if there's a climbable balcony and player is near its base, allow a small step up
        if (bb.climbable && this.yawObject.position.y < bb.topY + 0.6) {
          // small vertical assist to step onto balcony
          this.yawObject.position.y = Math.min(bb.topY - 0.6, this.yawObject.position.y + 0.6);
          this.grounded = true;
          this.velocity.y = 0;
        }
      }
    }
  }

    // apply visual recoil to weapon (decay back to 0)
    if (this.weapon && this.weapon.group) {
      // exponential decay
      this.recoil *= Math.exp(-12 * dt);
      // move weapon group forward/back along local z (positive z moves toward camera)
      this.weapon.group.position.z = this.recoil;
    }

  // update bullets (legacy - left for compatibility; currently unused with hitscan)
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const step = b.vel.clone().multiplyScalar(dt);
      b.mesh.position.add(step);
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
        continue;
      }
      // collision with targets
      for (const t of this.targets) {
        if (!t.alive) continue;
        const dist2 = t.mesh.position.distanceToSquared(b.mesh.position);
        if (dist2 < 0.6 * 0.6) {
          t.alive = false;
          this.scene.remove(t.mesh);
          this.scene.remove(b.mesh);
          this.bullets.splice(i, 1);
          this._updateScore();
          break;
        }
      }
    }

    // update tracers (animate from start -> end over tracer.dur seconds)
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      const p = Math.min(1, tr.t / tr.dur);
      // determine end position (support legacy tr.end or new tr.dir+maxDist)
      let endPosLocal;
      if (tr.end) {
        endPosLocal = tr.end;
      } else if (tr.dir && tr.maxDist !== undefined) {
        endPosLocal = tr.start.clone().add(tr.dir.clone().multiplyScalar(tr.maxDist));
      } else {
        // fallback: just advance along forward by some amount
        endPosLocal = tr.start.clone().add(new THREE.Vector3(0, 0, -1).multiplyScalar(10));
      }
      // update mesh position if tracer has a mesh (some tracers are lines-only)
      if (tr.mesh) {
        try {
          tr.mesh.position.lerpVectors(tr.start, endPosLocal, p);
        } catch (e) {
          // ignore per-tracer update errors
        }
      }
      // update line geometry end and fade
      try {
        if (tr.line) {
          const dist = Math.max(0, Math.min(tr.maxDist || 0, p * (tr.maxDist || 0)));
          const endPos = tr.start.clone().add((tr.dir || new THREE.Vector3(0, 0, -1)).clone().multiplyScalar(dist));
          const pts = [tr.start.clone(), endPos];
          tr.line.geometry.setFromPoints(pts);
          if (tr.line.material) tr.line.material.opacity = Math.max(0, 1 - p);
        }
      } catch (e) {}
      if (p >= 1) {
        this.scene.remove(tr.mesh);
        if (tr.line) this.scene.remove(tr.line);
        this.tracers.splice(i, 1);
      }
    }

    // autoshoot handling
    if (this.shooting) {
      this.timeSinceLastShot += dt;
      const interval = 1 / this.fireRate;
      while (this.timeSinceLastShot >= interval) {
        this._shoot();
        this.timeSinceLastShot -= interval;
      }
    } else {
      this.timeSinceLastShot = Math.min(this.timeSinceLastShot + dt, 1 / this.fireRate);
    }

  // scope smoothing: interpolate FOV and sensitivity scale
  const fovTarget = this.scoped ? this.scopeFov : this.normalFov;
  this.currentFov += (fovTarget - this.currentFov) * (1 - Math.exp(-10 * dt));
  this.camera.fov = this.currentFov;
  this.camera.updateProjectionMatrix();
  // sensitivity scale when scoped
  const targetSensScale = this.scoped ? this.scopeSensitivityScale : 1.0;
  // smooth sensitivity scale
  this.sensitivityScale += (targetSensScale - this.sensitivityScale) * (1 - Math.exp(-10 * dt));
  }

  _render() {
    this.renderer.render(this.scene, this.camera);
  }

  _openInterior(doorInfo) {
    if (!doorInfo) return;
    this.insideBuilding = doorInfo;
    // simple interior: teleport to insidePos and dim sky
    this.yawObject.position.copy(doorInfo.insidePos);
    // animate door open if we have the door mesh
    if (doorInfo.door && doorInfo.door.userData && !doorInfo.door.userData.open) {
      doorInfo.door.userData.open = true;
      const startRot = doorInfo.door.rotation.y;
      const target = startRot - Math.PI/2;
      const t0 = performance.now();
      const dur = 280;
      const tick = (now) => { const p = Math.min(1, (now - t0) / dur); doorInfo.door.rotation.y = startRot + (target - startRot) * p; if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    // optional: hide world objects or move camera slightly
    // if building has elevator, create a small UI to select floors
    if (doorInfo.elevator) {
      const ev = doorInfo.elevator;
      // create UI overlay
      this._elevatorEl = document.createElement('div');
      this._elevatorEl.style.position = 'fixed'; this._elevatorEl.style.right = '12px'; this._elevatorEl.style.top = '50%'; this._elevatorEl.style.transform = 'translateY(-50%)'; this._elevatorEl.style.padding = '8px'; this._elevatorEl.style.background = 'rgba(10,10,12,0.85)'; this._elevatorEl.style.color = '#fff'; this._elevatorEl.style.zIndex = 10000;
      this._elevatorEl.innerHTML = `<div style="font-weight:600;margin-bottom:6px">Elevator</div><div id="floors"></div><div style="margin-top:6px"><small>Click floor to go</small></div>`;
      document.body.appendChild(this._elevatorEl);
  const floorsEl = this._elevatorEl.querySelector('#floors');
  for (let f = ev.floors - 1; f >= 0; f--) {
        const btn = document.createElement('button'); btn.textContent = `${f+1}`; btn.style.display = 'block'; btn.style.margin = '4px 0'; btn.onclick = () => {
          // require player to be inside elevator car to operate
          if (!ev.car) return;
          const carBox = new THREE.Box3().setFromObject(ev.car);
          const pos = this.yawObject.position;
          if (!carBox.containsPoint(pos)) {
            // nudge player message
            btn.textContent = 'Stand inside car';
            setTimeout(() => { btn.textContent = `${f+1}`; }, 800);
            return;
          }
          // animate elevator car to target floor and move player with it
          const floorY = doorInfo.building.position.y - doorInfo.building.geometry.parameters.height/2 + (f + 0.5) * (doorInfo.building.geometry.parameters.height / Math.max(1, ev.floors));
          const carStartY = ev.car.position.y;
          const playerStartY = this.yawObject.position.y;
          const dur = 0.9;
          const startT = performance.now();
          const tick = (now) => {
            const p = Math.min(1, (now - startT) / (dur * 1000));
            const eased = p < 0.5 ? 2*p*p : -1 + (4-2*p)*p; // simple ease
            ev.car.position.y = carStartY + (floorY - carStartY) * eased;
            this.yawObject.position.y = playerStartY + (floorY - playerStartY) * eased;
            if (p < 1) requestAnimationFrame(tick); else { ev.currentFloor = f; }
          };
          requestAnimationFrame(tick);
        };
        floorsEl.appendChild(btn);
      }
    }
  }

  _closeInterior() {
    if (!this.insideBuilding) return;
    const outside = this.insideBuilding.outsidePos || new THREE.Vector3(0, 1.6, 5);
    this.yawObject.position.copy(outside);
    // animate door close if present
    if (this.insideBuilding.door && this.insideBuilding.door.userData && this.insideBuilding.door.userData.open) {
      const d = this.insideBuilding.door; d.userData.open = false; const startRot = d.rotation.y; const target = startRot + Math.PI/2; const t0 = performance.now(); const dur = 240; const tick = (now) => { const p = Math.min(1, (now - t0) / dur); d.rotation.y = startRot + (target - startRot) * p; if (p < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    }
    this.insideBuilding = null;
    if (this._elevatorEl) { try { document.body.removeChild(this._elevatorEl); } catch (e) {} this._elevatorEl = null; }
  }

  _toggleShop() {
    this.shopOpen = !this.shopOpen;
    this.shopEl.style.display = this.shopOpen ? 'block' : 'none';
    // update money display
    const m = this.shopEl.querySelector('#money'); if (m) m.textContent = String(this.money);
    // when shop opens, release pointer lock so user can click buttons
    if (this.shopOpen) {
      try { document.exitPointerLock(); } catch (e) {}
    }
  }

  _buyWeapon(id, cost) {
    if (this.unlocked[id]) return;
    if (this.money < cost) {
      console.log('Not enough money');
      return;
    }
    this.money -= cost;
    this.unlocked[id] = true;
    // apply weapon unlock: prefer not to switch automatically, but allow immediate equip
    for (let i = 0; i < this.weapons.length; i++) if (this.weapons[i].id === id) { this.currentWeaponIndex = i; this.fireRate = this.weapons[i].fireRate; this.scopeFov = this.weapons[i].scopeFov; }
    // update UI
    const m = this.shopEl.querySelector('#money'); if (m) m.textContent = String(this.money);
    const btn = this.shopEl.querySelector(`[data-weapon="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = `${id.toUpperCase()} (Owned)`; }
    console.log(`Bought ${id}`);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // start the game loop and initialize runtime systems
  start() {
    if (this.started) return;
    this.started = true;

    if (!this.renderer) {
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed'; overlay.style.inset = '0'; overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center'; overlay.style.background = 'rgba(0,0,0,0.9)'; overlay.style.color = '#fff'; overlay.style.zIndex = '9999';
      overlay.textContent = 'WebGL could not be created. The game cannot start.';
      document.body.appendChild(overlay);
      return;
    }

    // runtime defaults
    this.fireRate = this.weapons[this.currentWeaponIndex].fireRate;
    this.scopeFov = this.weapons[this.currentWeaponIndex].scopeFov || this.camera.fov;
    this.normalFov = this.camera.fov;
    this.currentFov = this.normalFov;
    this.scopeSensitivityScale = 0.35;
    this.baseSensitivity = { x: 0.0025, y: 0.0025 };
    this.sensitivityScale = 1.0;
    this.targetPitch = 0; this.targetYaw = 0; this.smoothedPitch = 0; this.smoothedYaw = 0; this.smoothSpeed = 12.0;
    this.recoil = 0;

    // set up UI, controls, weapon and spawn a few targets
    this._setupUI();
    this._setupControls();
    this._createWeapon();
    this._spawnTargets(6);

    // events
    window.addEventListener('resize', this._onResize.bind(this));

    this.running = true;
    this.clock.start();
    this._loop();
  }

  // resume an already started game (keeps state)
  resume() {
    if (!this.started) return this.start();
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this._loop();
  }
}
