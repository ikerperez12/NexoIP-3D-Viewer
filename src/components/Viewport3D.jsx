import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AlertTriangle, RefreshCw, UploadCloud } from 'lucide-react';
import { disposeModelResources, load3DModel } from '../utils/loaders.js';
import { callNexoip, responseModelUrl } from '../utils/nexoip.js';

function disposeLightGroup(group) {
  group?.traverse((object) => object.shadow?.dispose?.());
  group?.clear();
}

function revokeBlobUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function safeDownloadName(fileName) {
  return String(fileName || 'captura').replace(/[^a-z0-9._-]+/gi, '_');
}

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
  selectedClipIndex,
  isPlaying,
  playbackSpeed,
  seekRequest,
  onModelLoaded,
  onAnimationProgress,
  onSnapshotResult,
  onModelError,
  nodeVisibilityToggle
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const perspectiveCameraRef = useRef(null);
  const orthographicCameraRef = useRef(null);
  const controlsRef = useRef(null);
  const currentModelRef = useRef(null);
  const mixerRef = useRef(null);
  const activeActionRef = useRef(null);
  const animationsRef = useRef([]);
  const clockRef = useRef(new THREE.Clock());
  const lightsGroupRef = useRef(null);
  const gridHelperRef = useRef(null);
  const axesHelperRef = useRef(null);
  const originalMaterialsRef = useRef(new Map());
  const previewMaterialsRef = useRef(new Set());
  const lastProgressTimeRef = useRef(0);

  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(null);
  const [error, setError] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const updateOrthographicFrustum = (camera, width, height) => {
    if (!camera) return;
    const viewSize = camera.userData.viewSize || 10;
    const aspect = Math.max(width / Math.max(height, 1), 0.01);
    camera.left = -(viewSize * aspect) / 2;
    camera.right = (viewSize * aspect) / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
  };

  const setupLighting = (group, preset) => {
    disposeLightGroup(group);
    if (!sceneRef.current) return;

    sceneRef.current.background = new THREE.Color(preset === 'white' ? 0xf3f4f6 : 0x000000);
    group.add(new THREE.HemisphereLight(0xffffff, 0x080808, 0.55));

    const addSpotlight = ({ color, intensity, position, angle, penumbra, castShadow = false }) => {
      const light = new THREE.SpotLight(color, intensity, 0, angle, penumbra, 0);
      light.position.copy(position);
      light.target.position.set(0, 0, 0);
      light.castShadow = castShadow;
      if (castShadow) {
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.0005;
      }
      group.add(light, light.target);
      return light;
    };

    const palette = {
      cyberpunk: [0xec4899, 0x06b6d4, 0xa855f7],
      sunset: [0xf97316, 0xfacc15, 0xffedd5],
      emerald: [0x10b981, 0x34d399, 0x06b6d4],
      fireice: [0xef4444, 0x38bdf8, 0xffffff],
      studio_pro: [0xffffff, 0xe0e7ff, 0xffffff],
      white: [0xffffff, 0xe5e7eb, 0xffffff]
    }[preset] || [0xffffff, 0xe0e7ff, 0xffffff];

    addSpotlight({
      color: palette[0], intensity: 4.8, position: new THREE.Vector3(8, 16, 10),
      angle: Math.PI / 3.5, penumbra: 0.45, castShadow: true
    });
    addSpotlight({
      color: palette[1], intensity: 3.1, position: new THREE.Vector3(-9, 14, -8),
      angle: Math.PI / 3, penumbra: 0.55
    });
    addSpotlight({
      color: palette[2], intensity: 2.4, position: new THREE.Vector3(0, 20, 2),
      angle: Math.PI / 4, penumbra: 0.35
    });
  };

  const disposePreviewMaterials = () => {
    previewMaterialsRef.current.forEach((material) => material.dispose());
    previewMaterialsRef.current.clear();
  };

  const restoreOriginalMaterials = () => {
    const model = currentModelRef.current;
    if (!model) return;
    model.traverse((child) => {
      if (!child.isMesh) return;
      const original = originalMaterialsRef.current.get(child.uuid);
      if (original) child.material = original;
    });
    disposePreviewMaterials();
  };

  const releaseCurrentModel = () => {
    const model = currentModelRef.current;
    if (!model) return;

    const mixer = mixerRef.current;
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    }
    restoreOriginalMaterials();
    sceneRef.current?.remove(model);
    disposeModelResources(model);
    currentModelRef.current = null;
    mixerRef.current = null;
    activeActionRef.current = null;
    animationsRef.current = [];
    originalMaterialsRef.current.clear();
  };

  const centerAndFitCamera = (object) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!object || !camera || !controls) return;

    const boundingBox = new THREE.Box3().setFromObject(object);
    if (boundingBox.isEmpty()) return;
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 0.01);

    object.position.sub(center);
    object.position.y -= boundingBox.min.y - center.y;
    controls.target.set(0, size.y / 2, 0);

    if (camera.isOrthographicCamera) {
      camera.userData.viewSize = maxDimension * 1.8;
      updateOrthographicFrustum(camera, containerRef.current?.clientWidth || 1, containerRef.current?.clientHeight || 1);
      camera.position.set(maxDimension * 1.35, maxDimension, maxDimension * 1.35);
    } else {
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = Math.max((maxDimension / 2) / Math.tan(fov / 2) * 1.8, 1);
      camera.position.set(0, Math.max(size.y * 0.8, maxDimension * 0.25), distance);
    }
    camera.lookAt(controls.target);
    controls.update();
    gridHelperRef.current?.scale.setScalar(Math.max(1, maxDimension / 10));
  };

  const applyRenderMode = (mode) => {
    const model = currentModelRef.current;
    if (!model) return;

    restoreOriginalMaterials();
    if (mode === 'pbr') return;

    model.traverse((child) => {
      if (!child.isMesh) return;
      const original = originalMaterialsRef.current.get(child.uuid);
      const sourceMaterial = Array.isArray(original) ? original[0] : original;
      let previewMaterial;

      if (mode === 'wireframe') {
        previewMaterial = new THREE.MeshBasicMaterial({ color: 0x818cf8, wireframe: true });
      } else if (mode === 'normals') {
        previewMaterial = new THREE.MeshNormalMaterial();
      } else if (mode === 'xray') {
        previewMaterial = new THREE.MeshPhysicalMaterial({
          color: 0x6366f1, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, transmission: 0.9
        });
      } else if (mode === 'unlit') {
        previewMaterial = new THREE.MeshBasicMaterial({
          map: sourceMaterial?.map || null,
          color: sourceMaterial?.color || 0xffffff
        });
      }

      if (previewMaterial) {
        child.material = previewMaterial;
        previewMaterialsRef.current.add(previewMaterial);
      }
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const perspectiveCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const orthographicCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 1000);
    orthographicCamera.userData.viewSize = 10;
    updateOrthographicFrustum(orthographicCamera, width, height);
    perspectiveCamera.position.set(3, 2, 5);
    orthographicCamera.position.copy(perspectiveCamera.position);
    perspectiveCameraRef.current = perspectiveCamera;
    orthographicCameraRef.current = orthographicCamera;
    cameraRef.current = perspectiveCamera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(perspectiveCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI;
    controlsRef.current = controls;

    const lights = new THREE.Group();
    scene.add(lights);
    lightsGroupRef.current = lights;
    setupLighting(lights, envPreset);

    const grid = new THREE.GridHelper(20, 20, 0x6b7280, 0x1f2937);
    scene.add(grid);
    gridHelperRef.current = grid;
    const axes = new THREE.AxesHelper(2);
    scene.add(axes);
    axesHelperRef.current = axes;

    let frameId = 0;
    const renderFrame = () => {
      frameId = window.requestAnimationFrame(renderFrame);
      const delta = Math.min(clockRef.current.getDelta(), 0.1);
      mixerRef.current?.update(delta);
      controls.update();
      renderer.render(scene, cameraRef.current);

      const action = activeActionRef.current;
      const now = performance.now();
      if (action?.getClip().duration && now - lastProgressTimeRef.current > 80) {
        lastProgressTimeRef.current = now;
        onAnimationProgress?.(THREE.MathUtils.clamp(action.time / action.getClip().duration, 0, 1));
      }
    };
    const startRendering = () => {
      if (!document.hidden && !frameId) {
        clockRef.current.start();
        renderFrame();
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      } else {
        startRendering();
      }
    };
    const resize = () => {
      const nextWidth = Math.max(container.clientWidth, 1);
      const nextHeight = Math.max(container.clientHeight, 1);
      perspectiveCamera.aspect = nextWidth / nextHeight;
      perspectiveCamera.updateProjectionMatrix();
      updateOrthographicFrustum(orthographicCamera, nextWidth, nextHeight);
      renderer.setSize(nextWidth, nextHeight, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    startRendering();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frameId);
      releaseCurrentModel();
      disposeLightGroup(lights);
      grid.geometry.dispose();
      axes.geometry.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.clear();
      rendererRef.current = null;
    };
  // Scene resources deliberately have one lifecycle; refs keep mutable Three.js state current.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lightsGroupRef.current) setupLighting(lightsGroupRef.current, envPreset);
  }, [envPreset]);

  useEffect(() => {
    const controls = controlsRef.current;
    const nextCamera = isOrthographic ? orthographicCameraRef.current : perspectiveCameraRef.current;
    if (!controls || !nextCamera || cameraRef.current === nextCamera) return;

    if (nextCamera.isOrthographicCamera && currentModelRef.current) {
      const size = new THREE.Box3().setFromObject(currentModelRef.current).getSize(new THREE.Vector3());
      nextCamera.userData.viewSize = Math.max(size.x, size.y, size.z, 0.01) * 1.8;
      updateOrthographicFrustum(nextCamera, containerRef.current?.clientWidth || 1, containerRef.current?.clientHeight || 1);
    }
    nextCamera.position.copy(cameraRef.current.position);
    nextCamera.quaternion.copy(cameraRef.current.quaternion);
    controls.object = nextCamera;
    cameraRef.current = nextCamera;
    nextCamera.lookAt(controls.target);
    controls.update();
  }, [isOrthographic]);

  useEffect(() => {
    if (!currentFile?.id || !sceneRef.current) return undefined;
    let cancelled = false;
    let modelUrl = null;

    const loadModel = async () => {
      setLoading(true);
      setLoadProgress(0);
      setError(null);
      try {
        modelUrl = responseModelUrl(await callNexoip('getModelUrl', currentFile.id));
        if (!modelUrl) throw new Error('No se pudo resolver la ubicación segura del modelo.');
        const { object, animations, stats } = await load3DModel(modelUrl, currentFile.name, (value) => {
          if (!cancelled) setLoadProgress(value);
        });
        if (cancelled) {
          disposeModelResources(object);
          return;
        }

        releaseCurrentModel();
        originalMaterialsRef.current.clear();
        object.traverse((child) => {
          if (child.isMesh && child.material) originalMaterialsRef.current.set(child.uuid, child.material);
        });
        sceneRef.current.add(object);
        currentModelRef.current = object;
        animationsRef.current = animations || [];
        mixerRef.current = animationsRef.current.length ? new THREE.AnimationMixer(object) : null;
        activeActionRef.current = null;
        if (mixerRef.current) {
          const initialClip = animationsRef.current[selectedClipIndex] || animationsRef.current[0];
          const initialAction = mixerRef.current.clipAction(initialClip);
          initialAction.enabled = true;
          initialAction.setEffectiveTimeScale(playbackSpeed);
          initialAction.paused = !isPlaying;
          initialAction.play();
          activeActionRef.current = initialAction;
        }
        centerAndFitCamera(object);
        applyRenderMode(renderMode);
        onModelLoaded?.({ object, animations: animationsRef.current, stats });
        setLoading(false);
        setLoadProgress(null);
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : 'Error al procesar el archivo 3D.';
        setError(message);
        setLoading(false);
        setLoadProgress(null);
        onModelError?.(message);
      } finally {
        revokeBlobUrl(modelUrl);
      }
    };

    void loadModel();
    return () => {
      cancelled = true;
    };
  // Reload only when the opaque model id changes or the user explicitly retries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFile?.id, retryNonce]);

  useEffect(() => {
    applyRenderMode(renderMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderMode]);

  useEffect(() => {
    if (gridHelperRef.current) gridHelperRef.current.visible = showGrid;
    if (axesHelperRef.current) axesHelperRef.current.visible = showAxes;
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 1.6;
    }
  }, [showGrid, showAxes, autoRotate]);

  useEffect(() => {
    const mixer = mixerRef.current;
    const clips = animationsRef.current;
    if (!mixer || !clips.length) return;

    const clip = clips[selectedClipIndex] || clips[0];
    if (activeActionRef.current?.getClip() !== clip) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip);
      action.reset();
      action.enabled = true;
      action.setEffectiveTimeScale(playbackSpeed);
      action.paused = !isPlaying;
      action.play();
      activeActionRef.current = action;
    } else {
      activeActionRef.current.setEffectiveTimeScale(playbackSpeed);
      activeActionRef.current.paused = !isPlaying;
      if (isPlaying) activeActionRef.current.play();
    }
  }, [selectedClipIndex, isPlaying, playbackSpeed, currentFile?.id]);

  useEffect(() => {
    const action = activeActionRef.current;
    if (!action || !seekRequest) return;
    const duration = action.getClip().duration;
    action.time = THREE.MathUtils.clamp(seekRequest.value, 0, 1) * duration;
    mixerRef.current?.update(0);
    onAnimationProgress?.(THREE.MathUtils.clamp(seekRequest.value, 0, 1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest]);

  useEffect(() => {
    if (!cameraPresetRequest || !currentModelRef.current || !cameraRef.current || !controlsRef.current) return;
    const bounds = new THREE.Box3().setFromObject(currentModelRef.current);
    const size = bounds.getSize(new THREE.Vector3());
    const distance = Math.max(size.length() * 0.9, 2);
    const target = controlsRef.current.target;
    const camera = cameraRef.current;

    if (cameraPresetRequest.preset === 'front') camera.position.set(target.x, target.y, target.z + distance);
    if (cameraPresetRequest.preset === 'top') camera.position.set(target.x, target.y + distance, target.z + 0.001);
    if (cameraPresetRequest.preset === 'side') camera.position.set(target.x + distance, target.y, target.z);
    if (cameraPresetRequest.preset === 'iso') camera.position.set(target.x + distance, target.y + distance, target.z + distance);
    camera.lookAt(target);
    controlsRef.current.update();
  }, [cameraPresetRequest]);

  useEffect(() => {
    if (resetCameraRequest && currentModelRef.current) centerAndFitCamera(currentModelRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetCameraRequest]);

  useEffect(() => {
    if (!nodeVisibilityToggle || !currentModelRef.current) return;
    currentModelRef.current.traverse((child) => {
      if (child.uuid === nodeVisibilityToggle.uuid) child.visible = nodeVisibilityToggle.visible;
    });
  }, [nodeVisibilityToggle]);

  useEffect(() => {
    if (!snapshotRequest || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    let cancelled = false;
    const capture = async () => {
      try {
        const renderer = rendererRef.current;
        const sourceWidth = Math.max(renderer.domElement.width, 1);
        const sourceHeight = Math.max(renderer.domElement.height, 1);
        const scale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
        const pixels = new Uint8Array(width * height * 4);
        try {
          renderer.setRenderTarget(target);
          renderer.render(sceneRef.current, cameraRef.current);
          renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        } finally {
          renderer.setRenderTarget(null);
          target.dispose();
        }
        if (cancelled) return;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No se pudo preparar la captura.');
        const imageData = context.createImageData(width, height);
        for (let row = 0; row < height; row += 1) {
          const source = (height - row - 1) * width * 4;
          imageData.data.set(pixels.subarray(source, source + width * 4), row * width * 4);
        }
        context.putImageData(imageData, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('No se pudo codificar la captura PNG.');
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `NexoIP3D_${safeDownloadName(currentFile?.name)}.png`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        onSnapshotResult?.(null);
      } catch (snapshotError) {
        onSnapshotResult?.(snapshotError instanceof Error ? snapshotError.message : 'No se pudo guardar la captura.');
      }
    };
    void capture();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotRequest]);

  return (
    <section className="relative h-full w-full bg-black" aria-label="Lienzo de modelo 3D" aria-busy={loading}>
      <div ref={containerRef} className="h-full w-full cursor-grab bg-black active:cursor-grabbing" />

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center backdrop-blur-md" role="status" aria-live="polite">
          <RefreshCw size={38} aria-hidden="true" className="animate-spin text-amber-400" />
          <p className="text-sm font-semibold text-gray-100">Cargando objeto 3D…</p>
          {loadProgress !== null && <progress className="h-2 w-56 accent-amber-400" value={loadProgress} max="1">{Math.round(loadProgress * 100)}%</progress>}
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-red-950/90 p-6 text-center backdrop-blur-md" role="alert">
          <AlertTriangle size={48} aria-hidden="true" className="mb-3 text-red-400" />
          <h2 className="mb-1 text-lg font-bold text-red-100">No se pudo abrir el archivo 3D</h2>
          <p className="max-w-md text-xs text-red-200">{error}</p>
          <button type="button" onClick={() => setRetryNonce((value) => value + 1)} className="mt-4 rounded-lg border border-red-300/60 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900/50">
            Reintentar
          </button>
        </div>
      )}

      {!currentFile && !loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center">
          <div className="glass-panel max-w-md space-y-4 rounded-3xl border border-white/10 p-8 shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-600/20 text-amber-300">
              <UploadCloud size={32} aria-hidden="true" />
            </div>
            <div>
              <h2 className="mb-1 text-xl font-bold text-white">NexoIP 3D Viewer</h2>
              <p className="text-xs leading-relaxed text-gray-300">Selecciona un modelo de la biblioteca o abre un archivo local compatible.</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
