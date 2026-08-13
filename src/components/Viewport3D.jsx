import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { load3DModel } from '../utils/loaders.js';
import { RefreshCw, AlertTriangle, Sparkles, UploadCloud } from 'lucide-react';

export default function Viewport3D({
  currentFile,
  renderMode,
  envPreset,
  showGrid,
  showAxes,
  autoRotate,
  isOrthographic,
  cameraPresetRequest,
  resetCameraRequest,
  snapshotRequest,
  onModelLoaded,
  onProgressUpdate,
  nodeVisibilityToggle
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const currentModelRef = useRef(null);
  const mixerRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const lightsGroupRef = useRef(null);
  const gridHelperRef = useRef(null);
  const axesHelperRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const originalMaterialsRef = useRef(new Map());

  // 1. Inicialización de Escena Three.js con Fondo Negro Puro
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); // Negro Total
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(3, 2, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35; // Alta nitidez y contraste de brillos
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI;
    controlsRef.current = controls;

    const lightsGroup = new THREE.Group();
    scene.add(lightsGroup);
    lightsGroupRef.current = lightsGroup;
    setupLighting(lightsGroup, envPreset);

    // Rejilla de Suelo Oscura
    const gridHelper = new THREE.GridHelper(20, 20, 0x6366f1, 0x1f2937);
    gridHelper.position.y = 0;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    const axesHelper = new THREE.AxesHelper(2);
    scene.add(axesHelper);
    axesHelperRef.current = axesHelper;

    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const delta = clockRef.current.getDelta();
      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      renderer.render(scene, cameraRef.current);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;

      if (cameraRef.current.isPerspectiveCamera) {
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      }
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (renderer.domElement && containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // 2. Focos de Luz de Estudio Potentes + Fondo Negro Puro
  const setupLighting = (group, preset) => {
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    // Fondo siempre Negro Absoluto por defecto salvo blanco específico
    if (preset === 'white') {
      sceneRef.current.background = new THREE.Color(0xf3f4f6);
    } else {
      sceneRef.current.background = new THREE.Color(0x000000); // Negro Total
    }

    // Luz Ambiental de Relleno Suave para evitar zonas 100% oscuras en la sombra
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    group.add(ambientLight);

    // FOCO 1: Foco Principal Frontal-Derecho (SpotLight)
    const spotKey = new THREE.SpotLight(0xffffff, 4.5);
    spotKey.position.set(8, 16, 10);
    spotKey.angle = Math.PI / 3.5;
    spotKey.penumbra = 0.4;
    spotKey.decay = 0;
    spotKey.castShadow = true;
    spotKey.shadow.mapSize.width = 2048;
    spotKey.shadow.mapSize.height = 2048;
    group.add(spotKey);

    // FOCO 2: Foco Trasero / Luz de Contorno (Rim SpotLight)
    const spotRim = new THREE.SpotLight(0x818cf8, 3.5);
    spotRim.position.set(-9, 14, -8);
    spotRim.angle = Math.PI / 3;
    spotRim.penumbra = 0.5;
    spotRim.decay = 0;
    group.add(spotRim);

    // FOCO 3: Foco Cenital Superior (Overhead Top SpotLight)
    const spotTop = new THREE.SpotLight(0xffffff, 2.5);
    spotTop.position.set(0, 20, 2);
    spotTop.angle = Math.PI / 4;
    spotTop.penumbra = 0.3;
    spotTop.decay = 0;
    group.add(spotTop);

    // Personalización según la paleta elegida
    if (preset === 'cyberpunk') {
      spotKey.color.setHex(0xec4899); // Magenta neón
      spotRim.color.setHex(0x06b6d4); // Cyan neón
      spotTop.color.setHex(0xa855f7); // Violeta
    } else if (preset === 'sunset') {
      spotKey.color.setHex(0xf97316); // Naranja cálido
      spotRim.color.setHex(0xfacc15); // Dorado
      spotTop.color.setHex(0xffedd5);
    } else if (preset === 'emerald') {
      spotKey.color.setHex(0x10b981); // Verde Esmeralda
      spotRim.color.setHex(0x34d399); // Menta
      spotTop.color.setHex(0x06b6d4);
    } else if (preset === 'fireice') {
      spotKey.color.setHex(0xef4444); // Fuego Rojo
      spotRim.color.setHex(0x38bdf8); // Hielo Azul
      spotTop.color.setHex(0xffffff);
    } else if (preset === 'studio_pro' || preset === 'studio' || preset === 'dark') {
      // Focos de Estudio Blanco Potente + Fondo Negro Absoluto
      spotKey.color.setHex(0xffffff);
      spotKey.intensity = 5.0;
      spotRim.color.setHex(0xe0e7ff);
      spotRim.intensity = 3.8;
      spotTop.color.setHex(0xffffff);
      spotTop.intensity = 3.0;
    }
  };

  useEffect(() => {
    if (lightsGroupRef.current) {
      setupLighting(lightsGroupRef.current, envPreset);
    }
  }, [envPreset]);

  // 3. Cargar Modelo 3D
  useEffect(() => {
    if (!currentFile || !sceneRef.current) return;

    let isSubscribed = true;
    setLoading(true);
    setError(null);

    const fileUrl = currentFile.isBlob ? currentFile.path : `/api/file?path=${encodeURIComponent(currentFile.path)}`;

    load3DModel(fileUrl, currentFile.name)
      .then(({ object, animations, stats }) => {
        if (!isSubscribed) return;

        if (currentModelRef.current) {
          sceneRef.current.remove(currentModelRef.current);
        }

        originalMaterialsRef.current.clear();
        object.traverse((child) => {
          if (child.isMesh && child.material) {
            originalMaterialsRef.current.set(child.uuid, child.material);
          }
        });

        sceneRef.current.add(object);
        currentModelRef.current = object;

        if (animations && animations.length > 0) {
          const mixer = new THREE.AnimationMixer(object);
          mixerRef.current = mixer;
        } else {
          mixerRef.current = null;
        }

        centerAndFitCamera(object);

        if (onModelLoaded) {
          onModelLoaded({ object, animations, stats, mixer: mixerRef.current });
        }

        setLoading(false);
      })
      .catch((err) => {
        if (!isSubscribed) return;
        console.error('Error al cargar modelo 3D:', err);
        setError(err.message || 'Error al procesar el archivo 3D.');
        setLoading(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [currentFile]);

  const centerAndFitCamera = (object) => {
    if (!object || !cameraRef.current || !controlsRef.current) return;

    const bbox = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    object.position.x = -center.x;
    object.position.y = -bbox.min.y;
    object.position.z = -center.z;

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = cameraRef.current.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.8;

    if (isNaN(cameraZ) || cameraZ === 0) cameraZ = 5;

    cameraRef.current.position.set(0, size.y * 0.8 || 2, cameraZ);
    controlsRef.current.target.set(0, size.y / 2 || 0.5, 0);
    controlsRef.current.update();

    if (gridHelperRef.current) {
      gridHelperRef.current.scale.setScalar(Math.max(1, maxDim / 10));
    }
  };

  useEffect(() => {
    if (!currentModelRef.current) return;

    currentModelRef.current.traverse((child) => {
      if (child.isMesh) {
        const origMat = originalMaterialsRef.current.get(child.uuid);

        if (renderMode === 'wireframe') {
          child.material = new THREE.MeshBasicMaterial({
            color: 0x818cf8,
            wireframe: true
          });
        } else if (renderMode === 'normals') {
          child.material = new THREE.MeshNormalMaterial();
        } else if (renderMode === 'xray') {
          child.material = new THREE.MeshPhysicalMaterial({
            color: 0x6366f1,
            transparent: true,
            opacity: 0.35,
            roughness: 0.1,
            metalness: 0.1,
            transmission: 0.9
          });
        } else if (renderMode === 'unlit') {
          child.material = new THREE.MeshBasicMaterial({
            map: origMat ? origMat.map : null,
            color: origMat && origMat.color ? origMat.color : 0xffffff
          });
        } else {
          child.material = origMat || child.material;
        }
      }
    });
  }, [renderMode]);

  useEffect(() => {
    if (gridHelperRef.current) gridHelperRef.current.visible = showGrid;
    if (axesHelperRef.current) axesHelperRef.current.visible = showAxes;
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 2.0;
    }
  }, [showGrid, showAxes, autoRotate]);

  useEffect(() => {
    if (!cameraPresetRequest || !currentModelRef.current) return;
    const { preset } = cameraPresetRequest;
    const bbox = new THREE.Box3().setFromObject(currentModelRef.current);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const dist = Math.max(size.x, size.y, size.z) * 2 || 5;

    if (preset === 'front') cameraRef.current.position.set(0, size.y / 2, dist);
    if (preset === 'top') cameraRef.current.position.set(0, dist, 0);
    if (preset === 'side') cameraRef.current.position.set(dist, size.y / 2, 0);
    if (preset === 'iso') cameraRef.current.position.set(dist, dist, dist);

    controlsRef.current.target.set(0, size.y / 2, 0);
    controlsRef.current.update();
  }, [cameraPresetRequest]);

  useEffect(() => {
    if (resetCameraRequest && currentModelRef.current) {
      centerAndFitCamera(currentModelRef.current);
    }
  }, [resetCameraRequest]);

  useEffect(() => {
    if (!snapshotRequest || !rendererRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
    const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `NexoIP3D_${currentFile?.name || 'captura'}.png`;
    link.href = dataUrl;
    link.click();
  }, [snapshotRequest]);

  useEffect(() => {
    if (!nodeVisibilityToggle || !currentModelRef.current) return;
    const { uuid, visible } = nodeVisibilityToggle;
    currentModelRef.current.traverse((child) => {
      if (child.uuid === uuid) {
        child.visible = visible;
      }
    });
  }, [nodeVisibilityToggle]);

  return (
    <div className="relative w-full h-full bg-black">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing bg-black" />

      {loading && (
        <div className="absolute inset-0 glass-panel bg-black/85 backdrop-blur-md flex flex-col items-center justify-center gap-3 z-30 animate-fade-in">
          <RefreshCw size={38} className="animate-spin text-indigo-400" />
          <p className="text-sm font-semibold text-gray-100">Cargando objeto 3D con foco de estudio...</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 glass-panel bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-30 animate-fade-in">
          <AlertTriangle size={48} className="text-red-400 mb-3" />
          <h3 className="text-lg font-bold text-red-200 mb-1">No se pudo abrir el archivo 3D</h3>
          <p className="text-xs text-red-300 font-mono max-w-md">{error}</p>
        </div>
      )}

      {!currentFile && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 z-10 pointer-events-none">
          <div className="glass-panel p-8 rounded-3xl max-w-md border border-white/10 shadow-2xl pointer-events-auto space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
              <UploadCloud size={32} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-1">NexoIP 3D Viewer</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Fondo negro total con triple foco de luz de estudio. Usa las flechas <span className="text-indigo-300 font-mono font-bold">← / →</span> para navegar entre objetos 3D.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
