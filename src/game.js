import * as THREE from 'three';

const FIXED_STEP = 1 / 60;
const MAX_BULLETS = 30;
const MAX_TRACERS = 40;

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
  // Zufällige Spawn-Punkte in verschiedenen Stadtgebieten
  const spawnPoints = [
    { x: 15, y: 1.6, z: 15 },   // Nord-Ost Distrikt
    { x: -15, y: 1.6, z: 15 },  // Nord-West Distrikt
    { x: 15, y: 1.6, z: -15 },  // Süd-Ost Distrikt
    { x: -15, y: 1.6, z: -15 }, // Süd-West Distrikt
    { x: 35, y: 1.6, z: 0 },    // Ost-Außenbezirk
    { x: -35, y: 1.6, z: 0 },   // West-Außenbezirk
    { x: 0, y: 1.6, z: 35 },    // Nord-Außenbezirk
    { x: 0, y: 1.6, z: -35 }    // Süd-Außenbezirk
  ];
  const randomSpawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
  this.yawObject.position.set(randomSpawn.x, randomSpawn.y, randomSpawn.z);
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
  this.enemies = []; // KI-Gegner hinzugefügt
  this.score = 0;
  // caches and throttles for performance
  this._hittablesCache = null;
  this._lastMinimapUpdate = 0;

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
  this.health = 100; // health added
  this.maxHealth = 100;
  this.buildingPositions = [];
  // shooting / autoshoot state
  this.shooting = false;
  this.timeSinceLastShot = 0;
  // world setup moved to _setupWorld
  }

  _setupLights() {
    // Verbessertes Beleuchtungssystem für bessere Atmosphäre
    
    // Ambiente Beleuchtung mit Tageszeit-Simulation
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x334455, 0.6);
    hemi.position.set(0, 200, 0);
    this.scene.add(hemi);

    // Hauptsonne - Richtungslicht mit Schatten
    const sunLight = new THREE.DirectionalLight(0xfff4e6, 1.2);
    sunLight.position.set(-120, 180, -80);
    sunLight.castShadow = true;
    
    // Verbesserte Schatten-Einstellungen
    sunLight.shadow.camera.left = -300;
    sunLight.shadow.camera.right = 300;
    sunLight.shadow.camera.top = 300;
    sunLight.shadow.camera.bottom = -300;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 500;
  // moderate shadow resolution for performance
  sunLight.shadow.mapSize.setScalar(1024);
    sunLight.shadow.bias = -0.0001;
    sunLight.shadow.normalBias = 0.02;
    this.scene.add(sunLight);

    // Sekundäres Füllicht für weichere Schatten
    const fillLight = new THREE.DirectionalLight(0x87ceeb, 0.4);
    fillLight.position.set(100, 120, 100);
    this.scene.add(fillLight);

    // Atmosphärisches Gegenlicht
    const backLight = new THREE.DirectionalLight(0xffd4a3, 0.3);
    backLight.position.set(50, 80, -150);
    this.scene.add(backLight);

    // Punktlichter für Straßenbeleuchtung (nur einige, für Performance)
    for (let i = -4; i <= 4; i += 2) {
      for (let j = -2; j <= 2; j += 2) {
        const streetLight = new THREE.PointLight(0xfff1b6, 0.8, 25, 2);
        streetLight.position.set(i * 30, 4, j * 40 - 100);
      streetLight.castShadow = false; // no shadows for performance
        this.scene.add(streetLight);
      }
    }

    // Aktiviere Schatten im Renderer
    if (this.renderer) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  }

  _setupWorld() {
    // Dichtere Stadt mit mehr Gebäuden und kleineren Abständen
    const cols = 10, rows = 10; // Mehr Gebäudeblöcke
    const blockW = 28, blockD = 28; // Kleinere Blöcke
    const gap = 6; // Schmalere Straßen
    const startX = -((cols * (blockW + gap)) / 2) + (blockW + gap)/2;
    const startZ = -((rows * (blockD + gap)) / 2) - 120 + (blockD + gap)/2;
    const palette = [0xd9e6f2, 0xe8d8c3, 0xcfe3d6, 0xd0cbe6, 0xe6e0c9];

    // Kleinerer zentraler Park
    const parkSize = 45;
    const park = new THREE.Mesh(new THREE.CircleGeometry(parkSize, 32), new THREE.MeshStandardMaterial({ color: 0x6db36b }));
    park.rotation.x = -Math.PI/2;
    park.position.set(startX + (cols/2)*(blockW+gap) - (blockW+gap)/2, 0.01, startZ + (rows/2)*(blockD+gap) - (blockD+gap)/2);
    this.scene.add(park);

    // Kleinerer Brunnen
    const fountain = new THREE.Mesh(new THREE.CylinderGeometry(4,4,0.6,24), new THREE.MeshStandardMaterial({ color: 0x8fbce6 }));
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

        // park center, add more trees near park center (aber nicht in Gebäuden)
        if (Math.abs(cx - cols/2) < 1 && Math.abs(cz - rows/2) < 1) {
          for (let t = 0; t < 6; t++) { // Reduziert von 10 auf 6
            let tx, tz;
            let attempts = 0;
            do {
              tx = px + (Math.random()-0.5)*blockW*0.4; // Reduziert von 0.6 auf 0.4
              tz = pz + (Math.random()-0.5)*blockD*0.4;
              attempts++;
            } while (attempts < 10); // Verhindere unendliche Schleifen
            
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2, 6), new THREE.MeshStandardMaterial({ color: 0x5b3b2b }));
            trunk.position.set(tx, 1, tz);
            trunk.castShadow = true;
            trunk.receiveShadow = true;
            const foliage = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2f8b2f }));
            foliage.position.set(0, 1.6, 0); 
            foliage.castShadow = true;
            trunk.add(foliage); 
            this.scene.add(trunk); 
            trunk.userData.hittable = true;
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

          // Multiple doors and entrances for better accessibility
          const doorDepth = 0.12;
          const doorGeo = new THREE.BoxGeometry(0.9, 1.95, doorDepth);
          const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b3b2b });
          
          // Haupteingang
          const mainDoor = new THREE.Mesh(doorGeo, doorMat);
          const face = Math.random() > 0.5 ? 'x+' : 'z+';
          if (face === 'x+') {
            mainDoor.position.set(bw/2 - doorDepth/2 - 0.02, -bh/2 + 1.0, 0);
            mainDoor.rotation.y = -Math.PI/2;
            mainDoor.userData.hinge = 'x+';
          } else {
            mainDoor.position.set(0, -bh/2 + 1.0, bd/2 - doorDepth/2 - 0.02);
            mainDoor.userData.hinge = 'z+';
          }
          mainDoor.userData.isDoor = true; mainDoor.userData.open = false;
          box.add(mainDoor);
          
          // Back entrance for larger buildings (sneak path)
          if (bw > 12 && bd > 12) {
            const backDoor = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ color: 0x4a2a1a }));
            if (face === 'x+') {
              // Rückseite
              backDoor.position.set(-bw/2 + doorDepth/2 + 0.02, -bh/2 + 1.0, bd/4);
              backDoor.rotation.y = Math.PI/2;
              backDoor.userData.hinge = 'x-';
            } else {
              // Rückseite
              backDoor.position.set(-bw/4, -bh/2 + 1.0, -bd/2 + doorDepth/2 + 0.02);
              backDoor.rotation.y = Math.PI;
              backDoor.userData.hinge = 'z-';
            }
            backDoor.userData.isDoor = true; backDoor.userData.open = false;
            backDoor.userData.isBackEntrance = true;
            box.add(backDoor);
          }
          
          // Side entrances for very large buildings
          if (bw > 16 && bd > 16) {
            const sideDoor = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ color: 0x5a3a2a }));
            sideDoor.position.set(bw/4, -bh/2 + 1.0, bd/2 - doorDepth/2 - 0.02);
            sideDoor.userData.isDoor = true; sideDoor.userData.open = false;
            sideDoor.userData.isSideEntrance = true;
            box.add(sideDoor);
          }

          // windows: verbesserte Fenster mit korrekter Positionierung und ohne Z-Fighting
          const winMat = new THREE.MeshStandardMaterial({ 
            color: 0x4488cc, 
            emissive: 0x112244, 
            roughness: 0.05, 
            metalness: 0.1, 
            transparent: true, 
            opacity: 0.85,
            envMapIntensity: 0.8
          });
          
          const frameMat = new THREE.MeshStandardMaterial({ 
            color: 0x2a2a2a, 
            metalness: 0.4, 
            roughness: 0.6 
          });

          // Symmetrische Fenster-Anordnung
          const windowsPerRow = Math.floor(bw / 3.5); // Gleichmäßige Verteilung
          const floorsWithWindows = Math.floor(bh / 3.5);
          
          for (let floor = 1; floor <= floorsWithWindows; floor++) {
            for (let winPos = 0; winPos < windowsPerRow; winPos++) {
              const ww = 1.2, wh = 1.4;
              const wy = -bh/2 + floor * (bh / (floorsWithWindows + 1));
              
              // Gleichmäßige Verteilung der Fenster
              const xOffset = -bw/2 + (bw / (windowsPerRow + 1)) * (winPos + 1);
              
              // Vorderseite (Z+) - Fenster nach außen versetzt
              const frontWindow = new THREE.Group();
              
              // Fensterrahmen tief in der Wand
              const frontFrame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.15, wh + 0.15, 0.12), frameMat);
              // move frame slightly outwards to avoid z-fighting with glass
              frontFrame.position.set(xOffset, wy, bd/2 + 0.06);
              frontWindow.add(frontFrame);
              
              // Fensterglas leicht nach außen versetzt (verhindert Z-Fighting)
              const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(ww - 0.1, wh - 0.1), winMat);
              frontGlass.position.set(xOffset, wy, bd/2 + 0.08);
              frontWindow.add(frontGlass);
              
              // Fensterkreuz
              const frontCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.04, wh - 0.1, 0.02), frameMat);
              frontCrossV.position.set(xOffset, wy, bd/2 + 0.08);
              frontWindow.add(frontCrossV);
              
              const frontCrossH = new THREE.Mesh(new THREE.BoxGeometry(ww - 0.1, 0.04, 0.02), frameMat);
              frontCrossH.position.set(xOffset, wy, bd/2 + 0.08);
              frontWindow.add(frontCrossH);
              
              box.add(frontWindow);
              
              // Rückseite (Z-) 
              const backWindow = new THREE.Group();
              
              const backFrame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.15, wh + 0.15, 0.12), frameMat);
              // move frame slightly outwards on the back face
              backFrame.position.set(xOffset, wy, -bd/2 - 0.06);
              backWindow.add(backFrame);
              
              const backGlass = new THREE.Mesh(new THREE.PlaneGeometry(ww - 0.1, wh - 0.1), winMat);
              backGlass.position.set(xOffset, wy, -bd/2 - 0.08);
              backGlass.rotation.y = Math.PI;
              backWindow.add(backGlass);
              
              box.add(backWindow);
              
              // Seitenfenster nur bei größeren Gebäuden
              if (bw > 12) {
                // Linke Seite (X-)
                const leftWindow = new THREE.Group();
                
                const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, wh + 0.15, ww + 0.15), frameMat);
                // move left frame a bit outward on negative X face
                leftFrame.position.set(-bw/2 - 0.06, wy, xOffset * 0.8);
                leftWindow.add(leftFrame);
                
                const leftGlass = new THREE.Mesh(new THREE.PlaneGeometry(ww - 0.1, wh - 0.1), winMat);
                leftGlass.position.set(-bw/2 - 0.05, wy, xOffset * 0.8);
                leftGlass.rotation.y = Math.PI/2;
                leftWindow.add(leftGlass);
                
                box.add(leftWindow);
                
                // Rechte Seite (X+)
                const rightWindow = new THREE.Group();
                
                const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, wh + 0.15, ww + 0.15), frameMat);
                // move right frame a bit outward on positive X face
                rightFrame.position.set(bw/2 + 0.06, wy, xOffset * 0.8);
                rightWindow.add(rightFrame);
                
                const rightGlass = new THREE.Mesh(new THREE.PlaneGeometry(ww - 0.1, wh - 0.1), winMat);
                rightGlass.position.set(bw/2 + 0.05, wy, xOffset * 0.8);
                rightGlass.rotation.y = -Math.PI/2;
                rightWindow.add(rightGlass);
                
                box.add(rightWindow);
              }
            }
          }

          // roof and small details
          const roof = new THREE.Mesh(new THREE.BoxGeometry(bw*1.02, 0.4, bd*1.02), new THREE.MeshStandardMaterial({ color: 0x2e2e2e, roughness: 0.7 }));
          roof.position.set(0, bh/2 + 0.2, 0); 
          roof.castShadow = true;
          roof.receiveShadow = true;
          box.add(roof);

          // Balkone mit besserer Logik - mehrere Balkone möglich
          let climbable = false;
          const numFloors = Math.floor(bh / 3);
          
          for (let floorLevel = 1; floorLevel < numFloors; floorLevel++) {
            if (Math.random() > 0.6) { // 40% Chance für Balkon pro Stockwerk
              climbable = true;
              const balconyY = -bh/2 + (floorLevel * (bh / numFloors));
              
              // Balkon-Plattform
              const balcony = new THREE.Mesh(
                new THREE.BoxGeometry(Math.min(4, bw*0.7), 0.3, 2.5), 
                new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 })
              );
              balcony.position.set(bw/2 - 0.2, balconyY, 0);
              balcony.castShadow = true;
              balcony.receiveShadow = true;
              box.add(balcony);
              
              // Balkon-Geländer
              const railingMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
              
              // Vorderes Geländer
              const frontRailing = new THREE.Mesh(new THREE.BoxGeometry(balcony.geometry.parameters.width, 1.0, 0.1), railingMat);
              frontRailing.position.set(0, 0.65, balcony.geometry.parameters.depth/2 - 0.05);
              balcony.add(frontRailing);
              
              // Seitliche Geländer
              const leftRailing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, balcony.geometry.parameters.depth), railingMat);
              leftRailing.position.set(-balcony.geometry.parameters.width/2 + 0.05, 0.65, 0);
              balcony.add(leftRailing);
              
              const rightRailing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, balcony.geometry.parameters.depth), railingMat);
              rightRailing.position.set(balcony.geometry.parameters.width/2 - 0.05, 0.65, 0);
              balcony.add(rightRailing);
              
              // Balcony door
              const balconyDoorGeo = new THREE.BoxGeometry(0.9, 2.0, 0.12);
              const balconyDoorMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
              const balconyDoor = new THREE.Mesh(balconyDoorGeo, balconyDoorMat);
              balconyDoor.position.set(bw/2 - 0.12, balconyY, 0);
              balconyDoor.userData.isDoor = true;
              balconyDoor.userData.isBalconyDoor = true;
              balconyDoor.userData.open = false;
              balconyDoor.castShadow = true;
              box.add(balconyDoor);
              
              balcony.userData.climbable = true;
            }
          }

          box.userData.hittable = true;
          box.castShadow = true; // buildings cast shadows
          box.receiveShadow = true; // buildings receive shadows
          
          // enable shadows for building components
          // if main door exists, enable shadows for it
          if (typeof mainDoor !== 'undefined' && mainDoor) {
            mainDoor.castShadow = true;
            mainDoor.receiveShadow = true;
          }
          
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
          const doorWorld = (typeof mainDoor !== 'undefined' && mainDoor) ? mainDoor.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(box.position.x, 0, box.position.z);
          const insidePos = new THREE.Vector3(box.position.x, 1.2, box.position.z);
          this.buildingDoors.push({ doorPos: doorWorld.clone(), insidePos, outsidePos: new THREE.Vector3(bx + 2, 1.6, bz + 2), building: box, door: mainDoor, elevator: { shaft: elevShaft, car: elevCar, floors, currentFloor: 0, carHeight: carHeight } });
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

    // add street lamps and benches for charm (nur auf Gehwegen, nicht auf Straßen)
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    for (let i = -6; i <= 6; i += 4) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 8), lampMat);
      pole.position.set(i * 12, 1.5, -25); // Verschoben von Straße weg
      pole.castShadow = true;
      pole.receiveShadow = true;
      this.scene.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b6 }));
      bulb.position.set(pole.position.x, 2.6, pole.position.z);
      this.scene.add(bulb);
      pole.userData.hittable = true;
    }

    // benches (nur in Parks und Gehwegen)
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x6b3b2b });
    for (let i = 0; i < 8; i++) { // Reduziert von 12 auf 8
      const bx = -80 + i * 20;
      const bz = -15 + (i % 2) * 10; // Weiter von Straße weg
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 0.6), benchMat);
      bench.position.set(bx, 0.4, bz);
      bench.castShadow = true;
      bench.receiveShadow = true;
      this.scene.add(bench);
    }

    // add some trees along sidewalks (aber nicht auf Straßen)
    for (let i = 0; i < 25; i++) { // Reduziert von 40 auf 25
      let x, z;
      let onRoad = true;
      let attempts = 0;
      
  // Try to find a position that is not on a road or inside a building
      do {
        x = -150 + Math.random() * 300;
        z = -150 + Math.random() * 300;
        
        // Prüfe ob auf Straße (vereinfacht)
        const roadSpacing = 44;
        const isOnHorizontalRoad = Math.abs((z + 100) % roadSpacing - roadSpacing/2) < 4;
        const isOnVerticalRoad = Math.abs(x % roadSpacing - roadSpacing/2) < 4;
        onRoad = isOnHorizontalRoad || isOnVerticalRoad;
        
        attempts++;
      } while (onRoad && attempts < 20);
      
      if (!onRoad) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2, 6), new THREE.MeshStandardMaterial({ color: 0x5b3b2b }));
        trunk.position.set(x, 1, z);
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        const foliage = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0x2f8b2f }));
        foliage.position.set(0, 1.6, 0);
        foliage.castShadow = true;
        trunk.add(foliage);
        this.scene.add(trunk);
        trunk.userData.hittable = true;
      }
    }
  }
  _setupUI() {
    this.targetsEl = document.getElementById('targets');
    this.weaponEl = document.getElementById('current-weapon');
    this.healthEl = document.getElementById('health-value');
    this.healthFillEl = document.getElementById('health-fill');
    this.moneyEl = document.getElementById('money-value');
    this._updateScore();
    this._updateWeaponDisplay();
    this._updateHealthDisplay();
    this._updateMoneyDisplay();

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

    // mini-map canvas (top-left) mit verbesserter Funktionalität
    this.miniCanvas = document.createElement('canvas');
    this.miniCanvas.width = 220; this.miniCanvas.height = 220;
    this.miniCanvas.style.position = 'fixed';
    this.miniCanvas.style.left = '12px';
    this.miniCanvas.style.top = '12px';
    this.miniCanvas.style.zIndex = '9998';
    this.miniCanvas.style.border = '3px solid rgba(255,255,255,0.3)';
    this.miniCanvas.style.borderRadius = '8px';
    this.miniCanvas.style.background = 'rgba(0,0,0,0.7)';
    document.body.appendChild(this.miniCanvas);
    this.miniCtx = this.miniCanvas.getContext('2d');
    
    // Minimap-Stil
    this.minimapScale = 400; // Wie viel der Welt gezeigt wird
    this.minimapCenter = { x: 110, y: 110 };
  }

  _updateWeaponDisplay() {
    if (this.weaponEl) {
      const currentWeapon = this.weapons[this.currentWeaponIndex];
      this.weaponEl.textContent = currentWeapon.name.toUpperCase();
      
      // Ändere Farbe basierend auf Waffe
      if (currentWeapon.id === 'sniper') {
        this.weaponEl.style.color = '#ff6666';
        this.weaponEl.style.textShadow = '0 0 4px rgba(255, 102, 102, 0.6)';
      } else if (currentWeapon.id === 'shotgun') {
        this.weaponEl.style.color = '#ffaa00';
        this.weaponEl.style.textShadow = '0 0 4px rgba(255, 170, 0, 0.6)';
      } else {
        this.weaponEl.style.color = '#00ff88';
        this.weaponEl.style.textShadow = '0 0 4px rgba(0, 255, 136, 0.6)';
      }
    }
  }

  _updateHealthDisplay() {
    if (this.healthEl) {
      this.healthEl.textContent = Math.ceil(this.health);
    }
    if (this.healthFillEl) {
      const percentage = (this.health / this.maxHealth) * 100;
      this.healthFillEl.style.width = percentage + '%';
      
      // Change color based on health
      if (percentage > 60) {
        this.healthFillEl.style.background = 'linear-gradient(90deg, #44ff44 0%, #66ff66 50%, #88ff88 100%)';
      } else if (percentage > 30) {
        this.healthFillEl.style.background = 'linear-gradient(90deg, #ffaa44 0%, #ffcc66 50%, #ffdd88 100%)';
      } else {
        this.healthFillEl.style.background = 'linear-gradient(90deg, #ff4444 0%, #ff6666 50%, #ff8888 100%)';
      }
    }
  }

  _updateMoneyDisplay() {
    if (this.moneyEl) {
      this.moneyEl.textContent = this.money;
    }
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
  case 'Digit1': if (down && this.unlocked.shotgun) { this.currentWeaponIndex = 0; this.fireRate = this.weapons[0].fireRate; this.scopeFov = this.weapons[0].scopeFov; this._updateWeaponDisplay(); console.log('Weapon: Shotgun'); } break;
  case 'Digit2': if (down && this.unlocked.sniper) { this.currentWeaponIndex = 1; this.fireRate = this.weapons[1].fireRate; this.scopeFov = this.weapons[1].scopeFov; this._updateWeaponDisplay(); console.log('Weapon: Sniper'); } break;
  case 'Digit3': if (down && this.unlocked.smg) { this.currentWeaponIndex = 2; this.fireRate = this.weapons[2].fireRate; this.scopeFov = this.weapons[2].scopeFov; this._updateWeaponDisplay(); console.log('Weapon: SMG'); } break;
  case 'KeyB': if (down) { this._toggleShop(); } break;
      case 'KeyF': if (down) {
          // F für Türen öffnen/schließen
          this._interactWithNearestDoor();
        } break;
      case 'KeyE': if (down) {
          if (this.insideBuilding) {
            this._closeInterior();
          } else {
            // find nearest door with improved range and visual feedback
            let best = null; let bestDist = 3.5 * 3.5; // Erhöhte Reichweite
            for (const d of this.buildingDoors) {
              const dx = d.doorPos.distanceToSquared(this.yawObject.position);
              if (dx < bestDist) { best = d; bestDist = dx; }
            }
            if (best) {
              this._openInterior(best);
            } else {
              // Show hint when no door is nearby
              this._showTemporaryMessage("No door nearby. Move closer to a building.");
            }
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
  // Hochdetaillierte Waffe mit besseren Materialien und Texturen
  const gun = new THREE.Group();

  // Verbessertes Canvas für Waffendetails
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  // Grundfarbe
  ctx.fillStyle = '#1a1c20'; 
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Metallische Streifen und Details
  ctx.fillStyle = '#404448';
  for (let i = 0; i < 16; i++) {
    ctx.fillRect(10 + i * 60, 20, 35, 8);
    ctx.fillRect(15 + i * 60, 35, 25, 4);
  }
  
  // Waffenmarkierungen
  ctx.fillStyle = '#c8d2e0'; 
  ctx.font = 'bold 24px monospace'; 
  ctx.fillText('TACTICAL-X7', 20, 80);
  ctx.font = '16px monospace';
  ctx.fillText('.556 NATO', 20, 105);
  ctx.fillText('FULL AUTO', 20, 125);
  
  // Seriennummer
  ctx.fillStyle = '#808080';
  ctx.font = '12px monospace';
  ctx.fillText('SN: TX7-2024-001', 20, 145);

  const detailTex = new THREE.CanvasTexture(canvas);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;

  // Verbesserte Materialien
  const gunmetalMat = new THREE.MeshStandardMaterial({ 
    color: 0x1a1d22, 
    metalness: 0.9, 
    roughness: 0.2,
    envMapIntensity: 1.0
  });
  
  const receiverMat = new THREE.MeshStandardMaterial({ 
    color: 0x2d3037, 
    metalness: 0.4, 
    roughness: 0.5, 
    map: detailTex 
  });

  const gripMat = new THREE.MeshStandardMaterial({ 
    color: 0x1e1e1e, 
    metalness: 0.1, 
    roughness: 0.9,
    normalScale: new THREE.Vector2(0.5, 0.5)
  });

  // Hauptkörper (Receiver) - detaillierter
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.7), receiverMat);
  body.position.set(0.25, -0.14, -0.35);
  gun.add(body);

  // Oberer Receiver Teil
  const upperReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.65), gunmetalMat);
  upperReceiver.position.set(0.25, -0.06, -0.35);
  gun.add(upperReceiver);

  // Langer Lauf mit realistischen Proportionen
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 1.0, 20), gunmetalMat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.8, -0.14, -0.05);
  gun.add(barrel);

  // Laufmündung
  const muzzleDevice = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.032, 0.12, 16), gunmetalMat);
  muzzleDevice.rotation.z = Math.PI / 2;
  muzzleDevice.position.set(1.22, -0.14, -0.05);
  gun.add(muzzleDevice);

  // Verbesserte Picatinny Rail
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.08), gunmetalMat);
  rail.position.set(0.3, -0.02, -0.14);
  gun.add(rail);

  // Rail-Zähne für Realismus
  for (let i = 0; i < 8; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.06), gunmetalMat);
    tooth.position.set(0.1 + i * 0.04, 0.01, -0.14);
    rail.add(tooth);
  }

  // Hochwertiges Zielfernrohr mit realistischen Details
  const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.35, 16), new THREE.MeshStandardMaterial({ 
    color: 0x0a0a0c, 
    metalness: 0.8, 
    roughness: 0.15 
  }));
  scopeBody.rotation.z = Math.PI / 2;
  scopeBody.position.set(0.6, -0.04, -0.08);
  gun.add(scopeBody);

  // Vordere Scope-Linse (größer)
  const frontLens = new THREE.Mesh(new THREE.CircleGeometry(0.048, 16), new THREE.MeshStandardMaterial({ 
    color: 0x4477aa, 
    metalness: 0.9, 
    roughness: 0.02,
    transparent: true,
    opacity: 0.85,
    envMapIntensity: 1.5
  }));
  frontLens.position.set(0.775, -0.04, -0.08);
  frontLens.rotation.y = Math.PI / 2;
  gun.add(frontLens);

  // Hintere Scope-Linse (kleiner)
  const rearLens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), new THREE.MeshStandardMaterial({ 
    color: 0x2255aa, 
    metalness: 0.9, 
    roughness: 0.02,
    transparent: true,
    opacity: 0.9
  }));
  rearLens.position.set(0.425, -0.04, -0.08);
  rearLens.rotation.y = -Math.PI / 2;
  gun.add(rearLens);

  // Scope-Ringe (Montage)
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 16), new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      metalness: 0.6, 
      roughness: 0.4 
    }));
    ring.position.set(0.5 + i * 0.2, -0.04, -0.08);
    ring.rotation.z = Math.PI / 2;
    gun.add(ring);
  }

  // Scope-Verstellknöpfe
  const elevationKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 8), new THREE.MeshStandardMaterial({ 
    color: 0x222222, 
    metalness: 0.7, 
    roughness: 0.3 
  }));
  elevationKnob.position.set(0.6, 0.015, -0.08);
  gun.add(elevationKnob);

  const windageKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 8), new THREE.MeshStandardMaterial({ 
    color: 0x222222, 
    metalness: 0.7, 
    roughness: 0.3 
  }));
  windageKnob.position.set(0.6, -0.04, -0.025);
  windageKnob.rotation.x = Math.PI / 2;
  gun.add(windageKnob);

  // Verbesserter Griff
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.14), gripMat);
  grip.position.set(0.02, -0.32, -0.05);
  grip.rotation.x = 0.18;
  gun.add(grip);

  // Griffstruktur für besseren Halt
  for (let i = 0; i < 6; i++) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.02, 0.12), new THREE.MeshStandardMaterial({ 
      color: 0x151515, 
      metalness: 0.1, 
      roughness: 0.95 
    }));
    groove.position.set(0, -0.1 + i * 0.03, 0);
    grip.add(groove);
  }

  // Abzug
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.02), gunmetalMat);
  trigger.position.set(0.02, -0.24, -0.08);
  trigger.rotation.x = 0.2;
  gun.add(trigger);

  // Abzugsbügel
  const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 16), gunmetalMat);
  triggerGuard.position.set(0.02, -0.22, -0.08);
  triggerGuard.rotation.x = Math.PI / 2;
  gun.add(triggerGuard);

  // Verbessertes Magazin
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.05), new THREE.MeshStandardMaterial({ 
    color: 0x2a2a2a, 
    metalness: 0.3, 
    roughness: 0.6 
  }));
  mag.position.set(0.02, -0.08, -0.28);
  mag.rotation.x = -0.1;
  gun.add(mag);

  // Magazin-Details
  const magSpring = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.03), new THREE.MeshStandardMaterial({ 
    color: 0x888888, 
    metalness: 0.7, 
    roughness: 0.3 
  }));
  magSpring.position.set(0, 0.08, 0);
  mag.add(magSpring);

  // Schulterstütze
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.08), new THREE.MeshStandardMaterial({ 
    color: 0x1e1e1e, 
    metalness: 0.1, 
    roughness: 0.8 
  }));
  stock.position.set(-0.15, -0.14, -0.05);
  gun.add(stock);

  // Verbesserter Mündungsblitz
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ 
    color: 0xffcc44, 
    transparent: true, 
    opacity: 0.9,
    blending: THREE.AdditiveBlending
  }));
  flash.visible = false;

  // Mündungsposition
  const muzzle = new THREE.Object3D();
  muzzle.position.set(1.28, -0.14, -0.05);
  muzzle.add(flash);
  gun.add(muzzle);

  this.weapon = { group: gun, flash, muzzle };

  // Waffe an Kamera anhängen
  gun.position.set(0.4, -0.2, 0);
  gun.rotation.y = -0.05; // Leichte Neigung für bessere Sicht
  this.pitchObject.add(gun);
  }

  _createSky() {
    // Verbesserter Himmel mit realistischeren Farben und Atmosphäre
    const canvas = document.createElement('canvas');
    canvas.width = 2048; canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    // Komplexerer Himmelsgradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1e40af'); // Tiefes Blau oben
    gradient.addColorStop(0.2, '#2563eb');
    gradient.addColorStop(0.4, '#3b82f6'); 
    gradient.addColorStop(0.6, '#60a5fa');
    gradient.addColorStop(0.8, '#93c5fd');
    gradient.addColorStop(0.95, '#dbeafe');
    gradient.addColorStop(1, '#f0f9ff'); // Helles Blau am Horizont
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Füge Wolkenstrukturen hinzu
    ctx.globalCompositeOperation = 'overlay';
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height * 0.7; // Nur im oberen Bereich
      const size = 100 + Math.random() * 200;
      
      const cloudGrad = ctx.createRadialGradient(x, y, 0, x, y, size);
      cloudGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      cloudGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
      cloudGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.fillStyle = cloudGrad;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    }
    
    ctx.globalCompositeOperation = 'source-over';
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;

    const geom = new THREE.SphereGeometry(600, 32, 16);
    const mat = new THREE.MeshBasicMaterial({ 
      map: tex, 
      side: THREE.BackSide,
      depthWrite: false
    });
    const sky = new THREE.Mesh(geom, mat);
    sky.rotation.x = Math.PI / 2;
    this.scene.add(sky);

    // Verbesserte Atmosphäre mit Tiefennebel
    this.scene.fog = new THREE.FogExp2(0xb8d4f0, 0.0008);

    // Sichtbare Sonne mit Lens-Flare-Effekt
    const sunGeometry = new THREE.SphereGeometry(12, 16, 16);
    const sunMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffee88,
      emissive: 0xffdd44,
      emissiveIntensity: 0.8
    });
    const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    sunMesh.position.set(-120, 180, -80);
    this.scene.add(sunMesh);
    
    // Sonne-Halo-Effekt
    const haloGeometry = new THREE.SphereGeometry(20, 16, 16);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffee88,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending
    });
    const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
    haloMesh.position.copy(sunMesh.position);
    this.scene.add(haloMesh);
  }

  _createGround() {
    // Verbesserter Boden mit Schatten und besserer Textur
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    // Realistischere Grastextur
    ctx.fillStyle = '#5a8c3a'; 
    ctx.fillRect(0, 0, size, size);
    
    // Gras-Variationen für mehr Realismus
    for (let i = 0; i < 3000; i++) {
      const brightness = 0.8 + Math.random() * 0.4;
      ctx.fillStyle = `rgba(${Math.floor(65 * brightness)}, ${Math.floor(120 * brightness)}, ${Math.floor(45 * brightness)}, ${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
    
    // Füge Erd-Flecken hinzu
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(101, 67, 33, ${Math.random() * 0.2})`;
      const x = Math.random() * size;
      const y = Math.random() * size;
      const radius = 5 + Math.random() * 15;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    tex.anisotropy = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 1;
    
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      map: tex,
      roughness: 0.8,
      metalness: 0.1
    });
    
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.userData.hittable = true;
    ground.receiveShadow = true; // Boden empfängt Schatten
  ground.castShadow = false; // ground does not cast shadows
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

  _createEnemy(x, y, z) {
    const enemy = new THREE.Group();
    
    // Realistische Menschenmodelle mit noch kleineren Proportionen
    const skinColors = [0xd4a574, 0xc49969, 0xb08d57, 0xa67c52, 0x8b5a3c]; // Verschiedene Hauttöne
    const clothingColors = [0x2d4a22, 0x1a3d0a, 0x4a4a4a, 0x3d3d3d, 0x5a4a3a]; // Verschiedene Kleidungsfarben
    
    const skinColor = skinColors[Math.floor(Math.random() * skinColors.length)];
    const clothingColor = clothingColors[Math.floor(Math.random() * clothingColors.length)];
    
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor });
    const bodyMat = new THREE.MeshStandardMaterial({ color: clothingColor });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a }); // Schwarz für Hosen
    
    // Noch kleinerer, realistischerer Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 0.15), bodyMat);
    torso.position.set(0, 0.2, 0);
  torso.castShadow = true; // keep main body casting shadow
    enemy.add(torso);
    
    // Kleinerer, runderer Kopf
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), skinMat);
    head.position.set(0, 0.48, 0);
  head.castShadow = true; // keep head casting shadow
    enemy.add(head);
    
    // Haar (verschiedene Farben)
    const hairColors = [0x4a3428, 0x6b4423, 0x3c2415, 0x8b7355, 0x2c1b0f];
    const hairColor = hairColors[Math.floor(Math.random() * hairColors.length)];
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshStandardMaterial({ color: hairColor }));
    hair.position.set(0, 0.52, 0);
    hair.scale.set(1, 0.8, 1);
  // hair.castShadow = true; // disable small shadows for performance
    enemy.add(hair);
    
    // Realistischere Arme
    const leftUpperArm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.08), skinMat);
    leftUpperArm.position.set(-0.18, 0.15, 0);
  // leftUpperArm.castShadow = true;
    enemy.add(leftUpperArm);
    
    const leftLowerArm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.07), skinMat);
    leftLowerArm.position.set(-0.18, -0.08, 0);
  // leftLowerArm.castShadow = true;
    enemy.add(leftLowerArm);
    
    const rightUpperArm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.08), skinMat);
    rightUpperArm.position.set(0.18, 0.15, 0);
  // rightUpperArm.castShadow = true;
    enemy.add(rightUpperArm);
    
    const rightLowerArm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.07), skinMat);
    rightLowerArm.position.set(0.18, -0.08, 0);
  // rightLowerArm.castShadow = true;
    enemy.add(rightLowerArm);
    
    // Realistische Beine
    const leftUpperLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), legMat);
    leftUpperLeg.position.set(-0.08, -0.125, 0);
  // leftUpperLeg.castShadow = true;
    enemy.add(leftUpperLeg);
    
    const leftLowerLeg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.25, 0.09), legMat);
    leftLowerLeg.position.set(-0.08, -0.375, 0);
  // leftLowerLeg.castShadow = true;
    enemy.add(leftLowerLeg);
    
    const rightUpperLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), legMat);
    rightUpperLeg.position.set(0.08, -0.125, 0);
  // rightUpperLeg.castShadow = true;
    enemy.add(rightUpperLeg);
    
    const rightLowerLeg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.25, 0.09), legMat);
    rightLowerLeg.position.set(0.08, -0.375, 0);
  // rightLowerLeg.castShadow = true;
    enemy.add(rightLowerLeg);
    
    // Schuhe
    const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.18), new THREE.MeshStandardMaterial({ color: 0x2a1a0a }));
    leftShoe.position.set(-0.08, -0.525, 0.04);
  // leftShoe.castShadow = true;
    enemy.add(leftShoe);
    
    const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.18), new THREE.MeshStandardMaterial({ color: 0x2a1a0a }));
    rightShoe.position.set(0.08, -0.525, 0.04);
  // rightShoe.castShadow = true;
    enemy.add(rightShoe);
    
    // Zufällige Teams für Factional Warfare
    const teams = ['red', 'blue', 'green', 'yellow'];
    const teamColor = teams[Math.floor(Math.random() * teams.length)];
    let teamColorHex;
    switch(teamColor) {
      case 'red': teamColorHex = 0xff2222; break;
      case 'blue': teamColorHex = 0x2222ff; break;
      case 'green': teamColorHex = 0x22ff22; break;
      case 'yellow': teamColorHex = 0xffff22; break;
    }
    
    // Team-Abzeichen am Arm
    const teamBadge = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.02), 
      new THREE.MeshStandardMaterial({ color: teamColorHex })
    );
    teamBadge.position.set(0.18, 0.2, 0.05);
  // teamBadge.castShadow = true;
    enemy.add(teamBadge);
    
    // Verschiedene Waffentypen für Enemies
    const weaponTypes = ['rifle', 'smg', 'shotgun', 'sniper'];
    const chosenWeapon = weaponTypes[Math.floor(Math.random() * weaponTypes.length)];
    
    const weaponGroup = this._createEnemyWeapon(chosenWeapon);
    weaponGroup.position.set(0.15, 0.15, -0.1);
    weaponGroup.rotation.y = -Math.PI/6;
    enemy.add(weaponGroup);
    
    enemy.position.set(x, y, z);
    enemy.userData.isEnemy = true;
    enemy.userData.health = 100;
    enemy.userData.maxHealth = 100;
    enemy.userData.alive = true;
    enemy.userData.speed = 1.5 + Math.random() * 1; // Langsamere, realistischere Geschwindigkeit
    enemy.userData.weaponType = chosenWeapon;
    enemy.userData.weapon = weaponGroup;
    enemy.userData.lastShot = 0;
    enemy.userData.shootCooldown = 1 + Math.random() * 2;
    enemy.userData.detectionRange = 20; // Reduzierte Sichtweite
    enemy.userData.team = teamColor; // Team für Factional Warfare
    enemy.userData.patrolTarget = new THREE.Vector3(
      x + (Math.random() - 0.5) * 20,
      y,
      z + (Math.random() - 0.5) * 20
    );
    
    // Wichtig: userData für Kollisionserkennung hinzufügen
    enemy.userData.hittable = true;
    
    this.scene.add(enemy);
    return enemy;
  }

  _createEnemyWeapon(type) {
    const weaponGroup = new THREE.Group();
    
    switch(type) {
      case 'rifle': // AK-47 Style
        // Hauptkörper
        const rifleBody = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.04, 0.5), 
          new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
        );
        rifleBody.castShadow = true;
        weaponGroup.add(rifleBody);
        
        // Lauf
        const rifleBarrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.01, 0.01, 0.2), 
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        rifleBarrel.position.set(0, 0, -0.35);
        rifleBarrel.rotation.x = Math.PI/2;
        rifleBarrel.castShadow = true;
        weaponGroup.add(rifleBarrel);
        
        // Magazin
        const rifleMag = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.15, 0.08), 
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        rifleMag.position.set(0, -0.1, 0.1);
        rifleMag.castShadow = true;
        weaponGroup.add(rifleMag);
        break;
        
      case 'smg': // MP5 Style
        const smgBody = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.03, 0.3), 
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        smgBody.castShadow = true;
        weaponGroup.add(smgBody);
        
        const smgStock = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.02, 0.15), 
          new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
        );
        smgStock.position.set(0, 0, 0.2);
        smgStock.castShadow = true;
        weaponGroup.add(smgStock);
        break;
        
      case 'shotgun': // Shotgun Style
        const shotgunBody = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.05, 0.6), 
          new THREE.MeshStandardMaterial({ color: 0x4a3a2a })
        );
        shotgunBody.castShadow = true;
        weaponGroup.add(shotgunBody);
        
        const shotgunBarrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.015, 0.25), 
          new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
        );
        shotgunBarrel.position.set(0, 0, -0.4);
        shotgunBarrel.rotation.x = Math.PI/2;
        shotgunBarrel.castShadow = true;
        weaponGroup.add(shotgunBarrel);
        break;
        
      case 'sniper': // Sniper Style
        const sniperBody = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.04, 0.7), 
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        sniperBody.castShadow = true;
        weaponGroup.add(sniperBody);
        
        const sniperBarrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.3), 
          new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
        );
        sniperBarrel.position.set(0, 0, -0.5);
        sniperBarrel.rotation.x = Math.PI/2;
        sniperBarrel.castShadow = true;
        weaponGroup.add(sniperBarrel);
        
        // Scope
        const scope = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, 0.1), 
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        scope.position.set(0, 0.04, -0.1);
        scope.rotation.x = Math.PI/2;
        scope.castShadow = true;
        weaponGroup.add(scope);
        break;
    }
    
    return weaponGroup;
  }

  _spawnEnemies(count) {
    const spawnZones = [
      { x: 50, z: 50 },   // Nord-Ost
      { x: -50, z: 50 },  // Nord-West
      { x: 50, z: -50 },  // Süd-Ost
      { x: -50, z: -50 }, // Süd-West
      { x: 0, z: 80 },    // Nord
      { x: 0, z: -80 },   // Süd
      { x: 80, z: 0 },    // Ost
      { x: -80, z: 0 }    // West
    ];
    
    for (let i = 0; i < count; i++) {
      const zone = spawnZones[i % spawnZones.length];
      
      // Zufällige Position in der Zone
      const x = zone.x + (Math.random() - 0.5) * 30;
      const z = zone.z + (Math.random() - 0.5) * 30;
      const y = 0.5; // Niedrigere Höhe für kleinere Enemies
      
      // Prüfe, dass nicht in Gebäuden gespawnt wird
      let validPosition = false;
      let attempts = 0;
      let finalX = x, finalZ = z;
      
      while (!validPosition && attempts < 10) {
        validPosition = this._isValidSpawnPosition(finalX, finalZ);
        if (!validPosition) {
          finalX = zone.x + (Math.random() - 0.5) * 30;
          finalZ = zone.z + (Math.random() - 0.5) * 30;
          attempts++;
        }
      }
      
      const enemy = this._createEnemy(finalX, y, finalZ);
      this.enemies.push(enemy);
    }
    
    // Setze Respawn-Timer
    this.lastEnemyRespawn = Date.now();
    this.enemyRespawnInterval = 15000; // 15 Sekunden
    this.maxEnemies = count * 2; // Doppelt so viele Enemies erlaubt
  }

  _isValidSpawnPosition(x, z) {
    // Einfache Prüfung - nicht zu nah an Gebäuden spawnen
    for (let bx = 0; bx < 20; bx++) {
      for (let bz = 0; bz < 20; bz++) {
        const buildingX = (bx - 10) * 20;
        const buildingZ = (bz - 10) * 20;
        
        const dist = Math.sqrt((x - buildingX) ** 2 + (z - buildingZ) ** 2);
        if (dist < 8) { // Mindestabstand zu Gebäuden
          return false;
        }
      }
    }
    return true;
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
    
    // build hittable list once - jetzt auch Enemies einschließen
    const hittables = [];
    this.scene.traverse((obj) => { 
      if (obj.isMesh && obj.userData && obj.userData.hittable) {
        hittables.push(obj); 
      }
    });
    
    // Füge alle Enemy-Teile zur Hittable-Liste hinzu
    for (const enemy of this.enemies) {
      if (enemy.userData.alive) {
        hittables.push(enemy); // Das Group-Objekt selbst
        // Füge auch alle Children hinzu
        enemy.children.forEach(child => {
          if (child.isMesh) {
            child.userData.isEnemyPart = true;
            child.userData.parentEnemy = enemy;
            hittables.push(child);
          }
        });
      }
    }

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
            if (obj === t.mesh) { 
              t.alive = false; 
              this.scene.remove(t.mesh); 
              this._updateScore(); 
              this.money += 5; // Geld für Zielabschuss
              this._updateMoneyDisplay();
              break; 
            }
            obj = obj.parent;
          }
        }
        
        // Check if we hit an enemy (verbesserte Logik)
        let enemyHit = false;
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          const enemy = this.enemies[i];
          if (!enemy.userData.alive || enemyHit) continue;
          
          // Prüfe direkten Treffer auf Enemy oder Enemy-Teil
          const hitObject = intersects[0].object;
          let isEnemyHit = false;
          
          // 1. Prüfe ob das getroffene Objekt ein Enemy-Teil ist
          if (hitObject.userData && hitObject.userData.isEnemyPart && hitObject.userData.parentEnemy === enemy) {
            isEnemyHit = true;
          }
          
          // 2. Prüfe ob das getroffene Objekt der Enemy selbst ist
          if (hitObject === enemy) {
            isEnemyHit = true;
          }
          
          // 3. Prüfe die Parent-Hierarchie
          let obj = hitObject;
          while (obj && !isEnemyHit) {
            if (obj === enemy) {
              isEnemyHit = true;
              break;
            }
            obj = obj.parent;
          }
          
          if (isEnemyHit) {
            enemyHit = true; // Verhindere mehrfache Treffer
            
            // Damage the enemy und markiere als angegriffen
            const damage = weapon.damage * 10; // Scale damage
            enemy.userData.health -= damage;
            enemy.userData.lastDamageTime = Date.now(); // Markiere als unter Beschuss
            
            if (enemy.userData.health <= 0) {
              // Enemy killed
              enemy.userData.alive = false;
              this.scene.remove(enemy);
              this.enemies.splice(i, 1);
              this.money += 15; // More money for killing enemies
              this._updateMoneyDisplay();
              this._showTemporaryMessage(`+$15 Enemy Eliminated!`, 1500);
            } else {
              // Enemy damaged - zeige Blut-Effekt
              this._createBloodEffect(intersects[0].point);
              this._showTemporaryMessage(`Enemy Hit! (-${damage} HP)`, 800);
            }
            break; // Wichtig: Breche ab nachdem ein Enemy getroffen wurde
          }
        }
      }

      // draw subtle line tracer only (no sphere)
      try {
        // cap number of tracers
        if (this.tracers.length >= MAX_TRACERS) {
          const old = this.tracers.shift();
          try { if (old.line) this.scene.remove(old.line); } catch (e) {}
        }
        const start = camPos.clone().add(dir.clone().multiplyScalar(1.2));
        const pts = [start.clone(), start.clone()];
        const geom = new THREE.BufferGeometry();
        geom.setFromPoints(pts);
        // reuse tracer material if possible
        if (!this._tracerMat) this._tracerMat = new THREE.LineBasicMaterial({ color: 0xffeecc, transparent: true, opacity: 0.38 });
        const line = new THREE.Line(geom, this._tracerMat);
        line.frustumCulled = false;
        this.scene.add(line);
        this.tracers.push({ line, start: start.clone(), dir: dir.clone(), maxDist: start.distanceTo(hitPoint), t: 0, dur: 0.05 });

        const impactGeo = new THREE.SphereGeometry(0.08, 6, 6);
        const impactMat = new THREE.MeshBasicMaterial({ color: 0xffcc99, transparent: true, opacity: 0.9 });
        const impact = new THREE.Mesh(impactGeo, impactMat);
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
  
  // Update interaction prompts
  this._updateInteractionPrompt();
  
  // Update enemies
  this._updateEnemies(dt);
  
  // Enemy Respawn System
  this._handleEnemyRespawn();
  }

  _updateEnemies(dt) {
    const playerPos = this.yawObject.position;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.userData.alive) continue;

      const enemyPos = enemy.position;
      const distToPlayer = enemyPos.distanceTo(playerPos);

      // Prüfe ob Enemy unter Beschuss steht (erweiterte Detection)
      const isUnderAttack = enemy.userData.lastDamageTime && (Date.now() - enemy.userData.lastDamageTime) < 5000;
      const extendedRange = isUnderAttack ? enemy.userData.detectionRange * 2 : enemy.userData.detectionRange;

      if (distToPlayer < extendedRange || isUnderAttack) {
        // Spieler entdeckt - verfolge und schieße
        enemy.userData.state = 'hunting_player';
        enemy.userData.targetPlayer = true;

        const dirToPlayer = new THREE.Vector3().subVectors(playerPos, enemyPos);
        dirToPlayer.y = 0;
        dirToPlayer.normalize();

        const moveVector = dirToPlayer.clone().multiplyScalar(enemy.userData.speed * dt);
        const candidatePos = enemyPos.clone().add(moveVector);
        candidatePos.y = 0.5;

        if (this._canMoveTo(enemyPos, candidatePos)) {
          enemy.position.x = candidatePos.x;
          enemy.position.z = candidatePos.z;
          enemy.position.y = 0.5;
        } else {
          // try sidestep
          const side = new THREE.Vector3(-dirToPlayer.z, 0, dirToPlayer.x).multiplyScalar(enemy.userData.speed * dt);
          const sidePos = enemyPos.clone().add(side);
          sidePos.y = 0.5;
          if (this._canMoveTo(enemyPos, sidePos)) {
            enemy.position.x = sidePos.x;
            enemy.position.z = sidePos.z;
            enemy.position.y = 0.5;
          }
        }

        enemy.lookAt(playerPos.x, enemy.position.y, playerPos.z);

        // shooting timing
        enemy.userData.lastShot += dt;
        const shootDelay = enemy.userData.shootCooldown + (Math.random() * 0.5);
        if (enemy.userData.lastShot >= shootDelay && distToPlayer > 3 && distToPlayer < 30) {
          this._enemyShoot(enemy, playerPos);
          enemy.userData.lastShot = 0;
        }
        continue;
      }

      // free roaming / look for enemies from other teams
      enemy.userData.state = 'free_roaming';
      let targetEnemy = null;
      let closestEnemyDist = Infinity;

      for (const other of this.enemies) {
        if (other === enemy || !other.userData.alive) continue;
        if (other.userData.team === enemy.userData.team) continue;
        const d = enemyPos.distanceTo(other.position);
        if (d < 35 && d < closestEnemyDist) {
          targetEnemy = other;
          closestEnemyDist = d;
        }
      }

      if (targetEnemy) {
        // fight another enemy
        enemy.userData.state = 'fighting_enemy';
        const dir = new THREE.Vector3().subVectors(targetEnemy.position, enemyPos);
        dir.y = 0; dir.normalize();
        const move = dir.clone().multiplyScalar(enemy.userData.speed * 0.8 * dt);
        const nextPos = enemyPos.clone().add(move); nextPos.y = 0.5;
        if (this._canMoveTo(enemyPos, nextPos)) {
          enemy.position.x = nextPos.x; enemy.position.z = nextPos.z; enemy.position.y = 0.5;
        }
        enemy.lookAt(targetEnemy.position.x, enemy.position.y, targetEnemy.position.z);

        enemy.userData.lastShot += dt;
        const fightDelay = enemy.userData.shootCooldown + (Math.random() * 1.0);
        if (enemy.userData.lastShot >= fightDelay && closestEnemyDist > 2 && closestEnemyDist < 25) {
          this._enemyShoot(enemy, targetEnemy.position);
          enemy.userData.lastShot = 0;
        }
        continue;
      }

      // wander/go to goal
      if (!enemy.userData.currentGoal || Math.random() < 0.01) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 15 + Math.random() * 25;
        enemy.userData.currentGoal = new THREE.Vector3(
          enemyPos.x + Math.cos(angle) * distance,
          0.5,
          enemyPos.z + Math.sin(angle) * distance
        );
        enemy.userData.currentGoal.x = Math.max(-100, Math.min(100, enemy.userData.currentGoal.x));
        enemy.userData.currentGoal.z = Math.max(-100, Math.min(100, enemy.userData.currentGoal.z));
      }

      const goal = enemy.userData.currentGoal;
      const distToGoal = enemyPos.distanceTo(goal);
      if (distToGoal > 2) {
        const dir = new THREE.Vector3().subVectors(goal, enemyPos);
        dir.y = 0; dir.normalize();
        dir.x += (Math.random() - 0.5) * 0.3;
        dir.z += (Math.random() - 0.5) * 0.3;
        dir.normalize();
        const mv = dir.clone().multiplyScalar(enemy.userData.speed * 0.7 * dt);
        const cand = enemyPos.clone().add(mv); cand.y = 0.5;
        if (this._canMoveTo(enemyPos, cand)) {
          enemy.position.x = cand.x; enemy.position.z = cand.z; enemy.position.y = 0.5;
          enemy.lookAt(enemy.position.x + dir.x * 5, enemy.position.y, enemy.position.z + dir.z * 5);
        } else {
          enemy.userData.currentGoal = null;
        }
      } else {
        enemy.userData.currentGoal = null;
      }
    }
  }

  _canMoveTo(currentPos, newPos) {
    // Einfache Kollisionserkennung mit Gebäuden
  // Buildings are arranged in a 20x20 grid
    for (let x = 0; x < 20; x++) {
      for (let z = 0; z < 20; z++) {
        const buildingX = (x - 10) * 20;
        const buildingZ = (z - 10) * 20;
        
        // Check if the new position is inside a building
        if (newPos.x > buildingX - 8 && newPos.x < buildingX + 8 &&
            newPos.z > buildingZ - 8 && newPos.z < buildingZ + 8) {
          return false; // collision with building
        }
      }
    }
    
    // Prüfe Kollision mit anderen Enemies
    for (const enemy of this.enemies) {
      if (!enemy.userData.alive) continue;
      const dist = newPos.distanceTo(enemy.position);
      if (dist < 1.0 && enemy.position.distanceTo(currentPos) > 0.1) {
        return false; // Zu nah an anderem Enemy
      }
    }
    
    return true; // Bewegung erlaubt
  }

  _enemyShoot(enemy, targetPos) {
    const currentTime = Date.now();
    const weaponType = enemy.userData.weaponType;
    
    // Verschiedene Schussraten je nach Waffe
    const fireRates = {
      'rifle': 600,    // 0.6 Sekunden
      'smg': 300,      // 0.3 Sekunden (schneller)
      'shotgun': 1200, // 1.2 Sekunden (langsamer)
      'sniper': 2000   // 2 Sekunden (sehr langsam)
    };
    
    const fireRate = fireRates[weaponType] || 600;
    if (currentTime - enemy.userData.lastShot < fireRate) {
      return; // Noch nicht bereit zum Schießen
    }
    
    enemy.userData.lastShot = currentTime;
    
    // Muzzle Flash Effekt erstellen
    this._createEnemyMuzzleFlash(enemy);
    
    // Schussposition berechnen
    const startPos = enemy.position.clone();
    startPos.y += 0.6; // Waffenhöhe
    startPos.add(new THREE.Vector3(0.2, 0, -0.2)); // Offset zur Waffe
    
    const direction = new THREE.Vector3().subVectors(targetPos, startPos).normalize();
    
    // Verschlechterte Treffsicherheit je nach Waffe und Distanz
    const distToTarget = startPos.distanceTo(targetPos);
    let accuracy = 0.3; // Basis-Treffsicherheit stark reduziert
    
    switch(weaponType) {
      case 'rifle': accuracy = 0.4; break;
      case 'smg': accuracy = 0.25; break;
      case 'shotgun': accuracy = distToTarget < 15 ? 0.6 : 0.1; break; // Nur auf kurze Distanz gut
      case 'sniper': accuracy = distToTarget > 20 ? 0.7 : 0.2; break; // Nur auf lange Distanz gut
    }
    
    // Distanz-Malus
    accuracy *= Math.max(0.1, 1 - (distToTarget / 50));
    
    // Streuung hinzufügen (Enemy verfehlt öfter)
    const spread = 0.3; // Große Streuung
    direction.x += (Math.random() - 0.5) * spread;
    direction.y += (Math.random() - 0.5) * spread * 0.5;
    direction.z += (Math.random() - 0.5) * spread;
    direction.normalize();
    
    // Prüfe ob Ziel getroffen wird (Spieler oder anderer Enemy)
    if (Math.random() < accuracy && distToTarget < 40) {
      // Prüfe ob das Ziel ein anderer Enemy ist
      let hitEnemy = null;
      for (const otherEnemy of this.enemies) {
        if (otherEnemy.userData.alive && otherEnemy.position.distanceTo(targetPos) < 2) {
          hitEnemy = otherEnemy;
          break;
        }
      }
      
      if (hitEnemy) {
        // Enemy vs Enemy Schaden
        const damage = this._getWeaponDamage(weaponType);
        hitEnemy.userData.health -= damage;
        
        // Blut-Effekt für Enemy
        this._createBloodEffect(targetPos);
        
        if (hitEnemy.userData.health <= 0) {
          // Enemy getötet
          hitEnemy.userData.alive = false;
          this.scene.remove(hitEnemy);
          this.enemies.splice(this.enemies.indexOf(hitEnemy), 1);
        }
      } else {
        // Spieler getroffen!
        const damage = this._getWeaponDamage(weaponType);
        this._damagePlayer(damage);
      }
    }
    
    // Visueller Tracer (jetzt mit verschiedenen Farben je nach Waffe)
    try {
      const tracerColor = this._getTracerColor(weaponType);
      const endPos = startPos.clone().add(direction.clone().multiplyScalar(40));
      const geom = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
      const mat = new THREE.LineBasicMaterial({ 
        color: tracerColor, 
        transparent: true, 
        opacity: 0.8,
        linewidth: 2
      });
      const line = new THREE.Line(geom, mat);
      this.scene.add(line);
      
      setTimeout(() => {
        this.scene.remove(line);
      }, 150);
    } catch (e) {}
  }

  _createEnemyMuzzleFlash(enemy) {
    // Erstelle einen sichtbaren Muzzle Flash
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ 
        color: 0xffaa00,
        transparent: true,
        opacity: 0.9
      })
    );
    
    // Position am Ende der Waffe
    const weaponPos = enemy.position.clone();
    weaponPos.y += 0.6;
    weaponPos.add(new THREE.Vector3(0.2, 0, -0.4)); // Mündung der Waffe
    flash.position.copy(weaponPos);
    
    this.scene.add(flash);
    
    // Partikel-Effekt
    for (let i = 0; i < 8; i++) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xff6600 })
      );
      spark.position.copy(weaponPos);
      spark.position.add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3
      ));
      this.scene.add(spark);
      
      // Entferne Funken nach kurzer Zeit
      setTimeout(() => {
        this.scene.remove(spark);
      }, 100 + Math.random() * 100);
    }
    
    // Entferne Hauptflash nach kurzer Zeit
    setTimeout(() => {
      this.scene.remove(flash);
    }, 80);
  }

  _getWeaponDamage(weaponType) {
    switch(weaponType) {
      case 'rifle': return 8 + Math.random() * 6;
      case 'smg': return 4 + Math.random() * 4;
      case 'shotgun': return 15 + Math.random() * 10;
      case 'sniper': return 20 + Math.random() * 15;
      default: return 5 + Math.random() * 5;
    }
  }

  _getTracerColor(weaponType) {
    switch(weaponType) {
      case 'rifle': return 0xff4444;
      case 'smg': return 0xff6644;
      case 'shotgun': return 0xff8844;
      case 'sniper': return 0xff2222;
      default: return 0xff4444;
    }
  }

  _damagePlayer(damage) {
    this.health = Math.max(0, this.health - damage);
    this._updateHealthDisplay();
    
    // Rotes Bildschirm-Overlay bei Schaden
    this._showDamageEffect();
    
    if (this.health <= 0) {
      this._gameOver();
    }
  }

  _showDamageEffect() {
    const damageOverlay = document.createElement('div');
    damageOverlay.style.position = 'fixed';
    damageOverlay.style.inset = '0';
    damageOverlay.style.background = 'rgba(255, 0, 0, 0.3)';
    damageOverlay.style.pointerEvents = 'none';
    damageOverlay.style.zIndex = '9999';
    damageOverlay.style.animation = 'damageFlash 0.3s ease-out';
    
    document.body.appendChild(damageOverlay);
    
    setTimeout(() => {
      damageOverlay.remove();
    }, 300);
  }

  _gameOver() {
    this._showTemporaryMessage('GAME OVER! Lade die Seite neu um erneut zu spielen.', 10000);
    this.running = false;
  }

  _createBloodEffect(position) {
    // Erstelle einen kleinen roten Partikel-Effekt
    const bloodGeometry = new THREE.SphereGeometry(0.05, 6, 6);
    const bloodMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xaa0000, 
      transparent: true, 
      opacity: 0.8 
    });
    
    for (let i = 0; i < 3; i++) {
      const blood = new THREE.Mesh(bloodGeometry, bloodMaterial);
      blood.position.copy(position);
      blood.position.add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2
      ));
      
      this.scene.add(blood);
      
      // Animiere Blut nach unten
      const startY = blood.position.y;
      const startTime = performance.now();
      
      const animateBlood = (time) => {
        const elapsed = time - startTime;
        const progress = elapsed / 1000; // 1 Sekunde
        
        blood.position.y = startY - progress * 2; // Fällt nach unten
        blood.material.opacity = 0.8 - progress; // Verblasst
        
        if (progress < 1) {
          requestAnimationFrame(animateBlood);
        } else {
          this.scene.remove(blood);
        }
      };
      
      requestAnimationFrame(animateBlood);
    }
  }

  _interactWithNearestDoor() {
  // Find nearest door to open/close
    let nearestDoor = null;
    let nearestDist = 2.5 * 2.5;
    
    // Suche nach normalen Türen in der Nähe
    this.scene.traverse((obj) => {
      if (obj.userData && obj.userData.isDoor && !obj.userData.isBalconyDoor) {
        const doorPos = new THREE.Vector3();
        obj.getWorldPosition(doorPos);
        const dist = doorPos.distanceToSquared(this.yawObject.position);
        if (dist < nearestDist) {
          nearestDoor = obj;
          nearestDist = dist;
        }
      }
    });
    
    if (nearestDoor) {
      // Türe öffnen/schließen
      const isOpen = nearestDoor.userData.open;
      nearestDoor.userData.open = !isOpen;
      
      const currentRot = nearestDoor.rotation.y;
      const targetRot = isOpen ? currentRot + Math.PI/2 : currentRot - Math.PI/2;
      
  // Animate door
      const startTime = performance.now();
      const duration = 400;
      
      const animateDoor = (now) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
        
        nearestDoor.rotation.y = currentRot + (targetRot - currentRot) * eased;
        
        if (progress < 1) {
          requestAnimationFrame(animateDoor);
        }
      };
      
      requestAnimationFrame(animateDoor);
  this._showTemporaryMessage(isOpen ? 'Door closed' : 'Door opened', 1000);
    } else {
  this._showTemporaryMessage('No door nearby', 1000);
    }
  }

  _render() {
    this.renderer.render(this.scene, this.camera);
    this._updateMinimap();
  }

  _updateMinimap() {
  if (!this.miniCtx) return;
  const now = performance.now();
  if (now - (this._lastMinimapUpdate || 0) < 100) return; // throttle to 10 FPS for minimap
  this._lastMinimapUpdate = now;
    
    const ctx = this.miniCtx;
    const canvas = this.miniCanvas;
    
    // Lösche Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Hintergrund
    ctx.fillStyle = 'rgba(20, 30, 40, 0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Spielerposition
    const playerX = this.yawObject.position.x;
    const playerZ = this.yawObject.position.z;
    
    // Funktion um Weltkoordinaten zu Minimap-Koordinaten zu konvertieren
    const worldToMinimap = (worldX, worldZ) => ({
      x: this.minimapCenter.x + (worldX - playerX) * (canvas.width / this.minimapScale),
      y: this.minimapCenter.y + (worldZ - playerZ) * (canvas.height / this.minimapScale)
    });
    
  // Draw buildings
    ctx.fillStyle = 'rgba(180, 180, 180, 0.8)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    
    for (const bbox of this.buildingBoxes) {
      const min = worldToMinimap(bbox.box3.min.x, bbox.box3.min.z);
      const max = worldToMinimap(bbox.box3.max.x, bbox.box3.max.z);
      
      // Nur zeichnen wenn auf der sichtbaren Minimap
      if (max.x >= 0 && min.x <= canvas.width && max.y >= 0 && min.y <= canvas.height) {
        const width = max.x - min.x;
        const height = max.y - min.y;
        
        ctx.fillRect(min.x, min.y, width, height);
        ctx.strokeRect(min.x, min.y, width, height);
      }
    }
    
    // Zeichne Straßen/Gehwege
    ctx.fillStyle = 'rgba(60, 60, 60, 0.6)';
    const roadWidth = canvas.width / 20;
    // Horizontale Straßen
    for (let i = -3; i <= 3; i++) {
      const roadZ = i * 44; // Straßenabstand
      const pos = worldToMinimap(-200, roadZ);
      if (pos.y >= -roadWidth && pos.y <= canvas.height + roadWidth) {
        ctx.fillRect(0, pos.y - roadWidth/2, canvas.width, roadWidth);
      }
    }
    // Vertikale Straßen
    for (let i = -3; i <= 3; i++) {
      const roadX = i * 44;
      const pos = worldToMinimap(roadX, -200);
      if (pos.x >= -roadWidth && pos.x <= canvas.width + roadWidth) {
        ctx.fillRect(pos.x - roadWidth/2, 0, roadWidth, canvas.height);
      }
    }
    
    // Zeichne Targets
    ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
    for (const target of this.targets) {
      if (target.alive) {
        const pos = worldToMinimap(target.mesh.position.x, target.mesh.position.z);
        if (pos.x >= 0 && pos.x <= canvas.width && pos.y >= 0 && pos.y <= canvas.height) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Zeichne Enemies (verschiedene Farben für Teams)
    for (const enemy of this.enemies) {
      if (enemy.userData.alive) {
        const pos = worldToMinimap(enemy.position.x, enemy.position.z);
        if (pos.x >= 0 && pos.x <= canvas.width && pos.y >= 0 && pos.y <= canvas.height) {
          // Team-Farben
          switch(enemy.userData.team) {
            case 'red':
              ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
              ctx.strokeStyle = 'rgba(255, 120, 120, 0.8)';
              break;
            case 'blue':
              ctx.fillStyle = 'rgba(60, 60, 255, 0.9)';
              ctx.strokeStyle = 'rgba(120, 120, 255, 0.8)';
              break;
            case 'green':
              ctx.fillStyle = 'rgba(60, 255, 60, 0.9)';
              ctx.strokeStyle = 'rgba(120, 255, 120, 0.8)';
              break;
            case 'yellow':
              ctx.fillStyle = 'rgba(255, 255, 60, 0.9)';
              ctx.strokeStyle = 'rgba(255, 255, 120, 0.8)';
              break;
            default:
              ctx.fillStyle = 'rgba(255, 140, 0, 0.9)';
              ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
          }
          ctx.lineWidth = 1;
          
          ctx.save();
          ctx.translate(pos.x, pos.y);
          ctx.rotate(-enemy.rotation.y + Math.PI/2);
          
          ctx.beginPath();
          ctx.moveTo(0, -4);
          ctx.lineTo(-3, 3);
          ctx.lineTo(3, 3);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          
          ctx.restore();
        }
      }
    }
    
    // Zeichne Spieler (Dreieck zeigt Blickrichtung)
    const playerPos = worldToMinimap(playerX, playerZ);
    const playerYaw = this.yawObject.rotation.y;
    
    ctx.save();
    ctx.translate(playerPos.x, playerPos.y);
    ctx.rotate(-playerYaw + Math.PI/2); // Korrekte Rotation
    
    // Spieler-Dreieck
    ctx.fillStyle = 'rgba(0, 255, 100, 0.9)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-6, 6);
    ctx.lineTo(6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    ctx.restore();
    
    // Zeichne Sichtfeld-Kegel
    ctx.strokeStyle = 'rgba(0, 255, 100, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playerPos.x, playerPos.y);
    
    const viewDistance = 50;
    const fovAngle = Math.PI / 3; // 60 Grad Sichtfeld
    
    for (let i = -1; i <= 1; i += 2) {
      const angle = -playerYaw + Math.PI/2 + (i * fovAngle / 2);
      const endX = playerPos.x + Math.cos(angle) * viewDistance;
      const endY = playerPos.y + Math.sin(angle) * viewDistance;
      ctx.moveTo(playerPos.x, playerPos.y);
      ctx.lineTo(endX, endY);
    }
    ctx.stroke();
    
    // Minimap-Titel
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = 'bold 12px Arial';
    ctx.fillText('MINIMAP', 8, 18);
    
    // Kompass
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.font = '10px Arial';
    
    const compassX = canvas.width - 25;
    const compassY = 25;
    ctx.strokeRect(compassX - 15, compassY - 15, 30, 30);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('N', compassX - 4, compassY - 8);
    ctx.fillText('S', compassX - 4, compassY + 12);
    ctx.fillText('W', compassX - 12, compassY + 3);
    ctx.fillText('E', compassX + 8, compassY + 3);
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
          // robuster Check: prüfe XZ-Footprint + Y-Toleranz anstatt containsPoint (floating point issues)
          const carBox = new THREE.Box3().setFromObject(ev.car);
          const pos = this.yawObject.position;
          const xIn = pos.x >= carBox.min.x - 0.3 && pos.x <= carBox.max.x + 0.3;
          const zIn = pos.z >= carBox.min.z - 0.3 && pos.z <= carBox.max.z + 0.3;
          const yIn = pos.y >= carBox.min.y - 0.6 && pos.y <= carBox.max.y + 0.6;
          if (!(xIn && zIn && yIn)) {
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

  _showTemporaryMessage(message, duration = 2000) {
    // Entferne vorherige Nachricht falls vorhanden
    const existingMsg = document.getElementById('temp-message');
    if (existingMsg) existingMsg.remove();
    
    const msgEl = document.createElement('div');
    msgEl.id = 'temp-message';
    msgEl.style.position = 'fixed';
    msgEl.style.bottom = '20%';
    msgEl.style.left = '50%';
    msgEl.style.transform = 'translateX(-50%)';
    msgEl.style.padding = '12px 20px';
    msgEl.style.background = 'rgba(0, 0, 0, 0.8)';
    msgEl.style.color = '#fff';
    msgEl.style.borderRadius = '8px';
    msgEl.style.border = '2px solid rgba(255, 255, 255, 0.3)';
    msgEl.style.fontSize = '16px';
    msgEl.style.zIndex = '10001';
    msgEl.style.animation = 'fadeInOut 0.3s ease-in';
    msgEl.textContent = message;
    
    document.body.appendChild(msgEl);
    
    setTimeout(() => {
      if (msgEl.parentNode) {
        msgEl.style.animation = 'fadeInOut 0.3s ease-out reverse';
        setTimeout(() => msgEl.remove(), 300);
      }
    }, duration);
  }

  _updateInteractionPrompt() {
    if (!this.pointerLocked) return;
    
  // Find nearest door
    let nearestDoor = null;
    let nearestDist = 3.5 * 3.5;
    
    for (const d of this.buildingDoors) {
      const dist = d.doorPos.distanceToSquared(this.yawObject.position);
      if (dist < nearestDist) {
        nearestDoor = d;
        nearestDist = dist;
      }
    }
    
    // Entferne vorherigen Prompt
    const existingPrompt = document.getElementById('interaction-prompt');
    if (existingPrompt) existingPrompt.remove();
    
  // Show prompt when door is nearby
    if (nearestDoor || this.insideBuilding) {
      const promptEl = document.createElement('div');
      promptEl.id = 'interaction-prompt';
      promptEl.style.position = 'fixed';
      promptEl.style.bottom = '15%';
      promptEl.style.left = '50%';
      promptEl.style.transform = 'translateX(-50%)';
      promptEl.style.padding = '8px 16px';
      promptEl.style.background = 'rgba(0, 100, 200, 0.9)';
      promptEl.style.color = '#fff';
      promptEl.style.borderRadius = '6px';
      promptEl.style.fontSize = '14px';
      promptEl.style.fontWeight = 'bold';
      promptEl.style.zIndex = '10000';
      promptEl.style.border = '2px solid rgba(255, 255, 255, 0.4)';
      
      if (this.insideBuilding) {
  promptEl.textContent = 'Press E to leave the building';
      } else {
  promptEl.textContent = 'Press E to enter the building';
      }
      
      document.body.appendChild(promptEl);
    }
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
  this._showTemporaryMessage('Not enough money!');
      return;
    }
    this.money -= cost;
    this.unlocked[id] = true;
    // apply weapon unlock: prefer not to switch automatically, but allow immediate equip
    for (let i = 0; i < this.weapons.length; i++) {
      if (this.weapons[i].id === id) { 
        this.currentWeaponIndex = i; 
        this.fireRate = this.weapons[i].fireRate; 
        this.scopeFov = this.weapons[i].scopeFov; 
        this._updateWeaponDisplay();
      }
    }
    // update UI
    const m = this.shopEl.querySelector('#money'); if (m) m.textContent = String(this.money);
    const btn = this.shopEl.querySelector(`[data-weapon="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = `${id.toUpperCase()} (Owned)`; }
    console.log(`Bought ${id}`);
    this._showTemporaryMessage(`${this.weapons.find(w => w.id === id).name} gekauft!`);
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
    this._spawnEnemies(16); // Mehr Enemies für dichtere Action

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

  _handleEnemyRespawn() {
    const currentTime = Date.now();
    const aliveEnemies = this.enemies.filter(e => e.userData.alive).length;
    
    // Respawn wenn weniger als Mindestanzahl oder Zeitintervall erreicht
    if (aliveEnemies < this.maxEnemies && 
        (aliveEnemies < 12 || currentTime - this.lastEnemyRespawn > this.enemyRespawnInterval)) {
      
      const respawnCount = Math.min(4, this.maxEnemies - aliveEnemies); // Max 4 auf einmal
      
      for (let i = 0; i < respawnCount; i++) {
        // Wähle Spawn-Zone weit weg vom Spieler
        const playerPos = this.yawObject.position;
        const spawnZones = [
          { x: 70, z: 70 },   { x: -70, z: 70 },  { x: 70, z: -70 },  { x: -70, z: -70 },
          { x: 90, z: 0 },    { x: -90, z: 0 },   { x: 0, z: 90 },    { x: 0, z: -90 },
          { x: 60, z: 40 },   { x: -60, z: 40 },  { x: 60, z: -40 },  { x: -60, z: -40 }
        ];
        
        // Sortiere nach Distanz zum Spieler (fernste zuerst)
        spawnZones.sort((a, b) => {
          const distA = Math.sqrt((a.x - playerPos.x) ** 2 + (a.z - playerPos.z) ** 2);
          const distB = Math.sqrt((b.x - playerPos.x) ** 2 + (b.z - playerPos.z) ** 2);
          return distB - distA;
        });
        
        const zone = spawnZones[i % spawnZones.length];
        const x = zone.x + (Math.random() - 0.5) * 20;
        const z = zone.z + (Math.random() - 0.5) * 20;
        const y = 0.5;
        
        // Prüfe Position
        if (this._isValidSpawnPosition(x, z)) {
          const enemy = this._createEnemy(x, y, z);
          this.enemies.push(enemy);
        }
      }
      
      this.lastEnemyRespawn = currentTime;
    }
  }
}
